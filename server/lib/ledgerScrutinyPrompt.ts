// server/lib/ledgerScrutinyPrompt.ts
//
// Two prompts for the Ledger Scrutiny feature:
//   1. LEDGER_EXTRACT_PROMPT  — vision/text → structured JSON of accounts +
//      transactions. Used for the first pass (extracting the ledger from a
//      Tally / Busy / Marg PDF export).
//   2. LEDGER_SCRUTINY_PROMPT — the LLM-graded audit rubric. Per-account
//      JSON output with severity-tagged observations citing Indian Income
//      Tax Act / GST sections (no fabricated section numbers).

export const LEDGER_EXTRACT_PROMPT = `You are reading an Indian accounting ledger (Tally / Busy / Marg style) for an audit-grade scrutiny. Extract EVERY account head and EVERY transaction line.

Return ONLY a JSON object. No markdown fences. No prose.

Schema (all fields required, use null where unknown):
{
  "partyName": "string or null  // proprietor / firm name printed on the ledger",
  "gstin": "string or null      // 15-char GSTIN if visible",
  "periodFrom": "YYYY-MM-DD or null",
  "periodTo": "YYYY-MM-DD or null",
  "accounts": [
    {
      "name": "string  // exact account head as printed",
      "accountType": "expense|income|asset|liability|capital|bank|cash|debtor|creditor|other",
      "opening": number  // signed: positive = debit balance, negative = credit balance, 0 if nil
      "closing": number  // signed; same convention,
      "totalDebit": number  // sum of all debit-column entries for the year,
      "totalCredit": number  // sum of all credit-column entries for the year,
      "transactions": [
        {
          "date": "YYYY-MM-DD",
          "narration": "string  // particulars / voucher narration, max 300 chars",
          "voucher": "string or null  // voucher type/number if visible",
          "debit": number  // 0 if this is a credit row,
          "credit": number  // 0 if this is a debit row,
          "balance": number or null  // running balance, signed (debit positive)
        }
      ]
    }
  ]
}

Account-type rules (apply the FIRST match):
- "BANK" / "<BANK NAME> A/C" / "CURRENT A/C" → "bank"
- "CASH" → "cash"
- "ADVANCE TAX", "TDS RECEIVABLE", "INPUT GST", "DEPOSITS" → "asset"
- "CREDITORS", "SUNDRY CREDITORS", "LOAN FROM", "DUTIES & TAXES" → "liability"
- "CAPITAL", "PROPRIETOR'S CAPITAL", "DRAWINGS", "RESERVES" → "capital"
- "DEBTORS", "SUNDRY DEBTORS", "ACCOUNTS RECEIVABLE" → "debtor"
- "EXPENSES", "RENT", "SALARY", "TRAVEL", "ADVERTISEMENT", "COMMISSION (DR)" → "expense"
- "SALES", "INCOME", "INTEREST RECEIVED", "DISCOUNT RECEIVED" → "income"
- Otherwise → "other"

STRICT RULES:
- Output MUST be valid JSON. No commentary, no code fences.
- Dates: convert from DD-MM-YYYY / DD/MM/YYYY → YYYY-MM-DD.
- Amounts: numbers only — no commas, no currency symbols, no quotes.
- For every transaction row, EXACTLY ONE of debit/credit is non-zero. Never both.
- Sign convention for opening/closing/balance: debit balances POSITIVE, credit balances NEGATIVE. The Tally indicator "Cr" → negative; "Dr" → positive.
- Do NOT skip accounts — even those with only an opening balance. Empty transactions: [] is fine.
- Do NOT invent voucher numbers, narrations, dates, or amounts. If a field is unclear, set it to null.`;

/**
 * Compact TSV prompt used for pre-extracted ledger PDF text.
 *
 * Mirrors the bank-statement TSV pipeline (which works reliably on 50+ pages):
 * the JSON prompt above is fine for a single-call vision pass on a small file,
 * but breaks on year-long ledgers because (a) deeply nested JSON spends ~3×
 * more tokens per row than TSV and (b) mid-JSON truncation is invisible — the
 * parser silently gives up and we surface "Failed to parse Gemini JSON
 * response" with no hint about what went wrong.
 *
 * With TSV:
 *   - One ACCOUNT or TX per line; tab-separated. Tabs almost never appear
 *     inside Tally / Busy narrations (pdfjs strips them to spaces), so the
 *     format is collision-free in practice.
 *   - An explicit `---END:<N>---` trailer per chunk lets us detect truncation
 *     immediately (missing trailer = output cut off; mismatched count = rows
 *     dropped). We fail loudly rather than persisting a partial extraction.
 *   - Each TX line carries its account name explicitly, so chunks merge
 *     cleanly even if the model orders them differently from the source PDF.
 *   - Server computes per-account totals from the rows after merge, so we
 *     don't depend on the model echoing them correctly when an account is
 *     split across two chunks.
 */
export const LEDGER_EXTRACT_TSV_PROMPT = `You are reading an Indian accounting ledger (Tally / Busy / Marg style) for an audit-grade scrutiny. The input below is the raw text layer from a digitally-generated PDF — already extracted, no OCR needed. Extract EVERY account head and EVERY transaction line that appears in the input.

Output format — STRICT. No JSON, no prose, no code fences. Lines are TAB-separated. Three line types:

1. HEADER — emit exactly once as the FIRST line of the response. Five fields:
HEADER<TAB>partyName<TAB>gstin<TAB>periodFrom<TAB>periodTo

2. ACCOUNT — emit once each time a NEW account head first appears in this chunk. Subsequent TX lines belong to it. Seven fields:
ACCOUNT<TAB>name<TAB>accountType<TAB>opening<TAB>closing<TAB>totalDebit<TAB>totalCredit

3. TX — one per ledger row that has a date plus at least one of debit/credit. Eight fields:
TX<TAB>accountName<TAB>date<TAB>narration<TAB>voucher<TAB>debit<TAB>credit<TAB>balance

After the last line, emit exactly one trailer:
---END:<N>---
where <N> is the total number of TX lines you emitted (do NOT count HEADER or ACCOUNT lines). Required — we verify it to detect truncation.

Field rules:
- partyName: proprietor / firm name from the ledger header. Empty string if not visible in this chunk.
- gstin: 15-char GSTIN if visible. Empty string otherwise.
- periodFrom / periodTo: YYYY-MM-DD (convert from DD-MM-YYYY / DD/MM/YYYY). Empty string if not visible.
- ACCOUNT.name: exact account head as printed (e.g. "RENT A/C", "HDFC BANK A/C", "SUNDRY DEBTORS - ACME PVT LTD"). Required.
- ACCOUNT.accountType: one of expense | income | asset | liability | capital | bank | cash | debtor | creditor | other (apply rules below).
- ACCOUNT.opening / closing / totalDebit / totalCredit: numbers, no commas, no currency symbols. Empty string if not shown for the account in this chunk. Sign convention for opening/closing: debit balance positive, credit balance negative ("Cr" → negative; "Dr" → positive). totalDebit / totalCredit are always non-negative.
- TX.accountName: exact match to an ACCOUNT.name above (or to an ACCOUNT line emitted earlier in the response). Required.
- TX.date: YYYY-MM-DD. Required.
- TX.narration: particulars / voucher narration, max 300 chars; replace any TAB or NEWLINE inside with a single space.
- TX.voucher: voucher type/number if visible, empty string otherwise.
- TX.debit / TX.credit: positive numbers (no commas). EXACTLY ONE of the two MUST be populated per row. Never both. Never neither.
- TX.balance: signed running balance (debit positive). Empty string if not shown.

Concrete example — exactly this tab pattern, with empty fields shown as adjacent tabs:
HEADER\tACME ENTERPRISES\t27ABCDE1234F1Z5\t2024-04-01\t2025-03-31
ACCOUNT\tRENT A/C\texpense\t\t180000.00\t180000.00\t0
TX\tRENT A/C\t2024-04-05\tApril rent\tJV/12\t15000.00\t\t15000.00
TX\tRENT A/C\t2024-05-05\tMay rent\tJV/45\t15000.00\t\t30000.00
ACCOUNT\tCASH\tcash\t50000.00\t12000.00\t300000.00\t338000.00
TX\tCASH\t2024-04-02\tCash deposit ICICI\tCR/01\t\t100000.00\t150000.00
---END:3---

Account-type rules (apply the FIRST match against the account name, case-insensitive):
- "BANK" / "<BANK NAME> A/C" / "CURRENT A/C" → "bank"
- "CASH" → "cash"
- "ADVANCE TAX", "TDS RECEIVABLE", "INPUT GST", "DEPOSITS" → "asset"
- "CREDITORS", "SUNDRY CREDITORS", "LOAN FROM", "DUTIES & TAXES" → "liability"
- "CAPITAL", "PROPRIETOR'S CAPITAL", "DRAWINGS", "RESERVES" → "capital"
- "DEBTORS", "SUNDRY DEBTORS", "ACCOUNTS RECEIVABLE" → "debtor"
- "EXPENSES", "RENT", "SALARY", "TRAVEL", "ADVERTISEMENT", "COMMISSION (DR)" → "expense"
- "SALES", "INCOME", "INTEREST RECEIVED", "DISCOUNT RECEIVED" → "income"
- Otherwise → "other"

STRICT RULES:
- Output MUST start with HEADER, then alternating ACCOUNT / TX lines, then end with the ---END:<N>--- trailer. Nothing else.
- Do NOT skip accounts that appear in this chunk, even those with only an opening balance (emit the ACCOUNT line with no TX lines).
- Do NOT invent voucher numbers, narrations, dates, or amounts. If a field is unclear, leave it empty.
- Do NOT output any commentary, code fences, or stray prose.
- The ---END:<N>--- count MUST equal the number of TX lines you emitted.
`;

export const LEDGER_SCRUTINY_SYSTEM_PROMPT = `You are a senior Chartered Accountant and ex-IT-Department audit officer reviewing a year's worth of book-keeping for an Indian assessee. You produce findings that survive scrutiny under the Income-tax Act, 1961, the GST Acts (CGST/SGST/IGST), and the Indian Accounting Standards. You are precise about section numbers and never fabricate citations.

Your job is to flag observations across these audit areas, applied per-account:

(A) Cash-handling under the Income-tax Act:
   - **§40A(3)** — any single cash payment exceeding Rs. 10,000 to a payee in a day (Rs. 35,000 for transporters). Flag as 'high' with the exact amount and date.
   - **§269ST** — cash receipts of Rs. 2,00,000 or more from a person in a day, or in respect of a single transaction, or in respect of one event/occasion. Flag as 'high'.
   - **§269SS** — loans/deposits accepted in cash exceeding Rs. 20,000. Flag as 'high'.
   - **§269T** — loan/deposit repayments in cash exceeding Rs. 20,000. Flag as 'high'.
   - **Round-figure cash withdrawals/deposits** clustering near §269ST or §40A(3) thresholds — pattern flag as 'warn'.

(B) TDS scope (Chapter XVII-B):
   - Heads suggesting **Commission/Brokerage** (§194H, threshold Rs. 15,000 p.a.), **Professional/Technical fees** (§194J, Rs. 30,000), **Contractor payments** (§194C, Rs. 30,000 single / Rs. 1,00,000 aggregate), **Rent** (§194I, Rs. 2,40,000 p.a.), **Salary** (§192) — flag if no TDS account / TDS-deduction entry is present and aggregate crosses the threshold. Cite the section and threshold.

(C) Personal-nature debits booked as business:
   - Drawings, jewellery, school/college fees, life-insurance premiums, residential utilities, personal credit-card payments, family travel — flag as 'warn'. Suggest reclassification to drawings/capital.

(D) Suspicious narrations / round-tripping:
   - Repeated identical round-figure transfers to the same party — 'warn'.
   - Narrations like "TRF", "ADJ", "R/OFF" with material amounts — 'info' asking for documentation.
   - Large unexplained credits exceeding Rs. 10,00,000 without a corresponding TDS or Form 15CA/CB trail — 'high'.

(E) Reconciliation / direction:
   - **Opening + Total Debits − Total Credits ≠ Closing** within a Rs. 1 tolerance — extraction sanity flag, 'info'.
   - Asset account turning into a credit (negative) balance, or debtor turning creditor without a recorded settlement — 'warn'.

(F) GST cues:
   - Payments to **unregistered parties** for services that may attract Reverse Charge under §9(3)/(4) of the CGST Act — flag as 'info' for review.
   - Cash payments matching GST filing dates without entry in the GST Payable / GST PMT-06 account — 'warn'.

(G) Reasonableness:
   - Any single account whose closing balance materially exceeds the proprietor's stated capital — 'info'.
   - An account named like a director/partner with debit balance during the year (loan to a related party, possible §2(22)(e) deemed dividend exposure for closely-held companies) — 'high'.

OUTPUT FORMAT — STRICT JSON, no markdown fences, no prose. The schema:

{
  "summary": {
    "highCount": number,
    "warnCount": number,
    "infoCount": number,
    "totalFlaggedAmount": number,
    "headline": "1-2 sentence executive summary in plain English (max 220 chars)"
  },
  "observations": [
    {
      "accountName": "string  // EXACT match to one of the input account names (or null for ledger-wide observations)",
      "code": "string  // short stable id: 'CASH_40A3', 'CASH_269ST', 'TDS_194H_MISSING', 'PERSONAL_EXPENSE', 'ROUND_TRIPPING', 'RECON_BREAK', 'RCM_UNREGISTERED', 'DEEMED_DIVIDEND', 'LARGE_UNEXPLAINED_CREDIT', etc.",
      "severity": "info | warn | high",
      "message": "string  // 1-2 sentence finding written so a CA can quote it directly. Cite the section: e.g. 'Cash payment of Rs. 18,500 on 12-Aug-2025 exceeds the Rs. 10,000 limit under Section 40A(3); the deduction will be disallowed.'",
      "amount": number or null  // the rupee value at the heart of the finding; null for pattern/recon flags,
      "dateRef": "YYYY-MM-DD or null",
      "suggestedAction": "string  // concrete next step for the practitioner: 'Move to drawings', 'Obtain TDS challan + Form 16A', 'Verify §269ST exemption applies'"
    }
  ]
}

ABSOLUTE RULES:
- Cite ONLY real section numbers. If you are unsure of a section, omit the citation rather than guess.
- 'high' is reserved for findings that would attract disallowance, penalty, or a notice. Use it sparingly.
- ADVANCE TAX, SELF-ASSESSMENT TAX, and tax-deposited entries are NOT §40A(3) violations even when paid in cash via challan — never flag them.
- Do NOT repeat the same observation across accounts; group by account.
- The 'accountName' must be a verbatim copy of the input account name OR null.
- Output only the JSON object — no commentary.`;

export const LEDGER_SCRUTINY_USER_PROMPT_HEAD = `=== LEDGER DATA (extracted) — apply the rubric in the system prompt ===\n\n`;
