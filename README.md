# DocScanner

DocScanner is a browser-based document scanner built with React and Express. It supports camera capture or image upload, document edge detection, manual corner adjustment with magnifier zoom, perspective correction, filter controls, multi-page document assembly, and export as PDF, JPG, or PNG from a production-oriented scanner interface. A dedicated PDF Tools page provides server-side combine, split, and compress utilities for existing PDF files.

## Current Flow

### Scanner
1. Start from a source image: take a photo or upload an image file.
2. Detect the document edges and adjust the four corners if needed.
3. Crop the document and apply presets or manual filters.
4. Add the processed page to a document.
5. Export the document or add another image to combine into the same PDF.

### Tools Page (`/`)
The home page provides a categorized list of available utilities:

**PDF Tools**
1. **Combine**: Upload 1+ PDF files, visually arrange and reorder specific pages via a high-performance drag-and-drop grid, and merge into a single PDF.
2. **Split**: Upload a PDF, choose page ranges or split every page, download as ZIP or single PDF.
3. **Compress**: Upload a PDF, optimize its internal structure, download a smaller file with size reduction stats.

**Image Tools**
1. **DocScanner**: Launch the camera/image capture workflow at `/scanner` to detect document edges, perspective correct, and assemble into a PDF.
2. **Resize Image**: Resize an image by specifying exact width and height or maintaining aspect ratio. 
3. **Compress Image**: Compress images by lowering visual quality or converting between JPEG/WebP formats with live previews and estimated file size.

**Video Tools**
1. **Download Video**: Download videos directly from supported platforms via URL. For playlists, it fetches metadata and allows downloading individual videos or batch queueing with a "Download All" option. Displays real-time download speed, file size, and ETA progress. Estimated file sizes are shown before downloading. Downloads survive page refresh via localStorage and server-side job persistence. Temporary files are automatically cleaned up after 24 hours.
2. **Compress Video**: Reduce video file size by adjusting resolution and preset speed (requires `fluent-ffmpeg`). Enforces resolution-scaled Constant Rate Factor (CRF) quality targets and Video Buffer Verifier (VBV) bitrate capping to prevent size bloating under fast presets. Displays visual before-and-after size statistics and savings percentage upon completion.
3. **Transcribe Video**: Upload a video (or audio) file and generate downloadable subtitles as a `.srt` file. Speech-to-text runs entirely on the server using a local Whisper model (`@xenova/transformers`) — no API key and no data leaves the machine. Choose the spoken language (or auto-detect) and model quality (fast `tiny` vs. more accurate `base`). An optional **background noise reduction** selector offers three modes: **None**, **Light** (ffmpeg speech-isolation EQ filter, fast), or **Deep** (Meta's Demucs neural source separation — slow but significantly better at isolating vocals from music and noise). Progress is **real** at every stage (audio extraction, model download, and per-window transcription) with a live **ETA**. Results are shown in a **tabbed interface** — a Transcription tab for reviewing/downloading the original subtitles, and a Translate tab for generating translated `.srt` files in other languages (local `m2m100` model). Both transcription and translation run as background jobs: closing the tab/window does not stop them, and reopening the tool resumes the same progress or completed result via localStorage + server-side job persistence.
4. **Video to Audio**: Upload a video or provide a supported video URL and extract MP3, M4A, or WAV audio. Conversion runs as a persistent server job, reconnects after the tab or window is reopened, and keeps completed audio until the user removes or replaces the source.

Video-to-audio jobs reject private-network URLs, cap uploads and URL downloads at 500 MB, time out stalled subprocesses, and limit concurrent conversions (default: 2). Configure `AUDIO_JOB_TIMEOUT_MS` and `MAX_ACTIVE_AUDIO_JOBS` when needed.

See [`docs/VIDEO_TO_AUDIO.md`](docs/VIDEO_TO_AUDIO.md) and [`docs/VIDEO_COMPRESSION.md`](docs/VIDEO_COMPRESSION.md) for lifecycle guarantees, API contracts, storage layouts, limits, and recovery behaviors.

## Implemented Features

- Camera capture using the browser MediaDevices API with rear-camera preference on mobile.
- Image upload via file picker or drag and drop.
- Canvas-based document edge detection with manual corner fallback.
- Perspective warp from a four-corner selection into a flattened rectangle.
- Filter presets plus manual brightness, contrast, saturation, and sharpen sliders.
- Filter application from the original cropped image, not from previously filtered output.
- Production scanner shell with document status, workflow progress, responsive capture/edit/review layouts, and accessible page controls.
- Dedicated document step for page review, reordering, removal, and export.
- Client-side export to PDF, JPG, or PNG with format cards, selected-format summary, disabled export states, and visible export errors.
- User-facing recovery messages for failed edge detection, crop processing, image filtering, invalid uploads, and export failures.
- Server endpoints for health checks, PDF generation, and stub document metadata creation.
- **Tools page** as the new home (`/`) providing a categorized selection of tools:
  - **PDF Tools**: Includes Combine, Split, and Compress (server-side utilities).
  - **Image Tools**: Includes the main DocScanner interface (`/scanner`), Resize Image (Canvas API), and Compress Image (Canvas API with live previews).
  - **Video Tools**: Includes Download Video (with live CLI progress parsing and selective playlist queues), Compress Video (large-file compression with speed presets), Transcribe Video (local Whisper speech-to-text, denoising, progress/ETA, and local subtitle translation), and Video to Audio (upload/URL conversion with persistent background jobs and retained downloads).


## Performance & Optimizations

- **High-Performance Drag-and-Drop**: The Combine tool leverages native HTML5 DOM drag-and-drop (bypassing heavy React animation libraries) to support reordering massive page grids with zero UI lag.
- **Asynchronous Thumbnail Generation**: PDFs are parsed client-side using `pdfjs-dist` to generate visual thumbnails asynchronously, preventing browser freezing on large documents.
- **Large File Support (500MB)**: The configured Multer limit defaults to 500 MB. PDF/image routes use memory storage; video upload routes use disk-backed temporary storage so large videos are not buffered entirely in Node.js memory.
- **Memory-Safe Compression**: The compression engine chunks CPU operations (`objectsPerTick: 100`) to prevent Node.js Out-of-Memory (OOM) crashes on 100MB+ PDFs.
- **Zero-Footprint Split Streaming**: The Split tool uses Node.js Streams to pipe split PDF pages instantly into the `archiver` ZIP stream (`archive.pipe(res)`), resulting in near-zero server memory overhead.
- **UX Progress Tracking**: The Compress tool utilizes `XMLHttpRequest` to provide real-time, byte-level upload progress tracking alongside simulated multi-phase processing animations for long-running server tasks.
- **Non-Blocking AI Worker**: Transcription and translation both run their synchronous ONNX inference inside a single long-lived Node **worker thread** (`mediaWorker.js`), so the HTTP event loop stays fully responsive during long jobs — health checks, progress polls, and every other tool keep working. One persistent worker (rather than one spawned/terminated per job) is required because spawning a fresh onnxruntime worker after terminating one that already ran inference deadlocks `onnxruntime-node`; keeping it warm also avoids re-loading models between jobs. Cancellation is cooperative (the worker stops at the next window/batch), so a cancelled job never resurrects or leaks output.
- **Real Progress + ETA**: The worker transcribes the audio in overlapping 30s windows and reports genuine progress after every window ("window N of M"), plus real ffmpeg audio-extraction and model-download progress and a self-calibrating **ETA** — no fake/animated bars that stall at 95%. Windowing also bounds memory and enables an anti-repetition guard (`no_repeat_ngram_size` + a post-filter) that breaks Whisper's repetition-hallucination loops.
- **Fast Local Translation**: Subtitle translation uses a local `m2m100_418M` model with greedy decoding (`num_beams: 1`), which is ~10× faster than the model's default beam search while staying accurate for subtitles — translating cue-by-cue so the original timings are preserved.
- **Neural Vocal Separation (Demucs)**: The "Deep" denoise option runs Meta's `htdemucs` model to separate vocals from music and background noise before transcription. Unlike simple EQ filters, Demucs uses deep learning to cleanly isolate speech from complex audio mixes. Runs as a subprocess calling a Python helper (`server/src/scripts/demucs_separate.py`), with results piped through ffmpeg for Whisper-compatible 16kHz mono output. Falls back to ffmpeg denoise if Demucs is unavailable.
- **Resumable Background Jobs**: Video download, compress, and transcribe run as server-side jobs persisted to disk (`docscanner_video_jobs.json`) and keyed by a `jobId` stored in the browser's `localStorage`. Work continues even if the tab/window is closed or the page is refreshed, and the UI re-attaches to the same in-progress or completed job on return. Interrupted jobs are marked as errored on server restart, and temporary files are auto-cleaned after 24 hours.

## Development

Install dependencies:

```bash
git clone https://github.com/xteradmin/docscanner.git
cd docscanner
npm install
cd client && npm install
cd ../server && npm install
cd ..
```

### System Prerequisites for Video Tools

The backend video download utility utilizes `yt-dlp` under the hood, which may fallback to Python if a standalone binary isn't perfectly supported on the host OS. (Note: **FFmpeg** is bundled automatically via the `ffmpeg-static` npm package, so you do *not* need to install it manually!)

**Windows Laptops:**
1. **Python3**: Download from [python.org](https://www.python.org/downloads/) or the Microsoft Store.

**macOS / Linux:**
- macOS: `brew install python3`
- Ubuntu/Debian: `sudo apt-get install -y python3`

*(Note: If you run the app via Docker, Python is automatically installed inside the container without any manual setup needed.)*

**Video Transcription (local Whisper):**

The Transcribe Video tool runs speech-to-text (and translation) locally via `@xenova/transformers` (ONNX) — no API key required. Notes:

- On the **first** transcription the Whisper model (~40MB for `tiny`, ~80MB for `base`) is downloaded from Hugging Face and cached under the OS temp directory, so an internet connection is required on first run. Subsequent runs are offline. In Docker, models persist at the `TRANSFORMERS_CACHE` path (default `/data/docscanner/cache`) across container restarts.
- The **first** translation downloads the `m2m100_418M` model (~630MB) once, then it is cached and reused. CPU translation uses greedy decoding at roughly ~2s per subtitle line.
- Native inference is provided by `onnxruntime-node`, which ships prebuilt binaries for Windows/macOS/Linux (glibc). The Docker image uses `node:20-slim` (glibc) — Alpine-based images are not compatible. On ARM servers, set `ORT_NUM_THREADS=2` to reduce CPU contention on small instances.
- **Docker note:** The Dockerfile uses `node:20-slim` with `python3`, `ffmpeg`, `torch`, `demucs`, and glibc runtime libs installed. Demucs provides optional deep-learning vocal separation for the transcription tool. No manual system setup is needed inside the container.

Run the app from the repository root:

```bash
npm run dev
```

- Client: `http://localhost:5173`
- Server: `http://localhost:3000`

You can still run each side separately:

```bash
cd client && npm run dev
cd server && npm run dev
```

## Docker

```bash
docker compose up --build
```

The Docker image builds the Vite client, installs the Express server runtime dependencies, and serves the built frontend from the Node container on port `3000`. The base image is `node:20-slim` (Debian/glibc) which is required for `onnxruntime-node` ARM inference.

### ARM server tuning

On small ARM instances (e.g. 4-core A1), lower the ONNX thread count to reduce CPU contention:

```dotenv
ORT_NUM_THREADS=2
```

Models are cached at `/data/docscanner/cache` (mounted volume) so repeated transcriptions/translations skip the download after the first run.

## Module Map

### Client modules

- `camera/`: camera capture and image upload entry points.
- `detection/`: document corner detection from an input image.
- `perspective/`: four-point warp and crop output.
- `filters/`: image enhancement and manual filter operations.
- `export/`: client-side PDF and image export UI.
- `tools/`: Tools UI for PDF (`CombineTool`, `SplitTool`, `CompressTool`), image (`ImageResizeTool`, `ImageCompressTool`), and video (`VideoDownloadTool`, `VideoCompressTool`, `VideoTranscribeTool`, `VideoAudioTool`) processing.
- `auth/`: auth context scaffold for future login flows.
- `pages/`: legacy standalone page manager component; the current document flow is handled in `ScannerPage.jsx`.

### Pages

- `ScannerPage.jsx`: main scanner workflow at `/scanner`.
- `ToolsPage.jsx`: categorized tools selection and active tool workspace at `/`.

### Server modules

- `api/`: mounted Express routes for health, PDF/document operations, video download/compression, transcription/translation, and `/api/video/audio/url` plus `/api/video/audio/upload`. Shared video job status, result, and deletion routes use `/api/video/job/:jobId` and `/api/video/result/:jobId`. Temporary download/compression/transcription files are cleaned after 24 hours; audio-conversion results remain in persistent storage until explicitly removed. `mediaWorker.js` runs local Whisper and `m2m100` inference off the main event loop.
- `auth/`: planned server auth module, not currently implemented as runtime routes.
- `pdf/`: planned extracted PDF service; current PDF logic lives in `server/src/modules/api/index.js`.
- `storage/`: planned extracted storage service; current document route only creates a directory and returns metadata.

## Current Status Notes

- The client export UI currently uses `jsPDF` and Canvas in-browser.
- The server PDF endpoint exists and accepts JPEG or PNG uploads, but the current export UI does not call it yet.
- In-progress documents are kept in React state for the current browser session only; there is no IndexedDB draft persistence or account-backed document history yet.
- `AuthProvider.jsx` expects `/api/auth/*` endpoints, but those routes are not mounted in the current server.
- `better-sqlite3`, `bcryptjs`, and `jsonwebtoken` are installed as scaffolding for later persistence/auth work.

## License

MIT
