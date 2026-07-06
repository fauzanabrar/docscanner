import { useCallback, useEffect, useId, useState } from 'react'

const EMPTY_STATUS = { present: false, updatedAt: null }
const SAMPLE_COOKIE = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t1791692798\tCOOKIE_NAME\tCOOKIE_VALUE'
const STATUS_EVENT = 'docscanner:ytdlp-cookies-changed'

function formatUpdatedAt(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}

export function CookiesButton({ label = 'YouTube Cookies', onChanged }) {
  const headingId = useId()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState(null)
  const [text, setText] = useState('')
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [action, setAction] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true)
    try {
      const response = await fetch('/api/video/cookies')
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not load cookie status.')
      setStatus({ present: Boolean(data.present), updatedAt: data.updatedAt || null })
      setError('')
    } catch (loadError) {
      setStatus(EMPTY_STATUS)
      setError(loadError.message || 'Could not load cookie status.')
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  useEffect(() => {
    const handleStatusChange = event => setStatus(event.detail || EMPTY_STATUS)
    window.addEventListener(STATUS_EVENT, handleStatusChange)
    return () => window.removeEventListener(STATUS_EVENT, handleStatusChange)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = event => {
      if (event.key === 'Escape' && !action) setOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [action, open])

  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(''), 3000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const openDialog = () => {
    setText('')
    setError('')
    setOpen(true)
    loadStatus()
  }

  const closeDialog = () => {
    if (action) return
    setOpen(false)
    setText('')
    setError('')
  }

  const normalizedInput = text.replace(/\r\n?/g, '\n').trim()
  const firstLine = normalizedInput.split('\n')[0] || ''
  const hasHeader = /^#\s*(Netscape\s+HTTP\s+Cookie\s+File|HTTP\s+Cookie\s+File)/i.test(firstLine)
  const hasTab = normalizedInput.split('\n').some(line => line.includes('\t'))
  const looksSpaceSeparated = normalizedInput.split('\n').some(line => {
    const trimmed = line.trim()
    return trimmed && !trimmed.startsWith('#') && !line.includes('\t') && trimmed.split(/\s+/).length >= 6
  })
  const canSave = Boolean(normalizedInput && (hasHeader || hasTab)) && !action

  const applyStatus = nextStatus => {
    setStatus(nextStatus)
    window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: nextStatus }))
    onChanged?.(nextStatus)
  }

  const handleSave = async () => {
    if (!canSave) return
    setAction('save')
    setError('')
    try {
      const response = await fetch('/api/video/cookies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: text })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to save cookies.')
      applyStatus({ present: Boolean(data.present), updatedAt: data.updatedAt || null })
      setNotice('Saved ✓')
      setText('')
      setOpen(false)
    } catch (saveError) {
      setError(saveError.message || 'Failed to save cookies.')
    } finally {
      setAction('')
    }
  }

  const handleClear = async () => {
    setAction('clear')
    setError('')
    try {
      const response = await fetch('/api/video/cookies', { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to clear cookies.')
      applyStatus(EMPTY_STATUS)
      setNotice('Cleared')
      setText('')
      setOpen(false)
    } catch (clearError) {
      setError(clearError.message || 'Failed to clear cookies.')
    } finally {
      setAction('')
    }
  }

  const updatedAt = formatUpdatedAt(status?.updatedAt)

  return (
    <>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={openDialog}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            padding: '0.55rem 0.8rem',
            backgroundColor: '#fff',
            color: '#1976d2',
            border: '1px solid #1976d2',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: '600',
            whiteSpace: 'nowrap'
          }}
        >
          <span aria-hidden="true">🔑</span>
          <span>{label}</span>
          {!loadingStatus && status?.present && (
            <span aria-label="Cookies set" title="Cookies set" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#2e7d32' }} />
          )}
        </button>
        {!loadingStatus && (
          <span style={{ color: status?.present ? '#2e7d32' : '#777', fontSize: '0.8rem' }}>
            {status?.present ? 'Cookies set ✓' : 'No cookies'}
          </span>
        )}
        {notice && <span role="status" style={{ color: '#2e7d32', fontSize: '0.8rem', fontWeight: '600' }}>{notice}</span>}
      </span>

      {open && (
        <div
          role="presentation"
          onMouseDown={event => { if (event.target === event.currentTarget) closeDialog() }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            backgroundColor: 'rgba(0, 0, 0, 0.55)'
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            style={{
              width: 'min(720px, 100%)',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '1.5rem',
              backgroundColor: '#fff',
              borderRadius: '10px',
              boxShadow: '0 16px 48px rgba(0, 0, 0, 0.28)',
              boxSizing: 'border-box'
            }}
          >
            <h3 id={headingId} style={{ margin: '0 0 0.75rem', color: '#1976d2', fontSize: '1.35rem' }}>YouTube Session Cookies</h3>
            <p style={{ margin: '0 0 1rem', color: '#555', lineHeight: 1.5 }}>
              Paste your browser&apos;s YouTube cookies so downloads keep working when the server&apos;s session expires or YouTube shows &quot;confirm you&apos;re not a bot&quot;.
            </p>

            <div style={{ marginBottom: '1rem', padding: '0.75rem', borderRadius: '6px', backgroundColor: status?.present ? '#e8f5e9' : '#f5f5f5', color: status?.present ? '#2e7d32' : '#666' }}>
              <strong>{loadingStatus ? 'Checking cookie status…' : status?.present ? 'Cookies set ✓' : 'No cookies set'}</strong>
              {status?.present && updatedAt && <span style={{ display: 'block', marginTop: '0.2rem', fontSize: '0.8rem' }}>Last updated: {updatedAt}</span>}
            </div>

            <h4 style={{ margin: '0 0 0.5rem', color: '#333' }}>How to get your YouTube cookies</h4>
            <ol style={{ margin: '0 0 1rem', paddingLeft: '1.4rem', color: '#444', lineHeight: 1.55 }}>
              <li>
                Install a cookies-export extension:
                <ul style={{ margin: '0.3rem 0 0.4rem', paddingLeft: '1.25rem' }}>
                  <li>Chrome / Edge / Brave: <strong>&quot;Get cookies.txt LOCALLY&quot;</strong></li>
                  <li>Firefox: <strong>&quot;cookies.txt&quot;</strong></li>
                </ul>
              </li>
              <li>Open <strong>youtube.com</strong> in that browser and make sure you&apos;re <strong>signed in</strong> (a secondary / throwaway Google account is recommended).</li>
              <li>Click the extension icon while on a youtube.com tab.</li>
              <li>Choose <strong>Export</strong> (Netscape format). It downloads a <code>cookies.txt</code> file (or copies the contents).</li>
              <li>Open that file in a text editor and <strong>copy everything</strong> — it must start with <code># Netscape HTTP Cookie File</code>.</li>
              <li><strong>Paste it below</strong> and click <strong>Save</strong>.</li>
            </ol>
            <p style={{ margin: '0 0 1rem', color: '#666', fontSize: '0.9rem', fontStyle: 'italic' }}>
              Tip: if downloads start failing again later, your session expired — repeat these steps to refresh the cookies.
            </p>

            <label htmlFor={`${headingId}-text`} style={{ display: 'block', marginBottom: '0.4rem', fontWeight: '600', color: '#333' }}>Netscape cookies.txt contents</label>
            <textarea
              id={`${headingId}-text`}
              value={text}
              onChange={event => setText(event.target.value)}
              placeholder={SAMPLE_COOKIE}
              rows={10}
              spellCheck={false}
              autoComplete="off"
              wrap="off"
              disabled={Boolean(action)}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid #bbb',
                borderRadius: '4px',
                boxSizing: 'border-box',
                resize: 'vertical',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                fontSize: '0.8rem',
                lineHeight: 1.45
              }}
            />

            {normalizedInput && !canSave && (
              <div style={{ marginTop: '0.5rem', color: '#d32f2f', fontSize: '0.85rem' }}>
                {looksSpaceSeparated
                  ? 'Looks like tabs were converted to spaces — re-copy the file without reformatting.'
                  : 'Paste a Netscape cookies.txt file with its header or TAB-separated cookie lines.'}
              </div>
            )}

            <p style={{ margin: '0.9rem 0', color: '#777', fontSize: '0.8rem', lineHeight: 1.45 }}>
              Cookies are stored on the server and used for every download from this instance. Only paste cookies for an account you control — a secondary / throwaway Google account is recommended. Clearing removes them from the server.
            </p>

            {error && (
              <div role="alert" style={{ marginBottom: '0.9rem', padding: '0.75rem', color: '#d32f2f', backgroundColor: '#ffebee', borderRadius: '4px' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
              {status?.present && (
                <button type="button" onClick={handleClear} disabled={Boolean(action)} style={{ padding: '0.65rem 1rem', backgroundColor: '#fff', color: '#d32f2f', border: '1px solid #d32f2f', borderRadius: '4px', cursor: action ? 'not-allowed' : 'pointer', fontWeight: '600' }}>
                  {action === 'clear' ? 'Clearing…' : 'Clear'}
                </button>
              )}
              <button type="button" onClick={closeDialog} disabled={Boolean(action)} style={{ padding: '0.65rem 1rem', backgroundColor: '#fff', color: '#555', border: '1px solid #bbb', borderRadius: '4px', cursor: action ? 'not-allowed' : 'pointer', fontWeight: '600' }}>
                Cancel
              </button>
              <button type="button" onClick={handleSave} disabled={!canSave} style={{ padding: '0.65rem 1.2rem', backgroundColor: canSave ? '#1976d2' : '#9e9e9e', color: '#fff', border: 'none', borderRadius: '4px', cursor: canSave ? 'pointer' : 'not-allowed', fontWeight: '600' }}>
                {action === 'save' ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default CookiesButton
