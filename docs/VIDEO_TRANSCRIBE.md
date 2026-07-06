# Video Transcription

## Overview

The Transcribe Video tool converts speech in a video or audio file into a downloadable `.srt` subtitle file. Transcription is performed entirely on the server using a local [Whisper](https://github.com/xenova/transformers.js) model — no external API key is required and no audio ever leaves the machine.

**Source input options:**

| Mode | Description |
|---|---|
| **Upload file** | Drag-and-drop or file-picker. Supported: MP4, MKV, AVI, MOV, WEBM, MP3, WAV, M4A, OGG, FLAC, etc. |
| **Video URL** | Paste any URL supported by `yt-dlp` (YouTube, Twitter/X, Vimeo, etc.). The server downloads the source before processing. |

---

## User Flow

1. Open **Video Tools → Transcribe Video**.
2. Choose **Upload File** or **Video URL**.
3. If uploading, select a file (drag-and-drop or picker).  
   If using a URL, paste the video link.
4. Select **Language** (or leave on *Auto-detect*).
5. Select **Model**: `tiny` (fast) or `base` (more accurate).
6. Select **Denoise Mode**: `None`, `Light` (ffmpeg EQ), or `Deep` (Meta Demucs neural separation).
7. Click **Transcribe**.
8. Watch real-time progress — stage, percentage, ETA, and current window.
9. When done, review or copy the subtitle text in the **Transcription** tab.
10. Optionally switch to the **Translate** tab to produce a translated `.srt` in another language.
11. Download the `.srt` from either tab.

---

## Processing Pipeline

### Upload path

```
Browser → POST /api/transcribe (multipart) → audio extraction (ffmpeg) → [denoise] → Whisper inference → .srt
```

### URL path

```
Browser → POST /api/transcribe/url (JSON: { url }) → yt-dlp download → audio extraction (ffmpeg) → [denoise] → Whisper inference → .srt
```

Both paths create the same server-side job structure and use the same polling endpoint.

---

## Denoise Modes

| Mode | Method | Speed | Best for |
|---|---|---|---|
| **None** | No pre-processing | Fastest | Clean recordings |
| **Light** | ffmpeg speech-isolation EQ filter | Fast | Light background hum |
| **Deep** | Meta `htdemucs` neural source separation | Slow | Music, crowd noise |

Demucs runs as a Python subprocess (`server/src/scripts/demucs_separate.py`) and requires the `demucs` Python package to be available. If Demucs is unavailable at runtime, the job automatically falls back to the Light (ffmpeg) mode.

---

## Background Jobs & Persistence

- Jobs run in a dedicated **Node.js worker thread** (`mediaWorker.js`), keeping the HTTP event loop fully responsive.
- Closing or refreshing the browser tab does **not** stop the job — the server continues processing.
- The `jobId` is persisted to `localStorage` under `docscanner.transcribeJob`.
- On page load the client polls for the saved `jobId` and re-attaches to any in-progress or completed job.
- Cancellation is cooperative: the worker stops at the next windowing boundary.
- On server restart, any job that was actively `processing` is marked `error` to prevent a permanently stuck state.

---

## Progress Reporting

Progress events (polled every 1.5 s via `GET /api/transcribe/status/:jobId`) report:

| Field | Description |
|---|---|
| `phase` | `downloading` → `extracting` → `denoising` → `loading` → `transcribing` → `done` |
| `progress` | 0–100 integer |
| `eta` | Human-readable estimated time remaining |
| `currentWindow` | `"Window N of M"` during transcription |
| `status` | `processing` / `done` / `error` / `cancelled` |

---

## YouTube / URL Cookie Authentication

URL-based transcription shares the global `cookies.txt` credential file with Download Video and Video to Audio.

- **Primary setup:** Open **Video Tools → Transcribe Video**, select **Video URL**, then use **YouTube Cookies** to paste a Netscape-format export. Saving takes effect on the next `yt-dlp` invocation without restarting the server.
- **Storage:** In Docker the app-managed file is `/data/docscanner/cookies.txt` in the persistent `docscanner-data` volume. In local development, when `YOUTUBE_COOKIES` is unset, it defaults to `<UPLOAD_DIR>/video-jobs/cookies.txt` (or the equivalent OS temporary directory).
- **Env variable:** `YOUTUBE_COOKIES=/data/docscanner/cookies.txt`
- **Format:** Netscape cookie file (exported via browser extension, e.g. *Get cookies.txt LOCALLY*)
- **Expiry:** YouTube session cookies expire over time. When bot-detection errors reappear, open the dialog and save a fresh export.
- **Security:** Cookies are plaintext, global to the instance, and accepted by unauthenticated endpoints. This workflow is intended for self-hosted, single-tenant deployments; use a secondary account and do not expose it as a multi-tenant service without authentication and per-user isolation.

---

## API Reference

### Start transcription from a file upload

```
POST /api/transcribe
Content-Type: multipart/form-data

Fields:
  video      – file (required)
  language   – string, e.g. "en" (optional, default: auto)
  model      – "tiny" | "base" (optional, default: "tiny")
  denoise    – "none" | "light" | "deep" (optional, default: "none")

Response 200:
  { jobId: string }
```

### Start transcription from a URL

```
POST /api/transcribe/url
Content-Type: application/json

Body:
  { url: string, language?: string, model?: string, denoise?: string }

Response 200:
  { jobId: string }
```

### Poll job status

```
GET /api/transcribe/status/:jobId

Response 200:
  {
    status: "processing" | "done" | "error" | "cancelled",
    phase: string,
    progress: number,          // 0–100
    eta: string,               // e.g. "~2m 30s remaining"
    currentWindow: string,     // e.g. "Window 4 of 12"
    transcript?: string,       // SRT text (when done)
    error?: string
  }
```

### Download result

```
GET /api/transcribe/download/:jobId

Response: text/plain (.srt file)
```

### Cancel job

```
POST /api/transcribe/cancel/:jobId

Response 200: { ok: true }
```

### Translate subtitles

```
POST /api/transcribe/translate
Content-Type: application/json

Body:
  { jobId: string, targetLang: string }   // targetLang: ISO 639-1 code, e.g. "fr"

Response 200:
  { translateJobId: string }
```

Poll translation status the same way via `GET /api/transcribe/status/:translateJobId`.

---

## Storage

With `UPLOAD_DIR=/data/docscanner/uploads`, transcription jobs use:

```
/data/docscanner/uploads/video-jobs/
├── jobs.json
└── transcripts/
    └── transcript_<jobId>.srt
```

- Source videos downloaded from a URL are stored in the OS temp directory and cleaned up after the job completes or fails.
- Uploaded source files are removed after processing.
- Completed `.srt` transcripts persist until explicitly deleted or the 24-hour cleanup sweep removes the associated job entry.

---

## Limits & Configuration

| Parameter | Default | Notes |
|---|---|---|
| Max upload size | 500 MB | Configured via `MAX_UPLOAD_SIZE` env |
| URL download cap | 500 MB | Enforced by `yt-dlp --max-filesize` |
| Concurrent transcription jobs | 1 (worker thread) | One worker processes jobs sequentially |
| Model: `tiny` | ~75 MB VRAM/RAM | Fast, English-optimised |
| Model: `base` | ~150 MB VRAM/RAM | More accurate, slower |
| Demucs (Deep) | ~700 MB VRAM/RAM | Requires Python + `demucs` package |
