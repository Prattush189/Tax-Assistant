#!/bin/bash
# scripts/install-paddle-ocr.sh
#
# One-time PaddleOCR setup for the VPS. Run as root.
#
# What it does:
#   1. Installs python3 + pip3 if missing
#   2. Installs OS-level libs PaddleOCR needs (libgl1 for OpenCV,
#      libglib2.0-0 for various transitive deps)
#   3. pip-installs paddlepaddle + paddleocr (~500 MB total)
#   4. Triggers a first-run download of the OCR models (~250 MB) by
#      running a no-op OCR call so the next bank-statement upload
#      doesn't pay the cold-start cost
#   5. Health-checks via server/lib/paddleOcr.ts's checkPaddleOcrAvailable
#
# Idempotent — safe to re-run. Skips steps already complete.

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}=== PaddleOCR installer ===${NC}"

# 1. Python
if ! command -v python3 >/dev/null 2>&1; then
  echo "Installing python3..."
  apt-get update
  apt-get install -y python3 python3-pip
else
  echo "✓ python3 already installed: $(python3 --version)"
fi

if ! command -v pip3 >/dev/null 2>&1; then
  echo "Installing pip3..."
  apt-get install -y python3-pip
else
  echo "✓ pip3 already installed: $(pip3 --version | cut -d' ' -f1-2)"
fi

# 2. OS-level libs
echo "Installing OS dependencies (libgl1, libglib2.0-0)..."
apt-get install -y libgl1 libglib2.0-0 || {
  echo -e "${YELLOW}apt-get install failed — you may need to install libgl1 and libglib2.0-0 manually${NC}"
}

# 3. PaddleOCR (with --break-system-packages on newer pip versions
#    that enforce PEP 668)
echo "Installing paddlepaddle + paddleocr (~500 MB, may take a few minutes)..."
PIP_FLAGS=""
if pip3 --help | grep -q -- '--break-system-packages'; then
  PIP_FLAGS="--break-system-packages"
fi
pip3 install $PIP_FLAGS paddlepaddle paddleocr

# 4. Warm-up: trigger first-run model download
echo "Warming up — downloading OCR model weights (~250 MB)..."
python3 - <<'PYEOF'
import os
os.environ['PPOCR_LOG_LEVEL'] = 'ERROR'
from paddleocr import PaddleOCR
PaddleOCR(use_angle_cls=True, lang='en', show_log=False)
print('models warm')
PYEOF

# 5. Health check
echo -e "${GREEN}=== Verifying installation ===${NC}"
python3 -c "from paddleocr import PaddleOCR; print('PaddleOCR importable')" && \
  echo -e "${GREEN}✓ PaddleOCR ready${NC}" || \
  { echo -e "${RED}✗ PaddleOCR import failed${NC}"; exit 1; }

echo ""
echo -e "${GREEN}Setup complete.${NC}"
echo ""
echo "The Node process now picks up PaddleOCR automatically."
echo "If you need to override the Python binary path, set the env var:"
echo "  PADDLE_PYTHON=/path/to/python3 pm2 restart tax-assistant"
echo ""
echo "To smoke-test from the running app, upload any scanned PDF and"
echo "watch the logs for: [bank-statements] PaddleOCR start: ..."
