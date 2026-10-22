# syntax=docker/dockerfile:1.7
# Production images for the monorepo. Two targets:
#   docker build --target api .   -> API + worker (same image, different command) + migrations/seed
#   docker build --target web .   -> Next.js standalone server
# Prisma engines are generated for this same base (debian bookworm, OpenSSL 3).

FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# Dependencies: the lockfile alone feeds the download cache (rebuilt only when it changes).
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile

# ---- API (also runs the worker, `prisma migrate deploy` and the seed) ----
FROM deps AS build-api
RUN pnpm --filter @fusai/api build

# Production dependencies only (PIE V-02): the API bundle keeps @prisma/client and a few
# packages external, and @fusai/db carries the Prisma CLI for `migrate deploy`. No Next,
# devDependencies or other apps. Its postinstall generates the Prisma client for this base.
FROM base AS api-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --prod
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store   pnpm install --offline --frozen-lockfile --prod --filter "@fusai/api..."
# better-auth declares optional peers (Next, Vitest, Vite, sharp...) that auto-install-peers
# puts in the production graph; the API never imports them (~300 MB).
RUN cd node_modules/.pnpm && rm -rf next@* @next+* vitest@* @vitest+* vite@* rollup@* @rollup+* \
  esbuild@* @esbuild+* lightningcss* @img+* sharp@*
# Fails the build (not the deploy) if the Prisma CLI or a runtime import went missing.
RUN cd packages/db && node_modules/.bin/prisma --version >/dev/null \
  && cd ../../apps/api && node --input-type=module -e "for (const m of ['better-auth', \
  'better-auth/node', 'better-auth/api', 'better-auth/adapters/prisma', 'better-auth/crypto', \
  'better-auth/plugins/admin', 'bullmq', 'fastify', '@fastify/cors', '@fastify/helmet', \
  'fastify-type-provider-zod', '@prisma/client', '@modelcontextprotocol/sdk/server/mcp.js', \
  'nodemailer', 'ioredis', 'js-tiktoken', 'pino', 'secure-json-parse', 'zod']) await import(m)"

FROM base AS api
ARG APP_VERSION=dev
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 APP_VERSION=$APP_VERSION
# Same paths as before (apps/api/dist/*.js, packages/db/node_modules/.bin/prisma), so the
# compose file also starts older images during a rollback.
COPY --from=api-deps /app/package.json /app/pnpm-workspace.yaml /app/
COPY --from=api-deps /app/node_modules /app/node_modules
COPY --from=api-deps /app/packages /app/packages
COPY --from=api-deps /app/apps/api/package.json /app/apps/api/
COPY --from=api-deps /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build-api /app/apps/api/dist /app/apps/api/dist
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]

# ---- Web ----
FROM deps AS build-web
# Public URLs are baked into the client bundle (NEXT_PUBLIC_*) at build time.
ARG API_URL=https://api.fusai.com.br
ARG APP_URL=https://www.fusai.com.br
RUN API_URL=$API_URL APP_URL=$APP_URL pnpm --filter @fusai/web build

FROM base AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build-web --chown=node:node /app/apps/web/.next/standalone /app
COPY --from=build-web --chown=node:node /app/apps/web/.next/static /app/apps/web/.next/static
# O standalone NÃO inclui public/ (logo em /brand, etc.): copiar à parte.
COPY --from=build-web --chown=node:node /app/apps/web/public /app/apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
