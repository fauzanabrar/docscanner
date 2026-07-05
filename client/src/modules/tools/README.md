# Tools Module

## Purpose

Provides the PDF, image, and video utilities surfaced on the Tools page. PDF and video tools process server-side; image resize/compress tools use the browser Canvas API. The client handles file or URL selection, configuration, progress, persistence, and downloads.

## Components

### PDF tools (server-side)

- `CombineTool.jsx`
  Upload 1+ PDF files, extract individual pages into a visual grid, rearrange them via high-performance native drag-and-drop or position dropdowns, and merge into a single PDF download.

- `SplitTool.jsx`
  Upload a single PDF, choose a split mode (custom ranges, every page, or extract specific pages), download result as ZIP or single PDF.

- `CompressTool.jsx`
  Upload a single PDF, compress via structural optimization, display original vs compressed size and percentage reduction.

### Image tools (client-side, Canvas API)

- `ImageResizeTool.jsx`
  Resize an image to exact width/height or by maintaining aspect ratio, then download.

- `ImageCompressTool.jsx`
  Reduce image file size by lowering quality or converting between JPEG/WebP, with live preview and estimated size.

### Video tools (server-side background jobs)

- `VideoDownloadTool.jsx`
  Download videos/playlists via URL (yt-dlp) with real-time speed/size/ETA, size estimation, and `localStorage`-backed persistence across refreshes.

- `VideoCompressTool.jsx`
  Upload a video and re-encode it to a smaller size (resolution/bitrate/format presets) via server-side `fluent-ffmpeg`, with upload + processing progress.

- `VideoTranscribeTool.jsx`
  Upload a video/audio file and generate downloadable `.srt` subtitles via server-side local Whisper (`@xenova/transformers`). Lets the user pick the spoken language (or auto-detect), model quality (`tiny`/`base`), and an optional **"reduce background music/noise"** toggle (server-side ffmpeg speech-isolation filter). Uploads via `XMLHttpRequest` with byte-level progress, then polls `/api/video/job/:jobId` for **real** background progress — audio extraction, model download, and per-window transcription (`window N of M`) mapped into a single monotonic bar with a live **ETA** (no fake/stalling animation). Results are shown in a **tabbed interface**: the **Transcription** tab displays the original subtitles (with Copy/Download), and the **Translate** tab lets the user pick source/target languages and generate a translated `.srt` (local `m2m100`) as a second background job — accessible immediately without scrolling. A green dot on the Translate tab indicates a completed translation. Both jobs store their `jobId` in `localStorage`, so closing the tab/window does not stop them and reopening the tool resumes the same progress or completed result. Results are shown inline (with a Copy button) and downloadable from `/api/video/result/:jobId`.

- `VideoAudioTool.jsx`
  Upload a video or submit a supported video URL, select MP3/M4A/WAV output, reconnect to the background job after reopening the browser, and download or explicitly remove the retained result.

## Implemented behavior

- Combine and Split tools use `fetch()` to POST multipart form data.
- Compress (PDF), Compress Video, and Transcribe use `XMLHttpRequest` to provide real-time byte-level upload progress tracking; PDF compress adds a simulated multi-phase processing animation for large files.
- PDF tool file inputs accept `application/pdf` only; video tools accept `video/*,audio/*` (and allow empty-MIME containers such as `.mkv`).
- Combine tool parses PDFs locally (using `pdfjs-dist`) to generate visual page thumbnails asynchronously. It supports adding multiple files incrementally and allows reordering at the specific page-level via native drag-and-drop or dropdowns.
- Split tool supports three modes: custom ranges (`1-3,5,7-9`), every page (each page → separate file), and extract specific pages.
- Compress tool reads `X-Original-Size`, `X-Compressed-Size`, and `X-Reduction-Percent` response headers to display stats.
- Video Compress and Transcribe run as server-side background jobs: the client stores a `jobId` in `localStorage` and polls `GET /api/video/job/:jobId`, so progress/results survive closing the tab/window or refreshing, and resume on return. Async callbacks are guarded against setState-after-unmount.
- All tools show loading state during processing and user-facing error messages on failure.
- Download is triggered via a temporary `<a>` element (PDF/image via `blob:` URL; server-side video tools via `/api/video/result/:jobId`).
- Video-to-audio metadata is validated and stored in `localStorage` so the UI can reconnect after refresh or tab closure.
- An upload must reach 100% before closing the browser; once the server accepts it, conversion continues in the background.
- Changing the source or selecting **Remove result** calls the delete endpoint. Client state is cleared only after the server confirms deletion, preventing orphaned retained files during network failures.
- Malformed stored state, duplicate submissions, concurrent deletion attempts, request timeouts, unsupported files, and files above 500 MB are handled explicitly.

## Server endpoints used

| Tool | Endpoint | Response |
|------|----------|----------|
| Combine | `POST /api/pdf/merge` | Merged PDF |
| Split | `POST /api/pdf/split` | PDF or ZIP |
| Compress (PDF) | `POST /api/pdf/compress` | Compressed PDF + headers |
| Download Video | `POST /api/video/download` → poll `GET /api/video/job/:jobId` → `GET /api/video/result/:jobId` | Background job → video/audio file |
| Compress Video | `POST /api/video/compress` → poll `GET /api/video/job/:jobId` → `GET /api/video/result/:jobId` | Background job → re-encoded video |
| Transcribe | `POST /api/video/transcribe` → poll `GET /api/video/job/:jobId` → `GET /api/video/result/:jobId` | Background job → `.srt` (text inline + download) |
| Translate subtitles | `POST /api/video/translate` (JSON) → poll `GET /api/video/job/:jobId` → `GET /api/video/result/:jobId` | Background job → translated `.srt` |
| Video to audio (URL) | `POST /api/video/audio/url` | Background job id |
| Video to audio (upload) | `POST /api/video/audio/upload` | Background job id |
| Shared video job status | `GET /api/video/job/:jobId` | Persistent job state |
| Shared video job result | `GET /api/video/result/:jobId` | Completed output file |
| Remove/cancel video job | `DELETE /api/video/job/:jobId` | Cancellation/deletion confirmation |

Image Resize/Compress do not call the server — they process entirely in the browser via the Canvas API.

## Current status

- PDF, Image, and Video tools are all functional.
- PDF compression is structural only (object stream optimization); image recompression is not yet implemented.
- Video transcription (Whisper) and subtitle translation (`m2m100`) use local models (no API key); models download on first use and are cached (see the root `README.md` prerequisites). Both run in one shared worker thread and support optional audio denoising, real progress + ETA, and resumable background jobs.
- Full video-to-audio lifecycle and API documentation is in [`docs/VIDEO_TO_AUDIO.md`](../../../../docs/VIDEO_TO_AUDIO.md).
