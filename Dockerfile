# Uma imagem para a API e o worker (o comando muda no docker-compose).
# Construída pelo CI e publicada no GHCR; o servidor só faz pull.
FROM node:25-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/ingest/package.json packages/ingest/
COPY packages/ota/package.json packages/ota/
COPY packages/security/package.json packages/security/
COPY packages/shared/package.json packages/shared/
COPY packages/tokens/package.json packages/tokens/
COPY packages/db/prisma packages/db/prisma
COPY packages/db/prisma.config.ts packages/db/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS runtime
LABEL org.opencontainers.image.source="https://github.com/ali-ali18/orbita" \
	org.opencontainers.image.description="Órbita: API e worker de finanças pessoais" \
	org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production
COPY --from=deps /app /app
# `ota/` (atualização do app, assinada no CI) é copiada junto, para /app/ota; sem ela o servidor responde "sem atualização".
COPY . .
RUN pnpm --filter @orbita/db generate \
	&& pnpm --filter @orbita/api build:connect \
	&& printf '#!/bin/sh\ncd /app/apps/api && exec node --import tsx src/cli/parear.ts "$@"\n' > /usr/local/bin/parear \
	&& chmod +x /usr/local/bin/parear \
	&& chmod -R a+rX /app
USER node
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/server.ts"]
