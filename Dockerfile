FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 SQLITE_PATH=/app/data/voidlark.db DB_BACKUP_DIR=/app/backups/database
WORKDIR /app
RUN groupadd --system voidlark && useradd --system --gid voidlark --home /app voidlark \
    && mkdir -p /app/data /app/backups/database /app/knowledge_base \
    && chown -R voidlark:voidlark /app
COPY --from=build --chown=voidlark:voidlark /app/node_modules ./node_modules
COPY --from=build --chown=voidlark:voidlark /app/dist ./dist
COPY --chown=voidlark:voidlark package.json business.config.json prompt.builder.json ./
COPY --chown=voidlark:voidlark config ./config
USER voidlark
EXPOSE 3000
VOLUME ["/app/data", "/app/backups", "/app/knowledge_base"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
