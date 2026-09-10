# SAWOT — single CPU-only image running the Python speech sidecar and the
# TypeScript backend together. Models, settings and chat history live under
# /data (mount a volume there). See docker-compose.yml for the usual setup.

# --- frontend ---------------------------------------------------------------
FROM node:22-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY web ./
RUN npm run build

# --- backend ----------------------------------------------------------------
FROM node:22-slim AS backend
WORKDIR /src/ts-backend
COPY ts-backend/package.json ts-backend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY ts-backend ./
RUN npm run build && npm prune --omit=dev

# --- runtime ----------------------------------------------------------------
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SAWOT_DATA_DIR=/data \
    HF_HOME=/data/hf-cache \
    LM_STUDIO_URL=http://host.docker.internal:1234/v1 \
    SERVER_HOST=0.0.0.0 \
    SERVER_PORT=8765

RUN apt-get update \
 && apt-get install -y --no-install-recommends espeak-ng ffmpeg libsndfile1 curl \
 && rm -rf /var/lib/apt/lists/*

# Node runtime for the backend (the binary alone is enough).
COPY --from=backend /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
# CPU torch first so the requirements resolve against it instead of pulling
# the multi-gigabyte CUDA build.
COPY requirements.txt ./
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r requirements.txt \
 && python -m spacy download en_core_web_sm

COPY server ./server
COPY sidecar ./sidecar
COPY --from=backend /src/ts-backend/dist ./ts-backend/dist
COPY --from=backend /src/ts-backend/node_modules ./ts-backend/node_modules
COPY --from=backend /src/ts-backend/package.json ./ts-backend/package.json
COPY --from=web /src/web/dist ./web/dist
COPY docker/entrypoint.sh /usr/local/bin/sawot
RUN chmod +x /usr/local/bin/sawot && mkdir -p /data

VOLUME ["/data"]
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s \
  CMD curl -fsS http://127.0.0.1:${SERVER_PORT}/health || exit 1
CMD ["sawot"]
