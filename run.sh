#!/usr/bin/env bash
# Launch the voice assistant server.
# CTranslate2 (faster-whisper) needs CUDA 12 cuBLAS/cuDNN, which are installed
# in the venv via pip (nvidia-cublas-cu12, nvidia-cudnn-cu12) — torch ships
# CUDA 13 copies that don't satisfy it, hence the explicit LD_LIBRARY_PATH.
cd "$(dirname "$0")"
SP=.venv/lib/python3.12/site-packages
export LD_LIBRARY_PATH="$PWD/$SP/nvidia/cublas/lib:$PWD/$SP/nvidia/cudnn/lib:${LD_LIBRARY_PATH:-}"
exec .venv/bin/python -m server.main
