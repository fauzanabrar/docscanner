---
feature: docscanner
status: delivered
specs:
  - /home/ubuntu/.local/share/mimocode/plans/1781494957724-playful-orchid.md
plans:
  - /home/ubuntu/.local/share/mimocode/plans/1781494957724-playful-orchid.md
branch: main
commits: initial
---

# DocScanner — Final Report

> Note: This report reflects an earlier delivery snapshot. The current application flow, active modules, and runtime responsibilities are documented in the root `README.md` and the module `README.md` files in `client/src/modules` and `server/src/modules`.

> Post-delivery addition: persistent upload/URL video-to-audio conversion is documented in [`../../VIDEO_TO_AUDIO.md`](../../VIDEO_TO_AUDIO.md).

## What Was Built

A document scanner web application that works on both laptop and Android mobile devices. Users capture photos of documents using their device camera, the app auto-detects document boundaries, corrects perspective distortion, enhances brightness and color, supports multi-page documents, and exports as PDF or image files. A dedicated PDF Tools page (`/tools`) provides server-side combine, split, and compress utilities for existing PDF files.

The application is deployed at `tool.cobaweb.com` via Coolify with Traefik reverse proxy for HTTPS/SSL.

## Architecture

### Project Structure
```
docscanner/
├── client/                          # React frontend (Vite)
│   ├── src/modules/
│   │   ├── camera/                  # CameraCapture component
│   │   ├── detection/               # DocumentDetector (edge detection)
│   │   ├── perspective/             # PerspectiveTransform (warp to rectangle)
│   │   ├── filters/                 # ImageFilters (brightness, contrast, sharpen)
│   │   ├── pages/                   # PageManager (multi-page state)
│   │   ├── export/                  # ExportPanel (PDF/image download)
│   │   ├── tools/                   # PDF Tools (CombineTool, SplitTool, CompressTool)
│   │   └── auth/                    # AuthProvider (optional JWT auth)
│   ├── src/components/              # Layout (nav bar), shared UI
│   └── src/pages/                   # ScannerPage (/), ToolsPage (/tools)
├── server/                          # Node.js backend (Express)
│   └── src/modules/
│       ├── api/                     # API routes (PDF generate/merge/split/compress, documents)
│       ├── auth/                    # JWT authentication
│       ├── pdf/                     # PDF generation (pdf-lib)
│       └── storage/                 # File storage abstraction
├── Dockerfile                       # Multi-stage build
├── docker-compose.yml               # Container orchestration
└── docs/                            # Module documentation
```

### Key Components

**Client-Side:**
- **CameraCapture**: Uses `react-webcam` with `facingMode: 'environment'` for rear camera on mobile
- **DocumentDetector**: Canvas-based edge detection returning 4 corner points
- **PerspectiveTransform**: Warps detected document to A4 rectangle (2480×3508 pixels at 300 DPI)
- **ImageFilters**: Auto-contrast and sharpening via Canvas pixel manipulation
- **PageManager**: Multi-page state with reorder/remove functionality
- **ExportPanel**: Client-side PDF via `jsPDF`, direct image download

**Server-Side:**
- **PDF Generation**: `pdf-lib` for high-quality multi-page PDFs
- **PDF Merge**: `pdf-lib` `copyPages()` to combine 2+ PDFs into one
- **PDF Split**: page range parsing + `archiver` ZIP packaging
- **PDF Compress**: two-pass structural optimization via `pdf-lib` object streams
- **API Routes**: `/api/pdf/generate`, `/api/pdf/merge`, `/api/pdf/split`, `/api/pdf/compress`, `/api/documents`, `/api/health`
- **Storage**: Local filesystem at `/data/docscanner/uploads/`

### Design Decisions

- **Hybrid processing**: Client-side for real-time camera/detection, server-side for PDF generation
- **Canvas API for filters**: Zero dependencies, full pixel control, works offline
- **IndexedDB for state**: Handles large image blobs, survives page refresh
- **Optional auth**: App works fully without accounts; auth only for saving documents

## Usage

### Development
```bash
cd docscanner
npm install
npm run dev          # Starts both client (Vite) and server (Express)
```

### Production (Docker)
```bash
docker compose up --build
```

### API Endpoints
- `POST /api/pdf/generate` - Generate PDF from uploaded images
- `POST /api/pdf/merge` - Merge 2+ PDF files into one
- `POST /api/pdf/split` - Split PDF by page ranges (ZIP or single PDF)
- `POST /api/pdf/compress` - Compress PDF with size reduction stats
- `POST /api/documents` - Save document metadata
- `GET /api/documents` - List documents
- `GET /api/health` - Health check

### Access
- **URL**: https://tool.cobaweb.com
- **Port**: 3002 (host) → 3000 (container)

## Verification

1. **Client build**: `npm run build` completes successfully
2. **Server startup**: Server starts on configured port
3. **Traefik config**: Dynamic config created at `/traefik/dynamic/docscanner.yaml`
4. **Subdomain registered**: Added to `subdomains.json` as `tool.cobaweb.com`

## Journey Log

- [lesson] Coolify uses Traefik dynamic configs in `/data/coolify/proxy/dynamic/` - config files are auto-picked up
- [lesson] Subdomain registration requires both Traefik config AND entry in `subdomains.json`
- [pivot] Used Canvas API instead of OpenCV.js for image filters to reduce bundle size

## Source Materials

| File | Role | Notes |
|------|------|-------|
| `/home/ubuntu/.local/share/mimocode/plans/1781494957724-playful-orchid.md` | Implementation plan | Complete |
