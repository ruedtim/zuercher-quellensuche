# Multi-stage build für die SvelteKit-App.
# Build-Output: ein Node-Server unter /app/build, läuft auf Port 3000.

FROM node:22-alpine AS deps
WORKDIR /app
# swagger-ui-dist zieht @scarf/scarf (Install-Telemetrie) – abschalten.
ENV SCARF_ANALYTICS=false
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN npm run build

FROM node:22-alpine AS prod-deps
WORKDIR /app
ENV SCARF_ANALYTICS=false
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

RUN apk add --no-cache curl tini

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3000/healthz > /dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "build"]
