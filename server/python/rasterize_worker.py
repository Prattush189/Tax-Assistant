#!/usr/bin/env python3
"""
Downsampling rasterizer for the Gemini Vision fallback path.

Invoked by server/lib/rasterizePdf.ts as a one-shot subprocess:
    python3 rasterize_worker.py <input-path> <output-json-path> <max-px>

Renders each page of a PDF (or a single image file) to a JPEG whose
longest side is <= <max-px>, writes the JPEGs to sidecar files, and
emits their paths as JSON to the output file:

    {"images": ["/tmp/.../p0.jpg", "/tmp/.../p1.jpg", ...]}

Why this exists — token cost:
    Gemini processes PDF/image input AS IMAGES: each page is scaled up
    to at most 3072x3072 and tiled into 768x768 tiles at 258 tokens per
    tile, so a full-resolution dense A4 page costs ~3,000-4,100 input
    tokens. Sending the raw upload to vision (what the route did when
    PaddleOCR failed/timed out) is why some statements burned ~2M
    tokens. Pre-downsampling so the longest side is ~1200px collapses a
    page to ~4 tiles (~1,000 tokens) — a 3-4x input-token cut — while
    keeping printed digits legible.

Deliberately does NOT import paddleocr/paddle (heavy, ~1-2s + RAM). It
only needs pdf2image (already installed for the OCR path) and Pillow
(a pdf2image dependency), so no new packages.

Output goes to a sidecar file (not stdout) so any pdf2image / Pillow
chatter can't contaminate the JSON the Node wrapper parses.
"""
import sys
import json
import os


def emit_error(message: str, code: int) -> None:
    print(json.dumps({"error": message}), file=sys.stderr)
    sys.exit(code)


def main() -> None:
    if len(sys.argv) < 4:
        emit_error("usage: rasterize_worker.py <input-path> <output-json-path> <max-px>", 1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    try:
        max_px = max(256, int(sys.argv[3]))
    except ValueError:
        max_px = 1200

    if not os.path.isfile(input_path):
        emit_error(f"file not found: {input_path}", 1)

    out_dir = os.path.dirname(output_path)
    stem = os.path.splitext(os.path.basename(output_path))[0]

    try:
        from PIL import Image
    except ImportError as e:
        emit_error(f"Pillow not installed: {e}. Run: pip3 install pillow", 2)

    def downscale_and_save(img: "Image.Image", idx: int) -> str:
        # Flatten to RGB (JPEG has no alpha) and shrink so the longest
        # side == max_px. thumbnail() only ever downsizes (never upscales
        # a small page, which would just add tokens for no legibility).
        rgb = img.convert("RGB")
        rgb.thumbnail((max_px, max_px), Image.LANCZOS)
        path = os.path.join(out_dir, f"{stem}-p{idx}.jpg")
        # quality 80 is the digit-legibility floor: high enough that the
        # '1' vs '7' and thousands-separator gaps stay crisp, low enough
        # to keep the request payload small.
        rgb.save(path, "JPEG", quality=80)
        return path

    images = []
    lower = input_path.lower()
    if lower.endswith(".pdf"):
        try:
            from pdf2image import convert_from_path
        except ImportError as e:
            emit_error(
                f"pdf2image not installed: {e}. "
                f"Run: pip3 install pdf2image  (and apt-get install poppler-utils)",
                2,
            )
        # Rasterize near the target so we don't render huge bitmaps only
        # to shrink them. 150 DPI ~ 1240px wide for A4 portrait, a touch
        # above max_px=1200 so the thumbnail step still governs the final
        # size deterministically regardless of page geometry.
        try:
            pages = convert_from_path(input_path, dpi=150, fmt="png")
        except Exception as e:  # noqa: BLE001
            emit_error(f"PDF rasterization failed: {type(e).__name__}: {e}. Is poppler-utils installed?", 3)
        for i, page in enumerate(pages):
            images.append(downscale_and_save(page, i))
    else:
        try:
            img = Image.open(input_path)
        except Exception as e:  # noqa: BLE001
            emit_error(f"image open failed: {type(e).__name__}: {e}", 3)
        images.append(downscale_and_save(img, 0))

    tmp_out = output_path + ".tmp"
    with open(tmp_out, "w", encoding="utf-8") as fh:
        json.dump({"images": images}, fh)
    os.replace(tmp_out, output_path)


if __name__ == "__main__":
    main()
