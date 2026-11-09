# NAYA TIME – Produktionsimage (Next.js + Prisma). Läuft hinter Caddy (HTTPS), siehe deploy/docker-compose.yml
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && apt-get clean
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && apt-get clean
WORKDIR /app
ENV NODE_ENV=production STORAGE_DIR=/data/storage PORT=3000
COPY --from=build /app /app
RUN useradd -r -u 1001 naya && mkdir -p /data/storage && chown -R naya /data
USER naya
EXPOSE 3000
# Datenbank-Migrationen vor dem Start (nur neue, nichts wird zurückgesetzt)
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -p 3000"]
