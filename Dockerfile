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

FROM base AS api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000
COPY --from=build-api /app /app
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
