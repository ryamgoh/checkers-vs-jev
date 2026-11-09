# syntax=docker/dockerfile:1
# Production image: builds the three.js client, then runs the Fastify server (which also serves dist/).
# Secrets such as OPENROUTER_API_KEY are read from the runtime environment only, never at build time.

FROM node:22-bookworm-slim AS base
WORKDIR /app
# pnpm version is pinned by package.json "packageManager".
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack install

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
RUN pnpm install --frozen-lockfile --prod && pnpm store prune
COPY --from=build /app/dist ./dist
COPY shared ./shared
COPY server ./server
USER node
EXPOSE 3000
# Unauthenticated readiness endpoint used by the platform: GET /api/health
CMD ["node", "--import", "tsx", "server/index.ts"]
