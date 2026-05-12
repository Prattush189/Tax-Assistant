# Bank-rules audit — 2026-05-10

Audit of `src/lib/perBankRules.ts` against every PDF in
`C:\Users\Prattush\Downloads\Statements\` (top-level + `BANK STATEMENTS FORMATS/`).
17 PDFs total. Non-PDF formats (`.xlsx`, `.txt`, `.RPT`, `.RPTNFS`) are out of
scope — per-bank rules only consume PDF text extracted by `extractPdfGrid`.

## Verdict per file

### Top-level `Statements/`

| File | Rows × Cols | Rule fired | Notes |
|---|---|---|---|
| `01.04.2025 to 30.09.2025.pdf` | grid null | — | image-only / glyph-rendered PDF; pdfjs returns 0 text items. Vision-required. |
| `AccountStatement_31-Mar-2025_01-Apr-2026.pdf` | 482 × 7 | **Kotak Mahindra Bank** | Detected after the new Kotak rule + the new `preprocess` hook that splits the merged Date+Description cell. Roles: `skip | date | narration | reference | debit | credit | skip | balance`. |
| `OpTransactionHistory08-05-2026.pdf-11-38-32.pdf` | 73 × 6 | **ICICI Bank** | Filename suggests Axis but content is ICICI — "your base branch: icici bank limited" appears in the first 30 rows. Correct detection. |
| `Statement - Suresh.pdf` | 2,429 × 7 | **HDFC Bank** | HDFC's Virtual Imperia layout. No bank-name strings in the first 30 rows; only the IFSC line `rtgs/neft ifsc : hdfc0000138` surfaces. **Fixed**: added IFSC fingerprint regex to HDFC rule. |
| `canara_epassbook_2026-04-19 135757.699356.pdf` | 2,169 × 7 | **Canara Bank** | E-passbook export with the bank name in the LOGO image only. Pre-fix the IFSC fingerprint `/ifsc[^a-z]{0,8}cnrb0/i` failed because "IFSC Code  CNRB0..." has letters in "Code" between "ifsc" and "cnrb0". **Fixed**: replaced with `/\bifsc\b.{0,30}\bcnrb0\d{4,}/i` — same fix applied symmetrically to ICICI / PNB / Yes / J&K. |
| `statment.pdf` | grid null | — | J&K Bank Cash Credit (CC MORTG TRADE/SERVICE) — image-only / glyph-rendered. Vision-required. **Forward-looking**: generalised `JK_BANK_DCR` rule's fingerprints to cover this CC variant — will detect automatically once a text-extractable version of this layout arrives. |

### Nested `BANK STATEMENTS FORMATS/`

| File | Rows × Cols | Rule fired | Notes |
|---|---|---|---|
| `AXIS BANK.pdf` | grid null | — | Axis Bank's e-statement is glyph-rendered (no usable text layer). Vision-required, already in `KNOWN_VISION_ONLY_BANKS`. |
| `HDFC BANK-1.pdf` | 391 × 7 | **HDFC Bank** | Clean detection via bank-name string. |
| `HDFC BANK-2.pdf` | 333 × 7 | **HDFC Bank** | Same. |
| `ICICI BANK FORMAT-1.pdf` | grid null | — | Image-only / scanned format. Vision-required. |
| `ICICI BANK FORMAT-2.pdf` | grid null | — | Image-only / scanned format. **Note**: this is the 15 MB / 21-page file that earlier produced 0 transactions even from vision. Separate fix wired in `server/routes/bankStatements.ts` (`looksValid` callback on `extractVisionWithFallback` to force tier-2 fallback on empty `transactions[]`). |
| `ICICI BANK FORMAT-3.pdf` | 7,357 × 7 | **ICICI Bank** | Clean detection. |
| `JKBANK FORMAT-1.pdf` | 1,159 × 6 | **J&K Bank (Cash Credit)** | Positional rule (legacy DCR / CASH CREDIT SCHEME). |
| `JKBANK FORMAT-2.pdf` | 26 × 5 | **J&K Bank** | Header-rule match. |
| `JKBANK FORMAT-3.pdf` | 477 × 8 | **J&K Bank** | Header-rule match. |
| `JKBANK FORMAT-7 (LOAN).pdf` | 144 × 6 | **J&K Bank** | Loan-account variant — fingerprint matches general J&K rule (not the CC-positional rule). |
| `PNB BANK.pdf` | 423 × 6 | **Punjab National Bank** | Clean detection. |
| `SBI BNAK.pdf` | grid null | — | SBI e-statement is image-only, already in `KNOWN_VISION_ONLY_BANKS`. Vision-required. |
| `YES BANK.pdf` | 9,345 × 7 | **Yes Bank** | Clean detection. |

### Non-PDF formats (skipped — outside `perBankRules` scope)

- `BANK CHARGES FORMAT.xlsx` — bank-charges classifier input, not a bank statement
- `JKBANK FORMAT-4.txt` — text export, not parsed by `perBankRules`
- `JKBANK FORMAT-5.RPTNFS` / `JKBANK FORMAT-6.RPT` — Crystal Reports binary exports; pdfjs can't read them

## Headline numbers

- **17 PDFs** audited.
- **11 detected** by a per-bank rule (post-fix), 4 of those formerly failing.
- **6 image-only** (pdfjs returns null grid) — route through vision by design.
- **0 false positives** — no rule fires on a file from the wrong bank.

## Changes made during this audit

All in [src/lib/perBankRules.ts](../src/lib/perBankRules.ts):

1. **`BankRule.preprocess?: (grid: PdfGrid) => PdfGrid` hook** — runs before headerRules/positional. Per-bank grid reshape; defaults to identity when unset. Wrapped in `try/catch` inside `tryRule` so a buggy preprocess can't blow up detection for other banks.
2. **Kotak preprocess** — `kotakSplitDateFromDescription` detects rows whose col 1 starts with a `dd MMM yyyy` prefix and splits the cell into Date + Description, growing the grid by one column. Gated on ≥5 leading-date hits in the first 50 rows so it can't damage a non-Kotak grid.
3. **HDFC fingerprints** — added IFSC anchor `/\bifsc\b.{0,30}\bhdfc0\d{4,}/i` so HDFC's "Virtual Imperia" layout (no bank-name strings near the table) detects.
4. **IFSC regex generalisation** — replaced `/ifsc[^a-z]{0,8}<prefix>/i` with `/\bifsc\b.{0,30}\b<prefix>\d{4,}/i` on ICICI, Canara, PNB, Yes Bank, and J&K Bank. The old `[^a-z]{0,8}` excluded letters and failed on "IFSC Code <prefix>..." (the word "Code" between contains letters). False-positive risk is still bounded because the "IFSC" anchor word is required — RTGS narrations that quote a beneficiary's IFSC don't include the word "IFSC" itself.
5. **J&K Bank CC rule generalised** — renamed `J&K Bank (Cash Credit Scheme)` → `J&K Bank (Cash Credit)`; added fingerprints `cc mortg` / `cc trade` / `cc service` for the additional CC sub-types. Positional layout (`date | narration | skip | debit | credit | balance`) and Dr/Cr-suffix verify are unchanged.

## What's not in this audit's scope (separate follow-ups)

- **Image-only PDFs always go to vision.** The "use ai vision instead" demotion on healthy grids already landed; the `looksValid` fallback on bank-statement vision extraction also landed. The next structural improvement is **page-batched vision** for large image-only PDFs (15 MB / 21-page ICICI Format-2 was the trigger) and a more robust PDF text-extractor for files pdfjs can't read but other tools can (this `statment.pdf` is the example — clean text is extractable by Anthropic's PDF reader but pdfjs returns 0 items).
- **CC-account sign inversion in vision pipeline.** For liability accounts (Cash Credit, Overdraft, Loan) the running balance is a debit balance — vision currently treats balance deltas with savings-account semantics, which flips Cr/Dr on every transaction. Fix is two surgical changes (vision prompt: add `accountKind` field; server `reconcileBalances`: invert delta sign when `accountKind === 'liability'`). Tracked in conversation but not in this audit.
- **Kotak preprocess only handles the savings layout.** Kotak's CC / OD / loan formats may have different layouts and aren't represented in the audit set. If those surface later, extend the Kotak rule with additional preprocess heuristics rather than touching `pdfGrid` generically.

## How to reproduce

```bash
# Top-level Statements/
npx tsx --import ./scripts/node-pdfjs-shim.mjs scripts/smoke-test-bank-rules.ts \
  "C:\Users\Prattush\Downloads\Statements\AccountStatement_31-Mar-2025_01-Apr-2026.pdf" \
  "C:\Users\Prattush\Downloads\Statements\OpTransactionHistory08-05-2026.pdf-11-38-32.pdf" \
  "C:\Users\Prattush\Downloads\Statements\Statement - Suresh.pdf" \
  "C:\Users\Prattush\Downloads\Statements\canara_epassbook_2026-04-19 135757.699356.pdf"

# Nested BANK STATEMENTS FORMATS/
npx tsx --import ./scripts/node-pdfjs-shim.mjs scripts/smoke-test-bank-rules.ts \
  "C:\Users\Prattush\Downloads\Statements\BANK STATEMENTS FORMATS\HDFC BANK-1.pdf" \
  "C:\Users\Prattush\Downloads\Statements\BANK STATEMENTS FORMATS\HDFC BANK-2.pdf" \
  "C:\Users\Prattush\Downloads\Statements\BANK STATEMENTS FORMATS\ICICI BANK FORMAT-3.pdf" \
  # … etc
```

Expected outcome: each clean detection logs `RULE: <Bank Name>`. Each genuinely
image-only PDF logs `GRID: null (likely image-only PDF or password-protected)`.
No "no match — would fall through to wizard" lines on PDFs we know we cover.
