import React, { useState, useEffect } from 'react'

function VideoCompressTool() {
  const [file, setFile] = useState(null)
  const [quality, setQuality] = useState('480p')
  const [speed, setSpeed] = useState('fast')
  const [outFormat, setOutFormat] = useState('mp4')
  const [removeAudio, setRemoveAudio] = useState(false)
  const [error, setError] = useState(null)
  const [originalSize, setOriginalSize] = useState(null)
  const [compressedSize, setCompressedSize] = useState(null)
  
  const [processing, setProcessing] = useState(false)
  const [phase, setPhase] = useState('') // '', 'uploading', 'processing'
  const [uploadProgress, setUploadProgress] = useState(0)
  const [processingProgress, setProcessingProgress] = useState(0)
  const [processingTimemark, setProcessingTimemark] = useState(null)
  const [processingStatus, setProcessingStatus] = useState('Initializing...')
  const [jobId, setJobId] = useState(() => localStorage.getItem('compressJobId') || null)
  const [videoDuration, setVideoDuration] = useState(0)

  const qualities = ['240p', '360p', '480p', '720p', '1080p']

  useEffect(() => {
    if (!jobId || phase === 'uploading' || phase === 'done') {
      return
    }
    
    setProcessing(true)

    let intervalId
    const checkJob = async () => {
      try {
        const res = await fetch(`/api/video/job/${jobId}`)
        if (res.ok) {
          const data = await res.json()
          
          if (data.status === 'error') {
            setError(data.error || 'Compression failed.')
            setProcessing(false)
            setPhase('')
            setJobId(null)
            localStorage.removeItem('compressJobId')
            if (intervalId) clearInterval(intervalId)
          } else if (data.status === 'done') {
            setProcessingStatus('Compression complete!')
            setProcessingProgress(100)
            setProcessingTimemark(null)
            setPhase('done')
            setOriginalSize(data.originalSize || null)
            setCompressedSize(data.compressedSize || null)
            if (intervalId) clearInterval(intervalId)
          } else {
            if (phase !== 'processing') {
              setPhase('processing')
            }
            let currentP = 0
            if (data.percent === -1) {
              setProcessingTimemark(data.timemark || '00:00:00')
              setProcessingStatus(`Encoding video...`)
              setProcessingProgress(prev => {
                let next = prev + (Math.random() * 2.5)
                currentP = next > 95 ? 95 : Math.floor(next)
                return currentP
              })
            } else {
              setProcessingTimemark(null)
              currentP = data.percent || 0
              setProcessingProgress(currentP)
              if (currentP < 20) setProcessingStatus('Analyzing video streams...')
              else if (currentP < 95) setProcessingStatus('Applying FFmpeg compression filters...')
              else setProcessingStatus('Finalizing MP4 container...')
            }
          }
        } else if (res.status === 404) {
          setProcessing(false)
          setPhase('')
          setJobId(null)
          localStorage.removeItem('compressJobId')
          if (intervalId) clearInterval(intervalId)
        }
      } catch (e) {
        // silently fail on poll error
      }
    }

    checkJob()
    intervalId = setInterval(checkJob, 1000)

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [jobId, phase])

  const handleCompress = (e) => {
    e.preventDefault()
    if (!file) return

    if (!file.type.startsWith('video/')) {
      setError('Please select a valid video file.')
      return
    }

    const newJobId = Date.now().toString()
    setJobId(newJobId)
    localStorage.setItem('compressJobId', newJobId)
    setProcessing(true)
    setPhase('uploading')
    setUploadProgress(0)
    setProcessingProgress(0)
    setOriginalSize(null)
    setCompressedSize(null)
    setError(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('quality', quality)
    formData.append('speed', speed)
    formData.append('outFormat', outFormat)
    formData.append('removeAudio', removeAudio)
    formData.append('jobId', newJobId)
    if (videoDuration) formData.append('duration', videoDuration)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/video/compress')

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100)
        setUploadProgress(percent)
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // Initial upload finished, job is queued
        setPhase('processing')
        setProcessingStatus('Starting compression...')
      } else {
        try {
          const data = JSON.parse(xhr.responseText)
          setError(data.error || 'Failed to start compression')
        } catch {
          setError('Failed to start compression')
        }
        setProcessing(false)
        setPhase('')
        setJobId(null)
        localStorage.removeItem('compressJobId')
      }
    }

    xhr.onerror = () => {
      setError('A network error occurred during upload.')
      setProcessing(false)
      setPhase('')
    }

    xhr.send(formData)
  }

  const handleClearJob = async () => {
    if (jobId) {
      await fetch(`/api/video/job/${jobId}`, { method: 'DELETE' }).catch(() => {})
      setJobId(null)
      localStorage.removeItem('compressJobId')
    }
    setProcessing(false)
    setPhase('')
    setFile(null)
    setProcessingProgress(0)
    setUploadProgress(0)
    setOriginalSize(null)
    setCompressedSize(null)
    setError(null)
  }

  const formatBytes = (bytes) => {
    if (!bytes || isNaN(bytes)) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getSavingsPercentage = (original, compressed) => {
    if (!original || !compressed || original <= 0) return 0
    const pct = ((original - compressed) / original) * 100
    return Math.floor(pct)
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ marginBottom: '1.5rem', color: '#1976d2' }}>Compress Video</h2>
      <p style={{ marginBottom: '2rem', color: '#666', lineHeight: '1.6' }}>
        Reduce the file size of your videos. Select your target quality and adjust advanced settings.
      </p>

      {phase === 'done' ? (
        <div style={{ padding: '2rem', backgroundColor: '#e8f5e9', borderRadius: '8px', textAlign: 'center', border: '1px solid #c8e6c9' }}>
          <h3 style={{ color: '#2e7d32', marginBottom: '1rem' }}>Compression Complete!</h3>
          <p style={{ marginBottom: '1.5rem', color: '#1b5e20' }}>Your video has been successfully compressed and is ready to download.</p>
          
          {originalSize && compressedSize && (
            <div style={{ 
              backgroundColor: 'white', 
              borderRadius: '8px', 
              padding: '1.25rem 2rem', 
              marginBottom: '1.5rem', 
              boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
              display: 'inline-flex',
              gap: '1.5rem',
              alignItems: 'center',
              border: '1px solid #e0e0e0',
              flexWrap: 'wrap',
              justifyContent: 'center'
            }}>
              <div style={{ textAlign: 'left' }}>
                <span style={{ fontSize: '0.85rem', color: '#666', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Original Size</span>
                <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#333' }}>{formatBytes(originalSize)}</span>
              </div>
              <div style={{ fontSize: '1.5rem', color: '#bdbdbd' }}>➔</div>
              <div style={{ textAlign: 'left' }}>
                <span style={{ fontSize: '0.85rem', color: '#666', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Compressed Size</span>
                <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#2e7d32' }}>{formatBytes(compressedSize)}</span>
              </div>
              <div style={{ 
                backgroundColor: '#e8f5e9', 
                color: '#2e7d32', 
                fontWeight: 'bold', 
                padding: '0.4rem 0.8rem', 
                borderRadius: '16px',
                fontSize: '0.9rem',
                border: '1px solid #a5d6a7',
                marginLeft: '0.5rem'
              }}>
                Saved {getSavingsPercentage(originalSize, compressedSize)}%
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <a 
              href={`/api/video/result/${jobId}`} 
              style={{
                display: 'inline-block',
                padding: '0.75rem 2rem',
                backgroundColor: '#1976d2',
                color: 'white',
                textDecoration: 'none',
                borderRadius: '4px',
                fontWeight: '600',
                fontSize: '1rem',
                transition: 'background-color 0.2s'
              }}
            >
              Download Result
            </a>
            <button 
              onClick={handleClearJob}
              style={{
                padding: '0.75rem 2rem',
                backgroundColor: 'white',
                color: '#d32f2f',
                border: '1px solid #d32f2f',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '1rem',
                transition: 'background-color 0.2s'
              }}
            >
              Compress Another
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleCompress} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div>
          <label htmlFor="videoFile" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Select Video</label>
          <input
            id="videoFile"
            type="file"
            accept="video/*"
            onChange={(e) => {
              const selected = e.target.files[0]
              setFile(selected)
              if (selected) {
                const video = document.createElement('video')
                video.preload = 'metadata'
                video.onloadedmetadata = () => {
                  window.URL.revokeObjectURL(video.src)
                  setVideoDuration(video.duration)
                }
                video.src = window.URL.createObjectURL(selected)
              }
            }}
            required
            style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div>
            <label htmlFor="quality" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Target Quality</label>
            <select
              id="quality"
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', backgroundColor: 'white' }}
            >
              {qualities.map(q => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="outFormat" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Output Format</label>
            <select
              id="outFormat"
              value={outFormat}
              onChange={(e) => setOutFormat(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', backgroundColor: 'white' }}
            >
              <option value="mp4">MP4 (H.264)</option>
              <option value="webm">WebM (VP9)</option>
            </select>
          </div>

          <div>
            <label htmlFor="speed" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Encoding Speed</label>
            <select
              id="speed"
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', backgroundColor: 'white' }}
            >
              <option value="ultrafast">Ultrafast (Largest File)</option>
              <option value="fast">Fast (Balanced)</option>
              <option value="medium">Medium</option>
              <option value="slow">Slow (Smallest File)</option>
            </select>
          </div>
        </div>

        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: '500', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={removeAudio} 
              onChange={(e) => setRemoveAudio(e.target.checked)} 
              style={{ width: '16px', height: '16px' }}
            />
            Remove Audio (Mute)
          </label>
        </div>
        
        {error && <div style={{ color: '#d32f2f', padding: '0.75rem', backgroundColor: '#ffebee', borderRadius: '4px' }}>{error}</div>}
        
        {processing && phase === 'uploading' && (
          <div style={{ padding: '1rem', background: '#f5f5f5', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.9rem' }}>
              <strong>Uploading video...</strong>
              <span>{uploadProgress}%</span>
            </div>
            <div style={{ width: '100%', height: '8px', background: '#e0e0e0', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#1976d2', transition: 'width 0.2s' }} />
            </div>
          </div>
        )}

        {processing && (phase === 'processing' || phase === 'downloading') && (
          <div style={{ padding: '1rem', background: '#f5f5f5', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.9rem' }}>
              <strong>{processingStatus}</strong>
              {processingTimemark && phase === 'processing' ? (
                <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{processingTimemark}</span>
              ) : (
                <span>{phase === 'downloading' ? processingProgress : Math.min(processingProgress, 95)}%</span>
              )}
            </div>
            <div style={{ width: '100%', height: '8px', background: '#e0e0e0', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${phase === 'downloading' ? processingProgress : Math.min(processingProgress, 95)}%`, height: '100%', background: '#1976d2', transition: 'width 0.5s ease' }} />
            </div>
            {phase === 'processing' && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#666', fontStyle: 'italic' }}>
                Note: Video compression is CPU-intensive and may take several minutes for large files.
              </div>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={processing || !file}
          style={{
            padding: '0.75rem',
            backgroundColor: processing ? '#9e9e9e' : '#1976d2',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            fontSize: '1rem',
            fontWeight: '600',
            cursor: processing ? 'not-allowed' : 'pointer'
          }}
        >
          {processing ? 'Processing...' : 'Compress Video'}
        </button>
      </form>
      )}
    </div>
  )
}

export default VideoCompressTool
