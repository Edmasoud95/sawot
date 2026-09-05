#!/usr/bin/env bash
# Run only the Python inference sidecar (STT + TTS + model manager).
cd "$(dirname "$0")"
exec .venv/bin/python -m sidecar.main
