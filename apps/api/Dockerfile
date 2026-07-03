FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── Build ───────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY . .

RUN --mount=type=cache,id=s/18f60b48-38ce-4b14-9d80-88e73d727ffa-pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter=api build

# ── Bundle only prod deps via pnpm deploy ───────────────────────────
FROM base AS deployer
WORKDIR /app
COPY --from=builder /app .
RUN pnpm --filter=api deploy --prod /deploy

# ── Slim production image ───────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deployer /deploy .
COPY --from=builder /app/apps/api/dist ./dist

EXPOSE 3001
CMD ["node", "dist/index.js"]
