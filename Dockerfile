# syntax=docker/dockerfile:1

# MyTrack — production image (Next.js standalone server).
#   docker build -t mytrack .
#   docker run --env-file .env -p 3000:3000 -v mytrack-data:/app/data mytrack

ARG NODE_VERSION=20

# ---- 1. dependencies -------------------------------------------------------
# `npm ci` also runs the postinstall scripts, which copy pdf.js and tesseract
# (OCR) into public/ — the app serves them itself because of its CSP.
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/copy-pdfjs.js scripts/copy-tesseract.js ./scripts/
RUN npm ci --no-audit --no-fund

# ---- 2. build --------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=deps /app/public/pdfjs ./public/pdfjs
COPY --from=deps /app/public/tesseract ./public/tesseract
RUN npm run build
# Next bundles mysql2 into the server, so the standalone output has no
# node_modules/mysql2 for scripts/migrate.js — give the script its own copy.
RUN mkdir -p /migrate && cd /migrate \
 && npm install --no-save --no-audit --no-fund --omit=dev \
      "mysql2@$(node -p "require('/app/node_modules/mysql2/package.json').version")"

# ---- 3. runtime ------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DOWNLOAD_ROOT=/app/data/downloads \
    SCREENSHOT_DIR=/app/data/system-tracker

# Standalone server + its traced node_modules, plus the static assets it
# doesn't copy on its own. The schema/migrate script lets you run
# `node scripts/migrate.js` inside the container.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/scripts/migrate.js /app/scripts/schema.sql ./scripts/
COPY --from=builder --chown=node:node /migrate/node_modules ./scripts/node_modules

# Downloads and tracker screenshots live on a volume mounted here.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
