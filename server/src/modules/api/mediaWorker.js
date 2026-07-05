// A SINGLE long-lived worker thread that runs both Whisper transcription and
// m2m100 subtitle translation off the main event loop. Using one persistent
// worker (rather than spawning/terminating one per job) is important: spawning a
// fresh onnxruntime worker after terminating one that already ran inference
// deadlocks onnxruntime-node. Keeping one worker alive also keeps models warm.
//
// Jobs are processed one at a time (a promise queue). Cancellation is
// cooperative: the main thread posts { cmd:'cancel', jobId } and the loop stops
// at the next window/batch boundary. Progress/results are tagged with jobId.
import { parentPort } from 'worker_threads'
import path from 'path'
import { tmpdir } from 'os'

const SR = 16000
const WINDOW = 30 * SR
const OVERLAP = 5 * SR
const STEP = WINDOW - OVERLAP

let transformers = null
const asrCache = new Map()
let translator = null
const cancelled = new Set()

const post = (msg) => parentPort.postMessage(msg)

// Collapse a unit repeated 3+ times in a row (spaces/hyphens) down to two —
// breaks Whisper repetition hallucinations while keeping legit reduplication.
function sanitizeText(text) {
  if (!text) return ''
  return text.replace(/(\S{1,20}?)([-\s]+\1\b){2,}/gi, '$1$2').replace(/\s+/g, ' ').trim()
}

async function ensureTransformers() {
  if (!transformers) {
    transformers = await import('@xenova/transformers')
    transformers.env.cacheDir = process.env.TRANSFORMERS_CACHE || path.join(tmpdir(), 'docscanner_transformers_cache')
    transformers.env.allowLocalModels = false
    // Limit ONNX intra-op threads to avoid CPU contention on small ARM servers.
    // Defaults to all available cores if unset.
    const threads = parseInt(process.env.ORT_NUM_THREADS, 10)
    if (threads > 0) transformers.env.backends.onnx.numThreads = threads
  }
  return transformers
}

async function getAsr(modelId, jobId) {
  if (asrCache.has(modelId)) return asrCache.get(modelId)
  const { pipeline } = await ensureTransformers()
  const p = await pipeline('automatic-speech-recognition', modelId, {
    progress_callback: (pr) => {
      if (pr && pr.status === 'progress' && typeof pr.progress === 'number') {
        post({ jobId, type: 'progress', phase: 'loading-model', percent: Math.max(0, Math.min(100, Math.floor(pr.progress))), file: pr.file || '' })
      }
    }
  })
  asrCache.set(modelId, p)
  return p
}

async function getTranslator(jobId) {
  if (translator) return translator
  const { pipeline } = await ensureTransformers()
  translator = await pipeline('translation', 'Xenova/m2m100_418M', {
    progress_callback: (pr) => {
      if (pr && pr.status === 'progress' && typeof pr.progress === 'number') {
        post({ jobId, type: 'progress', phase: 'loading-model', percent: Math.max(0, Math.min(100, Math.floor(pr.progress))), file: pr.file || '' })
      }
    }
  })
  return translator
}

async function doTranscribe(job) {
  const { jobId, audio, modelId, language } = job
  const asr = await getAsr(modelId, jobId)
  if (cancelled.has(jobId)) return post({ jobId, type: 'cancelled' })

  post({ jobId, type: 'phase', phase: 'transcribing' })

  // Fresh opts each window: transformers.js mutates the opts object (injects
  // forced_decoder_ids) which then conflicts with language/task/return_timestamps.
  const buildOpts = () => {
    const o = { return_timestamps: true, no_repeat_ngram_size: 3, max_new_tokens: 256 }
    if (language) { o.language = language; o.task = 'transcribe' }
    return o
  }

  const total = audio.length
  const numWindows = total <= WINDOW ? 1 : Math.ceil((total - OVERLAP) / STEP)
  const cues = []

  for (let i = 0; i < numWindows; i++) {
    if (cancelled.has(jobId)) return post({ jobId, type: 'cancelled' })
    const startSample = i * STEP
    const endSample = Math.min(total, startSample + WINDOW)
    const slice = audio.subarray(startSample, endSample)
    const offsetSec = startSample / SR
    const isFirst = i === 0
    const isLast = endSample >= total
    const trustStart = offsetSec + (isFirst ? 0 : (OVERLAP / 2) / SR)
    const trustEnd = (endSample / SR) - (isLast ? 0 : (OVERLAP / 2) / SR)

    const out = await asr(slice, buildOpts())
    const outChunks = (out && out.chunks && out.chunks.length)
      ? out.chunks
      : (out && out.text ? [{ timestamp: [0, null], text: out.text }] : [])

    for (const c of outChunks) {
      const text = sanitizeText(c.text || '')
      if (!text) continue
      const ts = c.timestamp || []
      let s = (ts[0] != null && !isNaN(ts[0])) ? ts[0] : 0
      let e = (ts[1] != null && !isNaN(ts[1])) ? ts[1] : s
      s += offsetSec
      e += offsetSec
      if (!isFirst && s < trustStart) continue
      if (!isLast && s >= trustEnd) continue
      cues.push({ start: s, end: e, text })
    }

    post({ jobId, type: 'progress', phase: 'transcribing', percent: Math.round(((i + 1) / numWindows) * 100), index: i + 1, total: numWindows })
  }

  post({ jobId, type: 'result', cues, text: cues.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim() })
}

async function doTranslate(job) {
  const { jobId, cues, srcLang, tgtLang } = job
  const tr = await getTranslator(jobId)
  if (cancelled.has(jobId)) return post({ jobId, type: 'cancelled' })

  post({ jobId, type: 'phase', phase: 'translating' })

  // Greedy decoding (num_beams:1) is ~10x faster than the model's default beam
  // search and plenty accurate for subtitles; max_new_tokens bounds each cue.
  const out = []
  for (let i = 0; i < cues.length; i++) {
    if (cancelled.has(jobId)) return post({ jobId, type: 'cancelled' })
    const cue = cues[i]
    let translated = cue.text
    try {
      const r = await tr(cue.text, { src_lang: srcLang, tgt_lang: tgtLang, num_beams: 1, max_new_tokens: 120 })
      const txt = Array.isArray(r) ? (r[0] && r[0].translation_text) : (r && r.translation_text)
      if (txt && txt.trim()) translated = txt.trim()
    } catch {
      // keep the original text so the .srt stays complete
    }
    out.push({ start: cue.start, end: cue.end, text: translated })
    post({ jobId, type: 'progress', phase: 'translating', percent: Math.round(((i + 1) / cues.length) * 100), index: i + 1, total: cues.length })
  }

  post({ jobId, type: 'result', cues: out })
}

// Serialize jobs through a promise queue so only one runs at a time.
let queue = Promise.resolve()
parentPort.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return
  if (msg.cmd === 'cancel') { cancelled.add(msg.jobId); return }
  if (msg.cmd !== 'transcribe' && msg.cmd !== 'translate') return

  queue = queue.then(async () => {
    if (cancelled.has(msg.jobId)) { cancelled.delete(msg.jobId); return post({ jobId: msg.jobId, type: 'cancelled' }) }
    try {
      if (msg.cmd === 'transcribe') await doTranscribe(msg)
      else await doTranslate(msg)
    } catch (err) {
      post({ jobId: msg.jobId, type: 'error', message: (err && err.message) || 'Worker job failed.' })
    } finally {
      cancelled.delete(msg.jobId)
    }
  })
})
