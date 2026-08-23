#!/usr/bin/env bash
# Run only the Python inference sidecar (STT + TTS + model manager).
cd "$(dirname "$0")"
SP="$(.venv/bin/python -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
export LD_LIBRARY_PATH="$SP/nvidia/cublas/lib:$SP/nvidia/cudnn/lib:${LD_LIBRARY_PATH:-}"
exec .venv/bin/python -m sidecar.main
