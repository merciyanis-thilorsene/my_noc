# syntax=docker/dockerfile:1
# Build context is the my_noc/ root (see docker-compose.yml) so both backend/ and
# frontend/ are available to COPY.

# ── Stage 1: backend build ────────────────────────────────────────────────────
# Full image so node-gyp can compile better-sqlite3's native binding.
FROM node:22-bookworm AS backend-build
WORKDIR /app
COPY backend/package.json backend/yarn.lock ./
RUN yarn install --frozen-lockfile --ignore-engines
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN yarn run build

# ── Stage 2: frontend build ───────────────────────────────────────────────────
FROM node:22-bookworm AS frontend-build
# Path prefix the SPA is served under. Defaults to the prototypes value (/monitor/, behind
# Traefik). Override with `--build-arg APP_BASE=/` for a root-hosted local run with no proxy.
ARG APP_BASE=/monitor/
WORKDIR /fe
COPY frontend/package.json frontend/yarn.lock ./
RUN yarn install --frozen-lockfile --ignore-engines
COPY frontend/ ./
RUN node_modules/.bin/tsc --noEmit && node_modules/.bin/vite build --base "$APP_BASE"

# ── Stage 3: production dependencies ──────────────────────────────────────────
FROM node:22-bookworm AS deps
WORKDIR /app
COPY backend/package.json backend/yarn.lock ./
RUN yarn install --production --frozen-lockfile --ignore-engines && yarn cache clean

# ── Stage 4: runtime ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    DATABASE_PATH=/data/monitor.db \
    PUBLIC_DIR=/app/public
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /fe/dist ./public
COPY backend/package.json ./

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD \
  node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
