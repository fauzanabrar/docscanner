# Video Compression Engine

## Overview

The Video Compression tool reduces the file size of uploaded videos (MP4 or WebM) by applying resolution scaling and modern compression algorithms. It runs as a background process on the server, tracking compression progress and returning before-and-after size metrics when completed.

The client stores the active compression job ID in `localStorage`, allowing the user to refresh or return to the page and seamlessly reconnect to their compression progress.

## User Flow

1. Open **Video Tools → Compress Video**.
2. Select a video file to upload.
3. Choose the target output resolution:
   - **1080p**: High quality
   - **720p**: Medium-high quality
   - **480p**: Standard quality (Default)
   - **360p**: Compact quality
   - **240p**: Low quality
4. Select the **Encoding Speed** preset:
   - **Fast (Balanced)**: Good compression and high speed (Default)
   - **Ultrafast**: Maximum speed, larger output size
   - **Medium**: High compression efficiency
   - **Slow**: Maximum compression efficiency, smallest output size
5. Choose the output format (**MP4 (H.264)** or **WebM (VP9)**).
6. Optionally check **Remove Audio (Mute)** to strip audio tracks.
7. Start compression, track the upload and transcoding progress, and download the resulting file once completed.

## Architecture and Optimizations

### 1. Resolution-Scaled CRF (Constant Rate Factor)
Instead of forcing a fixed target bitrate, the engine utilizes Constant Rate Factor (CRF) quality targets tailored to each resolution level. This allows the encoder to dynamically allocate the exact bitrate needed to maintain visual fidelity based on the complexity of the video:

| Resolution | MP4 Target CRF (`libx264`) | WebM Target CRF (`libvpx-vp9`) |
|---|---|---|
| **1080p** | `crf 22` | `crf 30` |
| **720p**  | `crf 24` | `crf 33` |
| **480p**  | `crf 26` | `crf 36` |
| **360p**  | `crf 28` | `crf 39` |
| **240p**  | `crf 30` | `crf 42` |

### 2. Bitrate Capping via VBV (Video Buffer Verifier)
To prevent bloated file sizes under less efficient presets (like `Ultrafast`), the engine implements a Video Buffer Verifier (VBV) ceiling:
* A maximum bitrate limit (`-maxrate`) and buffer size (`-bufsize`) are enforced for each profile.
* This caps the peak bitrate, ensuring that the compressed file size does not explode even under high-motion or low-efficiency preset configurations.

| Resolution | Max Bitrate (`-maxrate`) | Buffer Size (`-bufsize`) |
|---|---|---|
| **1080p** | `5000k` (5.0 Mbps) | `10000k` |
| **720p**  | `2500k` (2.5 Mbps) | `5000k` |
| **480p**  | `1200k` (1.2 Mbps) | `2400k` |
| **360p**  | `700k` (0.7 Mbps)   | `1400k` |
| **240p**  | `400k` (0.4 Mbps)   | `800k` |

*Note: WebM (VP9) constant-quality mode is explicitly enabled by passing `-b:v 0` alongside the CRF target.*

### 3. Before/After Size Tracking
* **Initial Size Capturing:** The server captures the uploaded file size (`originalSize = req.file.size`) upon processing the upload request.
* **Result Size Measurement:** When the FFmpeg transcode successfully finishes, the server reads the filesystem metadata of the output file (`compressedSize = stat(outputPath).size`) and saves it in the persistent job record.
* **UI Representation:** The frontend displays an interactive statistics panel showing the human-readable sizes (e.g. `12.5 MB ➔ 2.3 MB`) and calculates the exact data saved (`Saved 81%`).

## Storage Layout

When `UPLOAD_DIR=/data/docscanner/uploads`, video jobs use:

```text
/data/docscanner/uploads/video-jobs/
├── jobs.json
```

Output compressed videos are written to the operating-system temporary directory (e.g., `/tmp`) and served directly via:
`GET /api/video/result/:jobId`

Uploaded source files and temporary transcode buffers are securely deleted as soon as compression ends (or fails).

## API Endpoints

### Start Compression
`POST /api/video/compress` (using `multipart/form-data`)

| Field | Required | Description |
|---|---|---|
| `file` | Yes | Uploaded video file |
| `jobId` | Yes | Client-generated job identifier |
| `quality` | No | `240p`, `360p`, `480p`, `720p`, `1080p` (default `480p`) |
| `speed` | No | `ultrafast`, `fast`, `medium`, `slow` (default `fast`) |
| `outFormat`| No | `mp4`, `webm` (default `mp4`) |
| `removeAudio`| No | `true`, `false` (default `false`) |
| `duration` | No | Duration of the video in seconds |

### Read Job Status
`GET /api/video/job/:jobId`

Returns the job metadata, including:
- `status`: `processing`, `done`, or `error`
- `percent`: Current percent completed (`-1` indicates indeterminate phase)
- `timemark`: Current time-code encoded
- `originalSize`: Uploaded file size (in bytes)
- `compressedSize`: Output file size (in bytes, present when `status === 'done'`)

## Implementation Map

- **Client UI & Polling:** [VideoCompressTool.jsx](file:///home/ubuntu/docscanner/client/src/modules/tools/VideoCompressTool.jsx)
- **API & FFmpeg Controller:** [index.js](file:///home/ubuntu/docscanner/server/src/modules/api/index.js)
