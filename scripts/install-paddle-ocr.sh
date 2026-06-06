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

# 3. PaddleOCR (pinned to the stable 2.x combo)
#
# Why pinned: paddlepaddle 3.x + paddleocr 3.x crash on certain model
# attribute types during model load with a PIR (Paddle IR) error:
#     NotImplementedError: ConvertPirAttribute2RuntimeAttribute not
#     support [pir::ArrayAttribute<pir::DoubleAttribute>]
# This is unfinished migration code in the 3.x stack. The 2.6.2 +
# 2.7.3 combo predates PIR and runs cleanly on the same CPU-only path.
# Revisit when paddlepaddle 3.4+ ships the missing PIR attribute
# converters.
#
# Uninstall any previously-installed 3.x version first so we don't
# end up with two paddlepaddle/paddleocr installs racing each other.
PIP_FLAGS=""
if pip3 --help | grep -q -- '--break-system-packages'; then
  PIP_FLAGS="--break-system-packages"
fi
echo "Removing any prior paddlepaddle / paddleocr install..."
pip3 uninstall -y $PIP_FLAGS paddlepaddle paddleocr paddlex 2>/dev/null || true
echo "Installing paddlepaddle 2.6.2 + paddleocr 2.7.3 (~500 MB, may take a few minutes)..."
pip3 install $PIP_FLAGS "paddlepaddle==2.6.2" "paddleocr==2.7.3"

# 4. Warm-up: trigger first-run model download
echo "Warming up — downloading OCR model weights (~250 MB)..."
python3 - <<'PYEOF'
import os
os.environ['PPOCR_LOG_LEVEL'] = 'ERROR'
os.environ['FLAGS_enable_pir_api'] = '0'
os.environ['FLAGS_enable_pir_in_executor'] = '0'
from paddleocr import PaddleOCR
# paddleocr 2.7.3 uses use_angle_cls + show_log (2.x API).
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
