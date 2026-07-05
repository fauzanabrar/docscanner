import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'docscanner.videoAudioJob'
const NEW_JOB_GRACE_MS = 30_000
const REQUEST_TIMEOUT_MS = 15_000
const UPLOAD_TIMEOUT_MS = 30 * 60 * 1000
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024
const VALID_SOURCE_TYPES = new Set(['url', 'upload'])
const VALID_FORMATS = new Set(['mp3', 'm4a', 'wav'])
const VALID_BITRATES = new Set(['128k', '192k', '320k'])

function isValidStoredJob(job) {
  return Boolean(
    job && typeof job === 'object' &&
    typeof job.jobId === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(job.jobId) &&
    VALID_SOURCE_TYPES.has(job.sourceType) &&
    VALID_FORMATS.has(job.format) &&
    VALID_BITRATES.has(job.bitrate) &&
    typeof job.sourceLabel === 'string' &&
    Number.isFinite(job.createdAt)
  )
}

function clearStoredJob() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage may be disabled; React state is still cleared by the caller.
  }
}

function readStoredJob() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { job: null, storageError: '' }
    const job = JSON.parse(raw)
    if (!isValidStoredJob(job)) {
      clearStoredJob()
      return { job: null, storageError: 'Invalid saved conversion state was cleared.' }
    }
    return { job, storageError: '' }
  } catch {
    clearStoredJob()
    return { job: null, storageError: 'Browser storage is unavailable. Conversion cannot start safely.' }
  }
}

function storeJob(job) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(job))
    return true
  } catch {
    return false
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

function createJobId() {
  return globalThis.crypto?.randomUUID?.() || `audio_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function formatFileSize(bytes) {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}

function isSupportedVideoFile(file) {
  if (!file) return false
  return file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi|m4v|mpeg|mpg|3gp|ts)$/i.test(file.name)
}

function VideoAudioTool() {
  const initialState = useRef(readStoredJob()).current
  const initialJob = initialState.job
  const uploadInFlight = useRef(false)
  const removalInFlight = useRef(false)
  const submissionInFlight = useRef(false)
  const [sourceType, setSourceType] = useState(initialJob?.sourceType || 'url')
  const [url, setUrl] = useState(initialJob?.sourceUrl || '')
  const [file, setFile] = useState(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [format, setFormat] = useState(initialJob?.format || 'mp3')
  const [bitrate, setBitrate] = useState(initialJob?.bitrate || '192k')
  const [job, setJob] = useState(initialJob)
  const [phase, setPhase] = useState(initialJob ? 'processing' : 'idle')
  const [progress, setProgress] = useState(0)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [detail, setDetail] = useState(initialJob ? 'Reconnecting to conversion...' : '')
  const [error, setError] = useState(initialState.storageError)
  const [removing, setRemoving] = useState(false)

  const forgetJob = useCallback(() => {
    clearStoredJob()
    setJob(null)
    setPhase('idle')
    setProgress(0)
    setUploadProgress(0)
    setDetail('')
  }, [])

  const removeCurrentJob = useCallback(async () => {
    const jobId = job?.jobId
    if (!jobId) return true
    if (removalInFlight.current) return false

    removalInFlight.current = true
    setRemoving(true)
    setError('')
    try {
      const response = await fetchWithTimeout(`/api/video/job/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
        keepalive: true
      })
      if (!response.ok && response.status !== 404) throw new Error('Server rejected job deletion.')
      forgetJob()
      setFile(null)
      setFileInputKey(value => value + 1)
      return true
    } catch {
      setError('Could not remove the saved audio. Check the connection and try again; the existing result was kept.')
      return false
    } finally {
      removalInFlight.current = false
      setRemoving(false)
    }
  }, [forgetJob, job?.jobId])

  useEffect(() => {
    if (!job?.jobId) return undefined

    let stopped = false
    let timer

    const poll = async () => {
      try {
        const response = await fetchWithTimeout(`/api/video/job/${encodeURIComponent(job.jobId)}`)
        if (stopped) return

        if (response.status === 404) {
          const jobAge = Date.now() - (job.createdAt || 0)
          if (!uploadInFlight.current && jobAge >= NEW_JOB_GRACE_MS) {
            forgetJob()
            setError('The saved conversion job could not be found. Please start it again.')
          } else {
            timer = window.setTimeout(poll, 1000)
          }
          return
        }
        if (!response.ok) throw new Error('Unable to read conversion status.')

        const data = await response.json()
        if (!data || !['processing', 'done', 'error'].includes(data.status)) {
          throw new Error('Server returned an invalid conversion status.')
        }
        const nextProgress = Number.isFinite(Number(data.progress))
          ? Math.min(100, Math.max(0, Number(data.progress)))
          : 0
        setProgress(nextProgress)
        setDetail(data.detail || 'Converting video to audio...')

        if (data.status === 'done') {
          setPhase('done')
          setProgress(100)
          return
        }
        if (data.status === 'error') {
          setPhase('error')
          setError(data.error || 'Audio conversion failed.')
          return
        }

        setPhase(current => current === 'uploading' ? current : 'processing')
        timer = window.setTimeout(poll, 1000)
      } catch {
        if (stopped) return
        setDetail('Connection interrupted. Retrying...')
        timer = window.setTimeout(poll, 2500)
      }
    }

    poll()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [forgetJob, job])

  const rememberJob = (nextJob) => {
    if (!storeJob(nextJob)) return false
    setJob(nextJob)
    return true
  }

  const startUrlConversion = async (nextJob) => {
    const response = await fetchWithTimeout('/api/video/audio/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: nextJob.sourceUrl,
        jobId: nextJob.jobId,
        format: nextJob.format,
        bitrate: nextJob.bitrate
      })
    }, 30_000)
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Failed to start URL conversion.')
    setPhase('processing')
    setDetail('Downloading source video...')
  }

  const startUploadConversion = (nextJob) => new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('jobId', nextJob.jobId)
    formData.append('format', nextJob.format)
    formData.append('bitrate', nextJob.bitrate)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/video/audio/upload')
    xhr.timeout = UPLOAD_TIMEOUT_MS
    uploadInFlight.current = true
    xhr.upload.onprogress = event => {
      if (!event.lengthComputable) return
      setUploadProgress(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      uploadInFlight.current = false
      const data = (() => {
        try { return JSON.parse(xhr.responseText) } catch { return {} }
      })()
      if (xhr.status >= 200 && xhr.status < 300) {
        setPhase('processing')
        setDetail('Extracting audio from uploaded video...')
        resolve(data)
      } else {
        reject(new Error(data.error || 'Failed to upload the video.'))
      }
    }
    xhr.onerror = () => {
      uploadInFlight.current = false
      reject(new Error('The video upload was interrupted.'))
    }
    xhr.ontimeout = () => {
      uploadInFlight.current = false
      reject(new Error('The video upload timed out. Check the connection or use a smaller file.'))
    }
    xhr.onabort = () => {
      uploadInFlight.current = false
      reject(new Error('The video upload was cancelled.'))
    }
    xhr.send(formData)
  })

  const handleSubmit = async event => {
    event.preventDefault()
    if (submissionInFlight.current || job) return
    setError('')

    if (sourceType === 'url' && !url.trim()) {
      setError('Enter a video URL to convert.')
      return
    }
    if (sourceType === 'url') {
      try {
        const parsedUrl = new URL(url.trim())
        if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) throw new Error()
      } catch {
        setError('Enter a valid HTTP or HTTPS video URL without embedded credentials.')
        return
      }
    }
    if (sourceType === 'upload' && !file) {
      setError('Select a video file to convert.')
      return
    }
    if (sourceType === 'upload' && !isSupportedVideoFile(file)) {
      setError('Select a supported video file.')
      return
    }
    if (sourceType === 'upload' && file.size > MAX_UPLOAD_BYTES) {
      setError('The video is larger than the 500 MB upload limit.')
      return
    }

    const nextJob = {
      jobId: createJobId(),
      sourceType,
      sourceUrl: sourceType === 'url' ? url.trim() : '',
      sourceLabel: sourceType === 'url' ? url.trim() : file.name,
      format,
      bitrate,
      createdAt: Date.now()
    }

    submissionInFlight.current = true
    if (!rememberJob(nextJob)) {
      submissionInFlight.current = false
      setError('Browser storage is unavailable. Enable site storage before starting so the job can reconnect after this tab closes.')
      return
    }
    setProgress(0)
    setUploadProgress(0)
    setPhase(sourceType === 'upload' ? 'uploading' : 'processing')
    setDetail(sourceType === 'upload' ? 'Uploading video...' : 'Starting conversion...')

    try {
      if (sourceType === 'url') await startUrlConversion(nextJob)
      else await startUploadConversion(nextJob)
    } catch (conversionError) {
      let cleanupConfirmed = false
      try {
        const cleanupResponse = await fetchWithTimeout(`/api/video/job/${encodeURIComponent(nextJob.jobId)}`, {
          method: 'DELETE',
          keepalive: true
        })
        cleanupConfirmed = cleanupResponse.ok || cleanupResponse.status === 404
      } catch {
        cleanupConfirmed = false
      }

      if (cleanupConfirmed) {
        forgetJob()
        setError(conversionError.message)
      } else {
        setPhase('processing')
        setDetail('Connection status is unknown. Reconnecting to the server...')
        setError(`${conversionError.message} The saved job was kept until the server confirms its status.`)
      }
    } finally {
      submissionInFlight.current = false
    }
  }

  const handleSourceTypeChange = async nextType => {
    if (nextType === sourceType || removing) return
    if (job && !(await removeCurrentJob())) return
    setSourceType(nextType)
  }

  const handleUrlChange = async event => {
    const nextUrl = event.target.value
    if (removing) return
    if (job && nextUrl !== job.sourceUrl && !(await removeCurrentJob())) return
    setUrl(nextUrl)
  }

  const handleFileChange = async event => {
    const nextFile = event.target.files?.[0] || null
    if (removing) return
    if (job && nextFile?.name !== job.sourceLabel && !(await removeCurrentJob())) {
      setFileInputKey(value => value + 1)
      return
    }
    if (nextFile && !isSupportedVideoFile(nextFile)) {
      setFile(null)
      setFileInputKey(value => value + 1)
      setError('Select a supported video file.')
      return
    }
    if (nextFile && nextFile.size > MAX_UPLOAD_BYTES) {
      setFile(null)
      setFileInputKey(value => value + 1)
      setError('The video is larger than the 500 MB upload limit.')
      return
    }
    setFile(nextFile)
    setError('')
  }

  const isBusy = phase === 'uploading' || phase === 'processing'
  const displayedProgress = phase === 'uploading' ? uploadProgress : progress

  return (
    <section className="tool-workspace audio-converter">
      <header className="tool-workspace-header">
        <h2>Convert Video to Audio</h2>
        <p>Upload a video or provide a supported video URL, then download the extracted audio.</p>
      </header>

      <div className="audio-source-tabs" role="tablist" aria-label="Video source">
        <button
          className={`audio-source-tab ${sourceType === 'url' ? 'active' : ''}`}
          type="button"
          role="tab"
          aria-selected={sourceType === 'url'}
          onClick={() => handleSourceTypeChange('url')}
          disabled={removing}
        >
          Video URL
        </button>
        <button
          className={`audio-source-tab ${sourceType === 'upload' ? 'active' : ''}`}
          type="button"
          role="tab"
          aria-selected={sourceType === 'upload'}
          onClick={() => handleSourceTypeChange('upload')}
          disabled={removing}
        >
          Upload video
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        {sourceType === 'url' ? (
          <div className="tool-input-group">
            <label className="tool-label" htmlFor="audio-video-url">Video URL</label>
            <input
              id="audio-video-url"
              className="tool-text-input"
              type="url"
              value={url}
              onChange={handleUrlChange}
              placeholder="https://www.youtube.com/watch?v=..."
              autoComplete="url"
              disabled={removing}
            />
            <span className="tool-hint">Changing this URL removes the previous conversion and its saved audio.</span>
          </div>
        ) : (
          <div className="tool-input-group">
            <label className="tool-label" htmlFor="audio-video-file">Video file</label>
            <label className="tool-upload-zone" htmlFor="audio-video-file">
              <input
                key={fileInputKey}
                id="audio-video-file"
                className="tool-file-input"
                type="file"
                accept="video/*,.mkv,.avi,.mov,.m4v,.mpeg,.mpg,.3gp,.ts"
                onChange={handleFileChange}
                disabled={removing}
              />
              <span className="tool-upload-content">
                <span className="tool-upload-icon" aria-hidden="true">+</span>
                <strong>{file?.name || job?.sourceLabel || 'Choose a video file'}</strong>
                <span>{file ? formatFileSize(file.size) : 'MP4, MOV, MKV, WebM, AVI, and other common formats'}</span>
              </span>
            </label>
          </div>
        )}

        <div className="audio-settings">
          <div>
            <label className="tool-label" htmlFor="audio-format">Audio format</label>
            <select
              id="audio-format"
              className="tool-text-input"
              value={format}
              onChange={event => setFormat(event.target.value)}
              disabled={Boolean(job)}
            >
              <option value="mp3">MP3</option>
              <option value="m4a">M4A</option>
              <option value="wav">WAV</option>
            </select>
          </div>
          <div>
            <label className="tool-label" htmlFor="audio-bitrate">Audio quality</label>
            <select
              id="audio-bitrate"
              className="tool-text-input"
              value={bitrate}
              onChange={event => setBitrate(event.target.value)}
              disabled={Boolean(job) || format === 'wav'}
            >
              <option value="128k">128 kbps</option>
              <option value="192k">192 kbps</option>
              <option value="320k">320 kbps</option>
            </select>
          </div>
        </div>

        <div className="tool-info-card audio-retention-note">
          <strong>Safe to close this tab</strong>
          <p>
            URL processing continues on the server. For uploads, wait until the upload reaches 100%; conversion then continues even if this tab or window is closed. The result stays available until you remove it or replace the source.
          </p>
        </div>

        {error && (
          <div className="tool-error" role="alert">
            <strong>Conversion error</strong>
            <span>{error}</span>
          </div>
        )}

        {(isBusy || phase === 'done') && (
          <div className="audio-progress" aria-live="polite">
            <div className="audio-progress-heading">
              <strong>{phase === 'done' ? 'Conversion complete' : detail}</strong>
              <span>{Math.round(displayedProgress)}%</span>
            </div>
            <div className="audio-progress-bar" role="progressbar" aria-valuenow={displayedProgress} aria-valuemin="0" aria-valuemax="100">
              <span className="audio-progress-fill" style={{ width: `${displayedProgress}%` }} />
            </div>
            {phase === 'uploading' && uploadProgress === 100 && (
              <small>Upload complete. Waiting for the server to start conversion...</small>
            )}
          </div>
        )}

        {phase === 'done' && job && (
          <div className="tool-success">
            <strong>Your audio is ready</strong>
            <span>{job.sourceLabel}</span>
          </div>
        )}

        <div className="tool-footer-actions">
          {job && (
            <button className="btn-secondary" type="button" onClick={removeCurrentJob} disabled={removing}>
              {removing ? 'Removing...' : 'Remove result'}
            </button>
          )}
          {phase === 'done' && job ? (
            <a className="btn-primary audio-download-link" href={`/api/video/result/${encodeURIComponent(job.jobId)}`}>
              Download audio
            </a>
          ) : (
            <button
              className="btn-primary"
              type="submit"
              disabled={removing || Boolean(job) || (sourceType === 'url' ? !url.trim() : !file)}
            >
              {isBusy ? 'Converting...' : 'Convert to audio'}
            </button>
          )}
        </div>
      </form>
    </section>
  )
}

export default VideoAudioTool
