# ---- build ----
FROM node:22-slim AS build
WORKDIR /app
# por si better-sqlite3 no encuentra binario precompilado y tiene que compilar
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-slim
WORKDIR /app
LABEL org.opencontainers.image.title="PVEMon" \
      org.opencontainers.image.description="PVE nodes and Backups monitor" \
      org.opencontainers.image.source="https://github.com/Dagarin-es/pvemon" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY drizzle ./drizzle
COPY public ./public
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
