ARG NODE_VERSION=26.3.0
ARG PLAYWRIGHT_VERSION=1.62.1

FROM node:${NODE_VERSION}-bookworm-slim@sha256:3fe807a03a4436e7bc76b7e84e6861899cd75c9028ae99bc00581940141ae150 AS node-runtime

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e
ARG NODE_VERSION
ARG PLAYWRIGHT_VERSION
ARG PNPM_VERSION=11.12.0
ENV CI=1
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY --from=node-runtime /usr/local/ /usr/local/
RUN test "$(node --version)" = "v${NODE_VERSION}" \
  && npm install --global "pnpm@${PNPM_VERSION}"

WORKDIR /work
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/llm/package.json packages/llm/package.json
RUN pnpm install --frozen-lockfile \
  && node -e "if (require('./node_modules/@playwright/test/package.json').version !== '${PLAYWRIGHT_VERSION}') process.exit(1)" \
  && node -e "const info = JSON.parse(require('node:fs').readFileSync('/ms-playwright/.docker-info')); if (info.driverVersion !== '${PLAYWRIGHT_VERSION}') process.exit(1)"

COPY playwright.config.ts ./
COPY tests/browser ./tests/browser

CMD ["pnpm", "exec", "playwright", "test"]
