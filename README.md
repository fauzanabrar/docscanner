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
2. **Compress Video**: Reduce video file size by adjusting resolution and bitrate (requires `fluent-ffmpeg`). Supports uploading large files with no limit and tracking compression frame rate progress.
3. **Transcribe Video**: Upload a video (or audio) file and generate downloadable subtitles as a `.srt` file. Speech-to-text runs entirely on the server using a local Whisper model (`@xenova/transformers`) — no API key and no data leaves the machine. Choose the spoken language (or auto-detect) and model quality (fast `tiny` vs. more accurate `base`). An optional **"reduce background music/noise"** toggle applies an ffmpeg speech-isolation filter to pull dialogue out of noisy/musical audio. Progress is **real** at every stage (audio extraction, model download, and per-window transcription) with a live **ETA**. After transcribing, the subtitles can be **translated into many languages** (local `m2m100` model) and downloaded as a separate `.srt`. Both transcription and translation run as background jobs: closing the tab/window does not stop them, and reopening the tool resumes the same progress or completed result via localStorage + server-side job persistence.

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
  - **Video Tools**: Includes Download Video (with live CLI progress parsing, selective playlist video queues, and automated browser-level download triggers), Compress Video (supporting large file storage and conversion with custom speed presets), and Transcribe Video (local Whisper speech-to-text with optional audio denoising, real progress + ETA, and local `m2m100` subtitle translation — producing downloadable `.srt` files as resumable background jobs).


## Performance & Optimizations

- **High-Performance Drag-and-Drop**: The Combine tool leverages native HTML5 DOM drag-and-drop (bypassing heavy React animation libraries) to support reordering massive page grids with zero UI lag.
- **Asynchronous Thumbnail Generation**: PDFs are parsed client-side using `pdfjs-dist` to generate visual thumbnails asynchronously, preventing browser freezing on large documents.
- **Large File Support (500MB)**: The server safely accepts payloads up to 500MB across all tools via `multer` memory storage.
- **Memory-Safe Compression**: The compression engine chunks CPU operations (`objectsPerTick: 100`) to prevent Node.js Out-of-Memory (OOM) crashes on 100MB+ PDFs.
- **Zero-Footprint Split Streaming**: The Split tool uses Node.js Streams to pipe split PDF pages instantly into the `archiver` ZIP stream (`archive.pipe(res)`), resulting in near-zero server memory overhead.
- **UX Progress Tracking**: The Compress tool utilizes `XMLHttpRequest` to provide real-time, byte-level upload progress tracking alongside simulated multi-phase processing animations for long-running server tasks.
- **Non-Blocking AI Worker**: Transcription and translation both run their synchronous ONNX inference inside a single long-lived Node **worker thread** (`mediaWorker.js`), so the HTTP event loop stays fully responsive during long jobs — health checks, progress polls, and every other tool keep working. One persistent worker (rather than one spawned/terminated per job) is required because spawning a fresh onnxruntime worker after terminating one that already ran inference deadlocks `onnxruntime-node`; keeping it warm also avoids re-loading models between jobs. Cancellation is cooperative (the worker stops at the next window/batch), so a cancelled job never resurrects or leaks output.
- **Real Progress + ETA**: The worker transcribes the audio in overlapping 30s windows and reports genuine progress after every window ("window N of M"), plus real ffmpeg audio-extraction and model-download progress and a self-calibrating **ETA** — no fake/animated bars that stall at 95%. Windowing also bounds memory and enables an anti-repetition guard (`no_repeat_ngram_size` + a post-filter) that breaks Whisper's repetition-hallucination loops.
- **Fast Local Translation**: Subtitle translation uses a local `m2m100_418M` model with greedy decoding (`num_beams: 1`), which is ~10× faster than the model's default beam search while staying accurate for subtitles — translating cue-by-cue so the original timings are preserved.
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

- On the **first** transcription the Whisper model (~40MB for `tiny`, ~80MB for `base`) is downloaded from Hugging Face and cached under the OS temp directory, so an internet connection is required on first run. Subsequent runs are offline.
- The **first** translation downloads the `m2m100_418M` model (~630MB) once, then it is cached and reused. CPU translation uses greedy decoding at roughly ~2s per subtitle line.
- Native inference is provided by `onnxruntime-node`, which ships prebuilt binaries for Windows/macOS/Linux (glibc). Under **pnpm**, the build scripts for `onnxruntime-node`, `ffmpeg-static`, and `youtube-dl-exec` are allowlisted in `server/pnpm-workspace.yaml` (`onlyBuiltDependencies`) so their binaries install correctly.
- **Docker note:** `onnxruntime-node` needs a glibc runtime. The default `node:20-alpine` image (musl) does not ship a compatible build, so for transcription in Docker use a glibc base such as `node:20-slim` (install `python3` and `ffmpeg`'s runtime deps via `apt-get` instead of `apk`).

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

The Docker image builds the Vite client, installs the Express server runtime dependencies, and serves the built frontend from the Node container on port `3000`.

## Module Map

### Client modules

- `camera/`: camera capture and image upload entry points.
- `detection/`: document corner detection from an input image.
- `perspective/`: four-point warp and crop output.
- `filters/`: image enhancement and manual filter operations.
- `export/`: client-side PDF and image export UI.
- `tools/`: Tools UI (all server-side or Canvas-based processing) — PDF: `CombineTool`, `SplitTool`, `CompressTool`; Image: `ImageResizeTool`, `ImageCompressTool`; Video: `VideoDownloadTool`, `VideoCompressTool`, `VideoTranscribeTool`.
- `auth/`: auth context scaffold for future login flows.
- `pages/`: legacy standalone page manager component; the current document flow is handled in `ScannerPage.jsx`.

### Pages

- `ScannerPage.jsx`: main scanner workflow at `/scanner`.
- `ToolsPage.jsx`: categorized tools selection and active tool workspace at `/`.

### Server modules

- `api/`: mounted Express routes for `/api/health`, `/api/pdf/generate`, `/api/pdf/merge`, `/api/pdf/split`, `/api/pdf/compress`, `/api/documents`, `/api/video/info`, `/api/video/download`, `/api/video/size`, `/api/video/sizes`, `/api/video/compress`, `/api/video/transcribe`, `/api/video/translate`, `/api/video/job/:jobId`, `/api/video/result/:jobId`, and `DELETE /api/video/job/:jobId`. Includes automatic temp file cleanup (files older than 24 hours are removed hourly). `mediaWorker.js` is the single long-lived worker-thread entry that runs local Whisper speech-to-text and `m2m100` translation (`@xenova/transformers`) off the main event loop.
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
