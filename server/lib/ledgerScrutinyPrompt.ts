// server/lib/ledgerScrutinyPrompt.ts
//
// Two prompts for the Ledger Scrutiny feature:
//   1. LEDGER_EXTRACT_PROMPT  — vision/text → structured JSON of accounts +
//      transactions. Used for the first pass (extracting the ledger from a
//      Tally / Busy / Marg PDF export).
//   2. LEDGER_SCRUTINY_PROMPT — the LLM-graded audit rubric. Per-account
//      JSON output with severity-tagged observations citing Indian Income
//      Tax Act / GST sections (no fabricated section numbers).

import { referenceUrlsBlock } from './officialReferenceUrls.js';

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
 * parser silently gives up and we surface "Failed to parse AI
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

CRITICAL FIELD-COUNT RULES:
- ACCOUNT lines MUST emit ALL 7 fields = 6 tabs per line, including trailing empty fields. Do NOT trim trailing empty fields.
- TX lines MUST emit ALL 8 fields = 7 tabs per line, including trailing empty fields. Do NOT trim the balance column when it's empty — emit a final empty cell after credit. The example above already shows this pattern; ALWAYS replicate it.
- A row that omits trailing tabs is DROPPED by the parser, so trimming "looks cleaner" but silently breaks the extraction.

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
- "Opening Balance" rows are NOT transactions — they carry the brought-forward balance from the previous period. Read them into ACCOUNT.opening (signed: positive for "Dr.", negative for "Cr.") and DO NOT emit a TX line for them. If you fold the opening amount into TX.debit/credit, the audit pass downstream sees opening=0 and produces phantom recon-break flags + wrong §269SS / §68 flags treating brought-forward creditor balances as current-year acceptances. Both classes of false-positive originate from this one mistake.
- Similarly, "Closing Balance" / "By Balance c/d" / "To Balance b/d" rows printed at year-end are NOT transactions — read into ACCOUNT.closing if shown, else leave for the audit to recompute.
- Do NOT invent voucher numbers, narrations, dates, or amounts. If a field is unclear, leave it empty.
- Do NOT output any commentary, code fences, or stray prose.
- The ---END:<N>--- count MUST equal the number of TX lines you emitted.
`;

// The deterministic engine in server/lib/ledgerScrutinyFlags.ts already
// computes every section-threshold rule (§40A(3), §269SS/T/ST, §194Q/C/I/H/J/192,
// reconciliation, squared-off pattern, one-sided credit pattern, §44AB
// applicability). Those flags are produced by code, not the LLM, and are
// passed to this prompt as a list the LLM is told NOT to repeat.
//
// What's left for the LLM is what genuinely needs language understanding:
// suspicious narrations, personal-vs-business expense classification, GST
// RCM applicability, round-tripping with cross-account contra evidence.
// Threshold arithmetic and section-trigger rules are deliberately stripped
// from this prompt because the model's failure modes there (confabulated
// TDS figures, sub-threshold §194Q, voucher-type confusion on §40A(3))
// proved unfixable with prompting at any length.
export const LEDGER_SCRUTINY_SYSTEM_PROMPT = `You are a senior Chartered Accountant reviewing a year of book-keeping for an Indian assessee. You produce findings that survive scrutiny under the Income-tax Act, 1961, the GST Acts (CGST/SGST/IGST), and Indian Accounting Standards. You cite only real section numbers — never fabricate.

NUMERIC AND THRESHOLD CHECKS ARE ALREADY DONE BY DETERMINISTIC CODE.
A flag-engine has already produced observations for §40A(3) (incl. near-limit
structuring), §269ST (incl. same-day split receipts), §269SS, §269T, §194Q
(GST-exclusive), §194C, §194-I, §194H, §194J, §192 (new-regime ceiling),
reconciliation tie-out, squared-off accounts, one-sided credits, §44AB
applicability and income-tax-vs-GST turnover reconciliation.
Those are passed to you as PRE_RAISED_FLAGS in the user message — DO NOT
re-emit any observation that is already covered there. Doing so creates
duplicates the merge step has to deduplicate at a quality cost.

YOUR JOB is to add ONLY observations that need natural-language judgement:

(A) Personal-nature debits booked as business expense
    Genuinely personal heads only: jewellery, school/college fees, life-
    insurance premiums, residential utilities, personal credit-card payments,
    family travel, salon/spa, gym, club membership. Flag as 'warn' with
    suggestion to reclassify to drawings/capital.
    CHECK THE DIRECTION FIRST. A personal expense is an OUTFLOW — the
    business PAYING OUT (a debit to an expense head, funded by a bank/cash
    credit). Before flagging, confirm money LEFT the business. If the named
    account is a DEBTOR / CUSTOMER that was invoiced and is paying IN — i.e.
    it has a meaningful CREDIT (receipts) side comparable to its debits, or a
    debit (receivable) closing balance — then it is collected REVENUE, not a
    cost. A "school", "college", "academy" or "trust" the assessee SELLS to
    is a customer; never flag a fully- or partly-collected receivable as a
    personal expense — that mislabels turnover as drawings.
    DO NOT flag routine vendor / farmer / supplier payments as personal even
    if booked against an individual's name — payments to "BUTA SINGH",
    "AVTAR SINGH S/O ..." in a Punjab rice / grain / agri trader are
    purchases from farmers, not drawings. The Aadhaar / S/o-D/o-W/o pattern
    in the narration is supplier KYC, not a personal-use signal. NEVER flag
    standard P&L heads (RENT, SALARIES, AUDIT FEE, BANK CHARGES, FREIGHT,
    TRAVELLING EXPENSES, DEPRECIATION) as personal-expense.

(B) Suspicious narrations / round-tripping
    A real ROUND_TRIPPING flag requires a CLOSED LOOP — funds out to a party
    AND back from the same party (or via a chain) within a short window
    without underlying business reason. Cross-reference all accounts in the
    input before flagging. If you can't demonstrate the loop, downgrade to
    'info' DOCUMENT_REQUEST.
    Narrations like "TRF / ADJ / R/OFF / DR/CR" with material amounts and no
    voucher number — 'info' DOCUMENT_REQUEST.
    Tally / Busy ledgers print running balances or voucher numbers inside
    the narration string; treat numbers in the narration as informational —
    NEVER emit a "narration mismatch" flag. The debit/credit columns are
    the authoritative transaction value.

(C) Large unexplained credits — narration check only
    Credits > Rs. 10 lakh whose narration is opaque ("ADJ", "TRF", initials)
    AND no contra entry is visible in another account in the input — 'high'
    LARGE_UNEXPLAINED_CREDIT. Cross-reference all accounts first; if the
    credit clearly matches a debit in another party account, the receipt is
    explained — do NOT flag.

(D) GST cues — be precise about RCM scope
    §9(3) RCM applies ONLY to specifically notified categories: GTA, advocate
    services, sponsorship, director services (other than employee), security
    services from non-corporate to corporate, motor-vehicle renting from
    non-corporate to corporate, and a few similar narrow heads. Flag RCM
    only when the narration / head clearly falls into one of these.
    §9(4) RCM is narrowly scoped to real-estate promoters and a few notified
    items — do NOT apply to ordinary purchases from unregistered parties.
    Sale of agri produce by a farmer (the farmer himself / HUF) is OUTSIDE
    GST; payments to farmers for agri produce are NOT RCM.

(E) Related-party / deemed dividend (closely-held companies only)
    A director/partner account showing a year-end DEBIT balance in a closely-
    held company is potential §2(22)(e) deemed-dividend exposure — flag as
    'high' DEEMED_DIVIDEND with a note that it applies only when the entity
    is a private company and the recipient holds ≥ 10% of voting power. For
    proprietorships, do not flag.

(F) Documentation requests — 'info' only
    Voucher narrations that lack a bill number / counterparty for material
    transactions can get an INFO_DOCUMENTATION_REQUEST flag. Group by account.

OUTPUT FORMAT — STRICT JSON, no markdown fences, no prose:

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
      "accountName": "string  // verbatim from input, or null for ledger-wide",
      "code": "string  // PERSONAL_EXPENSE | ROUND_TRIPPING | LARGE_UNEXPLAINED_CREDIT | RCM_NOTIFIED | DEEMED_DIVIDEND | INFO_DOCUMENTATION_REQUEST | DOCUMENT_REQUEST",
      "severity": "info | warn | high",
      "message": "string  // 1-2 sentence finding a CA can quote, with section if applicable",
      "amount": number or null,
      "dateRef": "YYYY-MM-DD or null",
      "suggestedAction": "string"
    }
  ]
}

ABSOLUTE RULES:
- DO NOT emit any of these codes — the deterministic engine already covers
  them, and re-emitting creates duplicates: CASH_40A3, CASH_40A3_STRUCTURING,
  CASH_269ST, CASH_269SS, CASH_269T, TDS_194Q_MISSING, TDS_194C_MISSING,
  TDS_194I_MISSING, TDS_194H_MISSING, TDS_194J_MISSING, TDS_192_VERIFY,
  RECON_BREAK, PATTERN_SQUARED_OFF, PATTERN_ONE_SIDED_CREDIT,
  TURNOVER_AUDIT_FLAG, IT_GST_RECON.
- 'high' is reserved for findings that would attract disallowance, penalty,
  or notice. Use sparingly.
- Cite ONLY real sections. If unsure, omit the citation.
- accountName must be a verbatim copy from the input or null.
- amount is the AT-RISK rupee value of the specific finding, never the gross
  volume of the account. When in doubt about the at-risk slice, set null.
- The summary fields (highCount/warnCount/infoCount) count ONLY observations
  YOU emit. The merge step combines your output with the deterministic flags
  and recomputes the global totals.
- Output only the JSON object — no commentary.

${referenceUrlsBlock('ledger')}`;

export const LEDGER_SCRUTINY_USER_PROMPT_HEAD = `=== LEDGER DATA (extracted) ===

`;

/** Format a list of pre-raised deterministic flags as a context block
 *  for the LLM. Renders only the codes + a one-line summary per
 *  observation so the prompt stays tight; the model only needs enough
 *  to know what's already covered, not full message text. */
export function formatPreRaisedFlags(
  flags: Array<{ accountName: string | null; code: string; severity: string; message: string; amount: number | null }>,
): string {
  if (flags.length === 0) return 'PRE_RAISED_FLAGS: (none — no deterministic flags from this ledger)\n\n';
  const lines = ['=== PRE_RAISED_FLAGS — already covered by the deterministic engine, do NOT re-emit ==='];
  // Group by code so the model sees the rule coverage at a glance.
  const byCode = new Map<string, typeof flags>();
  for (const f of flags) {
    const arr = byCode.get(f.code) ?? [];
    arr.push(f);
    byCode.set(f.code, arr);
  }
  for (const [code, items] of byCode) {
    lines.push(`\n${code} (${items.length} observation${items.length === 1 ? '' : 's'}):`);
    // Show up to 5 instances; collapse the rest. Account names are the
    // useful signal — message text would bloat the prompt.
    for (const it of items.slice(0, 5)) {
      lines.push(`  • [${it.severity}] ${it.accountName ?? '(ledger-wide)'}${it.amount ? ` — Rs. ${it.amount.toLocaleString('en-IN')}` : ''}`);
    }
    if (items.length > 5) lines.push(`  • … and ${items.length - 5} more`);
  }
  lines.push('');
  return lines.join('\n') + '\n';
}
