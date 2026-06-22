# Dev-oriented image: runs the TypeScript sources via tsx (no build step — internal packages
# export their .ts source directly). Replace with a multi-stage production build later.
FROM node:24-bookworm-slim

ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

EXPOSE 3000
CMD ["pnpm", "--filter", "@eng/server", "start"]
