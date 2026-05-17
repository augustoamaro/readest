#!/usr/bin/env bash
set -e

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SVC="$REPO/local-services/ctranslate2"
NV="$SVC/.venv/lib/python3.10/site-packages/nvidia"

export LD_LIBRARY_PATH="$NV/cublas/lib:$NV/cudnn/lib:$NV/cuda_nvrtc/lib:$LD_LIBRARY_PATH"

"$SVC/.venv/bin/python" \
  "$SVC/server.py" \
  --model-path "$HOME/Models/nllb-200-distilled-600M-ct2" \
  --tokenizer facebook/nllb-200-distilled-600M \
  --device cuda
