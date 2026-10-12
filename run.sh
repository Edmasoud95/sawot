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
  [ -z "${RUNNER_PID:-}" ] || kill "$RUNNER_PID" 2>/dev/null || true
  [ -z "${BACKEND_PID:-}" ] || kill "$BACKEND_PID" 2>/dev/null || true
  kill "$SIDECAR_PID" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Launch the app first. The runner helper waits for its health endpoint.
SAWOT_SIDECAR_PID="$SIDECAR_PID" node ts-backend/dist/index.js &
BACKEND_PID=$!

# Preserve terminal access for an optional sudo prompt without blocking the app.
if [ -t 0 ]; then
  node scripts/start-runner.mjs --wait-for-app "$BACKEND_PID" < /dev/tty &
else
  node scripts/start-runner.mjs --wait-for-app "$BACKEND_PID" &
fi
RUNNER_PID=$!
wait "$BACKEND_PID"
