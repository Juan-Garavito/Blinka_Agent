# Imagen única del backend para los procesos api y worker (Railway / Compose).
# Contexto de build: RAÍZ del monorepo (lockfile y workspaces viven allí).
#   docker build -f apps/backend/Dockerfile -t blinka-payguard-backend .
FROM node:24-bookworm-slim AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci --workspace=@blinka/web --include-workspace-root=false --ignore-scripts
COPY apps/web apps/web
RUN npm run build --workspace=@blinka/web

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
RUN npm ci --workspace=@blinka/backend --include-workspace-root=false --ignore-scripts
COPY apps/backend/tsconfig.json apps/backend/tsconfig.build.json apps/backend/
COPY apps/backend/src apps/backend/src
RUN npm run build --workspace=@blinka/backend

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
# Registro de operaciones de aprovisionamiento en stdout (logs de la plataforma).
ENV OPS_AUDIT_FILE=stdout
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
RUN npm ci --workspace=@blinka/backend --include-workspace-root=false --omit=dev --ignore-scripts \
  && npm cache clean --force
COPY --from=build /app/apps/backend/dist apps/backend/dist
COPY --from=web-build /app/apps/web/dist apps/web/dist
COPY apps/backend/drizzle apps/backend/drizzle
WORKDIR /app/apps/backend
# Almacenamiento local de documentos (montar un volumen persistente; en Railway usar Supabase Storage).
RUN mkdir -p /data/storage && chown node:node /data/storage
ENV STORAGE_LOCAL_DIR=/data/storage
USER node
EXPOSE 4000
# Por defecto arranca la API; el worker usa: node dist/worker.js
CMD ["node", "dist/server.js"]
