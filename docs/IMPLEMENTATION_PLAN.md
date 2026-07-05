# Document Scanner Web App — Implementation Plan

> Note: This file is the original implementation plan. The live code has changed since this plan was written. For the current module behavior and flow, use the root `README.md` and each module `README.md` under `client/src/modules` and `server/src/modules`. The later persistent video-to-audio feature is documented in [`VIDEO_TO_AUDIO.md`](VIDEO_TO_AUDIO.md).

## 1. Project Structure

```
docscanner/
├── client/                          # React frontend
│   ├── src/
│   │   ├── modules/
│   │   │   ├── camera/
│   │   │   │   ├── CameraCapture.jsx      # Camera stream + photo capture
│   │   │   │   ├── CameraCapture.css
│   │   │   │   └── README.md
│   │   │   ├── detection/
│   │   │   │   ├── DocumentDetector.jsx   # Auto-detect document boundaries
│   │   │   │   ├── canvasUtils.js         # Canvas drawing helpers
│   │   │   │   └── README.md
│   │   │   ├── perspective/
│   │   │   │   ├── PerspectiveTransform.jsx # Auto-correct perspective
│   │   │   │   └── README.md
│   │   │   ├── filters/
│   │   │   │   ├── ImageFilters.jsx       # Brightness, contrast, color restore
│   │   │   │   └── README.md
│   │   │   ├── pages/
│   │   │   │   ├── PageManager.jsx        # Multi-page document management
│   │   │   │   ├── PageList.jsx           # Thumbnail list of pages
│   │   │   │   └── README.md
│   │   │   ├── export/
│   │   │   │   ├── ExportPanel.jsx        # Export to PDF/image
│   │   │   │   ├── ExportService.js       # Client-side export logic
│   │   │   │   └── README.md
│   │   │   └── auth/
│   │   │       ├── AuthProvider.jsx       # Auth context provider
│   │   │       ├── LoginModal.jsx         # Login/Register modal
│   │   │       └── README.md
│   │   ├── components/
│   │   │   ├── Layout.jsx                 # App shell / responsive layout
│   │   │   ├── Header.jsx
│   │   │   ├── Button.jsx
│   │   │   └── Toast.jsx                  # Notification system
│   │   ├── pages/
│   │   │   ├── ScannerPage.jsx            # Main scanner workflow
│   │   │   ├── DocumentsPage.jsx          # Saved documents list
│   │   │   └── SettingsPage.jsx           # User settings
│   │   ├── hooks/
│   │   │   ├── useCamera.js               # Camera API hook
│   │   │   ├── useDocumentDetector.js     # OpenCV.js document detection
│   │   │   ├── usePerspectiveTransform.js # Perspective correction
│   │   │   └── useImageFilters.js         # Image filtering hook
│   │   ├── services/
│   │   │   ├── api.js                     # API client
│   │   │   └── storage.js                 # Local storage for unsaved docs
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── public/
│   │   └── opencv.js                      # OpenCV.js WASM (client-side)
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── README.md
├── server/                          # Node.js backend
│   ├── src/
│   │   ├── modules/
│   │   │   ├── api/
│   │   │   │   ├── index.js               # API route aggregator
│   │   │   │   ├── pdf.js                 # PDF generation endpoint
│   │   │   │   ├── documents.js           # Document CRUD
│   │   │   │   ├── upload.js              # Image upload endpoint
│   │   │   │   └── README.md
│   │   │   ├── auth/
│   │   │   │   ├── index.js               # Auth routes
│   │   │   │   ├── middleware.js           # JWT auth middleware
│   │   │   │   └── README.md
│   │   │   ├── storage/
│   │   │   │   ├── index.js               # File storage abstraction
│   │   │   │   ├── local.js               # Local filesystem storage
│   │   │   │   └── README.md
│   │   │   └── pdf/
│   │   │       ├── index.js               # PDF generation engine
│   │   │       ├── templates.js           # PDF templates
│   │   │       └── README.md
│   │   ├── middleware/
│   │   │   ├── auth.js                    # JWT verification
│   │   │   └── upload.js                  # Multer file upload
│   │   ├── config/
│   │   │   ├── index.js                   # Config loader
│   │   │   └── default.js                 # Default config
│   │   └── index.js                       # Server entry point
│   ├── package.json
│   └── README.md
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── DEPLOYMENT.md
│   └── SETUP.md
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 2. Client-Side Architecture

### 2.1 React Component Tree

```
App
├── AuthProvider (context)
├── Layout
│   ├── Header (navigation)
│   ├── ScannerPage (main workflow)
│   │   ├── CameraCapture → capture photo
│   │   ├── DocumentDetector → draw green overlay on document edges
│   │   ├── PerspectiveTransform → warp to rectangle
│   │   ├── ImageFilters → brightness, contrast, color
│   │   ├── PageManager → add/remove/reorder pages
│   │   └── ExportPanel → PDF or image download
│   ├── DocumentsPage (saved docs)
│   └── SettingsPage
└── LoginModal (optional auth)
```

### 2.2 Camera Handling (`modules/camera/`)

**Library: `react-webcam`** (wrapper around `navigator.mediaDevices.getUserMedia`)

```jsx
// CameraCapture.jsx — key logic
const constraints = {
  video: {
    facingMode: { ideal: 'environment' },  // back camera on mobile
    width: { ideal: 1920 },
    height: { ideal: 1080 }
  }
};

// Laptop: uses default webcam (no back camera, works fine)
// Android: requests rear camera via facingMode:'environment'
// Fallback: if no rear camera, use front camera
```

**Responsive behavior:**
- Mobile: Full-screen camera view with capture button overlay
- Laptop: Camera preview in a card/modal with manual crop option

### 2.3 Document Boundary Detection (`modules/detection/`)

**Library: OpenCV.js (client-side WASM)**

OpenCV.js loaded in browser, runs document contour detection:

```javascript
// detection logic (runs in Web Worker or main thread)
function detectDocument(imageData) {
  // 1. Convert to grayscale
  // 2. Gaussian blur
  // 3. Canny edge detection
  // 4. Find contours (cv.findContours)
  // 5. Approximate polygon (cv.approxPolyDP)
  // 6. Find 4-point contour (largest rectangle)
  // 7. Return corner points
}
```

**Alternative if OpenCV.js is too heavy (~8MB):**
- `jeeliz-docscanner` — lightweight, <100KB, built specifically for document detection
- Uses TensorFlow.js under the hood, auto-detects 4 corners

**Recommendation:** Start with `jeeliz-docscanner` for lighter load, fallback to OpenCV.js if more control needed.

### 2.4 Perspective Correction (`modules/perspective/`)

**Library: `perspective-transform` (npm) or manual implementation**

```javascript
// Given 4 corner points, compute 3x3 perspective matrix
// Warp image to standard A4/letter rectangle
function warpPerspective(sourceImage, corners, outputWidth, outputHeight) {
  // 1. Compute perspective transform matrix (cv.getPerspectiveTransform)
  // 2. Apply warp (cv.warpPerspective)
  // 3. Crop to output dimensions
}
```

**Output size calculation:**
- Measure distance between corners
- Compute aspect ratio (A4 = 210mm × 297mm)
- Scale output to maintain proportions
- Default: 2480 × 3508 pixels (A4 at 300 DPI)

### 2.5 Image Filters (`modules/filters/`)

**Library: Canvas API + custom filters (no external library needed)**

```javascript
// Filters applied via Canvas pixel manipulation
const filters = {
  brightness: (ctx, value) => { /* adjust pixel RGB values */ },
  contrast: (ctx, value) => { /* S-curve contrast adjustment */ },
  grayscale: (ctx) => { /* convert to grayscale */ },
  sharpen: (ctx) => { /* unsharp mask convolution */ },
  colorRestore: (ctx) => { /* auto white balance + saturation boost */ },
  enhance: (ctx) => { /* combined: sharpen + auto-contrast + color restore */ }
};
```

**Image enhance pipeline (one-click):**
1. Auto-white balance (gray world algorithm)
2. Contrast enhancement (histogram equalization)
3. Sharpening (unsharp mask)
4. Noise reduction (simple blur on low-contrast areas)

### 2.6 Multi-Page Support (`modules/pages/`)

```javascript
// PageManager state
{
  pages: [
    { id: 1, originalImage: Blob, processedImage: Blob, corners: [...], filters: {...}, order: 0 },
    { id: 2, originalImage: Blob, processedImage: Blob, corners: [...], filters: {...}, order: 1 },
  ],
  activePage: 0
}
```

**Storage:**
- Unsaved work: `IndexedDB` via `idb` library (handles large blobs)
- Auto-save every 30s to prevent data loss
- On export: send all processed images to server for PDF generation

### 2.7 Export (`modules/export/`)

**Client-side export (image):**
```javascript
// Direct download as JPEG/PNG
function exportAsImage(processedImageBlob, filename, format = 'jpeg') {
  const url = URL.createObjectURL(processedImageBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.${format}`;
  a.click();
}
```

**Server-side export (PDF):**
```javascript
// Send images to server for PDF generation
async function exportAsPDF(pages, filename) {
  const formData = new FormData();
  pages.forEach((page, i) => {
    formData.append('images', page.processedImage, `page_${i}.jpg`);
  });
  formData.append('filename', filename);
  const response = await api.post('/api/pdf/generate', formData);
  // Download returned PDF
}
```

**Client-side PDF fallback (for offline):**
```javascript
// Use jsPDF for simple client-side PDF generation
import jsPDF from 'jspdf';
function generatePDFClient(pages) {
  const doc = new jsPDF('p', 'mm', 'a4');
  pages.forEach((page, i) => {
    if (i > 0) doc.addPage();
    const imgData = URL.createObjectURL(page.processedImage);
    doc.addImage(imgData, 'JPEG', 0, 0, 210, 297);
  });
  return doc.output('blob');
}
```

---

## 3. Server-Side Architecture

### 3.1 API Routes

```
POST /api/auth/register       - Create account (optional)
POST /api/auth/login          - Login, returns JWT
GET  /api/auth/me             - Get current user

POST /api/pdf/generate        - Generate PDF from uploaded images
POST /api/pdf/merge           - Merge 2+ PDFs into one (pdf-lib copyPages)
POST /api/pdf/split           - Split PDF by page ranges (ZIP via archiver)
POST /api/pdf/compress        - Compress PDF with structural optimization
GET  /api/pdf/:id/download    - Download generated PDF

POST /api/documents           - Save document (requires auth)
GET  /api/documents           - List user's documents (requires auth)
GET  /api/documents/:id       - Get document details
DELETE /api/documents/:id     - Delete document

POST /api/upload/image        - Upload single image for processing
POST /api/health              - Health check (no auth)
```

### 3.2 PDF Generation (`modules/pdf/`)

**Library: `pdf-lib`** (recommended) or `PDFKit`

```javascript
// server/modules/pdf/index.js
import { PDFDocument } from 'pdf-lib';

async function generatePDF(images, options = {}) {
  const pdfDoc = await PDFDocument.create();
  
  for (const imageBuffer of images) {
    const jpegImage = await pdfDoc.embedJpg(imageBuffer);
    const page = pdfDoc.addPage([jpegImage.width, jpegImage.height]);
    page.drawImage(jpegImage, { x: 0, y: 0, width: jpegImage.width, height: jpegImage.height });
  }
  
  return await pdfDoc.save();
}
```

**Why `pdf-lib` over `PDFKit`:**
- Smaller bundle (~200KB vs ~1MB)
- Better async/await support
- Can merge existing PDFs
- Actively maintained

### 3.3 Auth Module (`modules/auth/`)

**Library: `bcryptjs` + `jsonwebtoken`**

```javascript
// Simple optional auth — no account required to use scanner
// Account only needed to SAVE documents

// User model (SQLite via better-sqlite3)
{
  id: INTEGER PRIMARY KEY,
  email: TEXT UNIQUE,
  password_hash: TEXT,
  created_at: DATETIME
}

// Document model
{
  id: INTEGER PRIMARY KEY,
  user_id: INTEGER (nullable),
  session_id: TEXT (for anonymous users),
  title: TEXT,
  page_count: INTEGER,
  file_path: TEXT,
  created_at: DATETIME
}
```

**Anonymous usage:** Documents stored with `session_id` (UUID), auto-expire after 24h unless user saves to account.

### 3.4 Storage Module

**Default: Local filesystem**

```javascript
// storage/local.js
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/docscanner/uploads';

async function saveDocument(id, images, pdf) {
  // Save individual images
  for (let i = 0; i < images.length; i++) {
    await fs.writeFile(`${UPLOAD_DIR}/${id}/page_${i}.jpg`, images[i]);
  }
  // Save PDF
  await fs.writeFile(`${UPLOAD_DIR}/${id}/document.pdf`, pdf);
}
```

**Optional: rclone sync to Google Drive** (leveraging existing infrastructure pattern from subdomain-registry).

---

## 4. Key Libraries

| Purpose | Library | Why |
|---------|---------|-----|
| Camera access | `react-webcam` | Simple React wrapper, handles getUserMedia |
| Document detection | `jeeliz-docscanner` | Lightweight (<100KB), auto-detects 4 corners. Fallback: OpenCV.js |
| Perspective transform | `perspective-transform` | Pure JS, no WASM dependency |
| Image filtering | Canvas API (built-in) | No extra deps, full pixel control |
| Multi-page state | `idb` (IndexedDB wrapper) | Handles large image blobs in browser |
| Client-side PDF | `jsPDF` | Offline PDF generation fallback |
| Server PDF | `pdf-lib` | Fast, async, <200KB |
| Auth | `bcryptjs` + `jsonwebtoken` | Standard, lightweight |
| Database | `better-sqlite3` | Embedded, no setup needed |
| File upload | `multer` | Standard Express middleware |
| Image processing (server) | `sharp` | Fast, libvips-based, auto-orient |
| React framework | Vite + React 18 | Fast dev, small bundle |
| Server framework | Express.js | Simple, well-known |

---

## 5. Module Breakdown with README Files

Each module directory contains a `README.md` describing:

### Client Modules

**`client/src/modules/camera/README.md`**
- CameraCapture component: full-screen camera on mobile, card on desktop
- Uses `react-webcam` with `facingMode: 'environment'` for rear camera
- Captures photo as JPEG blob (quality 0.92)
- Responsive: 100vh on mobile, 600×400 container on desktop
- Key exports: `CameraCapture` component, `capturePhoto()` method

**`client/src/modules/detection/README.md`**
- DocumentDetector: receives image blob, returns 4 corner points
- Uses `jeeliz-docscanner` for contour detection
- Returns normalized coordinates (0-1 range)
- Fallback: manual corner dragging if detection fails
- Key exports: `detectDocument(imageBlob)` → `Promise<{corners: Point[]}>`

**`client/src/modules/perspective/README.md`**
- PerspectiveTransform: takes 4 corners + source image, outputs warped rectangle
- Computes perspective matrix, applies affine warp
- Output size: A4 proportions (210:297), scaled to 300 DPI
- Key exports: `warpPerspective(image, corners, outputSize)` → `Promise<Blob>`

**`client/src/modules/filters/README.md`**
- ImageFilters: Canvas-based pixel manipulation
- Available filters: brightness, contrast, grayscale, sharpen, colorRestore, enhance
- Each filter is a pure function: `(ctx, value) => void`
- "Enhance" combines: auto-white-balance + contrast + sharpen
- Key exports: `applyFilter(canvas, filterName, value)`, `applyEnhance(canvas)`

**`client/src/modules/pages/README.md`**
- PageManager: manages multi-page document state
- State stored in IndexedDB via `idb`
- Operations: addPage, removePage, reorder, setActive
- Auto-saves to IndexedDB every 30s
- Key exports: `usePages()` hook returning `{pages, addPage, removePage, reorder}`

**`client/src/modules/export/README.md`**
- ExportPanel: UI for choosing PDF/image export
- Client-side: `jsPDF` for offline PDF, `Blob` API for image download
- Server-side: POST to `/api/pdf/generate` for high-quality PDF
- Key exports: `exportAsPDF(pages)`, `exportAsImage(blob, filename, format)`

**`client/src/modules/auth/README.md`**
- AuthProvider: React context for auth state
- LoginModal: email/password login/register form
- Optional: app works fully without auth
- Auth only needed to save documents server-side
- Key exports: `AuthProvider`, `useAuth()` hook

### Server Modules

**`server/src/modules/api/README.md`**
- API route aggregator: mounts all sub-routers
- Routes: `/pdf/generate`, `/documents/*`, `/upload/image`, `/health`
- All routes prefixed with `/api`

**`server/src/modules/pdf/README.md`**
- PDF generation engine using `pdf-lib`
- Accepts array of JPEG/PNG buffers
- Output: single multi-page PDF
- Optional: page labels, metadata, bookmarks

**`server/src/modules/auth/README.md`**
- JWT-based auth with bcrypt password hashing
- Routes: `/register`, `/login`, `/me`
- Middleware: `authMiddleware` verifies JWT in `Authorization` header
- Optional: works without auth for anonymous scanning

**`server/src/modules/storage/README.md`**
- File storage abstraction layer
- Default: local filesystem at `/data/docscanner/uploads/<docId>/`
- Optional: rclone sync to Google Drive
- Auto-cleanup: delete anonymous docs >24h old

---

## 6. Deployment Configuration

### 6.1 Dockerfile

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app

# Install server dependencies
COPY server/package*.json ./
RUN npm ci --omit=dev

# Copy server source
COPY server/src/ ./src/

# Copy built client
COPY --from=builder /app/client/dist/ ./public/

# Copy OpenCV.js for client
COPY client/public/opencv.js ./public/opencv.js

EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
```

**Note:** Multi-stage build — client built in builder stage, only `dist/` copied to production image.

### 6.2 docker-compose.yml

```yaml
services:
  docscanner:
    build: .
    container_name: docscanner
    restart: unless-stopped
    ports:
      - "3002:3000"
    volumes:
      - docscanner-data:/data/docscanner
    environment:
      - NODE_ENV=production
      - PORT=3000
      - JWT_SECRET=${JWT_SECRET}
      - UPLOAD_DIR=/data/docscanner/uploads
      - DB_PATH=/data/docscanner/db.sqlite
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  docscanner-data:
```

**Port mapping:** `3002:3000` — host port 3002, container port 3000. Port 3001 already used by subdomain-registry.

### 6.3 Traefik Dynamic Config

File: `/data/coolify/proxy/dynamic/docscanner.yaml`

```yaml
http:
  routers:
    docscanner:
      rule: "Host(`tool.cobaweb.com`)"
      entryPoints:
        - https
      service: docscanner
      tls:
        certResolver: letsencrypt
  services:
    docscanner:
      loadBalancer:
        servers:
          - url: "http://10.0.2.1:3002"
```

**Note:** `10.0.2.1` is the gateway IP for Coolify networks. Verify with `docker network inspect coolify` if different.

### 6.4 .env.example

```bash
# Server
NODE_ENV=production
PORT=3000

# Auth
JWT_SECRET=your-random-secret-here
SESSION_EXPIRY=86400

# Storage
UPLOAD_DIR=/data/docscanner/uploads
DB_PATH=/data/docscanner/db.sqlite
MAX_UPLOAD_SIZE=524288000  # 500MB
MAX_ACTIVE_AUDIO_JOBS=2
AUDIO_JOB_TIMEOUT_MS=7200000

# Anonymous cleanup
ANONYMOUS_DOC_EXPIRY=86400  # 24 hours
```

---

## 7. Subdomain Registration

### 7.1 Add to subdomains.json

Add entry to `/home/ubuntu/subdomain-registry/subdomains.json`:

```json
{
  "id": "7",
  "name": "docscanner",
  "subdomain": "tool.cobaweb.com",
  "description": "Document Scanner - Photo to PDF scanner with auto-detect, perspective correction, and multi-page support",
  "port": 3002,
  "type": "app",
  "status": "active",
  "addedAt": "2026-06-15",
  "username": "-",
  "password": "-"
}
```

### 7.2 DNS

Already handled — wildcard DNS `*.cobaweb.com` → `168.110.216.181` is configured.

### 7.3 Traefik SSL

Coolify's Traefik auto-provisions Let's Encrypt SSL certificates for any `Host()` rule in dynamic configs. Just create the YAML file above and Traefik picks it up automatically.

---

## 8. Development Workflow

### Phase 1: Scaffold (Day 1)
1. Create project structure with all module directories and README files
2. Initialize `client/` with Vite + React
3. Initialize `server/` with Express
4. Set up Dockerfile and docker-compose.yml

### Phase 2: Camera + Detection (Day 2-3)
1. Implement CameraCapture with responsive layout
2. Add document detection (jeeliz-docscanner)
3. Implement manual corner adjustment (drag handles)
4. Test on both laptop and Android

### Phase 3: Processing Pipeline (Day 3-4)
1. Implement perspective correction
2. Add image filters (brightness, enhance)
3. Wire up the full capture → detect → correct → filter flow
4. Multi-page add/remove/reorder

### Phase 4: Export + Backend (Day 4-5)
1. Client-side PDF export (jsPDF)
2. Server PDF generation endpoint (pdf-lib)
3. File upload + document storage
4. Health check endpoint

### Phase 5: Auth + Persistence (Day 5-6)
1. Optional auth (register/login)
2. Document save/load for authenticated users
3. Anonymous document expiry
4. IndexedDB auto-save

### Phase 6: Deploy (Day 6)
1. Build Docker image
2. Create Traefik dynamic config
3. Register in subdomain-registry
4. Test end-to-end on `tool.cobaweb.com`

---

## 9. Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|------------|
| Client-side detection | `jeeliz-docscanner` first, OpenCV.js fallback | 100KB vs 8MB; lighter initial load |
| Perspective correction | `perspective-transform` npm | Pure JS, no WASM, sufficient for 4-point warp |
| Image filters | Canvas API (built-in) | Zero deps, full pixel control, fast |
| Server PDF | `pdf-lib` | Smaller than PDFKit, better async API, supports merge/split |
| PDF Tools processing | Server-side | `pdf-lib` + `archiver` on server keeps client bundle small |
| PDF Split ZIP | `archiver` | Standard ZIP library, CJS-only (uses `createRequire` in ESM) |
| PDF Compress | Structural only (`pdf-lib` `useObjectStreams`) | No image re-encoding dependency, works on all PDFs |
| Database | SQLite via `better-sqlite3` | Embedded, no external DB needed |
| Auth | Optional JWT | App works without accounts; auth only for saving |
| State persistence | IndexedDB | Handles large blobs, survives page refresh |
| Build | Vite | Fast HMR, small bundles, ESM-first |
| Server framework | Express | Simple, matches existing infrastructure patterns |
| Image processing (server) | `sharp` | Fast libvips bindings, handles orientation auto-fix |
