FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends xz-utils ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
RUN curl -sL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
  | tar xJ --strip-components=1 -C /usr/local/bin --wildcards "*/ffmpeg" "*/ffprobe" \
  && chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY lib ./lib
COPY public ./public

ENV PORT=7860 \
    DATA_DIR=/app/data \
    FFMPEG_PATH=/usr/local/bin/ffmpeg \
    FFPROBE_PATH=/usr/local/bin/ffprobe \
    NODE_ENV=production

EXPOSE 7860
CMD ["node", "server.js"]
