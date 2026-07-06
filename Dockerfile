# Build the Vite client assets first.
FROM node:20-slim AS builder

WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Install the server runtime dependencies and serve the built client with Express.
FROM node:20-slim
WORKDIR /app

# glibc is required by onnxruntime-node (Whisper / m2m100 inference).
# python3 is required by yt-dlp video download fallback and Demucs source separation.
# ffmpeg runtime libs are required by ffmpeg-static for audio extraction.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    build-essential \
    ffmpeg \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Demucs (neural vocal separation) and its PyTorch CPU runtime.
# Install yt-dlp with EJS challenge solver for YouTube n-challenge bypass.
# --no-cache-dir keeps the image smaller; models are cached at TRANSFORMERS_CACHE.
RUN pip3 install --break-system-packages --no-cache-dir torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip3 install --break-system-packages --no-cache-dir demucs \
    && pip3 install --break-system-packages --no-cache-dir yt-dlp yt-dlp-ejs

# Install deno for yt-dlp JS challenge solving (n-challenge bypass).
RUN curl -fsSL https://github.com/denoland/deno/releases/latest/download/deno-aarch64-unknown-linux-gnu.zip -o /tmp/deno.zip \
    && unzip -o /tmp/deno.zip -d /usr/local/bin \
    && rm /tmp/deno.zip

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server/src/ ./src/
COPY --from=builder /app/client/dist/ ./public/

EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
