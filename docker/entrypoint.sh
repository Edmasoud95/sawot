#!/bin/sh
# Start the speech sidecar and the backend; exit if either one dies so the
# container restarts cleanly.
set -e
cd /app
mkdir -p "${SAWOT_DATA_DIR:-/data}/data" "${SAWOT_DATA_DIR:-/data}/models"

python -m sidecar.main &
SIDECAR=$!
node ts-backend/dist/index.js &
BACKEND=$!

trap 'kill $SIDECAR $BACKEND 2>/dev/null; wait; exit 0' INT TERM

# Wait for whichever exits first, then take the other down.
while kill -0 $SIDECAR 2>/dev/null && kill -0 $BACKEND 2>/dev/null; do
  sleep 2
done
kill $SIDECAR $BACKEND 2>/dev/null || true
wait
exit 1
