# Tools Module

## Purpose

Provides the PDF, image, and video utility UI. Server-backed tools handle file selection or URL entry, processing configuration, status, and downloads.

## Components

- `CombineTool.jsx`
  Upload 1+ PDF files, extract individual pages into a visual grid, rearrange them via high-performance native drag-and-drop or position dropdowns, and merge into a single PDF download.

- `SplitTool.jsx`
  Upload a single PDF, choose a split mode (custom ranges, every page, or extract specific pages), download result as ZIP or single PDF.

- `CompressTool.jsx`
  Upload a single PDF, compress via structural optimization, display original vs compressed size and percentage reduction.

- `VideoAudioTool.jsx`
  Upload a video or submit a supported video URL, select MP3/M4A/WAV output, reconnect to the background job after reopening the browser, and download or explicitly remove the retained result.

## Implemented behavior

- Combine and Split tools use `fetch()` to POST multipart form data.
- Compress tool uses `XMLHttpRequest` to provide real-time byte-level upload progress tracking and a simulated multi-phase processing animation for large files.
- File inputs accept `application/pdf` only.
- Combine tool parses PDFs locally (using `pdfjs-dist`) to generate visual page thumbnails asynchronously. It supports adding multiple files incrementally and allows reordering at the specific page-level via native drag-and-drop or dropdowns.
- Split tool supports three modes: custom ranges (`1-3,5,7-9`), every page (each page → separate file), and extract specific pages.
- Compress tool reads `X-Original-Size`, `X-Compressed-Size`, and `X-Reduction-Percent` response headers to display stats.
- All tools show loading state during processing and user-facing error messages on failure.
- Download is triggered via a temporary `<a>` element with `download` attribute and `blob:` URL.
- Video-to-audio metadata is validated and stored in `localStorage` so the UI can reconnect after refresh or tab closure.
- An upload must reach 100% before closing the browser; once the server accepts it, conversion continues in the background.
- Changing the source or selecting **Remove result** calls the delete endpoint. Client state is cleared only after the server confirms deletion, preventing orphaned retained files during network failures.
- Malformed stored state, duplicate submissions, concurrent deletion attempts, request timeouts, unsupported files, and files above 500 MB are handled explicitly.

## Server endpoints used

| Tool | Endpoint | Response |
|------|----------|----------|
| Combine | `POST /api/pdf/merge` | Merged PDF |
| Split | `POST /api/pdf/split` | PDF or ZIP |
| Compress | `POST /api/pdf/compress` | Compressed PDF + headers |
| Video to audio (URL) | `POST /api/video/audio/url` | Background job id |
| Video to audio (upload) | `POST /api/video/audio/upload` | Background job id |
| Video/audio job status | `GET /api/video/job/:jobId` | Persistent job state |
| Video/audio result | `GET /api/video/result/:jobId` | Completed audio file |
| Remove video/audio job | `DELETE /api/video/job/:jobId` | Cancellation/deletion confirmation |

## Current status

- PDF combine/split/compress and video-to-audio conversion are fully functional.
- Compression is structural only (object stream optimization); image recompression is not yet implemented.
- Full video-to-audio lifecycle and API documentation is in [`docs/VIDEO_TO_AUDIO.md`](../../../../docs/VIDEO_TO_AUDIO.md).
