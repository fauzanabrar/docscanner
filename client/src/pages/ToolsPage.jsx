import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CombineTool from '../modules/tools/CombineTool'
import SplitTool from '../modules/tools/SplitTool'
import CompressTool from '../modules/tools/CompressTool'
import ImageResizeTool from '../modules/tools/ImageResizeTool'
import ImageCompressTool from '../modules/tools/ImageCompressTool'
import VideoDownloadTool from '../modules/tools/VideoDownloadTool'
import VideoCompressTool from '../modules/tools/VideoCompressTool'
import VideoTranscribeTool from '../modules/tools/VideoTranscribeTool'
import VideoAudioTool from '../modules/tools/VideoAudioTool'

const PDF_TOOLS = [
  {
    id: 'combine',
    title: 'Combine PDFs',
    description: 'Merge multiple PDF files into a single document. Add files and reorder them before combining.',
    icon: '📎',
    detail: '2+ files → 1 merged PDF'
  },
  {
    id: 'split',
    title: 'Split PDF',
    description: 'Extract specific pages or split a PDF into multiple files by page ranges.',
    icon: '✂️',
    detail: '1 PDF → multiple files'
  },
  {
    id: 'compress',
    title: 'Compress PDF',
    description: 'Reduce file size by optimizing images and removing unnecessary data from your PDF.',
    icon: '📦',
    detail: 'Smaller file, same quality'
  }
]

const IMAGE_TOOLS = [
  {
    id: 'docscanner',
    title: 'DocScanner',
    description: 'Scan physical documents using your camera with automatic perspective correction.',
    icon: '📷',
    detail: 'Camera → Image',
    path: '/scanner'
  },
  {
    id: 'imageresize',
    title: 'Resize Image',
    description: 'Change the dimensions of an image by setting exact width and height.',
    icon: '📐',
    detail: 'Change dimensions'
  },
  {
    id: 'imagecompress',
    title: 'Compress Image',
    description: 'Reduce image file size by adjusting its quality, making it easier to share or upload.',
    icon: '📉',
    detail: 'Reduce file size'
  }
]

const TOOL_COMPONENTS = {
  combine: CombineTool,
  split: SplitTool,
  compress: CompressTool,
  imageresize: ImageResizeTool,
  imagecompress: ImageCompressTool,
  videodownload: VideoDownloadTool,
  videocompress: VideoCompressTool,
  videotranscribe: VideoTranscribeTool,
  videoaudio: VideoAudioTool
}

const VIDEO_TOOLS = [
  {
    id: 'videodownload',
    title: 'Download Video',
    description: 'Download videos from supported platforms directly via URL.',
    icon: '📥',
    detail: 'URL → Video File'
  },
  {
    id: 'videocompress',
    title: 'Compress Video',
    description: 'Reduce video file size by adjusting resolution and bitrate.',
    icon: '🗜️',
    detail: 'Smaller video size'
  },
  {
    id: 'videotranscribe',
    title: 'Transcribe Video',
    description: 'Generate downloadable subtitles (.srt) from a video or audio file using on-device speech recognition.',
    icon: '📝',
    detail: 'Video → .srt subtitles'
  },
  {
    id: 'videoaudio',
    title: 'Video to Audio',
    description: 'Extract downloadable audio from an uploaded video or supported video URL.',
    icon: '♫',
    detail: 'Video or URL to audio'
  }
]

function ToolsPage() {
  const [activeTool, setActiveTool] = useState(null)
  const navigate = useNavigate()

  const ActiveComponent = activeTool ? TOOL_COMPONENTS[activeTool] : null

  const handleToolClick = (tool) => {
    if (tool.path) {
      navigate(tool.path)
    } else {
      setActiveTool(tool.id)
    }
  }

  return (
    <div className="tools-page">
      <header className="tools-header">
        <div>
          <span className="section-eyebrow">Utilities</span>
          <h1 className="tools-title">Available Tools</h1>
          <p className="tools-subtitle">Choose from our collection of PDF and Image processing tools.</p>
        </div>
        {activeTool && (
          <button className="btn-secondary compact" type="button" onClick={() => setActiveTool(null)}>
            ← All tools
          </button>
        )}
      </header>

      {!activeTool && (
        <div className="tools-categories">
          <section className="tools-category" style={{ marginBottom: '2rem' }}>
            <h2 className="category-title" style={{ marginBottom: '1rem', fontSize: '1.25rem', fontWeight: '600' }}>PDF Tools</h2>
            <div className="tools-grid">
              {PDF_TOOLS.map(tool => (
                <button
                  key={tool.id}
                  className="tool-card"
                  type="button"
                  onClick={() => handleToolClick(tool)}
                >
                  <span className="tool-icon" aria-hidden="true">{tool.icon}</span>
                  <div className="tool-body">
                    <strong>{tool.title}</strong>
                    <p>{tool.description}</p>
                    <span className="tool-detail">{tool.detail}</span>
                  </div>
                  <span className="tool-arrow" aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          </section>
          
          <section className="tools-category" style={{ marginBottom: '2rem' }}>
            <h2 className="category-title" style={{ marginBottom: '1rem', fontSize: '1.25rem', fontWeight: '600' }}>Image Tools</h2>
            <div className="tools-grid">
              {IMAGE_TOOLS.map(tool => (
                <button
                  key={tool.id}
                  className="tool-card"
                  type="button"
                  onClick={() => handleToolClick(tool)}
                >
                  <span className="tool-icon" aria-hidden="true">{tool.icon}</span>
                  <div className="tool-body">
                    <strong>{tool.title}</strong>
                    <p>{tool.description}</p>
                    <span className="tool-detail">{tool.detail}</span>
                  </div>
                  <span className="tool-arrow" aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          </section>

          <section className="tools-category" style={{ marginBottom: '2rem' }}>
            <h2 className="category-title" style={{ marginBottom: '1rem', fontSize: '1.25rem', fontWeight: '600' }}>Video Tools</h2>
            <div className="tools-grid">
              {VIDEO_TOOLS.map(tool => (
                <button
                  key={tool.id}
                  className="tool-card"
                  type="button"
                  onClick={() => handleToolClick(tool)}
                >
                  <span className="tool-icon" aria-hidden="true">{tool.icon}</span>
                  <div className="tool-body">
                    <strong>{tool.title}</strong>
                    <p>{tool.description}</p>
                    <span className="tool-detail">{tool.detail}</span>
                  </div>
                  <span className="tool-arrow" aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {ActiveComponent && (
        <div className="tool-active-panel">
          <ActiveComponent />
        </div>
      )}
    </div>
  )
}

export default ToolsPage
