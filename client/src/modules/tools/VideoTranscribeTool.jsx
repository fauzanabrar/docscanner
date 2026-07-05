import React, { useState, useEffect, useRef } from 'react'

const LANGUAGES = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'id', label: 'Indonesian' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'nl', label: 'Dutch' },
  { value: 'ru', label: 'Russian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'tr', label: 'Turkish' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'th', label: 'Thai' },
  { value: 'pl', label: 'Polish' },
  { value: 'uk', label: 'Ukrainian' }
]

// Translation source/target list (no auto-detect — m2m100 needs explicit codes).
const TRANSLATE_LANGUAGES = LANGUAGES.filter((l) => l.value !== 'auto')
const langLabel = (code) => (LANGUAGES.find((l) => l.value === code) || {}).label || code

function fmtDur(s) {
  if (s == null || isNaN(s)) return ''
  s = Math.max(0, Math.round(s))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

function VideoTranscribeTool() {
  const [file, setFile] = useState(null)
  const [model, setModel] = useState('tiny')
  const [language, setLanguage] = useState('auto')
  const [denoise, setDenoise] = useState(false)
  const [error, setError] = useState(null)

  const [processing, setProcessing] = useState(false)
  const [phase, setPhase] = useState('') // '', 'uploading', 'processing', 'done'
  const [uploadProgress, setUploadProgress] = useState(0)
  const [percent, setPercent] = useState(0)
  const [stage, setStage] = useState('Initializing...')
  const [eta, setEta] = useState(null)
  const [duration, setDuration] = useState(null)
  const [jobId, setJobId] = useState(() => localStorage.getItem('transcribeJobId') || null)
  const [srtText, setSrtText] = useState('')
  const [srtBaseName, setSrtBaseName] = useState('subtitles')
  const [copied, setCopied] = useState(false)

  // ── Translation state ──────────────────────────────────────────────
  const [sourceLang, setSourceLang] = useState('en')
  const [targetLang, setTargetLang] = useState('en')
  const [translateJobId, setTranslateJobId] = useState(() => localStorage.getItem('translateJobId') || null)
  const [translating, setTranslating] = useState(false)
  const [translatePercent, setTranslatePercent] = useState(0)
  const [translateStage, setTranslateStage] = useState('')
  const [translateEta, setTranslateEta] = useState(null)
  const [translatedSrt, setTranslatedSrt] = useState('')
  const [translatedLang, setTranslatedLang] = useState('')
  const [translateError, setTranslateError] = useState(null)
  const [translateCopied, setTranslateCopied] = useState(false)

  // Track mount state so async XHR/poll callbacks never call setState after the
  // component has unmounted (e.g. the user navigated back to "All tools" while a
  // job is still running). The server keeps working regardless.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Poll the transcription job so progress/results survive a refresh or the
  // tab/window being closed and reopened — the server keeps working regardless.
  useEffect(() => {
    if (!jobId) return
    setProcessing(true)
    if (phase !== 'uploading') setPhase('processing')

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/video/job/${jobId}`)
        if (!mountedRef.current) return
        if (res.ok) {
          const data = await res.json()
          if (data.status === 'error') {
            setError(data.error || 'Transcription failed.')
            setProcessing(false); setPhase(''); setJobId(null)
            localStorage.removeItem('transcribeJobId')
            clearInterval(interval)
          } else if (data.status === 'done') {
            setSrtText(data.srtText || '')
            setSrtBaseName((data.filename || 'subtitles.srt').replace(/\.srt$/i, '') || 'subtitles')
            setPercent(100); setStage('Transcription complete!'); setPhase('done')
            setProcessing(false)
            clearInterval(interval)
          } else {
            setStage(data.stage || 'Processing...')
            setEta(typeof data.etaSeconds === 'number' ? data.etaSeconds : null)
            if (typeof data.durationSeconds === 'number') setDuration(data.durationSeconds)
            // Map each phase's REAL percent into a single monotonic overall bar
            // (extract 0–5%, model load 5–15%, transcribe 15–100%).
            const p = typeof data.percent === 'number' && data.percent >= 0 ? data.percent : 0
            let overall
            if (data.phase === 'extracting') overall = p * 0.05
            else if (data.phase === 'loading-model') overall = 5 + p * 0.10
            else if (data.phase === 'transcribing') overall = 15 + p * 0.85
            else overall = p
            setPercent(Math.round(overall))
          }
        } else if (res.status === 404) {
          setProcessing(false); setPhase(''); setJobId(null)
          localStorage.removeItem('transcribeJobId')
          clearInterval(interval)
        }
      } catch (e) { /* ignore transient poll errors */ }
    }, 1000)

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  // Poll the translation job (also a resumable background job).
  useEffect(() => {
    if (!translateJobId) return
    setTranslating(true)

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/video/job/${translateJobId}`)
        if (!mountedRef.current) return
        if (res.ok) {
          const data = await res.json()
          if (data.status === 'error') {
            setTranslateError(data.error || 'Translation failed.')
            setTranslating(false); setTranslateJobId(null)
            localStorage.removeItem('translateJobId')
            clearInterval(interval)
          } else if (data.status === 'done') {
            setTranslatedSrt(data.srtText || '')
            if (data.targetLang) setTranslatedLang(data.targetLang)
            setTranslatePercent(100); setTranslateStage('Translation complete!')
            setTranslating(false)
            clearInterval(interval)
          } else {
            setTranslateStage(data.stage || 'Translating...')
            setTranslateEta(typeof data.etaSeconds === 'number' ? data.etaSeconds : null)
            const p = typeof data.percent === 'number' && data.percent >= 0 ? data.percent : 0
            let overall
            if (data.phase === 'loading-model') overall = p * 0.15
            else if (data.phase === 'translating') overall = 15 + p * 0.85
            else overall = p
            setTranslatePercent(Math.round(overall))
          }
        } else if (res.status === 404) {
          setTranslating(false); setTranslateJobId(null)
          localStorage.removeItem('translateJobId')
          clearInterval(interval)
        }
      } catch (e) { /* ignore transient poll errors */ }
    }, 1000)

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translateJobId])

  const handleTranscribe = (e) => {
    e.preventDefault()
    if (!file) return
    if (file.type && !file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
      setError('Please select a valid video or audio file.')
      return
    }

    const newJobId = Date.now().toString()
    setJobId(newJobId)
    localStorage.setItem('transcribeJobId', newJobId)
    setProcessing(true); setPhase('uploading')
    setUploadProgress(0); setPercent(0); setEta(null); setDuration(null)
    setSrtText(''); setError(null)
    if (language && language !== 'auto') setSourceLang(language)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('model', model)
    formData.append('language', language)
    formData.append('denoise', denoise ? 'true' : 'false')
    formData.append('jobId', newJobId)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/video/transcribe')
    xhr.upload.onprogress = (event) => {
      if (!mountedRef.current) return
      if (event.lengthComputable) {
        const pct = Math.round((event.loaded / event.total) * 100)
        setUploadProgress(pct)
        if (pct === 100) { setPhase('processing'); setStage('Extracting audio track...') }
      }
    }
    xhr.onload = () => {
      if (!mountedRef.current) return
      if (xhr.status >= 200 && xhr.status < 300) {
        setPhase('processing')
      } else {
        try { setError(JSON.parse(xhr.responseText).error || 'Failed to start transcription') }
        catch { setError('Failed to start transcription') }
        setProcessing(false); setPhase(''); setJobId(null)
        localStorage.removeItem('transcribeJobId')
      }
    }
    xhr.onerror = () => {
      if (!mountedRef.current) return
      setError('A network error occurred during upload.')
      setProcessing(false); setPhase('')
    }
    try {
      xhr.send(formData)
    } catch {
      setError('Failed to start the upload.')
      setProcessing(false); setPhase(''); setJobId(null)
      localStorage.removeItem('transcribeJobId')
    }
  }

  const handleClearJob = async () => {
    if (jobId) await fetch(`/api/video/job/${jobId}`, { method: 'DELETE' }).catch(() => {})
    if (translateJobId) await fetch(`/api/video/job/${translateJobId}`, { method: 'DELETE' }).catch(() => {})
    setJobId(null); localStorage.removeItem('transcribeJobId')
    setTranslateJobId(null); localStorage.removeItem('translateJobId')
    setProcessing(false); setPhase(''); setFile(null)
    setSrtText(''); setPercent(0); setUploadProgress(0); setError(null)
    setTranslating(false); setTranslatedSrt(''); setTranslateError(null); setTranslatePercent(0)
  }

  const handleTranslate = () => {
    if (!srtText.trim() || !targetLang) return
    const newId = 'tr' + Date.now()
    setTranslateJobId(newId)
    localStorage.setItem('translateJobId', newId)
    setTranslating(true); setTranslatePercent(0); setTranslateEta(null)
    setTranslateStage('Starting translation...'); setTranslatedSrt(''); setTranslateError(null)
    setTranslatedLang(targetLang)

    fetch('/api/video/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: newId, srtText, srcLang: sourceLang, tgtLang: targetLang, baseName: srtBaseName })
    })
      .then(async (r) => {
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Failed to start translation') }
      })
      .catch((err) => {
        if (!mountedRef.current) return
        setTranslateError(err.message || 'Failed to start translation')
        setTranslating(false); setTranslateJobId(null)
        localStorage.removeItem('translateJobId')
      })
  }

  const handleTranslateAnother = async () => {
    if (translateJobId) await fetch(`/api/video/job/${translateJobId}`, { method: 'DELETE' }).catch(() => {})
    setTranslateJobId(null); localStorage.removeItem('translateJobId')
    setTranslating(false); setTranslatedSrt(''); setTranslateError(null); setTranslatePercent(0)
  }

  const copyText = async (text, setFlag) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
      }
      setFlag(true)
      setTimeout(() => { if (mountedRef.current) setFlag(false) }, 2000)
    } catch { /* clipboard unavailable */ }
  }

  const barPercent = phase === 'uploading' ? uploadProgress : Math.min(percent, 100)
  const btn = (bg) => ({ padding: '0.75rem 2rem', backgroundColor: bg, color: 'white', border: 'none', borderRadius: '4px', fontWeight: '600', fontSize: '1rem', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' })
  const selectStyle = { width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', backgroundColor: 'white' }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ marginBottom: '1.5rem', color: '#1976d2' }}>Transcribe Video</h2>
      <p style={{ marginBottom: '2rem', color: '#666', lineHeight: '1.6' }}>
        Upload a video (or audio) file and generate downloadable subtitles as an <code>.srt</code> file — then
        optionally translate them into other languages. Everything runs on the server, so you can safely close
        this tab; it keeps working and the result will still be here when you come back.
      </p>

      {phase === 'done' ? (
        <div>
          <div style={{ padding: '1.5rem', backgroundColor: '#e8f5e9', borderRadius: '8px', border: '1px solid #c8e6c9', marginBottom: '1.5rem' }}>
            <h3 style={{ color: '#2e7d32', marginBottom: '0.5rem' }}>Transcription Complete!</h3>
            <p style={{ color: '#1b5e20', margin: 0 }}>Your subtitles are ready. Review, copy, download, or translate them below.</p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong style={{ color: '#333' }}>Subtitles (.srt)</strong>
            <button type="button" onClick={() => copyText(srtText, setCopied)}
              style={{ padding: '0.35rem 0.9rem', backgroundColor: 'white', color: '#1976d2', border: '1px solid #1976d2', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <textarea readOnly value={srtText}
            style={{ width: '100%', height: '260px', padding: '1rem', borderRadius: '8px', border: '1px solid #ccc', fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: '1.5', resize: 'vertical', backgroundColor: '#fafafa', boxSizing: 'border-box' }} />

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.5rem' }}>
            <a href={`/api/video/result/${jobId}`} style={btn('#1976d2')}>Download .srt</a>
            <button onClick={handleClearJob} style={{ ...btn('white'), color: '#d32f2f', border: '1px solid #d32f2f' }}>Transcribe Another</button>
          </div>

          {/* ── Translate panel ─────────────────────────────────────── */}
          <div style={{ marginTop: '2.5rem', paddingTop: '1.5rem', borderTop: '1px solid #e0e0e0' }}>
            <h3 style={{ color: '#1976d2', marginBottom: '0.75rem' }}>Translate subtitles</h3>

            {translatedSrt ? (
              <div>
                <div style={{ padding: '1rem 1.25rem', backgroundColor: '#e3f2fd', borderRadius: '8px', border: '1px solid #bbdefb', marginBottom: '1rem' }}>
                  <strong style={{ color: '#0d47a1' }}>Translated to {langLabel(translatedLang)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <strong style={{ color: '#333' }}>{langLabel(translatedLang)} subtitles (.srt)</strong>
                  <button type="button" onClick={() => copyText(translatedSrt, setTranslateCopied)}
                    style={{ padding: '0.35rem 0.9rem', backgroundColor: 'white', color: '#1976d2', border: '1px solid #1976d2', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}>
                    {translateCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <textarea readOnly value={translatedSrt}
                  style={{ width: '100%', height: '220px', padding: '1rem', borderRadius: '8px', border: '1px solid #ccc', fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: '1.5', resize: 'vertical', backgroundColor: '#fafafa', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.25rem' }}>
                  <a href={`/api/video/result/${translateJobId}`} style={btn('#1976d2')}>Download .srt</a>
                  <button onClick={handleTranslateAnother} style={{ ...btn('white'), color: '#1976d2', border: '1px solid #1976d2' }}>Translate another language</button>
                </div>
              </div>
            ) : translating ? (
              <div style={{ padding: '1rem', background: '#f5f5f5', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.9rem' }}>
                  <strong>{translateStage || 'Translating...'}</strong>
                  <span>{Math.min(translatePercent, 99)}%</span>
                </div>
                <div style={{ width: '100%', height: '8px', background: '#e0e0e0', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(translatePercent, 99)}%`, height: '100%', background: '#1976d2', transition: 'width 0.5s ease' }} />
                </div>
                {translateEta != null && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#666' }}>Estimated time left: ~{fmtDur(translateEta)}</div>
                )}
              </div>
            ) : (
              <div>
                <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1rem' }}>
                  Generate an <code>.srt</code> in another language. Set the spoken (source) language for best results.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>From (source)</label>
                    <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} style={selectStyle}>
                      {TRANSLATE_LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>To (target)</label>
                    <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} style={selectStyle}>
                      {TRANSLATE_LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                  </div>
                </div>
                {translateError && <div style={{ color: '#d32f2f', padding: '0.75rem', backgroundColor: '#ffebee', borderRadius: '4px', marginBottom: '1rem' }}>{translateError}</div>}
                <button onClick={handleTranslate} disabled={sourceLang === targetLang}
                  style={{ ...btn(sourceLang === targetLang ? '#9e9e9e' : '#1976d2'), cursor: sourceLang === targetLang ? 'not-allowed' : 'pointer' }}>
                  Translate to {langLabel(targetLang)}
                </button>
                {sourceLang === targetLang && <div style={{ fontSize: '0.8rem', color: '#999', marginTop: '0.5rem' }}>Choose a different target language.</div>}
              </div>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleTranscribe} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div>
            <label htmlFor="transcribeFile" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Select Video or Audio</label>
            <input id="transcribeFile" type="file" accept="video/*,audio/*"
              onChange={(e) => setFile(e.target.files[0])} required disabled={processing}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            <div>
              <label htmlFor="language" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Spoken Language</label>
              <select id="language" value={language} onChange={(e) => setLanguage(e.target.value)} disabled={processing} style={selectStyle}>
                {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="model" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Model Quality</label>
              <select id="model" value={model} onChange={(e) => setModel(e.target.value)} disabled={processing} style={selectStyle}>
                <option value="tiny">Fast (tiny — quickest)</option>
                <option value="base">Balanced (base — more accurate)</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: '500', cursor: processing ? 'default' : 'pointer' }}>
              <input type="checkbox" checked={denoise} onChange={(e) => setDenoise(e.target.checked)} disabled={processing} style={{ width: '16px', height: '16px' }} />
              Reduce background music/noise (clearer dialogue)
            </label>
            <div style={{ fontSize: '0.8rem', color: '#999', marginTop: '0.35rem', marginLeft: '1.6rem' }}>
              Applies a speech-isolation filter — helps on noisy or music-heavy audio (slightly slower extraction).
            </div>
          </div>

          {error && <div style={{ color: '#d32f2f', padding: '0.75rem', backgroundColor: '#ffebee', borderRadius: '4px' }}>{error}</div>}

          {processing && phase === 'uploading' && (
            <div style={{ padding: '1rem', background: '#f5f5f5', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.9rem' }}>
                <strong>Uploading file...</strong>
                <span>{uploadProgress}%</span>
              </div>
              <div style={{ width: '100%', height: '8px', background: '#e0e0e0', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#1976d2', transition: 'width 0.2s' }} />
              </div>
            </div>
          )}

          {processing && phase === 'processing' && (
            <div style={{ padding: '1rem', background: '#f5f5f5', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.9rem' }}>
                <strong>{stage}</strong>
                <span>{Math.min(barPercent, 99)}%</span>
              </div>
              <div style={{ width: '100%', height: '8px', background: '#e0e0e0', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(barPercent, 99)}%`, height: '100%', background: '#1976d2', transition: 'width 0.5s ease' }} />
              </div>
              <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#666' }}>
                {duration != null && <span>Audio length: {fmtDur(duration)}</span>}
                {eta != null && <span>{duration != null ? ' · ' : ''}Estimated time left: ~{fmtDur(eta)}</span>}
                {eta == null && duration == null && <span style={{ fontStyle: 'italic' }}>You can close this tab and come back later.</span>}
              </div>
            </div>
          )}

          <button type="submit" disabled={processing || !file}
            style={{ padding: '0.75rem', backgroundColor: processing || !file ? '#9e9e9e' : '#1976d2', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '1rem', fontWeight: '600', cursor: processing || !file ? 'not-allowed' : 'pointer' }}>
            {processing ? 'Processing...' : 'Transcribe Video'}
          </button>
        </form>
      )}
    </div>
  )
}

export default VideoTranscribeTool
