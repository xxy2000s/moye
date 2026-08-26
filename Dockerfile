# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies
WORKDIR /opt/moye
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json vitest.config.ts ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ARG CODEX_VERSION=0.149.1
ARG CLAUDE_CODE_VERSION=2.1.104
ENV NODE_ENV=production \
    RESTATE_SERVICE_PORT=9080 \
    MOYE_BOARD_PORT=3000 \
    MOYE_LIVE_RUNTIME_ROOT=/var/lib/moye/artifacts/live \
    MOYE_ARTIFACT_ROOTS=/var/lib/moye/artifacts \
    MOYE_REPOSITORY_ROOTS=/workspaces \
    MOYE_SESSION_SOURCE_ROOTS=/sessions
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git ruby \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global "@openai/codex@${CODEX_VERSION}" "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && npm cache clean --force
WORKDIR /opt/moye
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /opt/moye/dist/src ./dist/src
COPY public ./public
RUN mkdir -p /var/lib/moye/artifacts /workspaces /sessions \
    && chown -R node:node /opt/moye /var/lib/moye /workspaces /sessions
USER node
EXPOSE 3000 9080
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/src/index.js"]
