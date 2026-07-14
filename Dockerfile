ARG NODE_VERSION=26.3.0
ARG PNPM_VERSION=11.12.0

FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
RUN npm install --global "pnpm@${PNPM_VERSION}"
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/llm/package.json packages/llm/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY . .
RUN pnpm build

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/llm/package.json packages/llm/package.json
RUN pnpm install --prod --frozen-lockfile

FROM node:${NODE_VERSION}-alpine AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=production-dependencies --chown=node:node /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=production-dependencies --chown=node:node /app/packages/llm/node_modules ./packages/llm/node_modules

COPY --from=builder --chown=node:node /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=node:node /app/packages/core/package.json ./packages/core/package.json
COPY --from=builder --chown=node:node /app/packages/core/dist ./packages/core/dist
COPY --from=builder --chown=node:node /app/packages/llm/package.json ./packages/llm/package.json
COPY --from=builder --chown=node:node /app/packages/llm/dist ./packages/llm/dist

USER node
EXPOSE 3000

CMD ["node", "apps/web/dist/server.js"]
