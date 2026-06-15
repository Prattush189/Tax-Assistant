#!/bin/bash
# scripts/install-docling.sh
#
# One-time Docling setup for the VPS. Run as root.
#
# What it does:
#   1. Installs python3 + pip3 if missing
#   2. pip-installs docling (pulls layout + TableFormer models' deps)
#   3. Optionally installs an alternate OCR backend (RapidOCR is fastest
#      on CPU; Tesseract is lightest). EasyOCR is Docling's default.
#   4. Triggers a first-run model download so the next upload doesn't
#      pay the cold-start cost
#   5. Health-checks the import
#
# Idempotent — safe to re-run.
#
# OCR backend choice (set DOCLING_OCR_ENGINE in the app env to match):
#   - (default)  EasyOCR — installed with docling; needs torch (CPU OK).
#   - rapidocr   ONNX runtime, faster on CPU. This script installs it.
#   - tesseract  System binary; smallest footprint. Install separately:
#                apt-get install -y tesseract-ocr

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}=== Docling installer ===${NC}"

# 1. Python
if ! command -v python3 >/dev/null 2>&1; then
  echo "Installing python3..."
  apt-get update
  apt-get install -y python3 python3-pip
else
  echo "✓ python3 already installed: $(python3 --version)"
fi
if ! command -v pip3 >/dev/null 2>&1; then
  apt-get install -y python3-pip
fi

PIP_FLAGS=""
if pip3 --help | grep -q -- '--break-system-packages'; then
  PIP_FLAGS="--break-system-packages"
fi

# 2. Docling
echo "Installing docling (this pulls in torch + model deps, ~1-2 GB)..."
pip3 install $PIP_FLAGS docling

# 3. Optional faster CPU OCR backend
echo "Installing RapidOCR (ONNX) for faster CPU OCR — optional but recommended..."
pip3 install $PIP_FLAGS rapidocr_onnxruntime || {
  echo -e "${YELLOW}RapidOCR install failed — Docling will use its default EasyOCR backend.${NC}"
}

# 4. Warm-up: trigger first-run model download
echo "Warming up — downloading Docling layout + table models..."
python3 - <<'PYEOF'
from docling.document_converter import DocumentConverter
# Constructing the converter triggers model resolution/download.
DocumentConverter()
print('docling models warm')
PYEOF

# 5. Health check
echo -e "${GREEN}=== Verifying installation ===${NC}"
python3 -c "import docling; print('Docling importable')" && \
  echo -e "${GREEN}✓ Docling ready${NC}" || \
  { echo -e "${RED}✗ Docling import failed${NC}"; exit 1; }

echo ""
echo -e "${GREEN}Setup complete.${NC}"
echo ""
echo "Enable Docling as the primary OCR engine (it's the default; set to"
echo "'paddle' to force the old path):"
echo "  OCR_ENGINE=docling pm2 restart tax-assistant"
echo ""
echo "To use the faster CPU OCR backend:"
echo "  DOCLING_OCR_ENGINE=rapidocr pm2 restart tax-assistant"
echo ""
echo "Override the Python binary if needed:"
echo "  DOCLING_PYTHON=/path/to/python3 pm2 restart tax-assistant"
