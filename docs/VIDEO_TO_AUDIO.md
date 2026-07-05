# Video-to-Audio Conversion

## Overview

The Video to Audio tool converts either an uploaded video or a supported public video URL into MP3, M4A, or WAV audio. Conversion runs as a server-side background job after the source has reached the server.

The client stores active job metadata in `localStorage`. Reopening or refreshing the page reconnects to the same job through the job-status API.

## User flow

1. Open **Video Tools → Video to Audio**.
2. Select **Video URL** or **Upload video**.
3. Choose MP3, M4A, or WAV. MP3 and M4A support 128, 192, or 320 kbps.
4. Start the conversion.
5. Wait for the upload to reach 100% when using a local file.
6. Close or refresh the tab if needed. The server continues processing after it accepts the job.
7. Return to the tool to reconnect and download the result.
8. Select **Remove result**, replace the upload, or change the URL to delete the previous server job and output.

## Lifecycle guarantees

### Browser tab or window closes

- URL jobs continue after the server returns `202 Accepted`.
- Upload jobs continue after the upload reaches 100% and the server returns `202 Accepted`.
- Closing the browser during an incomplete upload can abort that upload, so no conversion job is guaranteed to exist yet.
- The client reconnects with the job ID stored under `docscanner.videoAudioJob` in `localStorage`.

### Server restarts

- Completed jobs and their output files are restored from persistent storage.
- A process that was actively converting cannot continue through a server restart. On startup, that job is changed to `error` instead of remaining permanently stuck in `processing`.
- Invalid registry JSON is quarantined as `jobs.json.corrupt-<timestamp>` and the server starts with an empty registry.

## Storage

When `UPLOAD_DIR=/data/docscanner/uploads`, audio jobs use:

```text
/data/docscanner/uploads/video-jobs/
├── jobs.json
└── audio/
    └── audio_<jobId>.<format>
```

- `jobs.json` is written through a serialized, atomic temporary-file replacement.
- Uploaded source videos use the operating-system temporary directory while processing and are removed after success, failure, or cancellation.
- Completed audio outputs are not part of the normal 24-hour temporary-video cleanup.
- Audio remains available until the user explicitly removes or replaces the source. Administrators must account for the resulting persistent disk usage.

## API

### Start from a URL

`POST /api/video/audio/url`

```json
{
  "url": "https://example.com/video",
  "jobId": "client-generated-uuid",
  "format": "mp3",
  "bitrate": "192k"
}
```

The URL must use HTTP or HTTPS, resolve to a public address, and contain no embedded username or password. Localhost, private-network, link-local, multicast, and reserved addresses are rejected.

### Start from an upload

`POST /api/video/audio/upload` using `multipart/form-data`:

| Field | Required | Values |
|---|---:|---|
| `file` | Yes | A supported video file |
| `jobId` | Yes | 8–128 letters, numbers, `_`, or `-` |
| `format` | No | `mp3`, `m4a`, `wav`; default `mp3` |
| `bitrate` | No | `128k`, `192k`, `320k`; default `192k` |

Both start endpoints return `202 Accepted`:

```json
{
  "message": "Audio conversion started.",
  "jobId": "client-generated-uuid"
}
```

### Read status

`GET /api/video/job/:jobId`

| Field | Description |
|---|---|
| `status` | `processing`, `done`, or `error` |
| `progress` | Integer-compatible percentage from 0 to 100 |
| `detail` | Current user-facing phase description |
| `sourceType` | `url` or `upload` |
| `sourceLabel` | Hostname or uploaded filename |
| `filename` | Download filename when complete |
| `error` | Sanitized user-facing failure text |

Internal filesystem paths are removed from API responses.

### Download result

`GET /api/video/result/:jobId`

The endpoint returns the audio file only when the job is complete. A missing result returns `410 Gone`.

### Cancel or remove

`DELETE /api/video/job/:jobId`

Deletion is idempotent. For active jobs it terminates the subprocess, removes temporary and output files, deletes the registry entry, and persists that deletion before returning success.

## YouTube / URL Cookie Authentication

URL conversions share the global `cookies.txt` credential file with Download Video and Transcribe Video.

- **File location (host):** `docscanner/cookies.txt` (project root)
- **Mount path (container):** `/data/docscanner/cookies.txt`
- **Env variable:** `YOUTUBE_COOKIES=/data/docscanner/cookies.txt`
- **Format:** Netscape cookie file (exported via a browser extension such as *Get cookies.txt LOCALLY*)
- **Live reload:** The bind mount means updating `cookies.txt` on the host takes effect on the **next** `yt-dlp` call — no container restart needed.
- **Expiry:** YouTube session cookies expire periodically. Replace the file with a fresh export when bot-detection errors reappear.

## Limits and safeguards

- Default source limit: 500 MB through `MAX_UPLOAD_SIZE`.
- Default concurrent audio jobs: 2 through `MAX_ACTIVE_AUDIO_JOBS`.
- Default subprocess timeout: 7,200,000 ms (2 hours) through `AUDIO_JOB_TIMEOUT_MS`.
- URL retrieval uses bounded socket, download, fragment, and file-access retries.
- Duplicate job IDs return `409 Conflict`.
- Capacity exhaustion returns `429 Too Many Requests`.
- Invalid sources or options return `400 Bad Request`.
- Registry/storage failures return `503 Service Unavailable`.
- Client requests use timeouts and preserve the saved job when deletion or startup status is uncertain.

Example configuration:

```dotenv
UPLOAD_DIR=/data/docscanner/uploads
MAX_UPLOAD_SIZE=524288000
MAX_ACTIVE_AUDIO_JOBS=2
AUDIO_JOB_TIMEOUT_MS=7200000
```

## Runtime dependencies

- `ffmpeg-static` supplies FFmpeg for uploaded-video extraction and yt-dlp post-processing.
- `youtube-dl-exec` supplies the platform-specific yt-dlp binary for public URL sources.
- `multer` streams video uploads to disk-backed temporary files.

## Implementation map

- Client UI and reconnection: `client/src/modules/tools/VideoAudioTool.jsx`
- Tool registration: `client/src/pages/ToolsPage.jsx`
- API, persistence, validation, and subprocess management: `server/src/modules/api/index.js`
- Environment defaults: `.env.example`

## Verification

The feature has been checked with:

- Production client build.
- Upload-to-MP3 conversion and FFmpeg decode validation.
- Public-URL-to-MP3/M4A conversion and decode validation.
- Completed-job restoration after a server restart.
- Cancellation and artifact-removal races.
- Invalid URL, embedded-credential, private-network, malformed-media, and unsupported-quality cases.
- Registry JSON integrity, persisted deletion, and corrupt-registry quarantine.
