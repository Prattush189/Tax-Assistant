#!/usr/bin/env python3
"""
PaddleOCR worker for scanned bank-statement PDFs.

Invoked by server/lib/paddleOcr.ts as a one-shot subprocess:
    python3 ocr_worker.py <path-to-pdf> <path-to-output-json>

Reads the PDF, runs PaddleOCR page-by-page, writes a JSON file at the
second-argument path:

    {"pages": [
        {"text": "page-1 text\\n...",       # joined text (structurer fallback)
         "width": 1654, "height": 2339,     # page pixel dims (for y-offset)
         "items": [{"text": "...", "x": .., "y": .., "w": ..}, ...]},
        ...
    ]}

`items` are positioned tokens (top-left x/y + width) the TS side
clusters into a 2D grid — letting a scanned statement of a known bank
auto-map deterministically and skip the LLM structurer. `text` is kept
so the structurer can still run on unknown-format scans.

Output goes to a sidecar file (not stdout) because PaddleOCR 2.7.3 and
its transitive deps (paddlepaddle, opencv, fire) print log lines /
download progress / Paddle warnings to stdout during init and inference.
That would contaminate the JSON and trip the Node wrapper's parser.
Using a tempfile path makes the worker immune to whatever PaddleOCR
chooses to print.

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
    if len(sys.argv) < 3:
        emit_error("usage: ocr_worker.py <pdf-path> <output-json-path>", 1)

    pdf_path = sys.argv[1]
    output_path = sys.argv[2]
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

    # PaddleOCR 2.7.3's `ocr.ocr(pdf_path)` returns a list of ONE page
    # result on multi-page PDFs — page 1 only — silently dropping
    # every subsequent page. Production log on 2026-06-06: a 28-page
    # J&K Bank statement returned only 21 transactions (page 1) of
    # ~500. The fix is to rasterize the PDF page-by-page in Python
    # ourselves and feed each page IMAGE to OCR. That guarantees
    # every page is processed regardless of which PaddleOCR build
    # is installed.
    #
    # We use pdf2image (Python binding to Poppler's pdftoppm) — a
    # peer of the `pdftotext` binary already on the VPS, so no
    # additional system package needed beyond `poppler-utils` which
    # the install script ensures is present.
    try:
        from pdf2image import convert_from_path
    except ImportError as e:
        emit_error(
            f"pdf2image not installed: {e}. "
            f"Run: pip3 install pdf2image  (and apt-get install poppler-utils)",
            2,
        )

    # 200 DPI is the sweet spot for printed bank-statement scans:
    # high enough that PaddleOCR's recogniser reads digits cleanly,
    # low enough that a 50-page PDF doesn't OOM at ~25 MB per image.
    # `fmt='png'` keeps it lossless (JPEG artefacts blur digit
    # separators on dense layouts and cause `1` ↔ `7` confusion).
    try:
        page_images = convert_from_path(pdf_path, dpi=200, fmt="png")
    except Exception as e:  # noqa: BLE001
        emit_error(f"PDF rasterization failed: {type(e).__name__}: {e}. Is poppler-utils installed?", 3)

    # OCR each page in sequence. We deliberately don't parallelise —
    # PaddleOCR holds shared model state that isn't thread-safe in
    # 2.7.3, and the bottleneck is the recogniser inference (CPU
    # bound, would just contend on cores anyway). Sequential is the
    # safe, predictable path.
    import numpy as np  # local import — heavy, only needed here

    results = []
    for page_img in page_images:
        # PaddleOCR accepts a numpy array (HxWx3 uint8 RGB). PIL's
        # Image.convert('RGB') guarantees the right shape regardless
        # of source colourspace.
        arr = np.array(page_img.convert("RGB"))
        try:
            if hasattr(ocr, "predict"):
                # 3.x style
                try:
                    page_res = ocr.predict(input=arr)
                except TypeError:
                    page_res = ocr.predict(arr)
            else:
                # 2.x style
                page_res = ocr.ocr(arr, cls=True)
        except Exception as e:  # noqa: BLE001
            emit_error(f"OCR failed on a page: {type(e).__name__}: {e}", 3)
        # `ocr.ocr()` returns [page_result] (a one-element wrapper
        # list) when called on a single image. Unwrap so the loop
        # below sees a flat list of page_results across all pages.
        if isinstance(page_res, list) and len(page_res) == 1:
            results.append(page_res[0])
        else:
            results.append(page_res)

    pages = []
    for page_idx, page_result in enumerate(results):
        # Page pixel dimensions — needed so the TS side can offset each
        # page's y into one continuous axis (mirrors extractPdfGrid's
        # Phase 1) before feeding buildGridFromItems.
        try:
            page_w = int(page_images[page_idx].width)
            page_h = int(page_images[page_idx].height)
        except Exception:  # noqa: BLE001
            page_w, page_h = 0, 0

        if not page_result:
            pages.append({"text": "", "width": page_w, "height": page_h, "items": []})
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
            pages.append({"text": "", "width": page_w, "height": page_h, "items": []})
            continue

        def y_of(bbox):
            # bbox[0] is the first point [x, y].
            return bbox[0][1]

        def x_of(bbox):
            return bbox[0][0]

        def w_of(bbox):
            # 4-point quad [TL, TR, BR, BL]; width = TR.x - TL.x.
            try:
                return float(bbox[1][0]) - float(bbox[0][0])
            except Exception:  # noqa: BLE001
                return 0.0

        # Positioned items for the grid engine. Each carries its own
        # top-left x/y and width — the TS side clusters these into a
        # 2D grid exactly like the digital-PDF path, so a scanned
        # statement of a known bank can auto-map deterministically
        # instead of paying for the LLM structurer.
        out_items = []
        for bbox, text in items:
            if not text or not text.strip():
                continue
            out_items.append({
                "text": text,
                "x": round(float(x_of(bbox)), 2),
                "y": round(float(y_of(bbox)), 2),
                "w": round(w_of(bbox), 2),
            })

        # Group lines by Y-band (~15px) for the joined `text` blob —
        # still emitted because the LLM structurer fallback consumes it
        # when the grid path can't auto-map (unknown bank format).
        # 15px is empirical: tight enough that a 2-line narration splits
        # cleanly, loose enough that same-baseline anti-aliased text
        # doesn't fragment.
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

        pages.append({
            "text": "\n".join(lines),
            "width": page_w,
            "height": page_h,
            "items": out_items,
        })

    # Write to the sidecar file the Node wrapper passes in. Avoids
    # contamination from any PaddleOCR / paddlepaddle / opencv chatter
    # on stdout. Atomic-ish: write to <path>.tmp then rename so a
    # crash mid-write doesn't leave a half-truncated file the wrapper
    # would JSON.parse on.
    tmp_out = output_path + ".tmp"
    with open(tmp_out, "w", encoding="utf-8") as fh:
        json.dump({"pages": pages}, fh)
    os.replace(tmp_out, output_path)


if __name__ == "__main__":
    main()
