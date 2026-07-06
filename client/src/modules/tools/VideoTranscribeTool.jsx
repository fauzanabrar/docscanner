import React, { useState, useEffect, useRef } from 'react'
import { CookiesButton } from './YtDlpCookiesDialog'

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
  const [sourceType, setSourceType] = useState('upload') // 'upload' | 'url'
  const [url, setUrl] = useState('')
  const [model, setModel] = useState('tiny')
  const [language, setLanguage] = useState('auto')
  const [denoiseMethod, setDenoiseMethod] = useState('none')
  const [error, setError] = useState(null)
  const [authRequired, setAuthRequired] = useState(false)

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

  // ── Active tab after completion ────────────────────────────────────
  const [activeTab, setActiveTab] = useState('transcription') // 'transcription' | 'translation'

  // Track mount state so async XHR/poll callbacks never call setState after the
  // component has unmounted (e.g. the user navigated back to "All tools" while a
  // job is still running). The server keeps working regardless.
  const mountedRef = useRef(true)
  const xhrRef = useRef(null)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Poll the transcription job so progress/results survive a refresh or the
  // tab/window being closed and reopened — the server keeps working regardless.
  useEffect(() => {
    if (!jobId || phase === 'uploading' || phase === 'done') return
    setProcessing(true)

    let intervalId
    const checkJob = async () => {
      try {
        const res = await fetch(`/api/video/job/${jobId}`)
        if (!mountedRef.current) return
        if (res.ok) {
          const data = await res.json()
          if (data.status === 'error') {
            setError(data.error || 'Transcription failed.')
            setAuthRequired(Boolean(data.authRequired))
            setProcessing(false); setPhase(''); setJobId(null)
            localStorage.removeItem('transcribeJobId')
            if (intervalId) clearInterval(intervalId)
          } else if (data.status === 'done') {
            setSrtText(data.srtText || '')
            setSrtBaseName((data.filename || 'subtitles.srt').replace(/\.srt$/i, '') || 'subtitles')
            setPercent(100); setStage('Transcription complete!'); setPhase('done')
            setProcessing(false)
            if (intervalId) clearInterval(intervalId)
          } else {
            if (phase !== 'processing') {
              setPhase('processing')
            }
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
          if (intervalId) clearInterval(intervalId)
        }
      } catch (e) { /* ignore transient poll errors */ }
    }

    checkJob()
    intervalId = setInterval(checkJob, 1000)

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, phase])

  // Poll the translation job (also a resumable background job).
  useEffect(() => {
    if (!translateJobId) return
    setTranslating(true)

    let intervalId
    const checkTranslate = async () => {
      try {
        const res = await fetch(`/api/video/job/${translateJobId}`)
        if (!mountedRef.current) return
        if (res.ok) {
          const data = await res.json()
          if (data.status === 'error') {
            setTranslateError(data.error || 'Translation failed.')
            setTranslating(false); setTranslateJobId(null)
            localStorage.removeItem('translateJobId')
            if (intervalId) clearInterval(intervalId)
          } else if (data.status === 'done') {
            setTranslatedSrt(data.srtText || '')
            if (data.targetLang) setTranslatedLang(data.targetLang)
            setTranslatePercent(100); setTranslateStage('Translation complete!')
            setTranslating(false)
            if (intervalId) clearInterval(intervalId)
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
          if (intervalId) clearInterval(intervalId)
        }
      } catch (e) { /* ignore transient poll errors */ }
    }

    checkTranslate()
    intervalId = setInterval(checkTranslate, 1000)

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translateJobId])

  const handleTranscribe = (e) => {
    e.preventDefault()
    if (sourceType === 'upload') {
      if (!file) return
      if (file.type && !file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
        setError('Please select a valid video or audio file.')
        return
      }
    } else {
      if (!url.trim()) return
    }

    const newJobId = Date.now().toString()
    setJobId(newJobId)
    localStorage.setItem('transcribeJobId', newJobId)
    setProcessing(true)
    setPhase('uploading')
    setUploadProgress(0); setPercent(0); setEta(null); setDuration(null)
    setSrtText(''); setError(null); setAuthRequired(false)
    if (language && language !== 'auto') setSourceLang(language)

    const formData = new FormData()
    if (sourceType === 'upload') {
      formData.append('file', file)
    } else {
      formData.append('url', url.trim())
    }
    formData.append('model', model)
    formData.append('language', language)
    formData.append('denoiseMethod', denoiseMethod)
    formData.append('jobId', newJobId)

    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr
    xhr.open('POST', '/api/video/transcribe')
    
    if (sourceType === 'upload') {
      xhr.upload.onprogress = (event) => {
        if (!mountedRef.current) return
        if (event.lengthComputable) {
          const pct = Math.round((event.loaded / event.total) * 100)
          setUploadProgress(pct)
        }
      }
    }

    xhr.onload = () => {
      if (!mountedRef.current) return
      if (xhr.status >= 200 && xhr.status < 300) {
        setPhase('processing')
        setStage(sourceType === 'upload' ? 'Extracting audio track...' : 'Downloading video source...')
      } else {
        try {
          const data = JSON.parse(xhr.responseText)
          setError(data.error || 'Failed to start transcription')
          setAuthRequired(Boolean(data.authRequired))
        }
        catch { setError('Failed to start transcription') }
        setProcessing(false); setPhase(''); setJobId(null)
        localStorage.removeItem('transcribeJobId')
      }
    }
    xhr.onerror = () => {
      if (!mountedRef.current) return
      setError(sourceType === 'upload' ? 'A network error occurred during upload.' : 'A network error occurred.')
      setProcessing(false); setPhase('')
    }
    try {
      xhr.send(formData)
    } catch {
      setError('Failed to start the transcription.')
      setProcessing(false); setPhase(''); setJobId(null)
      localStorage.removeItem('transcribeJobId')
    }
  }

  const handleClearJob = async () => {
    if (xhrRef.current) { xhrRef.current.abort(); xhrRef.current = null }
    if (jobId) await fetch(`/api/video/job/${jobId}`, { method: 'DELETE' }).catch(() => {})
    if (translateJobId) await fetch(`/api/video/job/${translateJobId}`, { method: 'DELETE' }).catch(() => {})
    setJobId(null); localStorage.removeItem('transcribeJobId')
    setTranslateJobId(null); localStorage.removeItem('translateJobId')
    setProcessing(false); setPhase(''); setFile(null); setUrl('')
    setSrtText(''); setPercent(0); setUploadProgress(0); setError(null); setAuthRequired(false)
    setTranslating(false); setTranslatedSrt(''); setTranslateError(null); setTranslatePercent(0)
    setActiveTab('transcription')
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
          <div style={{ padding: '1rem 1.25rem', backgroundColor: '#e8f5e9', borderRadius: '8px', border: '1px solid #c8e6c9', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.3rem' }}>&#10003;</span>
            <div>
              <strong style={{ color: '#2e7d32' }}>Transcription complete</strong>
              <span style={{ color: '#388e3c', marginLeft: '0.5rem', fontSize: '0.9rem' }}>Subtitles ready — review, download, or translate below.</span>
            </div>
          </div>

          {/* ── Tabs ──────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', borderBottom: '2px solid #e0e0e0', marginBottom: '1.25rem' }}>
            <button type="button" onClick={() => setActiveTab('transcription')}
              style={{ flex: 1, padding: '0.7rem 1rem', background: 'none', border: 'none', borderBottom: activeTab === 'transcription' ? '2px solid #1976d2' : '2px solid transparent', marginBottom: '-2px', fontWeight: '600', fontSize: '0.95rem', cursor: 'pointer', color: activeTab === 'transcription' ? '#1976d2' : '#666', transition: 'color 0.15s, border-color 0.15s' }}>
              Transcription
            </button>
            <button type="button" onClick={() => setActiveTab('translation')}
              style={{ flex: 1, padding: '0.7rem 1rem', background: 'none', border: 'none', borderBottom: activeTab === 'translation' ? '2px solid #1976d2' : '2px solid transparent', marginBottom: '-2px', fontWeight: '600', fontSize: '0.95rem', cursor: 'pointer', color: activeTab === 'translation' ? '#1976d2' : '#666', transition: 'color 0.15s, border-color 0.15s' }}>
              Translate
              {translatedSrt && <span style={{ marginLeft: '0.4rem', display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#4caf50', verticalAlign: 'middle' }} />}
            </button>
          </div>

          {/* ── Transcription tab ─────────────────────────────────────── */}
          {activeTab === 'transcription' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <strong style={{ color: '#333' }}>Subtitles (.srt)</strong>
                <button type="button" onClick={() => copyText(srtText, setCopied)}
                  style={{ padding: '0.35rem 0.9rem', backgroundColor: 'white', color: '#1976d2', border: '1px solid #1976d2', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <textarea readOnly value={srtText}
                style={{ width: '100%', height: '260px', padding: '1rem', borderRadius: '8px', border: '1px solid #ccc', fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: '1.5', resize: 'vertical', backgroundColor: '#fafafa', boxSizing: 'border-box' }} />

              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.25rem' }}>
                <a href={`/api/video/result/${jobId}`} style={btn('#1976d2')}>Download .srt</a>
                <button onClick={handleClearJob} style={{ ...btn('white'), color: '#d32f2f', border: '1px solid #d32f2f' }}>Transcribe Another</button>
              </div>
            </div>
          )}

          {/* ── Translation tab ───────────────────────────────────────── */}
          {activeTab === 'translation' && (
            <div>
              {translatedSrt ? (
                <div>
                  <div style={{ padding: '0.75rem 1rem', backgroundColor: '#e3f2fd', borderRadius: '8px', border: '1px solid #bbdefb', marginBottom: '1rem' }}>
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
                    <span>{translatePercent}%</span>
                  </div>
                  <div style={{ width: '100%', height: '8px', background: '#e0e0e0', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${translatePercent}%`, height: '100%', background: '#1976d2', transition: 'width 0.5s ease' }} />
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
          )}
        </div>
      ) : (
        <form onSubmit={handleTranscribe} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ display: 'flex', borderBottom: '2px solid #e0e0e0', marginBottom: '0.5rem', gap: '1rem' }}>
            <button
              type="button"
              onClick={() => setSourceType('upload')}
              disabled={processing}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: 'transparent',
                border: 'none',
                borderBottom: sourceType === 'upload' ? '3px solid #1976d2' : '3px solid transparent',
                color: sourceType === 'upload' ? '#1976d2' : '#666',
                fontWeight: '600',
                cursor: processing ? 'not-allowed' : 'pointer',
                fontSize: '1rem',
                outline: 'none',
                marginBottom: '-2px'
              }}
            >
              Upload File
            </button>
            <button
              type="button"
              onClick={() => setSourceType('url')}
              disabled={processing}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: 'transparent',
                border: 'none',
                borderBottom: sourceType === 'url' ? '3px solid #1976d2' : '3px solid transparent',
                color: sourceType === 'url' ? '#1976d2' : '#666',
                fontWeight: '600',
                cursor: processing ? 'not-allowed' : 'pointer',
                fontSize: '1rem',
                outline: 'none',
                marginBottom: '-2px'
              }}
            >
              Video URL
            </button>
          </div>

          {sourceType === 'upload' ? (
            <div>
              <label htmlFor="transcribeFile" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Select Video or Audio</label>
              <input id="transcribeFile" type="file" accept="video/*,audio/*"
                onChange={(e) => setFile(e.target.files[0])} required disabled={processing}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>
          ) : (
            <div>
              <label htmlFor="transcribeUrl" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Video URL</label>
              <input id="transcribeUrl" type="url" placeholder="https://www.youtube.com/watch?v=..."
                value={url} onChange={(e) => { setUrl(e.target.value); setAuthRequired(false) }} required disabled={processing}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
              <div style={{ marginTop: '0.75rem' }}>
                <CookiesButton />
              </div>
            </div>
          )}

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
            <label htmlFor="denoiseMethod" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Background Noise Reduction</label>
            <select id="denoiseMethod" value={denoiseMethod} onChange={(e) => setDenoiseMethod(e.target.value)} disabled={processing} style={selectStyle}>
              <option value="none">None</option>
              <option value="ffmpeg">Light — ffmpeg speech filter (fast)</option>
              <option value="demucs">Deep — Demucs neural separation (slow, best quality)</option>
            </select>
            <div style={{ fontSize: '0.8rem', color: '#999', marginTop: '0.35rem' }}>
              {denoiseMethod === 'demucs'
                ? 'Uses Meta\'s Demucs deep learning model to isolate vocals from music/background noise. Significantly slower but much higher quality separation.'
                : denoiseMethod === 'ffmpeg'
                  ? 'Applies a speech-isolation EQ filter — helps on mildly noisy audio (slightly slower extraction).'
                  : 'No noise reduction applied.'}
            </div>
          </div>

          {error && (
            <div style={{ color: '#d32f2f', padding: '0.75rem', backgroundColor: '#ffebee', borderRadius: '4px' }}>
              <div>{error}</div>
              {authRequired && <div style={{ marginTop: '0.75rem' }}><CookiesButton label="Add your YouTube cookies" /></div>}
            </div>
          )}

          {processing && phase === 'uploading' && (
            <div style={{ padding: '1rem', background: '#f5f5f5', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '0.9rem' }}>
                <strong>{sourceType === 'upload' ? 'Uploading file...' : 'Starting transcription...'}</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {sourceType === 'upload' && <span>{uploadProgress}%</span>}
                  <button type="button" onClick={handleClearJob}
                    style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', backgroundColor: '#fff', color: '#d32f2f', border: '1px solid #d32f2f', borderRadius: '4px', cursor: 'pointer', fontWeight: '600' }}>
                    Cancel
                  </button>
                </div>
              </div>
              <div style={{ width: '100%', height: '8px', background: '#e0e0e0', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${sourceType === 'upload' ? uploadProgress : 100}%`, height: '100%', background: '#1976d2', transition: 'width 0.2s' }} />
              </div>
            </div>
          )}

          {processing && phase === 'processing' && (
            <div style={{ padding: '1rem', background: '#f5f5f5', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontSize: '0.9rem' }}>
                <strong>{stage}</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span>{barPercent}%</span>
                  <button type="button" onClick={handleClearJob}
                    style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', backgroundColor: '#fff', color: '#d32f2f', border: '1px solid #d32f2f', borderRadius: '4px', cursor: 'pointer', fontWeight: '600' }}>
                    Cancel
                  </button>
                </div>
              </div>
              <div style={{ width: '100%', height: '8px', background: '#e0e0e0', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${barPercent}%`, height: '100%', background: '#1976d2', transition: 'width 0.5s ease' }} />
              </div>
              <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#666' }}>
                {duration != null && <span>Audio length: {fmtDur(duration)}</span>}
                {eta != null && <span>{duration != null ? ' · ' : ''}Estimated time left: ~{fmtDur(eta)}</span>}
                {eta == null && duration == null && <span style={{ fontStyle: 'italic' }}>You can close this tab and come back later.</span>}
              </div>
            </div>
          )}

          <button type="submit" disabled={processing || (sourceType === 'upload' ? !file : !url.trim())}
            style={{
              padding: '0.75rem',
              backgroundColor: processing || (sourceType === 'upload' ? !file : !url.trim()) ? '#9e9e9e' : '#1976d2',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: processing || (sourceType === 'upload' ? !file : !url.trim()) ? 'not-allowed' : 'pointer'
            }}
          >
            {processing ? 'Processing...' : 'Transcribe Video'}
          </button>
        </form>
      )}
    </div>
  )
}

export default VideoTranscribeTool
