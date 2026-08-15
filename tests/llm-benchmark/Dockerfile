ARG NODE_VERSION=26.3.0
ARG PNPM_VERSION=11.12.0

FROM node:${NODE_VERSION}-alpine

WORKDIR /app

RUN npm install --global "pnpm@${PNPM_VERSION}"

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/llm/package.json packages/llm/package.json
RUN pnpm install --frozen-lockfile

COPY . .

ENTRYPOINT ["pnpm", "--filter", "@uo-request-generator/web", "benchmark:llm", "--"]
