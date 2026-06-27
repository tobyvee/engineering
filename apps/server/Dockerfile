# Dev-oriented image: runs the TypeScript sources via tsx (no build step — internal packages
# export their .ts source directly). Replace with a multi-stage production build later.
FROM node:24-bookworm-slim

ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
# git is required by the local-git DeliveryAdapter (DELIVERY_BACKEND=local) and the QA repo-context
# reader — without it the worker fails to commit the agent's code (`spawn git ENOENT`).
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

EXPOSE 3000
CMD ["pnpm", "--filter", "@eng/server", "start"]
