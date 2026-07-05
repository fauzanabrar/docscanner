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
# python3 is required by yt-dlp video download fallback.
# ffmpeg runtime libs are required by ffmpeg-static for audio extraction.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server/src/ ./src/
COPY --from=builder /app/client/dist/ ./public/

EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
