# Dev image for the Vite dashboard — serves the dev server (HMR) and proxies /api + /health to the
# `server` service. Replace with a static build (vite build + a static file server) for production.
FROM node:24-bookworm-slim

ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

EXPOSE 5173
CMD ["pnpm", "--filter", "@eng/web", "dev"]
