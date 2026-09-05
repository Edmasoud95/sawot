#!/usr/bin/env bash
# Launch SAWOT: Python inference sidecar + TypeScript backend.
set -e
cd "$(dirname "$0")"

# Build the TypeScript backend and frontend if not already built.
[ -d ts-backend/dist ] || (cd ts-backend && npm install && npm run build)
[ -d web/dist ] || (cd web && npm install && npm run build)

# Start the Python inference sidecar (STT/TTS) in the background.
.venv/bin/python -m sidecar.main &
SIDECAR_PID=$!

cleanup() {
  kill "$SIDECAR_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Run the TypeScript backend in the foreground.
node ts-backend/dist/index.js
