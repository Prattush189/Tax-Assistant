#!/usr/bin/env python3
"""
Docling worker for scanned bank-statement PDFs.

Invoked by server/lib/docling.ts as a one-shot subprocess:
    python3 docling_worker.py <path-to-pdf> <path-to-output-json>

Why Docling (vs the PaddleOCR + Gemini-structurer path):
  Docling's TableFormer reconstructs the statement TABLE — actual cells,
  with the Withdrawal / Deposit / Balance columns kept distinct and
  wrapped UPI narrations held in one cell. That lets us read direction
  from the column DETERMINISTICALLY and skip the LLM structurer entirely
  (no per-statement Gemini cost, no row-dropping under output pressure).
  It also runs on CPU — important since the deploy box has no GPU.

Output JSON (written to the second-arg path, NOT stdout, because Docling
and its model deps print progress to stdout and would clobber the JSON):

    {"transactions": [
        {"date": "YYYY-MM-DD"|null, "narration": "...",
         "type": "credit"|"debit", "amount": <number|null>,
         "balance": <number|null>},
        ...
     ],
     "page_count": <int>,
     "markdown": "<full doc markdown>"}     # for the date-line yield
                                            # estimate + a structurer fallback

`amount` is an UNSIGNED magnitude; `type` carries direction. The Node
side signs it and the route's deriveAmountsFromBalance cross-checks the
magnitude against the running-balance delta (the same safety net the
PaddleOCR path uses). `markdown` is kept so callers can fall back to the
Gemini structurer when Docling finds no parseable transaction table.

Non-zero exit codes signal hard failures; the Node wrapper translates
these into surfaced errors and falls back to the PaddleOCR / vision path.
"""
from __future__ import annotations  # PEP 604 `str | None` hints on py3.9

import sys
import json
import os
import re
from datetime import datetime


def emit_error(message: str, code: int) -> None:
    print(json.dumps({"error": message}), file=sys.stderr)
    sys.exit(code)


def to_iso(value) -> str | None:
    """Best-effort bank-date → ISO YYYY-MM-DD. Returns None when the cell
    isn't a date (header / total / blank), which is also how we filter
    non-transaction rows out of the table."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    for fmt in (
        "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y",
        "%d-%m-%y", "%d/%m/%y",
        "%d-%b-%Y", "%d-%b-%y", "%d %b %Y", "%d %b, %Y",
        "%d-%B-%Y", "%d %B %Y",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def to_num(value):
    """Parse an Indian-format money cell. Handles commas, ₹, trailing
    Cr/Dr suffix, and (parentheses) negatives. Returns float or None."""
    if value is None:
        return None
    t = str(value).strip()
    if not t or t.lower() in ("nan", "none"):
        return None
    neg = t.startswith("(") and t.endswith(")")
    cleaned = re.sub(r"[^\d.\-]", "", t)
    if cleaned in ("", "-", ".", "--"):
        return None
    try:
        v = float(cleaned)
    except ValueError:
        return None
    return -abs(v) if neg else v


def find_col(headers, *keys) -> int:
    for i, h in enumerate(headers):
        hl = str(h).lower()
        if any(k in hl for k in keys):
            return i
    return -1


def rows_from_table(df, state) -> list:
    """Map one Docling table (a pandas DataFrame) to transaction rows.
    Returns [] when the table doesn't look like a statement (no date /
    balance header) so non-transaction tables are skipped.

    `state` carries cross-table context + diagnostics:
      - state['last_date']: the most recent parsed date, carried forward
        onto rows whose own date cell is blank — Indian statements print
        the date once per day and leave continuation rows blank, so a
        strict "needs a date" filter silently drops whole same-date
        clusters (observed: 74 rows lost on a 21-page ICICI scan).
      - state['stats']: raw/kept/drop-reason tallies, emitted to stderr so
        we can tell a TableFormer miss (Docling never produced the row)
        from a filter drop (we discarded it) without re-running blind."""
    st = state['stats']
    headers = [str(c) for c in df.columns]
    st['tables'].append(headers)
    date_i = find_col(headers, "date")
    bal_i = find_col(headers, "balance", "closing bal")
    if date_i < 0 or bal_i < 0:
        st['skipped_tables'] += 1
        return []
    narr_i = find_col(headers, "particular", "narration", "description", "details", "remarks", "transaction")
    wd_i = find_col(headers, "withdraw", "debit", "dr ", "(dr", "dr)", "paid")
    dep_i = find_col(headers, "deposit", "credit", "cr ", "(cr", "cr)", "received")
    amt_i = find_col(headers, "amount")
    drcr_i = find_col(headers, "dr/cr", "cr/dr", "type", "indicator")

    out = []
    for _, r in df.iterrows():
        cells = [("" if v is None else str(v)) for v in list(r)]
        if not any(c.strip() for c in cells):
            continue  # wholly blank row
        st['raw'] += 1

        def cell(i):
            return cells[i] if 0 <= i < len(cells) else ""

        date_iso = to_iso(cell(date_i))
        bal = to_num(cell(bal_i))

        wd = to_num(cell(wd_i)) if wd_i >= 0 else None
        dep = to_num(cell(dep_i)) if dep_i >= 0 else None
        amt = to_num(cell(amt_i)) if amt_i >= 0 else None

        if wd not in (None, 0):
            typ, mag = "debit", abs(wd)
        elif dep not in (None, 0):
            typ, mag = "credit", abs(dep)
        elif amt is not None and amt != 0:
            ind = cell(drcr_i).lower()
            if "cr" in ind:
                typ, mag = "credit", abs(amt)
            elif "dr" in ind:
                typ, mag = "debit", abs(amt)
            else:
                typ, mag = ("credit" if amt >= 0 else "debit"), abs(amt)
        else:
            # No amount: header repeat / total / B/F stub. Drop, but don't
            # let it reset the carried date.
            st['drop_no_amount'] += 1
            if len(st['samples']) < 12:
                st['samples'].append("no_amount: " + " | ".join(c[:18] for c in cells))
            continue

        if not date_iso:
            # Date cell blank but this row HAS a real amount → it's a
            # same-date continuation row. Carry the last date forward
            # rather than dropping a genuine transaction.
            if state['last_date'] and bal is not None:
                date_iso = state['last_date']
                st['carried_date'] += 1
            else:
                st['drop_no_date'] += 1
                if len(st['samples']) < 12:
                    st['samples'].append("no_date: " + " | ".join(c[:18] for c in cells))
                continue
        else:
            state['last_date'] = date_iso

        out.append({
            "date": date_iso,
            "narration": re.sub(r"\s+", " ", cell(narr_i)).strip(),
            "type": typ,
            "amount": mag,
            "balance": bal,
        })
        st['kept'] += 1
    return out


def main() -> None:
    if len(sys.argv) < 3:
        emit_error("usage: docling_worker.py <pdf-path> <output-json-path>", 1)
    pdf_path = sys.argv[1]
    output_path = sys.argv[2]
    if not os.path.isfile(pdf_path):
        emit_error(f"file not found: {pdf_path}", 1)

    try:
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
    except ImportError as e:
        emit_error(
            f"Docling not installed: {e}. Run: pip3 install docling  "
            f"(see scripts/install-docling.sh)",
            2,
        )

    pipeline_options = PdfPipelineOptions()
    # Scanned statement: force OCR + table structure. cell-matching ties
    # OCR'd text back to TableFormer's detected cell grid so numbers land
    # in the right column.
    pipeline_options.do_ocr = True
    pipeline_options.do_table_structure = True
    pipeline_options.table_structure_options.do_cell_matching = True
    # A scanned PDF may carry a junk/partial text layer; force full-page
    # OCR so we don't trust it.
    try:
        pipeline_options.ocr_options.force_full_page_ocr = True
    except Exception:  # noqa: BLE001 — older docling without the flag
        pass

    # Optional OCR-engine override. EasyOCR is Docling's default; RapidOCR
    # (ONNX) is faster on CPU. Set DOCLING_OCR_ENGINE=rapidocr|tesseract.
    engine = os.environ.get("DOCLING_OCR_ENGINE", "").lower()
    try:
        if engine == "rapidocr":
            from docling.datamodel.pipeline_options import RapidOcrOptions
            pipeline_options.ocr_options = RapidOcrOptions(force_full_page_ocr=True)
        elif engine in ("tesseract", "tesseract_cli"):
            from docling.datamodel.pipeline_options import TesseractCliOcrOptions
            pipeline_options.ocr_options = TesseractCliOcrOptions(force_full_page_ocr=True)
    except Exception as e:  # noqa: BLE001
        emit_error(f"Docling OCR engine '{engine}' unavailable: {e}", 2)

    try:
        converter = DocumentConverter(
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)}
        )
    except Exception as e:  # noqa: BLE001
        emit_error(f"Docling converter init failed: {type(e).__name__}: {e}", 3)

    try:
        result = converter.convert(pdf_path)
        doc = result.document
    except Exception as e:  # noqa: BLE001
        emit_error(f"Docling conversion failed: {type(e).__name__}: {e}", 3)

    transactions = []
    state = {
        "last_date": None,
        "stats": {
            "tables": [], "skipped_tables": 0, "raw": 0, "kept": 0,
            "carried_date": 0, "drop_no_amount": 0, "drop_no_date": 0,
            "frame_failed": 0, "samples": [],
        },
    }
    try:
        for table in (getattr(doc, "tables", None) or []):
            try:
                df = table.export_to_dataframe()
            except Exception:  # noqa: BLE001 — skip a table that won't frame
                state["stats"]["frame_failed"] += 1
                continue
            transactions.extend(rows_from_table(df, state))
    except Exception as e:  # noqa: BLE001
        emit_error(f"Docling table parse failed: {type(e).__name__}: {e}", 3)

    # Diagnostics to stderr (the Node wrapper logs this) — lets us tell a
    # TableFormer miss from a filter drop. raw≈expected but kept<raw means
    # our mapping is too strict; raw itself low means Docling lost the row.
    st = state["stats"]
    print(json.dumps({
        "diag": {
            "n_tables": len(st["tables"]), "skipped_tables": st["skipped_tables"],
            "frame_failed": st["frame_failed"], "raw_rows": st["raw"],
            "kept": st["kept"], "carried_date": st["carried_date"],
            "drop_no_amount": st["drop_no_amount"], "drop_no_date": st["drop_no_date"],
            "table_headers": st["tables"][:6], "drop_samples": st["samples"],
        }
    }), file=sys.stderr)

    try:
        markdown = doc.export_to_markdown()
    except Exception:  # noqa: BLE001
        markdown = ""

    try:
        page_count = doc.num_pages()
    except Exception:  # noqa: BLE001
        page_count = len(getattr(doc, "pages", {}) or {})

    tmp_out = output_path + ".tmp"
    with open(tmp_out, "w", encoding="utf-8") as fh:
        json.dump({
            "transactions": transactions,
            "page_count": page_count,
            "markdown": markdown,
        }, fh)
    os.replace(tmp_out, output_path)


if __name__ == "__main__":
    main()
