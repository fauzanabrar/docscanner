import { Router } from 'express'
import multer from 'multer'
import { PDFDocument } from 'pdf-lib'
import { v4 as uuidv4 } from 'uuid'
import { writeFile, rename, mkdir, unlink, readdir, stat } from 'fs/promises'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'fs'
import path from 'path'
import { tmpdir } from 'os'
import { lookup } from 'dns/promises'
import { isIP } from 'net'
import { ZipArchive } from 'archiver'
import youtubedl from 'youtube-dl-exec'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'

// Tell fluent-ffmpeg to use the static binary we just installed
ffmpeg.setFfmpegPath(ffmpegStatic)

const router = Router()
const MAX_UPLOAD_BYTES = Math.min(
  2 * 1024 * 1024 * 1024,
  Math.max(1024 * 1024, Number.parseInt(process.env.MAX_UPLOAD_SIZE || String(500 * 1024 * 1024), 10) || (500 * 1024 * 1024))
)
const MAX_UPLOAD_MEGABYTES = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))

const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tmpdir()),
  filename: (req, file, cb) => cb(null, `input_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '')}`)
})
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES }
})
const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: MAX_UPLOAD_BYTES }
})

// Persistent video jobs store. In Docker, UPLOAD_DIR is mounted on the
// docscanner-data volume, so completed audio jobs survive container restarts.
const JOBS_ROOT = path.join(process.env.UPLOAD_DIR || path.join(tmpdir(), 'docscanner'), 'video-jobs')
const AUDIO_RESULTS_DIR = path.join(JOBS_ROOT, 'audio')
const JOBS_FILE = path.join(JOBS_ROOT, 'jobs.json')
const LEGACY_JOBS_FILE = path.join(tmpdir(), 'docscanner_video_jobs.json')
mkdirSync(AUDIO_RESULTS_DIR, { recursive: true })

const videoJobs = new Map()
const activeVideoJobs = new Map()
let saveJobsQueue = Promise.resolve()

function isPathInside(root, candidate) {
  if (!candidate || typeof candidate !== 'string') return false
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function isManagedJobPath(candidate) {
  return isPathInside(tmpdir(), candidate) || isPathInside(JOBS_ROOT, candidate)
}

async function safeUnlink(candidate) {
  if (!candidate) return
  if (!isManagedJobPath(candidate)) {
    console.warn(`Refused to delete unmanaged job path: ${candidate}`)
    return
  }
  await unlink(candidate).catch(() => {})
}

function saveJobs() {
  const obj = {}
  for (const [k, v] of videoJobs) obj[k] = v
  const snapshot = JSON.stringify(obj, null, 2)
  const tempFile = `${JOBS_FILE}.tmp`
  const operation = saveJobsQueue.then(async () => {
    await writeFile(tempFile, snapshot)
    await rename(tempFile, JOBS_FILE)
  })
  saveJobsQueue = operation.catch(error => {
    console.error('Failed to persist video jobs:', error.message)
  })
  return operation
}

function normalizeLoadedJob(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) return null
  if (!['processing', 'done', 'error'].includes(job.status)) return null

  const normalized = { ...job }
  for (const key of ['resultPath', 'inputPath', 'outputPath']) {
    if (normalized[key] && !isManagedJobPath(normalized[key])) delete normalized[key]
  }
  if (normalized.status === 'done' && !normalized.resultPath) {
    normalized.status = 'error'
    normalized.error = 'File no longer available.'
  }
  return normalized
}

function loadJobs() {
  let sourceFile = JOBS_FILE
  try {
    sourceFile = existsSync(JOBS_FILE) ? JOBS_FILE : LEGACY_JOBS_FILE
    if (!existsSync(sourceFile)) return
    const raw = readFileSync(sourceFile, 'utf-8')
    const obj = JSON.parse(raw)
    let jobsChanged = false
    for (const [k, rawJob] of Object.entries(obj)) {
      const v = normalizeLoadedJob(rawJob)
      if (!v) {
        jobsChanged = true
        continue
      }
      // Jobs that were mid-download when server stopped are stuck — mark as error
      if (v.status === 'processing') {
        v.status = 'error'
        v.error = 'Processing was interrupted because the server restarted.'
        jobsChanged = true
      }
      // Verify done jobs still have their file
      if (v.status === 'done' && v.resultPath && !existsSync(v.resultPath)) {
        v.status = 'error'
        v.error = 'File no longer available.'
        jobsChanged = true
      }
      videoJobs.set(k, v)
    }
    console.log(`Loaded ${videoJobs.size} saved video jobs`)
    if (sourceFile === LEGACY_JOBS_FILE || jobsChanged) saveJobs()
  } catch (e) {
    console.error('Failed to load video jobs:', e.message)
    if (existsSync(sourceFile)) {
      try {
        renameSync(sourceFile, `${sourceFile}.corrupt-${Date.now()}`)
        console.error('The invalid jobs file was quarantined; the server started with an empty job registry.')
      } catch (quarantineError) {
        console.error('Failed to quarantine invalid jobs file:', quarantineError.message)
      }
    }
  }
}

loadJobs()

// ─── Temp file cleanup (every hour, remove files older than 1 day) ─────────────
const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000
const TEMP_PREFIXES = ['video_', 'compressed_', 'input_', 'batch_urls_']

async function cleanupTempFiles() {
  try {
    const dir = tmpdir()
    const files = await readdir(dir)
    const now = Date.now()
    let removed = 0

    for (const file of files) {
      if (!TEMP_PREFIXES.some(p => file.startsWith(p))) continue
      try {
        const filePath = path.join(dir, file)
        const s = await stat(filePath)
        if (now - s.mtimeMs > TEMP_MAX_AGE_MS) {
          await unlink(filePath)
          removed++
        }
      } catch { /* file may have been deleted already */ }
    }

    // Purge jobs whose resultPath no longer exists
    let purged = 0
    for (const [jid, job] of videoJobs) {
      if (job.status === 'done' && job.resultPath && !existsSync(job.resultPath)) {
        videoJobs.delete(jid)
        purged++
      }
    }
    if (purged > 0) saveJobs()

    if (removed > 0 || purged > 0) {
      console.log(`Temp cleanup: removed ${removed} files, purged ${purged} stale jobs`)
    }
  } catch (e) {
    console.error('Temp cleanup error:', e.message)
  }
}

cleanupTempFiles()
setInterval(cleanupTempFiles, 60 * 60 * 1000)

router.get('/video/job/:jobId', (req, res) => {
  const job = videoJobs.get(req.params.jobId)
  if (!job) return res.status(404).json({ error: 'Job not found' })
  const { resultPath, inputPath, outputPath, ...publicJob } = job
  res.json(publicJob)
})

router.get('/video/result/:jobId', (req, res) => {
  const job = videoJobs.get(req.params.jobId)
  if (!job || job.status !== 'done') return res.status(400).json({ error: 'Not ready' })
  if (!job.resultPath || !existsSync(job.resultPath)) {
    return res.status(410).json({ error: 'The result file is no longer available.' })
  }

  res.download(job.resultPath, job.filename)
})

router.delete('/video/job/:jobId', async (req, res) => {
  const job = videoJobs.get(req.params.jobId)
  const activeJob = activeVideoJobs.get(req.params.jobId)
  if (activeJob) {
    activeJob.kill?.()
    activeVideoJobs.delete(req.params.jobId)
  }
  if (!job && activeJob) {
    await Promise.all((activeJob.paths || []).map(safeUnlink))
    await removeAudioJobFiles(req.params.jobId)
  }
  if (job) {
    const paths = new Set([
      job.resultPath,
      job.inputPath,
      job.outputPath,
      ...(activeJob?.paths || [])
    ].filter(Boolean))
    await Promise.all([...paths].map(safeUnlink))
    if (job.type === 'audio-convert') await removeAudioJobFiles(req.params.jobId)
    videoJobs.delete(req.params.jobId)
    try {
      await saveJobs()
    } catch {
      videoJobs.set(req.params.jobId, {
        ...job,
        status: 'error',
        error: 'Job deletion must be retried.',
        resultPath: undefined,
        inputPath: undefined,
        outputPath: undefined
      })
      return res.status(503).json({ error: 'The job was removed, but the registry could not be persisted. Retry the request.' })
    }
  }
  res.json({ success: true })
})

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

router.post('/pdf/generate', memoryUpload.array('images', 20), async (req, res) => {
  try {
    const pdfDoc = await PDFDocument.create()
    
    for (const file of req.files) {
      const image = file.mimetype === 'image/png'
        ? await pdfDoc.embedPng(file.buffer)
        : await pdfDoc.embedJpg(file.buffer)
      const page = pdfDoc.addPage([image.width, image.height])
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
    }
    
    const pdfBytes = await pdfDoc.save()
    const filename = req.body.filename || `document_${Date.now()}`
    
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`)
    res.send(Buffer.from(pdfBytes))
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate PDF' })
  }
})

router.post('/documents', async (req, res) => {
  const { title, pages } = req.body
  const docId = uuidv4()
  const uploadDir = process.env.UPLOAD_DIR || '/data/docscanner/uploads'
  const docDir = path.join(uploadDir, docId)
  
  if (!existsSync(docDir)) {
    await mkdir(docDir, { recursive: true })
  }
  
  res.json({ id: docId, title, pageCount: pages?.length || 0, createdAt: new Date().toISOString() })
})

router.get('/documents', (req, res) => {
  res.json({ documents: [] })
})

// ─── PDF Merge (Combine) ───────────────────────────────────────────────────────
router.post('/pdf/merge', memoryUpload.array('files', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Please upload at least 1 PDF file to merge.' })
    }

    const mergedPdf = await PDFDocument.create()
    const loadedDocs = []
    
    for (const file of req.files) {
      loadedDocs.push(await PDFDocument.load(file.buffer, { ignoreEncryption: true }))
    }

    if (req.body.pageOrder) {
      const pageOrder = JSON.parse(req.body.pageOrder)
      
      const copiedPagesMap = new Map()
      for (let i = 0; i < loadedDocs.length; i++) {
        const indices = new Set()
        pageOrder.forEach(p => { if (p.fileIndex === i) indices.add(p.pageIndex) })
        if (indices.size > 0) {
          const uniqueIndices = Array.from(indices).sort((a, b) => a - b)
          const copied = await mergedPdf.copyPages(loadedDocs[i], uniqueIndices)
          const pageMap = new Map()
          uniqueIndices.forEach((idx, copyIdx) => pageMap.set(idx, copied[copyIdx]))
          copiedPagesMap.set(i, pageMap)
        }
      }

      for (const p of pageOrder) {
        if (copiedPagesMap.has(p.fileIndex) && copiedPagesMap.get(p.fileIndex).has(p.pageIndex)) {
          const page = copiedPagesMap.get(p.fileIndex).get(p.pageIndex)
          mergedPdf.addPage(page)
        }
      }
    } else {
      // Legacy support
      for (const srcDoc of loadedDocs) {
        const pageIndices = srcDoc.getPageIndices()
        const copiedPages = await mergedPdf.copyPages(srcDoc, pageIndices)
        copiedPages.forEach(page => mergedPdf.addPage(page))
      }
    }

    const pdfBytes = await mergedPdf.save()
    const filename = req.body.filename || `merged_${Date.now()}`

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`)
    res.send(Buffer.from(pdfBytes))
  } catch (error) {
    console.error('PDF merge error:', error)
    res.status(500).json({ error: 'Failed to merge PDF files.' })
  }
})

// ─── PDF Split ──────────────────────────────────────────────────────────────────
router.post('/pdf/split', memoryUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a PDF file to split.' })
    }

    const srcDoc = await PDFDocument.load(req.file.buffer, { ignoreEncryption: true })
    const totalPages = srcDoc.getPageCount()

    // Parse ranges from body, e.g. "1-3,5,7-9" or "all"
    const rangesRaw = req.body.ranges || 'all'
    const pageGroups = parsePageRanges(rangesRaw, totalPages)

    if (pageGroups.length === 0) {
      return res.status(400).json({ error: 'No valid page ranges provided.' })
    }

    // If only one group, return a single PDF directly
    if (pageGroups.length === 1) {
      const newDoc = await PDFDocument.create()
      const copied = await newDoc.copyPages(srcDoc, pageGroups[0])
      copied.forEach(page => newDoc.addPage(page))
      const pdfBytes = await newDoc.save()
      const filename = req.body.filename || `split_${Date.now()}`

      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`)
      return res.send(Buffer.from(pdfBytes))
    }

    // Multiple groups → ZIP
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="split_pages_${Date.now()}.zip"`)

    const archive = new ZipArchive({ zlib: { level: 6 } })
    archive.pipe(res)

    for (let i = 0; i < pageGroups.length; i++) {
      const newDoc = await PDFDocument.create()
      const copied = await newDoc.copyPages(srcDoc, pageGroups[i])
      copied.forEach(page => newDoc.addPage(page))
      const pdfBytes = await newDoc.save()
      const label = formatRangeLabel(pageGroups[i])
      archive.append(Buffer.from(pdfBytes), { name: `part_${i + 1}_pages_${label}.pdf` })
    }

    await archive.finalize()
  } catch (error) {
    console.error('PDF split error:', error)
    res.status(500).json({ error: 'Failed to split PDF.' })
  }
})

// ─── PDF Compress ───────────────────────────────────────────────────────────────
router.post('/pdf/compress', memoryUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a PDF file to compress.' })
    }

    const srcDoc = await PDFDocument.load(req.file.buffer, { ignoreEncryption: true })
    const originalSize = req.file.buffer.length

    // Structural compression: repack with object streams to eliminate redundancy
    const cleanPdfBytes = await srcDoc.save({ useObjectStreams: true, addDefaultPage: false })

    // Second pass: further deduplication with batched object writing
    const reloadedDoc = await PDFDocument.load(cleanPdfBytes, { ignoreEncryption: true })
    const finalBytes = await reloadedDoc.save({
      useObjectStreams: true,
      addDefaultPage: false,
      objectsPerTick: 100
    })

    const compressedSize = finalBytes.length
    const reduction = Math.max(0, Math.round((1 - compressedSize / originalSize) * 100))

    const filename = req.body.filename || `compressed_${Date.now()}`
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`)
    res.setHeader('X-Original-Size', originalSize)
    res.setHeader('X-Compressed-Size', compressedSize)
    res.setHeader('X-Reduction-Percent', reduction)
    res.send(Buffer.from(finalBytes))
  } catch (error) {
    console.error('PDF compress error:', error)
    res.status(500).json({ error: 'Failed to compress PDF.' })
  }
})

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Parse range string like "1-3,5,7-9" into array of index arrays.
 * Each group is an array of 0-based page indices.
 */
function parsePageRanges(raw, totalPages) {
  const trimmed = raw.trim().toLowerCase()

  if (trimmed === 'all') {
    return [Array.from({ length: totalPages }, (_, i) => i)]
  }

  // "each" or "every" → one group per page
  if (trimmed === 'each' || trimmed === 'every') {
    return Array.from({ length: totalPages }, (_, i) => [i])
  }

  const groups = raw.split(',').map(s => s.trim()).filter(Boolean)
  const result = []

  for (const group of groups) {
    const match = group.match(/^(\d+)\s*-\s*(\d+)$/)
    if (match) {
      const start = Math.max(1, parseInt(match[1], 10))
      const end = Math.min(totalPages, parseInt(match[2], 10))
      if (start <= end) {
        result.push(Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i))
      }
    } else {
      const pageNum = parseInt(group, 10)
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
        result.push([pageNum - 1])
      }
    }
  }

  return result
}

function formatRangeLabel(indices) {
  if (indices.length === 1) return String(indices[0] + 1)
  const first = indices[0] + 1
  const last = indices[indices.length - 1] + 1
  return `${first}-${last}`
}

// ─── Video Tools ────────────────────────────────────────────────────────────────

function getDownloadArgs(url, downloadFormat, filepath) {
  const isAudio = downloadFormat === 'mp3'
  const isWebm = downloadFormat.endsWith('-webm')
  const args = [
    url,
    '-o', filepath,
    '--ffmpeg-location', ffmpegStatic,
    '--no-playlist',
    '--newline'
  ]
  if (isAudio) {
    args.push('--extract-audio', '--audio-format', 'mp3', '-f', 'bestaudio/best')
  } else if (downloadFormat === 'best') {
    args.push('--merge-output-format', 'mp4', '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best')
  } else if (isWebm) {
    const height = downloadFormat.split('-')[0].replace('p', '')
    args.push('--merge-output-format', 'webm', '-f', `bestvideo[height<=${height}][ext=webm]+bestaudio[ext=webm]/best[height<=${height}][ext=webm]/best[ext=webm]`)
  } else {
    const height = downloadFormat.replace('p', '')
    args.push('--merge-output-format', 'mp4', '-f', `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}][ext=mp4]/best[ext=mp4]`)
  }
  return args
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return null
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++ }
  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[i]}`
}

const AUDIO_FORMATS = {
  mp3: { extension: 'mp3', codec: 'libmp3lame' },
  m4a: { extension: 'm4a', codec: 'aac' },
  wav: { extension: 'wav', codec: 'pcm_s16le' }
}
const AUDIO_BITRATES = new Set(['128k', '192k', '320k'])
const VIDEO_FILE_EXTENSIONS = new Set([
  '.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.mpeg', '.mpg', '.3gp', '.ts'
])
const MAX_ACTIVE_AUDIO_JOBS = Math.min(8, Math.max(1, Number.parseInt(process.env.MAX_ACTIVE_AUDIO_JOBS || '2', 10) || 2))
const AUDIO_JOB_TIMEOUT_MS = Math.min(
  24 * 60 * 60 * 1000,
  Math.max(60 * 1000, Number.parseInt(process.env.AUDIO_JOB_TIMEOUT_MS || String(2 * 60 * 60 * 1000), 10) || (2 * 60 * 60 * 1000))
)

class AudioJobError extends Error {
  constructor(publicMessage, internalMessage = publicMessage) {
    super(internalMessage)
    this.publicMessage = publicMessage
  }
}

function isValidJobId(jobId) {
  return typeof jobId === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(jobId)
}

function getAudioSettings(format, bitrate) {
  const normalizedFormat = String(format || 'mp3').toLowerCase()
  const normalizedBitrate = bitrate === undefined || bitrate === null || bitrate === '' ? '192k' : String(bitrate).toLowerCase()
  return {
    format: normalizedFormat,
    bitrate: normalizedBitrate,
    config: AUDIO_FORMATS[normalizedFormat],
    validBitrate: AUDIO_BITRATES.has(normalizedBitrate)
  }
}

function activeAudioJobCount() {
  let count = 0
  for (const job of videoJobs.values()) {
    if (job.type === 'audio-convert' && job.status === 'processing') count++
  }
  return count
}

function isPrivateIpAddress(address) {
  if (!address) return true
  const normalized = address.toLowerCase().split('%')[0]
  if (normalized.startsWith('::ffff:')) return isPrivateIpAddress(normalized.slice(7))

  if (isIP(normalized) === 4) {
    const [a, b, c] = normalized.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
  }

  if (isIP(normalized) === 6) {
    return normalized === '::' || normalized === '::1' ||
      normalized.startsWith('fc') || normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) || normalized.startsWith('ff')
  }

  return true
}

async function validateRemoteVideoUrl(rawUrl) {
  let parsedUrl
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    throw new AudioJobError('Enter a valid HTTP or HTTPS video URL.')
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    throw new AudioJobError('Enter a public HTTP or HTTPS video URL without embedded credentials.')
  }

  const hostname = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new AudioJobError('Local or private-network video URLs are not allowed.')
  }

  let addresses
  try {
    addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new AudioJobError('The video URL hostname could not be resolved.')
  }
  if (!addresses.length || addresses.some(record => isPrivateIpAddress(record.address))) {
    throw new AudioJobError('Local or private-network video URLs are not allowed.')
  }

  return parsedUrl
}

function trackActiveJob(jobId, processHandle, paths) {
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    processHandle.kill('SIGKILL')
  }, AUDIO_JOB_TIMEOUT_MS)
  timeout.unref?.()

  const activeJob = {
    paths,
    didTimeout: () => timedOut,
    clear: () => clearTimeout(timeout),
    kill: () => {
      clearTimeout(timeout)
      processHandle.kill('SIGKILL')
    }
  }
  activeVideoJobs.set(jobId, activeJob)
  return activeJob
}

function isSupportedVideoFile(file) {
  if (!file) return false
  return file.mimetype?.startsWith('video/') || VIDEO_FILE_EXTENSIONS.has(path.extname(file.originalname).toLowerCase())
}

function safeAudioFilename(sourceName, extension) {
  const sourceBase = path.parse(sourceName || 'converted_audio').name
  const cleanBase = sourceBase
    .replace(/[^a-zA-Z0-9 _.-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 100) || 'converted_audio'
  return `${cleanBase}.${extension}`
}

function secondsFromTimestamp(value) {
  const parts = String(value || '').trim().split(':').map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null
  return (parts[0] * 3600) + (parts[1] * 60) + parts[2]
}

function updateAudioJob(jobId, updates) {
  const job = videoJobs.get(jobId)
  if (!job || job.status !== 'processing') return false
  Object.assign(job, updates, { updatedAt: new Date().toISOString() })
  videoJobs.set(jobId, job)
  return true
}

async function removeAudioJobFiles(jobId) {
  const prefix = `audio_${jobId}.`
  const files = await readdir(AUDIO_RESULTS_DIR).catch(() => [])
  await Promise.all(files
    .filter(file => file.startsWith(prefix))
    .map(file => safeUnlink(path.join(AUDIO_RESULTS_DIR, file))))
}

async function finishAudioJob(jobId, resultPath, filename) {
  const activeJob = activeVideoJobs.get(jobId)
  activeJob?.clear?.()
  activeVideoJobs.delete(jobId)
  if (!videoJobs.has(jobId)) {
    await safeUnlink(resultPath)
    return
  }
  videoJobs.set(jobId, {
    ...videoJobs.get(jobId),
    status: 'done',
    progress: 100,
    detail: 'Audio is ready to download.',
    resultPath,
    filename,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })
  await saveJobs()
}

async function failAudioJob(jobId, error) {
  const activeJob = activeVideoJobs.get(jobId)
  activeJob?.clear?.()
  activeVideoJobs.delete(jobId)
  if (!videoJobs.has(jobId)) return
  console.error(`Audio conversion job ${jobId} failed:`, error)
  videoJobs.set(jobId, {
    ...videoJobs.get(jobId),
    status: 'error',
    error: error?.publicMessage || 'Audio conversion failed. Verify the source and try again.',
    detail: '',
    updatedAt: new Date().toISOString()
  })
  await saveJobs().catch(() => {})
}

async function createAudioJob(jobId, sourceType, sourceLabel, outputPath) {
  const now = new Date().toISOString()
  videoJobs.set(jobId, {
    type: 'audio-convert',
    sourceType,
    sourceLabel: String(sourceLabel || 'video').slice(0, 200),
    status: 'processing',
    progress: 0,
    detail: sourceType === 'url' ? 'Preparing video download...' : 'Preparing uploaded video...',
    outputPath,
    retainedUntilRemoved: true,
    createdAt: now,
    updatedAt: now
  })
  await saveJobs()
}

async function runUploadedAudioConversion({ jobId, inputPath, outputPath, filename, config, bitrate }) {
  const { spawn } = await import('child_process')
  const args = ['-y', '-i', inputPath, '-vn', '-c:a', config.codec]
  if (config.extension !== 'wav') args.push('-b:a', bitrate)
  args.push(outputPath)

  const proc = spawn(ffmpegStatic, args, { windowsHide: true })
  const activeJob = trackActiveJob(jobId, proc, [inputPath, outputPath])

  let durationSeconds = null
  let errorOutput = ''
  proc.stderr.on('data', chunk => {
    const text = chunk.toString()
    errorOutput = `${errorOutput}${text}`.slice(-8000)

    const durationMatch = text.match(/Duration:\s*(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/)
    if (durationMatch) durationSeconds = secondsFromTimestamp(durationMatch[1])

    const timeMatches = [...text.matchAll(/time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/g)]
    const latestTime = timeMatches.at(-1)?.[1]
    if (latestTime) {
      const currentSeconds = secondsFromTimestamp(latestTime)
      const progress = durationSeconds && currentSeconds !== null
        ? Math.min(99, Math.max(1, Math.floor((currentSeconds / durationSeconds) * 100)))
        : 25
      updateAudioJob(jobId, { progress, detail: `Extracting audio (${latestTime})...` })
    }
  })

  await new Promise((resolve, reject) => {
    proc.on('close', code => {
      if (code === 0) return resolve()
      if (activeJob.didTimeout()) return reject(new AudioJobError('Audio conversion timed out. Try a shorter or smaller video.'))
      reject(new Error(errorOutput || `FFmpeg exited with code ${code}`))
    })
    proc.on('error', reject)
  })

  await safeUnlink(inputPath)
  if (!existsSync(outputPath)) throw new AudioJobError('Conversion finished without an audio file. Verify that the video contains an audio track.')
  await finishAudioJob(jobId, outputPath, filename)
}

async function runUrlAudioConversion({ jobId, url, outputTemplate, outputPath, filename, format, bitrate }) {
  const subprocess = youtubedl.exec(url, {
    output: outputTemplate,
    ffmpegLocation: ffmpegStatic,
    noPlaylist: true,
    newline: true,
    format: 'bestaudio/best',
    extractAudio: true,
    audioFormat: format,
    audioQuality: format === 'wav' ? undefined : bitrate.toUpperCase(),
    maxFilesize: `${MAX_UPLOAD_MEGABYTES}M`,
    socketTimeout: 30,
    retries: 3,
    fragmentRetries: 3,
    fileAccessRetries: 3
  }, { windowsHide: true })

  const activeJob = trackActiveJob(jobId, subprocess, [outputPath])

  let errorOutput = ''
  const parseProgress = text => {
    for (const line of text.replace(/\r/g, '\n').split('\n')) {
      const progressMatch = line.match(/\[download\]\s+([\d.]+)%/)
      if (progressMatch) {
        updateAudioJob(jobId, {
          progress: Math.min(94, Math.max(1, Math.floor(Number(progressMatch[1]) * 0.94))),
          detail: 'Downloading source video...'
        })
      }
      if (/ExtractAudio|ffmpeg|Post-process/i.test(line)) {
        updateAudioJob(jobId, { progress: 96, detail: 'Extracting audio track...' })
      }
    }
  }

  subprocess.stdout?.on('data', chunk => parseProgress(chunk.toString()))
  subprocess.stderr?.on('data', chunk => {
    const text = chunk.toString()
    errorOutput = `${errorOutput}${text}`.slice(-8000)
    parseProgress(text)
  })

  try {
    await subprocess
  } catch (error) {
    if (activeJob.didTimeout()) throw new AudioJobError('Audio conversion timed out. Try a shorter or smaller video.')
    throw new Error(errorOutput || error.message || 'Failed to download the video URL.')
  }

  if (!existsSync(outputPath)) throw new AudioJobError('Conversion finished without an audio file. Verify that the URL contains playable audio.')
  await finishAudioJob(jobId, outputPath, filename)
}

router.post('/video/audio/url', async (req, res) => {
  const { url, jobId, format = 'mp3', bitrate = '192k' } = req.body
  if (!isValidJobId(jobId)) return res.status(400).json({ error: 'A valid jobId is required.' })
  if (videoJobs.has(jobId)) return res.status(409).json({ error: 'This job already exists.' })
  if (activeAudioJobCount() >= MAX_ACTIVE_AUDIO_JOBS) {
    return res.status(429).json({ error: 'The audio converter is busy. Wait for another conversion to finish and try again.' })
  }

  let parsedUrl
  try {
    parsedUrl = await validateRemoteVideoUrl(url)
  } catch (error) {
    return res.status(400).json({ error: error.publicMessage || 'Enter a valid public video URL.' })
  }
  if (videoJobs.has(jobId)) return res.status(409).json({ error: 'This job already exists.' })
  if (activeAudioJobCount() >= MAX_ACTIVE_AUDIO_JOBS) {
    return res.status(429).json({ error: 'The audio converter is busy. Wait for another conversion to finish and try again.' })
  }

  const settings = getAudioSettings(format, bitrate)
  if (!settings.config) return res.status(400).json({ error: 'Unsupported audio format.' })
  if (!settings.validBitrate && settings.format !== 'wav') return res.status(400).json({ error: 'Unsupported audio quality.' })

  const outputBase = path.join(AUDIO_RESULTS_DIR, `audio_${jobId}`)
  const outputPath = `${outputBase}.${settings.config.extension}`
  const outputTemplate = `${outputBase}.%(ext)s`
  const filename = safeAudioFilename('converted_audio', settings.config.extension)

  try {
    await createAudioJob(jobId, 'url', parsedUrl.hostname, outputPath)
  } catch {
    videoJobs.delete(jobId)
    return res.status(503).json({ error: 'The job registry is unavailable. Try again later.' })
  }
  res.status(202).json({ message: 'Audio conversion started.', jobId })

  runUrlAudioConversion({
    jobId,
    url: parsedUrl.toString(),
    outputTemplate,
    outputPath,
    filename,
    format: settings.format,
    bitrate: settings.bitrate
  }).catch(async error => {
    await removeAudioJobFiles(jobId)
    await failAudioJob(jobId, error)
  })
})

router.post('/video/audio/upload', videoUpload.single('file'), async (req, res) => {
  const inputPath = req.file?.path
  try {
    const { jobId, format = 'mp3', bitrate = '192k' } = req.body
    if (!req.file || !isSupportedVideoFile(req.file)) {
      if (inputPath) await safeUnlink(inputPath)
      return res.status(400).json({ error: 'Upload a supported video file.' })
    }
    if (!isValidJobId(jobId)) {
      await safeUnlink(inputPath)
      return res.status(400).json({ error: 'A valid jobId is required.' })
    }
    if (videoJobs.has(jobId)) {
      await safeUnlink(inputPath)
      return res.status(409).json({ error: 'This job already exists.' })
    }
    if (activeAudioJobCount() >= MAX_ACTIVE_AUDIO_JOBS) {
      await safeUnlink(inputPath)
      return res.status(429).json({ error: 'The audio converter is busy. Wait for another conversion to finish and try again.' })
    }

    const settings = getAudioSettings(format, bitrate)
    if (!settings.config) {
      await safeUnlink(inputPath)
      return res.status(400).json({ error: 'Unsupported audio format.' })
    }
    if (!settings.validBitrate && settings.format !== 'wav') {
      await safeUnlink(inputPath)
      return res.status(400).json({ error: 'Unsupported audio quality.' })
    }

    const outputPath = path.join(AUDIO_RESULTS_DIR, `audio_${jobId}.${settings.config.extension}`)
    const filename = safeAudioFilename(req.file.originalname, settings.config.extension)
    await createAudioJob(jobId, 'upload', req.file.originalname, outputPath)
    const job = videoJobs.get(jobId)
    job.inputPath = inputPath
    await saveJobs()

    res.status(202).json({ message: 'Audio conversion started.', jobId })

    runUploadedAudioConversion({
      jobId,
      inputPath,
      outputPath,
      filename,
      config: settings.config,
      bitrate: settings.bitrate
    }).catch(async error => {
      await safeUnlink(inputPath)
      await removeAudioJobFiles(jobId)
      await failAudioJob(jobId, error)
    })
  } catch (error) {
    if (inputPath) await safeUnlink(inputPath)
    const failedJobId = req.body?.jobId
    if (isValidJobId(failedJobId) && videoJobs.get(failedJobId)?.status === 'processing') {
      videoJobs.delete(failedJobId)
      await saveJobs().catch(() => {})
    }
    console.error('Audio upload error:', error)
    res.status(503).json({ error: 'Failed to persist and start the audio conversion. Try again later.' })
  }
})

router.post('/video/size', async (req, res) => {
  const { url, downloadFormat = 'best' } = req.body
  if (!url) return res.status(400).json({ error: 'URL is required' })

  try {
    const { spawn } = await import('child_process')
    const { createRequire } = await import('module')
    const require = createRequire(import.meta.url)
    const ytdlpBin = path.join(path.dirname(require.resolve('youtube-dl-exec')), '..', 'bin', 'yt-dlp.exe')

    const args = [url, '--no-playlist', '--print', 'filesize_approx']
    const fmtArgs = getDownloadArgs(url, downloadFormat, '/dev/null')
    const fmtIdx = fmtArgs.indexOf('-f')
    if (fmtIdx !== -1) args.push('-f', fmtArgs[fmtIdx + 1])
    const mergeIdx = fmtArgs.indexOf('--merge-output-format')
    if (mergeIdx !== -1) args.push('--merge-output-format', fmtArgs[mergeIdx + 1])
    const audioIdx = fmtArgs.indexOf('--extract-audio')
    if (audioIdx !== -1) args.push('--extract-audio', '--audio-format', fmtArgs[fmtArgs.indexOf('--audio-format') + 1])

    const sizeBytes = await new Promise((resolve) => {
      const proc = spawn(ytdlpBin, args, { windowsHide: true })
      let stdout = ''
      proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
      proc.stderr.on('data', () => {})
      proc.on('close', (code) => {
        if (code === 0) {
          const val = parseInt(stdout.trim(), 10)
          resolve(isNaN(val) ? null : val)
        } else {
          resolve(null)
        }
      })
      proc.on('error', () => resolve(null))
    })

    res.json({ sizeBytes, size: formatBytes(sizeBytes) })
  } catch (err) {
    res.json({ sizeBytes: null, size: null })
  }
})

router.post('/video/sizes', async (req, res) => {
  const { urls, downloadFormat = 'best' } = req.body
  if (!urls || !Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: 'urls array is required' })

  try {
    const { spawn } = await import('child_process')
    const { createRequire } = await import('module')
    const require = createRequire(import.meta.url)
    const ytdlpBin = path.join(path.dirname(require.resolve('youtube-dl-exec')), '..', 'bin', 'yt-dlp.exe')

    const batchFile = path.join(tmpdir(), `batch_urls_${Date.now()}.txt`)
    await writeFile(batchFile, urls.join('\n'))

    const fmtArgs = getDownloadArgs(urls[0], downloadFormat, '/dev/null')
    const fmtIdx = fmtArgs.indexOf('-f')
    const mergeIdx = fmtArgs.indexOf('--merge-output-format')
    const audioIdx = fmtArgs.indexOf('--extract-audio')

    const args = [
      '--batch-file', batchFile,
      '--no-playlist',
      '--print', '%(id)s %(filesize_approx)s'
    ]
    if (fmtIdx !== -1) args.push('-f', fmtArgs[fmtIdx + 1])
    if (mergeIdx !== -1) args.push('--merge-output-format', fmtArgs[mergeIdx + 1])
    if (audioIdx !== -1) args.push('--extract-audio', '--audio-format', fmtArgs[fmtArgs.indexOf('--audio-format') + 1])

    const output = await new Promise((resolve) => {
      const proc = spawn(ytdlpBin, args, { windowsHide: true })
      let stdout = ''
      proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
      proc.stderr.on('data', () => {})
      proc.on('close', () => resolve(stdout))
      proc.on('error', () => resolve(''))
    })

    const sizeMap = {}
    for (const line of output.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const spaceIdx = trimmed.indexOf(' ')
      if (spaceIdx === -1) continue
      const id = trimmed.substring(0, spaceIdx)
      const bytes = parseInt(trimmed.substring(spaceIdx + 1), 10)
      if (!isNaN(bytes) && bytes > 0) sizeMap[id] = formatBytes(bytes)
    }

    unlink(batchFile).catch(() => {})
    res.json({ sizes: sizeMap })
  } catch (err) {
    res.json({ sizes: {} })
  }
})

router.post('/video/info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    let finalUrl = url;
    try {
      const parsed = new URL(url);
      const listId = parsed.searchParams.get('list');
      if (listId) {
        finalUrl = `https://www.youtube.com/playlist?list=${listId}`;
      }
    } catch (e) {
      // ignore
    }

    const info = await youtubedl(finalUrl, {
      dumpSingleJson: true,
      flatPlaylist: true,
      ignoreErrors: true,
      noWarnings: true
    });

    res.json(info);
  } catch (err) {
    console.error('Info error:', err);
    res.status(500).json({ error: 'Failed to fetch video information. Ensure the URL is valid.' });
  }
});

router.post('/video/download', async (req, res) => {
  const { url, downloadFormat = 'best', jobId } = req.body
  if (!url) return res.status(400).json({ error: 'URL is required' })
  if (!jobId) return res.status(400).json({ error: 'jobId is required' })

  videoJobs.set(jobId, { type: 'download', status: 'processing', progress: 0, dlInfo: '' })
  saveJobs()
  res.json({ message: 'Download started', jobId })

  // Process asynchronously using spawn for real-time progress
  ;(async () => {
    try {
      const { spawn } = await import('child_process')
      const { createRequire } = await import('module')
      const require = createRequire(import.meta.url)
      const isAudio = downloadFormat === 'mp3'
      const isWebm = downloadFormat.endsWith('-webm')
      const ext = isAudio ? 'mp3' : (isWebm ? 'webm' : 'mp4')
      const filename = `video_${Date.now()}.${ext}`
      const filepath = path.join(tmpdir(), filename)

      const ytdlpBin = path.join(path.dirname(require.resolve('youtube-dl-exec')), '..', 'bin', 'yt-dlp.exe')
      const args = getDownloadArgs(url, downloadFormat, filepath)

      await new Promise((resolve, reject) => {
        const proc = spawn(ytdlpBin, args, { windowsHide: true })
        let stderrData = ''

        const parseOutput = (text) => {
          const lines = text.replace(/\r/g, '\n').split('\n')
          for (const line of lines) {
            const trimmedLine = line.trim()
            if (!trimmedLine) continue
            
            const pctMatch = trimmedLine.match(/\[download\]\s+([\d.]+)%\s+of\s+(.+?)(?:\s+at\s+(.+?))?(?:\s+ETA\s+(.+))?\s*$/)
            if (pctMatch) {
              const pct = parseFloat(pctMatch[1])
              const totalSize = pctMatch[2]?.trim() || ''
              const speed = pctMatch[3]?.trim() || ''
              const eta = pctMatch[4]?.trim() || ''
              const job = videoJobs.get(jobId)
              if (job && job.status === 'processing') {
                job.progress = Math.min(Math.floor(pct), 99)
                job.totalSize = totalSize
                job.speed = speed
                job.eta = eta
                job.dlInfo = [totalSize, speed, eta ? `ETA ${eta}` : ''].filter(Boolean).join(' | ')
                videoJobs.set(jobId, job)
              }
            }
            if (trimmedLine.includes('[Merger]') || trimmedLine.includes('[ffmpeg]') || trimmedLine.includes('Merging')) {
              const job = videoJobs.get(jobId)
              if (job && job.status === 'processing') {
                job.progress = 99
                job.dlInfo = 'Merging audio and video...'
                videoJobs.set(jobId, job)
              }
            }
          }
        }

        proc.stdout.on('data', (chunk) => parseOutput(chunk.toString()))
        proc.stderr.on('data', (chunk) => {
          const text = chunk.toString()
          stderrData += text
          parseOutput(text)
        })

        proc.on('close', (code) => {
          if (code === 0) resolve()
          else reject(new Error(stderrData || `yt-dlp exited with code ${code}`))
        })

        proc.on('error', (err) => reject(err))
      })

      if (!existsSync(filepath)) {
        throw new Error('Video downloaded but output file not found.')
      }

      videoJobs.set(jobId, { status: 'done', resultPath: filepath, filename, progress: 100, dlInfo: '' })
      saveJobs()
    } catch (err) {
      console.error('Download error:', err)
      const msg = err.message || 'Failed to download video.'
      videoJobs.set(jobId, { status: 'error', error: msg })
      saveJobs()
    }
  })()
})

router.post('/video/compress', videoUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Please upload a video file to compress.' })
    const { quality = '480p', jobId, duration, speed = 'ultrafast', removeAudio = 'false', outFormat = 'mp4' } = req.body
    if (!jobId) return res.status(400).json({ error: 'jobId is required' })

    const inputPath = req.file.path
    const isWebm = outFormat === 'webm'
    const ext = isWebm ? 'webm' : 'mp4'
    const outputPath = path.join(tmpdir(), `compressed_${Date.now()}.${ext}`)

    videoJobs.set(jobId, { type: 'compress', status: 'processing', percent: -1, timemark: '00:00:00' })
    saveJobs()
    res.json({ message: 'Compression started', jobId })

    const totalSeconds = duration ? parseFloat(duration) : null

    const qualitySettings = {
      '240p': { res: '426x240', vb: '500k' },
      '360p': { res: '640x360', vb: '800k' },
      '480p': { res: '854x480', vb: '1200k' },
      '720p': { res: '1280x720', vb: '2500k' },
      '1080p': { res: '1920x1080', vb: '5000k' }
    }

    const qs = qualitySettings[quality] || qualitySettings['480p']
    const noAudio = removeAudio === 'true'

    const outputOpts = [
      '-y',
      isWebm ? '-c:v libvpx-vp9' : '-c:v libx264',
      `-preset ${speed}`, // ultrafast, fast, medium, slow
      isWebm ? '-crf 30' : '-crf 23',
      `-b:v ${qs.vb}`,
      `-s ${qs.res}`
    ]

    if (noAudio) {
      outputOpts.push('-an')
    } else {
      outputOpts.push(isWebm ? '-c:a libopus' : '-c:a aac', '-b:a 128k')
    }

    if (!isWebm) {
      outputOpts.push('-movflags +faststart')
    }

    const originalname = req.file.originalname || `video${isWebm ? '.webm' : '.mp4'}`
    const baseName = originalname.substring(0, originalname.lastIndexOf('.')) || originalname
    const compressedFilename = `compressed_${baseName}${extName}`

    // Process asynchronously
    ;(async () => {
      ffmpeg(inputPath)
        .outputOptions(outputOpts)
        .on('progress', (progress) => {
          let p = videoJobs.get(jobId) || { status: 'processing', percent: -1, timemark: '00:00:00' }
          
          if (progress.timemark) {
            p.timemark = progress.timemark
            if (totalSeconds && totalSeconds > 0) {
              const parts = progress.timemark.split(':')
              if (parts.length === 3) {
                const h = parseFloat(parts[0]) || 0
                const m = parseFloat(parts[1]) || 0
                const s = parseFloat(parts[2]) || 0
                const currentSeconds = (h * 3600) + (m * 60) + s
                progress.percent = (currentSeconds / totalSeconds) * 100
              }
            }
          }

          if (progress.percent !== undefined && !isNaN(progress.percent)) {
            let pct = Math.floor(progress.percent)
            if (pct < 0) pct = 0
            if (pct > 99) pct = 99
            p.percent = pct
          }
          
          videoJobs.set(jobId, p)
        })
        .on('end', () => {
          videoJobs.set(jobId, { status: 'done', resultPath: outputPath, filename: compressedFilename, percent: 100, timemark: 'Done' })
          saveJobs()
          unlink(inputPath).catch(console.error)
        })
        .on('error', (err) => {
          console.error('Compress error:', err)
          videoJobs.set(jobId, { status: 'error', error: 'FFmpeg compression failed.' })
          saveJobs()
          unlink(inputPath).catch(console.error)
        })
        .save(outputPath)
    })()

  } catch (error) {
    console.error('Upload error:', error)
    res.status(500).json({ error: 'Failed to start video compression.' })
  }
})

// Error handler for Multer and other middleware errors
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File is too large. Maximum size is ${MAX_UPLOAD_MEGABYTES} MB.` })
    }
    return res.status(400).json({ error: err.message })
  }
  next(err)
})

export default router
