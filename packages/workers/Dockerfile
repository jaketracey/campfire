FROM node:24-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/workers/package.json ./packages/workers/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared ./packages/shared
COPY packages/workers ./packages/workers
COPY tsconfig.base.json ./

# Build shared first, then workers
RUN pnpm --filter @campfire/shared build
RUN pnpm --filter @campfire/workers build

# Production image
FROM node:24-alpine AS production

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY --from=base /app/packages/workers/dist ./dist
COPY --from=base /app/packages/workers/package.json ./
COPY --from=base /app/node_modules ./node_modules

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
