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
2. **Compress Video**: Reduce video file size by adjusting resolution and bitrate (requires `fluent-ffmpeg`). Supports uploads up to the configured limit (500 MB by default) and tracks compression frame-rate progress.
3. **Video to Audio**: Upload a video or provide a supported video URL and extract MP3, M4A, or WAV audio. Conversion runs as a persistent server job, reconnects after the tab or window is reopened, and keeps completed audio until the user removes or replaces the source.

Video-to-audio jobs reject private-network URLs, cap uploads and URL downloads at 500 MB, time out stalled subprocesses, and limit concurrent conversions (default: 2). Configure `AUDIO_JOB_TIMEOUT_MS` and `MAX_ACTIVE_AUDIO_JOBS` when needed.

See [`docs/VIDEO_TO_AUDIO.md`](docs/VIDEO_TO_AUDIO.md) for lifecycle guarantees, API contracts, storage layout, limits, and recovery behavior.

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
  - **Video Tools**: Includes Download Video (with live CLI progress parsing and selective playlist queues), Compress Video (large-file compression with speed presets), and Video to Audio (upload/URL conversion with persistent background jobs and retained downloads).


## Performance & Optimizations

- **High-Performance Drag-and-Drop**: The Combine tool leverages native HTML5 DOM drag-and-drop (bypassing heavy React animation libraries) to support reordering massive page grids with zero UI lag.
- **Asynchronous Thumbnail Generation**: PDFs are parsed client-side using `pdfjs-dist` to generate visual thumbnails asynchronously, preventing browser freezing on large documents.
- **Large File Support (500MB)**: The configured Multer limit defaults to 500 MB. PDF/image routes use memory storage; video upload routes use disk-backed temporary storage so large videos are not buffered entirely in Node.js memory.
- **Memory-Safe Compression**: The compression engine chunks CPU operations (`objectsPerTick: 100`) to prevent Node.js Out-of-Memory (OOM) crashes on 100MB+ PDFs.
- **Zero-Footprint Split Streaming**: The Split tool uses Node.js Streams to pipe split PDF pages instantly into the `archiver` ZIP stream (`archive.pipe(res)`), resulting in near-zero server memory overhead.
- **UX Progress Tracking**: The Compress tool utilizes `XMLHttpRequest` to provide real-time, byte-level upload progress tracking alongside simulated multi-phase processing animations for long-running server tasks.

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
- `tools/`: PDF, image, and video utility UIs, including persistent upload/URL video-to-audio conversion.
- `auth/`: auth context scaffold for future login flows.
- `pages/`: legacy standalone page manager component; the current document flow is handled in `ScannerPage.jsx`.

### Pages

- `ScannerPage.jsx`: main scanner workflow at `/scanner`.
- `ToolsPage.jsx`: categorized tools selection and active tool workspace at `/`.

### Server modules

- `api/`: mounted Express routes for `/api/health`, PDF/document operations, video download/compression, and `/api/video/audio/url` plus `/api/video/audio/upload`. Video/audio job status and downloads use `/api/video/job/:jobId` and `/api/video/result/:jobId`. Ordinary temporary video files are cleaned after 24 hours; audio-conversion results are retained in the persistent upload volume until explicitly removed.
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
