# API Module

## Purpose

Holds the currently mounted Express API routes for the app.

## Implemented routes

- `GET /api/health`
  Returns `{ status, timestamp }` for liveness checks.

- `POST /api/pdf/generate`
  Accepts up to 20 uploaded images through Multer memory storage, embeds JPEG or PNG images into a `pdf-lib` document, and returns the generated PDF as a download.

- `POST /api/pdf/merge`
  Accepts 2+ PDF files via multipart upload (`files` field). Uses `pdf-lib` `copyPages()` to merge all pages from each source PDF into a single output document. Returns the merged PDF as a download.

- `POST /api/pdf/split`
  Accepts a single PDF file (`file` field) and a `ranges` parameter. Supported range formats:
  - `all` — returns the entire PDF unchanged.
  - `each` or `every` — splits every page into its own PDF, packaged into a ZIP via `archiver`.
  - `1-3,5,7-9` — custom page groups; each comma-separated group becomes a separate PDF in a ZIP. Single group returns a direct PDF download.

- `POST /api/pdf/compress`
  Accepts a single PDF file (`file` field). Runs a two-pass structural optimization: repacks objects using `useObjectStreams` and batched object writing to eliminate redundancy. Returns the compressed PDF with `X-Original-Size`, `X-Compressed-Size`, and `X-Reduction-Percent` response headers.

- `POST /api/video/info`
  Accepts `{ url }`. Returns yt-dlp metadata for a single video, or a flat listing for a playlist URL.

- `POST /api/video/size` and `POST /api/video/sizes`
  Estimate the approximate download size for a single URL, or a batch of URLs, for the chosen `downloadFormat`.

- `POST /api/video/download`
  Accepts `{ url, downloadFormat, jobId }`. Starts a background yt-dlp download (video, or `mp3`/`webm` variants), parsing live progress (percent, total size, speed, ETA) into the job store. Responds immediately with `{ jobId }`.

- `POST /api/video/compress`
  Accepts a video upload (`file`) plus `jobId`, `quality`, `speed`, `outFormat`, `removeAudio`, and optional `duration`. Re-encodes via `fluent-ffmpeg` in the background, reporting timemark/percent progress. Responds immediately with `{ jobId }`.

- `POST /api/video/transcribe`
  Accepts a single video/audio file (`file` field) plus `jobId`, `model` (`tiny` | `base`), `language` (`auto` or an ISO code), and `denoiseMethod` (`none` | `ffmpeg` | `demucs`). The `ffmpeg` mode applies a speech-isolation EQ filter; the `demucs` mode runs Meta's `htdemucs` neural source separation to isolate vocals from music/noise before transcription (much higher quality but significantly slower — falls back to ffmpeg if Demucs is unavailable). Responds immediately with `{ jobId }` and processes in the background: optionally separates vocals (Demucs), extracts 16kHz mono PCM audio with the bundled `ffmpeg-static` (reporting real ffmpeg progress), then runs a local Whisper model via `@xenova/transformers` **inside the shared `mediaWorker.js` worker thread** so the synchronous ONNX inference never blocks the HTTP event loop, and builds a SubRip (`.srt`) document. The worker transcribes in overlapping 30s windows and reports **real progress** ("window N of M") + a live **ETA** after each window; a `no_repeat_ngram_size`/`max_new_tokens` setting plus a post-filter guard against Whisper repetition hallucinations. When a specific language is chosen, `language`/`task` are pinned per window (fresh opts each call — transformers.js mutates the opts with `forced_decoder_ids`); for `auto` they are omitted (passing `task` during auto-detect returns empty text).

- `POST /api/video/translate`
  JSON body: `jobId` (a new id for the translation job), `srtText` (the source subtitles), `srcLang`, `tgtLang` (ISO codes), and `baseName`. Responds immediately with `{ jobId }` and translates the parsed cues **line-by-line** (preserving timings) with a local `m2m100_418M` model in the same worker (greedy decoding for speed), then writes `<baseName>.<tgtLang>.srt`. Reports real per-cue progress + ETA.

- `GET /api/video/job/:jobId`
  Returns the current job record (`status`, `phase`, `percent`, `stage`, `etaSeconds`, `durationSeconds`, and — when done — `srtText`, `transcript`/`targetLang`, `filename`). Used for background-job polling; jobs survive page/tab close and server restart via `docscanner_video_jobs.json`.

- `GET /api/video/result/:jobId`
  Streams the finished result file (the generated `.srt`) as an attachment download.

- `DELETE /api/video/job/:jobId`
  Cooperatively cancels any in-flight transcription/translation for the job (the shared worker stops at the next window/batch boundary — no resurrection, no leaked output) and removes the job and its result file.

- `POST /api/documents`
  Creates a document id, ensures an upload directory exists, and returns document metadata.

- `POST /api/video/audio/url`
  Starts a background audio extraction job for a supported public HTTP(S) video URL. Local/private-network destinations are rejected.

- `POST /api/video/audio/upload`
  Accepts an uploaded video through disk-backed Multer storage and starts background FFmpeg audio extraction.

- `GET /api/video/job/:jobId`, `GET /api/video/result/:jobId`, `DELETE /api/video/job/:jobId`
  Reconnect to a job, download its completed result, or cancel/remove it. Audio-conversion results live under the persistent upload volume and are retained until deletion; changing the source in the client invokes the delete route.

Audio jobs use atomic serialized registry writes, a configurable source limit (500 MB by default), bounded retries, subprocess timeouts, safe managed-path deletion, and a configurable concurrency limit (`MAX_ACTIVE_AUDIO_JOBS`, default 2). Completed results survive server restarts; processing jobs become errors after a restart because operating-system subprocesses cannot resume.

- `GET /api/documents`
  Returns an empty `documents` array placeholder.

## Dependencies

- `youtube-dl-exec` and bundled FFmpeg — URL retrieval and audio extraction.

- `pdf-lib` — PDF creation, merging, splitting, and structural compression.
- `archiver` — ZIP packaging for multi-file split output (imported via `createRequire` for ESM compatibility).
- `multer` — multipart handling with memory storage for PDF/image routes and disk storage for video routes. `MAX_UPLOAD_SIZE` defaults to 500 MB.
- `fluent-ffmpeg` + `ffmpeg-static` — audio extraction (and video compression); bundled ffmpeg binary, no manual install.
- `@xenova/transformers` — local Whisper speech-to-text and `m2m100` translation (ONNX via `onnxruntime-node`), both run in the shared `mediaWorker.js` worker thread; models download and cache on first use.

## Background jobs & cleanup

- Video download, compress, transcribe/translate, and video-to-audio conversion run as background jobs tracked in memory and persisted to `<UPLOAD_DIR>/video-jobs/jobs.json`. Jobs are keyed by a client-supplied `jobId`, so they survive page/tab closure and are re-attached by polling `GET /api/video/job/:jobId`.
- On server restart, any job still marked `processing` is flipped to `error` (interrupted), and `done` jobs whose result file is missing are dropped.
- A cleanup task runs hourly, removing ordinary prefixed temp files (`video_`, `compressed_`, `input_`, `batch_urls_`, `transcript_`) older than 24 hours and purging stale jobs. Video-to-audio outputs are retained in persistent storage until explicitly deleted.

## Current status

- This router is the real server implementation today.
- There is no mounted `/api/auth/*` router yet.
- There is no `/api/upload/image` endpoint in the current server.
- Detailed video-to-audio operations documentation is in [`docs/VIDEO_TO_AUDIO.md`](../../../../docs/VIDEO_TO_AUDIO.md).
