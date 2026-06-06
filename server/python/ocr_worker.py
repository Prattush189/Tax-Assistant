#!/usr/bin/env python3
"""
PaddleOCR worker for scanned bank-statement PDFs.

Invoked by server/lib/paddleOcr.ts as a one-shot subprocess:
    python3 ocr_worker.py <path-to-pdf>

Reads the PDF, runs PaddleOCR page-by-page, prints a single JSON line
to stdout:

    {"pages": ["page-1 text\\n...", "page-2 text\\n...", ...]}

Non-zero exit codes signal hard failures; the Node wrapper translates
these into surfaced errors and may fall back to the Gemini Vision path.

Why this lives as a Python script:
  PaddleOCR is Python-only — no maintained Node binding. The Python
  startup tax (~1-2s for the import) is amortised across all pages of
  one statement, so single-shot invocation per upload is fine. A
  long-running OCR daemon would be faster but adds infra surface area
  we don't need at this scale.
"""
import sys
import json
import os


def emit_error(message: str, code: int) -> None:
    """Write JSON to stderr and exit non-zero so the Node wrapper sees a
    structured error rather than a bare crash."""
    print(json.dumps({"error": message}), file=sys.stderr)
    sys.exit(code)


def main() -> None:
    if len(sys.argv) < 2:
        emit_error("usage: ocr_worker.py <pdf-path>", 1)

    pdf_path = sys.argv[1]
    if not os.path.isfile(pdf_path):
        emit_error(f"file not found: {pdf_path}", 1)

    # Silence PaddleOCR's debug prints — they go to stdout by default
    # and would clobber our JSON output. show_log=False on the
    # constructor + LOG_LEVEL env both needed depending on version.
    os.environ.setdefault("PPOCR_LOG_LEVEL", "ERROR")
    os.environ.setdefault("FLAGS_logtostderr", "1")

    try:
        from paddleocr import PaddleOCR
    except ImportError as e:
        emit_error(
            f"PaddleOCR not installed: {e}. "
            f"Run: pip3 install paddlepaddle paddleocr",
            2,
        )

    # use_angle_cls=True handles slightly-rotated scans; lang='en'
    # covers Indian English bank statements. Hindi / Marathi could be
    # added per-bank later, but the printed transaction grid is always
    # English even on Hindi-titled forms.
    ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)

    try:
        # PaddleOCR.ocr() accepts a PDF path directly (since v2.6).
        # Returns: List[List[ [bbox, (text, confidence)] ]] — outer
        # list is per page, inner list is per detected line.
        results = ocr.ocr(pdf_path, cls=True)
    except Exception as e:  # noqa: BLE001 — surface any OCR-internal crash
        emit_error(f"OCR failed: {type(e).__name__}: {e}", 3)

    pages = []
    for page_result in results:
        if not page_result:
            pages.append("")
            continue

        # PaddleOCR returns lines in detection order, not reading
        # order. Group lines by Y-band (~15px) so words on the same
        # visual row stay together, then sort by X within each band.
        # 15px is empirical — tight enough that a 2-line transaction
        # narration splits cleanly, loose enough that anti-aliased
        # text on the same baseline doesn't fragment.
        def y_band(item):
            return round(item[0][0][1] / 15)

        sorted_items = sorted(page_result, key=lambda x: (y_band(x), x[0][0][0]))

        lines = []
        current_band = None
        buffer = []
        for item in sorted_items:
            band = y_band(item)
            text = item[1][0]
            if current_band is None or band == current_band:
                buffer.append(text)
                current_band = band
            else:
                lines.append(" ".join(buffer))
                buffer = [text]
                current_band = band
        if buffer:
            lines.append(" ".join(buffer))

        pages.append("\n".join(lines))

    # Single-line JSON so the Node wrapper can parse without worrying
    # about partial reads on the pipe buffer.
    sys.stdout.write(json.dumps({"pages": pages}))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
