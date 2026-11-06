# Uma imagem para a API e o worker (o comando muda no docker-compose).
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/db/prisma packages/db/prisma
COPY packages/db/prisma.config.ts packages/db/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app /app
COPY . .
RUN pnpm --filter @orbita/db generate \
	&& printf '#!/bin/sh\ncd /app/apps/api && exec node --import tsx src/cli/parear.ts "$@"\n' > /usr/local/bin/parear \
	&& chmod +x /usr/local/bin/parear
USER node
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "--import", "tsx", "src/server.ts"]
