# Translator — production image.
# Multi-stage: build the Vite client, then ship a slim Node runtime with ffmpeg.

# ---------- builder ----------
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (sharp, etc.) and Python for
# any post-install scripts. Alpine ships python3 separately.
RUN apk add --no-cache python3 make g++ ffmpeg

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:22-alpine

# ffmpeg + yt-dlp dependencies. ffmpeg is also bundled via `ffmpeg-static` for
# code paths that spawn it directly, but a system binary keeps yt-dlp happy.
RUN apk add --no-cache ffmpeg ca-certificates python3 py3-pip \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY api ./api
COPY --from=builder /app/dist ./dist

# Persistent state mounts here (jobs db, uploads).
RUN mkdir -p /app/data /app/uploads /app/temp
VOLUME ["/app/data", "/app/uploads", "/app/temp"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health | grep -q '"status":"ok"' || exit 1

CMD ["node", "server/index.js"]
