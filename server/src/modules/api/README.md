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

- `POST /api/documents`
  Creates a document id, ensures an upload directory exists, and returns document metadata.

- `POST /api/video/audio/url`
  Starts a background audio extraction job for a supported public HTTP(S) video URL. Local/private-network destinations are rejected.

- `POST /api/video/audio/upload`
  Accepts an uploaded video and starts background FFmpeg audio extraction.

- `GET /api/video/job/:jobId`, `GET /api/video/result/:jobId`, `DELETE /api/video/job/:jobId`
  Reconnect to a job, download its completed result, or cancel/remove it. Audio-conversion results live under the persistent upload volume and are retained until deletion; changing the source in the client invokes the delete route.

Audio jobs use atomic registry writes, a 500 MB source limit, bounded retries, subprocess timeouts, and a configurable concurrency limit (`MAX_ACTIVE_AUDIO_JOBS`, default 2).

- `GET /api/documents`
  Returns an empty `documents` array placeholder.

## Dependencies

- `youtube-dl-exec` and bundled FFmpeg â€” URL retrieval and audio extraction.

- `pdf-lib` — PDF creation, merging, splitting, and structural compression.
- `archiver` — ZIP packaging for multi-file split output (imported via `createRequire` for ESM compatibility).
- `multer` — multipart file upload handling with memory storage (50MB limit).

## Current status

- This router is the real server implementation today.
- There is no mounted `/api/auth/*` router yet.
- There is no `/api/upload/image` endpoint in the current server.
