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
    # Disable Paddle's new PIR loader on paddlepaddle 3.x — at 3.3 it
    # still has unfinished ConvertPirAttribute paths that crash on
    # certain model attribute types (ArrayAttribute<DoubleAttribute>
    # in the angle-classifier model). Setting these env vars BEFORE
    # `import paddle` (transitively, via paddleocr) forces the
    # legacy / IR-free loader path, which works on every 2.6+ build.
    os.environ.setdefault("FLAGS_enable_pir_api", "0")
    os.environ.setdefault("FLAGS_enable_pir_in_executor", "0")

    try:
        from paddleocr import PaddleOCR
    except ImportError as e:
        emit_error(
            f"PaddleOCR not installed: {e}. "
            f"Run: pip3 install paddlepaddle paddleocr",
            2,
        )

    # Construct PaddleOCR with the right kwargs for the installed
    # major version. 3.x renamed use_angle_cls → use_textline_orientation
    # and dropped show_log. 2.x has neither rename and accepts show_log.
    # Try the 3.x form first; on TypeError (unknown kwarg) fall back to
    # the 2.x form.
    try:
        ocr = PaddleOCR(use_textline_orientation=True, lang="en")
    except TypeError:
        ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)

    try:
        # PaddleOCR 3.x renamed the entry point to .predict(); 2.x
        # used .ocr(cls=True). Try the new name first, fall back.
        if hasattr(ocr, "predict"):
            try:
                results = ocr.predict(input=pdf_path)
            except TypeError:
                # Some 3.x builds expect positional arg, not input=.
                results = ocr.predict(pdf_path)
        else:
            results = ocr.ocr(pdf_path, cls=True)
    except Exception as e:  # noqa: BLE001 — surface any OCR-internal crash
        emit_error(f"OCR failed: {type(e).__name__}: {e}", 3)

    pages = []
    for page_result in results:
        if not page_result:
            pages.append("")
            continue

        # Normalise across PaddleOCR major-version output formats:
        #
        #   2.x: list of [bbox, (text, confidence)]
        #        page_result[i] = [ [[x1,y1],[x2,y2],[x3,y3],[x4,y4]], (text, conf) ]
        #
        #   3.x: dict with parallel arrays
        #        page_result = { 'rec_texts': [...], 'rec_polys': [...],
        #                        'rec_scores': [...], ... }
        #
        # Build a unified `items = [(bbox, text), ...]` list either way.
        items = []
        if isinstance(page_result, dict):
            texts = page_result.get("rec_texts", []) or []
            polys = page_result.get("rec_polys", []) or []
            for text, poly in zip(texts, polys):
                # rec_polys entries are 4-point quads; treat the first
                # point as the top-left anchor for sorting (good enough
                # for axis-aligned printed text).
                if poly is None or len(poly) == 0:
                    continue
                bbox = poly  # poly is already a list of 4 points
                items.append((bbox, text))
        else:
            for entry in page_result:
                try:
                    bbox, (text, _conf) = entry[0], entry[1]
                except (TypeError, ValueError, IndexError):
                    continue
                items.append((bbox, text))

        if not items:
            pages.append("")
            continue

        # Group lines by Y-band (~15px) so words on the same visual
        # row stay together, then sort by X within each band. 15px is
        # empirical — tight enough that a 2-line transaction narration
        # splits cleanly, loose enough that anti-aliased text on the
        # same baseline doesn't fragment.
        def y_of(bbox):
            # bbox[0] is the first point [x, y].
            return bbox[0][1]

        def x_of(bbox):
            return bbox[0][0]

        def y_band(bbox):
            return round(y_of(bbox) / 15)

        items.sort(key=lambda it: (y_band(it[0]), x_of(it[0])))

        lines = []
        current_band = None
        buffer = []
        for bbox, text in items:
            band = y_band(bbox)
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
