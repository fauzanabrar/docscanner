import React, { useState, useEffect, useRef, useCallback } from 'react'
import { CookiesButton } from './YtDlpCookiesDialog'

const STORAGE_KEY = 'downloadJobs'
const UI_STATE_KEY = 'downloadUiState'

function loadSavedJobs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}

function saveJobToStorage(jobId, meta) {
  try {
    const jobs = loadSavedJobs()
    jobs[jobId] = meta
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs))
  } catch { /* quota exceeded — ignore */ }
}

function removeJobFromStorage(jobId) {
  try {
    const jobs = loadSavedJobs()
    delete jobs[jobId]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs))
  } catch { /* ignore */ }
}

function loadUiState() {
  try { return JSON.parse(localStorage.getItem(UI_STATE_KEY) || '{}') } catch { return {} }
}

function saveUiState(state) {
  try { localStorage.setItem(UI_STATE_KEY, JSON.stringify(state)) } catch { /* ignore */ }
}

function formatDuration(seconds) {
  if (!seconds) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function getVideoId(url) {
  if (!url) return null
  const match = url.match(/[?&]v=([^&]+)/)
  return match ? match[1] : url
}

function VideoDownloadTool() {
  const [url, setUrl] = useState('')
  const [downloadFormat, setDownloadFormat] = useState('best')
  const [error, setError] = useState(null)
  const [authRequired, setAuthRequired] = useState(false)

  const [playlistInfo, setPlaylistInfo] = useState(null)
  const [isPlaylist, setIsPlaylist] = useState(false)
  const [fetchingInfo, setFetchingInfo] = useState(false)

  const [videoJobs, setVideoJobs] = useState({})
  const videoJobsRef = useRef({})

  const [singleJobId, setSingleJobId] = useState(null)
  const [singlePhase, setSinglePhase] = useState('')
  const [singleStatus, setSingleStatus] = useState('')
  const [singleProgress, setSingleProgress] = useState(0)
  const [singleDlInfo, setSingleDlInfo] = useState('')
  const [singleLoading, setSingleLoading] = useState(false)
  const [singleVideoSize, setSingleVideoSize] = useState(null)

  const [videoSizes, setVideoSizes] = useState({})

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) { setUrl(text.trim()); setPlaylistInfo(null); setVideoJobs({}); setError(null); setAuthRequired(false) }
    } catch {
      setError('Clipboard access denied. Use Ctrl+V to paste manually.')
      setTimeout(() => setError(null), 3000)
    }
  }

  useEffect(() => { videoJobsRef.current = videoJobs }, [videoJobs])

  useEffect(() => {
    const savedJobs = loadSavedJobs()
    const savedUi = loadUiState()
    const entries = Object.entries(savedJobs)
    if (entries.length === 0 && !savedUi.playlistInfo) return

    if (savedUi.url) setUrl(savedUi.url)
    if (savedUi.downloadFormat) setDownloadFormat(savedUi.downloadFormat)
    if (savedUi.playlistInfo) {
      setPlaylistInfo(savedUi.playlistInfo)
      setIsPlaylist(savedUi.isPlaylist || false)
    }

    const singleEntries = entries.filter(([, m]) => m.single)
    const playlistEntries = entries.filter(([, m]) => !m.single)

    if (singleEntries.length > 0) {
      const [jid] = singleEntries[0]
      setSingleJobId(jid)
      setSingleLoading(true)
      setSinglePhase('downloading')
      setSingleStatus('Restoring...')
    }

    if (playlistEntries.length > 0) {
      const restored = {}
      for (const [jid, meta] of playlistEntries) {
        restored[jid] = {
          status: 'downloading',
          videoUrl: meta.url,
          title: meta.title,
          index: meta.index,
          progress: 0,
          dlInfo: 'Restoring...'
        }
      }
      setVideoJobs(restored)
      videoJobsRef.current = restored
    }
  }, [])

  useEffect(() => {
    if (playlistInfo) {
      saveUiState({ url, downloadFormat, playlistInfo, isPlaylist })
    }
  }, [url, downloadFormat, playlistInfo, isPlaylist])

  useEffect(() => {
    if (!playlistInfo) return
    const isPl = playlistInfo.entries && playlistInfo.entries.length > 1
    const videos = isPl ? playlistInfo.entries : [{ ...playlistInfo }]

    if (isPl) {
      const urls = videos.map(v => v.url || v.webpage_url || playlistInfo.url).filter(Boolean)
      if (urls.length === 0) return
      fetch('/api/video/sizes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, downloadFormat })
      }).then(r => r.ok ? r.json() : { sizes: {} }).then(({ sizes }) => {
        const sizeMap = {}
        videos.forEach((v, i) => {
          const vUrl = v.url || v.webpage_url || playlistInfo.url
          const id = v.id || getVideoId(vUrl)
          if (sizes[id]) sizeMap[i] = sizes[id]
        })
        setVideoSizes(sizeMap)
      }).catch(() => {})
    } else {
      const vUrl = videos[0]?.url || videos[0]?.webpage_url || playlistInfo.url
      if (!vUrl) return
      fetch('/api/video/size', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: vUrl, downloadFormat })
      }).then(r => r.ok ? r.json() : null).then(d => {
        setSingleVideoSize(d?.size || null)
      }).catch(() => setSingleVideoSize(null))
    }
  }, [downloadFormat, playlistInfo])

  useEffect(() => {
    if (!singleJobId) { setSingleLoading(false); return }
    setSingleLoading(true)
    setSinglePhase('downloading')
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/video/job/${singleJobId}`)
        if (res.ok) {
          const data = await res.json()
          if (data.status === 'error') {
            setError(data.error || 'Download failed.')
            setAuthRequired(Boolean(data.authRequired))
            setSingleLoading(false); setSinglePhase(''); setSingleJobId(null)
            removeJobFromStorage(singleJobId)
            clearInterval(interval)
          } else if (data.status === 'done') {
            setSinglePhase('done'); setSingleProgress(100); setSingleDlInfo('')
            clearInterval(interval)
          } else {
            setSingleProgress(data.progress || 0)
            setSingleDlInfo(data.dlInfo || '')
            setSingleStatus(data.progress >= 99 ? 'Merging...' : 'Downloading...')
          }
        } else if (res.status === 404) {
          setSingleLoading(false); setSinglePhase(''); setSingleJobId(null)
          removeJobFromStorage(singleJobId)
          clearInterval(interval)
        }
      } catch { /* network hiccup — keep polling */ }
    }, 1000)
    return () => clearInterval(interval)
  }, [singleJobId])

  useEffect(() => {
    const activeJobs = Object.entries(videoJobs).filter(([, v]) => v.status === 'downloading')
    if (activeJobs.length === 0) return
    const interval = setInterval(async () => {
      const current = { ...videoJobsRef.current }
      let changed = false
      for (const [jid, job] of Object.entries(current)) {
        if (job.status !== 'downloading') continue
        try {
          const res = await fetch(`/api/video/job/${jid}`)
          if (res.ok) {
            const data = await res.json()
            if (data.status === 'error') {
              current[jid] = { ...job, status: 'error', error: data.error }
              if (data.authRequired) setAuthRequired(true)
              changed = true
              removeJobFromStorage(jid)
            } else if (data.status === 'done') {
              current[jid] = { ...job, status: 'done', progress: 100, dlInfo: '', filename: data.filename }
              changed = true
            } else if (data.progress !== job.progress || data.dlInfo !== job.dlInfo) {
              current[jid] = { ...job, progress: data.progress || 0, dlInfo: data.dlInfo || '' }
              changed = true
            }
          } else if (res.status === 404) {
            current[jid] = { ...job, status: 'error', error: 'Job not found on server.' }
            changed = true
            removeJobFromStorage(jid)
          }
        } catch { /* keep polling */ }
      }
      if (changed) setVideoJobs({ ...current })
    }, 1000)
    return () => clearInterval(interval)
  }, [videoJobs])

  const handleFetchInfo = async (e) => {
    e.preventDefault()
    let finalUrl = url.trim()
    if (!finalUrl) return
    if (!/^https?:\/\//i.test(finalUrl)) finalUrl = 'https://' + finalUrl
    try { new URL(finalUrl) } catch { setError('Please enter a valid URL.'); return }

    setError(null); setAuthRequired(false); setFetchingInfo(true); setPlaylistInfo(null); setVideoJobs({}); setVideoSizes({}); setSingleVideoSize(null)
    try {
      const response = await fetch('/api/video/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: finalUrl })
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error || 'Failed to fetch video information.')
        setAuthRequired(Boolean(data.authRequired))
      } else {
        setPlaylistInfo(data)
        const isPl = data.entries && data.entries.length > 1
        setIsPlaylist(isPl)

        if (isPl) {
          const urls = data.entries.map(v => v.url || v.webpage_url || data.url).filter(Boolean)
          if (urls.length > 0) {
            fetch('/api/video/sizes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ urls, downloadFormat })
            }).then(r => r.ok ? r.json() : { sizes: {} }).then(({ sizes }) => {
              const sizeMap = {}
              data.entries.forEach((v, i) => {
                const vUrl = v.url || v.webpage_url || data.url
                const id = v.id || getVideoId(vUrl)
                if (sizes[id]) sizeMap[i] = sizes[id]
              })
              setVideoSizes(sizeMap)
            }).catch(() => {})
          }
        } else {
          const vUrl = data.url || data.webpage_url
          if (vUrl) {
            fetch('/api/video/size', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: vUrl, downloadFormat })
            }).then(r => r.ok ? r.json() : null).then(d => {
              setSingleVideoSize(d?.size || null)
            }).catch(() => {})
          }
        }
      }
    } catch {
      setError('A network error occurred while fetching info.')
    } finally {
      setFetchingInfo(false)
    }
  }

  const startDownload = useCallback(async (videoUrl, title, index) => {
    const newJobId = Date.now().toString() + '_' + index

    if (!isPlaylist) {
      setSingleJobId(newJobId)
      saveJobToStorage(newJobId, { single: true, url: videoUrl, title, index })
      setSingleLoading(true); setSinglePhase('downloading')
      setSingleStatus('Initializing...'); setSingleProgress(0); setSingleDlInfo('')
      setError(null); setAuthRequired(false)
    } else {
      const prev = Object.entries(videoJobsRef.current).find(([, v]) => v.index === index)
      const cleaned = { ...videoJobsRef.current }
      if (prev) delete cleaned[prev[0]]
      cleaned[newJobId] = { status: 'downloading', videoUrl, title, index, progress: 0, dlInfo: '' }
      videoJobsRef.current = cleaned
      setVideoJobs(cleaned)
      saveJobToStorage(newJobId, { single: false, url: videoUrl, title, index })
    }

    try {
      const response = await fetch('/api/video/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: videoUrl, downloadFormat, jobId: newJobId })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const errMsg = data.error || 'Failed to initialize download.'
        setAuthRequired(Boolean(data.authRequired))
        if (!isPlaylist) {
          setError(errMsg); setSingleLoading(false); setSinglePhase('')
          setSingleJobId(null); removeJobFromStorage(newJobId)
        } else {
          const updated = { ...videoJobsRef.current }
          if (updated[newJobId]) {
            updated[newJobId] = { ...updated[newJobId], status: 'error', error: errMsg }
          }
          videoJobsRef.current = updated
          setVideoJobs(updated)
          removeJobFromStorage(newJobId)
        }
      }
    } catch {
      if (!isPlaylist) {
        setError('A network error occurred.'); setSingleLoading(false); setSinglePhase('')
        setSingleJobId(null); removeJobFromStorage(newJobId)
      } else {
        const updated = { ...videoJobsRef.current }
        if (updated[newJobId]) {
          updated[newJobId] = { ...updated[newJobId], status: 'error', error: 'Network error.' }
        }
        videoJobsRef.current = updated
        setVideoJobs(updated)
        removeJobFromStorage(newJobId)
      }
    }
    return newJobId
  }, [isPlaylist, downloadFormat])

  const handleDownloadSingle = () => {
    if (!playlistInfo) return
    const videoUrl = playlistInfo.url || playlistInfo.webpage_url || url.trim()
    startDownload(videoUrl, playlistInfo.title, 0)
  }

  const handleDownloadOne = (video, idx) => {
    const videoUrl = video.url || video.webpage_url
    if (!videoUrl) return
    startDownload(videoUrl, video.title, idx)
  }

  const triggerBrowserDownload = (jobId, filename) => {
    const link = document.createElement('a')
    link.href = `/api/video/result/${jobId}`
    link.setAttribute('download', filename || 'video.mp4')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleDownloadAll = async () => {
    if (!playlistInfo?.entries) return
    for (let i = 0; i < playlistInfo.entries.length; i++) {
      const video = playlistInfo.entries[i]
      const videoUrl = video.url || video.webpage_url
      if (!videoUrl) continue

      const entry = Object.entries(videoJobsRef.current).find(([, j]) => j.index === i)
      if (entry) {
        const [jid, job] = entry
        if (job.status === 'done') {
          triggerBrowserDownload(jid, job.filename)
        }
        continue
      }

      await startDownload(videoUrl, video.title, i)
    }
  }

  const handleClear = async () => {
    if (singleJobId) {
      await fetch(`/api/video/job/${singleJobId}`, { method: 'DELETE' }).catch(() => {})
      removeJobFromStorage(singleJobId)
      setSingleJobId(null)
    }
    for (const jid of Object.keys(videoJobs)) {
      await fetch(`/api/video/job/${jid}`, { method: 'DELETE' }).catch(() => {})
      removeJobFromStorage(jid)
    }
    localStorage.removeItem(UI_STATE_KEY)
    setSingleLoading(false); setSinglePhase(''); setSingleStatus(''); setSingleProgress(0); setSingleDlInfo('')
    setUrl(''); setError(null); setAuthRequired(false); setPlaylistInfo(null); setVideoJobs({}); setIsPlaylist(false)
  }

  const getVideoJobStatus = (idx) => {
    const entry = Object.entries(videoJobs).find(([, v]) => v.index === idx)
    return entry ? { jobId: entry[0], ...entry[1] } : null
  }

  const downloadingCount = Object.values(videoJobs).filter(j => j.status === 'downloading').length
  const doneCount = Object.values(videoJobs).filter(j => j.status === 'done').length
  const totalCount = playlistInfo?.entries?.length || 0

  const disabled = singleLoading || fetchingInfo

  return (
    <div>
      <h2 style={{ marginBottom: '1.5rem', color: '#1976d2' }}>Download Video</h2>
      <p style={{ marginBottom: '2rem', color: '#666', lineHeight: '1.6' }}>
        Download videos from YouTube and other platforms. Paste a video or playlist URL to get started.
      </p>

      <form onSubmit={handleFetchInfo}>
        <label htmlFor="url" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Video or Playlist URL</label>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              id="url"
              type="url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setPlaylistInfo(null); setVideoJobs({}); setError(null); setAuthRequired(false) }}
              placeholder="e.g. https://www.youtube.com/watch?v=... or playlist URL"
              required
              style={{ width: '100%', padding: '0.75rem 2.5rem 0.75rem 0.75rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '1rem', boxSizing: 'border-box' }}
              disabled={disabled}
            />
            {url && (
              <button type="button" onClick={() => { setUrl(''); setPlaylistInfo(null); setVideoJobs({}); setError(null); setAuthRequired(false) }}
                style={{ position: 'absolute', right: '0.5rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#999', padding: '0.25rem', lineHeight: 1 }}
                title="Clear URL"
              >&#10005;</button>
            )}
          </div>
          <button type="button" onClick={handlePaste} disabled={disabled}
            style={{
              padding: '0.75rem',
              backgroundColor: disabled ? '#e0e0e0' : '#f5f5f5',
              border: '1px solid #ccc', borderRadius: '4px',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: '0.85rem', fontWeight: '500', whiteSpace: 'nowrap', color: '#555'
            }}
            title="Paste from clipboard"
          >Paste</button>
          <button type="submit" disabled={disabled}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: disabled ? '#9e9e9e' : '#1976d2',
              color: 'white', border: 'none', borderRadius: '4px',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontWeight: '600', whiteSpace: 'nowrap'
            }}
          >
            {fetchingInfo ? 'Fetching...' : 'Fetch Info'}
          </button>
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <CookiesButton />
        </div>
      </form>

      {error && (
        <div style={{ color: '#d32f2f', padding: '0.75rem', backgroundColor: '#ffebee', borderRadius: '4px', marginTop: '1rem' }}>
          <div>{error}</div>
          {authRequired && <div style={{ marginTop: '0.75rem' }}><CookiesButton label="Add your YouTube cookies" /></div>}
        </div>
      )}

      {playlistInfo && (
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '1.5rem', padding: '1rem', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
          <label htmlFor="dlFormat" style={{ fontWeight: '500', whiteSpace: 'nowrap' }}>Quality:</label>
          <select id="dlFormat" value={downloadFormat} onChange={(e) => setDownloadFormat(e.target.value)}
            style={{ flex: 1, padding: '0.75rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '1rem', backgroundColor: 'white' }}>
            <option value="best">Best Available (MP4)</option>
            <option value="2160p-webm">4K 2160p (WebM)</option>
            <option value="1440p-webm">2K 1440p (WebM)</option>
            <option value="1080p">1080p (MP4)</option>
            <option value="720p">720p (MP4)</option>
            <option value="480p">480p (MP4)</option>
            <option value="mp3">Audio Only (MP3)</option>
          </select>
        </div>
      )}

      {playlistInfo && !isPlaylist && (
        <div style={{ marginTop: '1.5rem', padding: '1.5rem', border: '1px solid #e0e0e0', borderRadius: '8px', backgroundColor: '#fafafa' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#333' }}>{playlistInfo.title}</h3>

          {singlePhase === 'done' ? (
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <a href={`/api/video/result/${singleJobId}`} download style={{
                display: 'inline-block', padding: '0.75rem 2rem',
                backgroundColor: '#2e7d32', color: 'white', textDecoration: 'none',
                borderRadius: '4px', fontWeight: '600', fontSize: '1rem'
              }}>Save to Device</a>
              <button onClick={handleClear} style={{
                padding: '0.75rem 1.5rem', backgroundColor: 'white', color: '#d32f2f',
                border: '1px solid #d32f2f', borderRadius: '4px', cursor: 'pointer', fontWeight: '600'
              }}>Download Another</button>
            </div>
          ) : singleLoading ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                <span style={{ fontWeight: '500' }}>{singleStatus}</span>
                <span style={{ color: '#1976d2', fontWeight: '600' }}>{singleProgress}%</span>
              </div>
              <div style={{ width: '100%', height: '10px', backgroundColor: '#e0e0e0', borderRadius: '5px', overflow: 'hidden' }}>
                <div style={{ width: `${singleProgress}%`, height: '100%', backgroundColor: '#1976d2', borderRadius: '5px', transition: 'width 0.3s' }}></div>
              </div>
              {singleDlInfo && (
                <div style={{ margin: '0.5rem 0 0 0', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {singleDlInfo.split('|').map((part, i) => (
                    <span key={i} style={{ fontSize: '0.8rem', color: '#757575', backgroundColor: '#f0f0f0', padding: '0.15rem 0.5rem', borderRadius: '3px' }}>{part.trim()}</span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <button onClick={handleDownloadSingle} style={{
                padding: '0.75rem 2rem', backgroundColor: '#1976d2', color: 'white',
                border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: '600', fontSize: '1rem'
              }}>Download Video</button>
              {singleVideoSize && (
                <span style={{ fontSize: '0.85rem', color: '#757575', backgroundColor: '#f0f0f0', padding: '0.25rem 0.6rem', borderRadius: '4px' }}>
                  {singleVideoSize}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {playlistInfo && isPlaylist && playlistInfo.entries && (
        <div style={{ marginTop: '1.5rem', border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem 1.5rem', backgroundColor: '#fafafa', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <h3 style={{ margin: 0, color: '#333' }}>{playlistInfo.title}</h3>
              <p style={{ margin: '0.25rem 0 0 0', color: '#757575', fontSize: '0.9rem' }}>
                {totalCount} videos
                {doneCount > 0 && <span style={{ color: '#2e7d32', marginLeft: '0.75rem' }}>{doneCount} done</span>}
                {downloadingCount > 0 && <span style={{ color: '#1976d2', marginLeft: '0.75rem' }}>{downloadingCount} downloading</span>}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={handleDownloadAll} style={{
                padding: '0.6rem 1.2rem',
                backgroundColor: '#1976d2', color: 'white', border: 'none', borderRadius: '4px',
                cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem'
              }}>Download All</button>
              <button onClick={handleClear} style={{
                padding: '0.6rem 1.2rem', backgroundColor: 'white', color: '#666',
                border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', fontWeight: '500', fontSize: '0.9rem'
              }}>Clear</button>
            </div>
          </div>

          <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
            {playlistInfo.entries.map((video, idx) => {
              const job = getVideoJobStatus(idx)
              const isDone = job?.status === 'done'
              const isDownloading = job?.status === 'downloading'
              const isError = job?.status === 'error'
              const progress = job?.progress || 0
              const dlInfo = job?.dlInfo || ''

              return (
                <div key={idx} style={{ borderBottom: '1px solid #f0f0f0', backgroundColor: isDone ? '#f1f8e9' : isError ? '#ffebee' : 'white' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1.5rem' }}>
                    <span style={{ width: '2rem', textAlign: 'center', fontWeight: '600', color: '#757575', fontSize: '0.9rem', flexShrink: 0 }}>{idx + 1}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.95rem' }}>{video.title}</span>
                    <span style={{ color: '#757575', fontSize: '0.85rem', flexShrink: 0, display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      {formatDuration(video.duration)}
                      {videoSizes[idx] && (
                        <span style={{ fontSize: '0.8rem', backgroundColor: '#f0f0f0', padding: '0.1rem 0.4rem', borderRadius: '3px', color: '#9e9e9e' }}>{videoSizes[idx]}</span>
                      )}
                    </span>
                    <div style={{ flexShrink: 0, minWidth: '110px', textAlign: 'right' }}>
                      {isDone ? (
                        <a href={`/api/video/result/${job.jobId}`} download style={{
                          display: 'inline-block', padding: '0.35rem 0.75rem',
                          backgroundColor: '#2e7d32', color: 'white', textDecoration: 'none',
                          borderRadius: '4px', fontWeight: '500', fontSize: '0.85rem'
                        }}>Save</a>
                      ) : isDownloading ? (
                        <span style={{ color: '#1976d2', fontSize: '0.85rem', fontWeight: '600' }}>{progress}%</span>
                      ) : isError ? (
                        <button onClick={() => handleDownloadOne(video, idx)} style={{
                          padding: '0.35rem 0.75rem', backgroundColor: '#d32f2f', color: 'white',
                          border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: '500', fontSize: '0.85rem'
                        }}>Retry</button>
                      ) : (
                        <button onClick={() => handleDownloadOne(video, idx)} style={{
                          padding: '0.35rem 0.75rem', backgroundColor: '#1976d2', color: 'white',
                          border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: '500', fontSize: '0.85rem'
                        }}>Download</button>
                      )}
                    </div>
                  </div>
                  {isDownloading && (
                    <div style={{ padding: '0 1.5rem 0.75rem 3.75rem' }}>
                      <div style={{ width: '100%', height: '4px', backgroundColor: '#e0e0e0', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ width: `${progress}%`, height: '100%', backgroundColor: '#1976d2', borderRadius: '2px', transition: 'width 0.5s' }}></div>
                      </div>
                      {dlInfo && (
                        <div style={{ margin: '0.3rem 0 0 0', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          {dlInfo.split('|').map((part, i) => (
                            <span key={i} style={{ fontSize: '0.75rem', color: '#9e9e9e', backgroundColor: '#f5f5f5', padding: '0.1rem 0.4rem', borderRadius: '3px' }}>{part.trim()}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default VideoDownloadTool
