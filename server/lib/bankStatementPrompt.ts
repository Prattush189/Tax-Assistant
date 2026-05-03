// server/lib/bankStatementPrompt.ts

// Per-condition word ceiling. Enforced both in the React form (live counter)
// and in the POST /conditions handler — the prompt-builder also clips so a
// stale row from before the limit existed can't leak into the AI prompt.
export const MAX_CONDITION_WORDS = 50;

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Build the user-conditions block prepended to every parse prompt.
 *
 * Free-form instructions the user wants the AI to follow when categorising
 * transactions: filters, exclusions, special tagging hints, etc. We render
 * them as a numbered list so the model can reference them mentally and so a
 * single condition that goes long doesn't shadow the rest.
 *
 * Returns an empty string when the user has no conditions — caller can blindly
 * concatenate without worrying about extra whitespace.
 */
export function buildConditionsBlock(conditions: { text: string }[]): string {
  if (!conditions.length) return '';
  const items = conditions
    .map((c) => c.text.trim())
    .filter(Boolean)
    .map((t) => t.split(/\s+/).slice(0, MAX_CONDITION_WORDS).join(' '))
    .map((t, i) => `${i + 1}. ${t}`)
    .join('\n');
  if (!items) return '';
  return `USER FILTERING / TAGGING CONDITIONS — apply to every transaction. If a condition asks you to exclude or skip a row, omit it entirely from the output. If it asks to tag/categorise differently, override the default category accordingly. Conditions take precedence over the default categorisation rules below.\n${items}\n\n---\n\n`;
}

export const BANK_STATEMENT_CATEGORIES = [
  'Business Income',
  'Salary',
  'Rent Received',
  'Interest Income',
  'Dividends',
  'GST Payments',
  'TDS',
  'Business Expenses',
  'Personal',
  'Transfers',
  'Investments',
  'Loan EMI',
  'Taxes Paid',
  'Other',
] as const;

export type BankStatementCategory = typeof BANK_STATEMENT_CATEGORIES[number];

export const BANK_STATEMENT_SUBCATEGORIES: Record<BankStatementCategory, string[]> = {
  'Business Income': ['Sales', 'Services', 'Consulting', 'Commission'],
  Salary: [],
  'Rent Received': [],
  'Interest Income': ['Savings', 'FD', 'Other'],
  Dividends: [],
  'GST Payments': ['CGST', 'SGST', 'IGST'],
  TDS: [],
  'Business Expenses': ['Rent', 'Utilities', 'Travel', 'Office', 'Marketing', 'Professional Fees', 'Software'],
  Personal: [],
  Transfers: [],
  Investments: ['SIP', 'MF', 'Stocks', 'FD'],
  'Loan EMI': ['Home', 'Car', 'Business', 'Personal'],
  'Taxes Paid': ['Advance Tax', 'Self Assessment'],
  Other: [],
};

/**
 * Compact TSV prompt used for pre-extracted PDF text.
 *
 * The JSON-object prompt below is perfect for vision/image inputs but has two
 * problems for the 46-page-text path: (a) JSON output uses ~3× more tokens
 * per transaction than TSV, which means either many chunks or truncation and
 * (b) mid-JSON truncation is invisible — the parser just gives up silently.
 *
 * With TSV:
 *   - One row per line. Each row ends with a newline. Truncation is trivially
 *     detectable because the trailer `---END:<N>---` won't appear.
 *   - Tabs as separators: bank narrations almost never contain tabs (pdfjs
 *     strips them to spaces), so the format is collision-free in practice.
 *   - ~60-80 chars per tx vs ~200-250 for JSON → 3-4× more transactions fit
 *     in a single 16K-token Gemini response.
 *   - An explicit trailer count lets us verify the model didn't silently
 *     drop rows. If the trailer count mismatches the parsed row count, we
 *     fail loudly rather than persisting a partial result.
 */
export const BANK_STATEMENT_TSV_PROMPT = `You are parsing an Indian bank statement. The input below is the raw text layer from a digitally-generated PDF (already extracted by pdfjs — no OCR needed). Extract EVERY transaction.

Output format — STRICT. No JSON, no prose, no code fences. Emit ONE transaction per line. Fields separated by a single TAB character. Exactly 10 fields per row:

date<TAB>narration<TAB>debit<TAB>credit<TAB>balance<TAB>category<TAB>subcategory<TAB>counterparty<TAB>reference<TAB>isRecurring

Field rules:
- date: YYYY-MM-DD (convert from DD/MM/YYYY if the statement uses that). Required.
- narration: raw bank narration, max 200 chars. Replace any TAB or NEWLINE inside with a single space. Required.
- debit: the debit / withdrawal / outflow amount EXACTLY as shown in the statement's Debit column — positive number with decimals, no commas. EMPTY STRING if this row is a credit. Never negative.
- credit: the credit / deposit / inflow amount EXACTLY as shown in the statement's Credit column — positive number with decimals, no commas. EMPTY STRING if this row is a debit. Never negative.
- EXACTLY ONE of debit/credit MUST be populated per row. Never both. Never neither. Copy directly from the statement's Debit/Credit columns (or from the DR/CR marker). DO NOT infer, flip signs, or swap columns.
- balance: number with decimals, no commas. Empty string if the statement doesn't show one.
- category: one of ${BANK_STATEMENT_CATEGORIES.map(c => `"${c}"`).join(' | ')}. Required.
- subcategory: string or empty.
- counterparty: cleanest human-readable payee/merchant label (VPA for UPI, NAME for NEFT/IMPS/RTGS, merchant for POS). Empty if nothing identifiable.
- reference: UTR / cheque number / txn reference number. Empty if none.
- isRecurring: "1" if the same narration pattern appears at least twice with similar amounts (salary/EMI/SIP/rent), else "0".

Concrete example — EXACTLY this tab pattern, with two consecutive tabs where a column is empty:
2025-02-28\tUPI/DR/100732291255/THE MUSCL\t500.00\t\t6152.58\tPersonal\t\tTHE MUSCL\t100732291255\t0
2025-03-01\tNEFT-HDFC-SALARY MAR\t\t85000.00\t91152.58\tSalary\t\tACME CORP\tN123456\t1
Notice row 1 has an EMPTY credit column (two consecutive tabs between 500.00 and 6152.58) and row 2 has an EMPTY debit column (two consecutive tabs between the narration and 85000.00). ALWAYS emit 10 fields per row = 9 tabs per row, including empty ones.

After the last transaction row, emit exactly one trailer line:
---END:<N>---
where <N> is the total count of transaction rows you just emitted. This is required — we verify it to detect truncation.

BEFORE the first transaction row, emit exactly one header line with the statement metadata, tab-separated with 5 fields:
HEADER<TAB>bankName<TAB>accountNumberMasked<TAB>periodFrom<TAB>periodTo

CRITICAL — periodFrom and periodTo:
- Read these from the EXPLICIT statement period line in the header (printed by the bank as "Statement Period: 01-Apr-2024 to 31-Mar-2025" / "Period: From 01/04/2024 To 31/03/2025" / similar).
- Do NOT use the date of the first transaction or last transaction. The statement's printed period is often wider (e.g., it includes a closing balance line dated after the last transaction, or starts a day before the first).
- Convert DD/MM/YYYY → YYYY-MM-DD. Use the literal string "null" only if no period header exists in this chunk.

Use null (the literal string "null") for any field you can't determine. Example:
HEADER\tHDFC Bank\tXXXX1234\t2024-04-01\t2024-04-30

CRITICAL — debit and credit fidelity:
- Read each digit of the amount column directly from the statement; do NOT recompute, round, or guess.
- The DEBIT column on Indian bank statements lives in either a "Withdrawal" / "Dr" / left-most amount slot. The CREDIT column lives in "Deposit" / "Cr" / right-most amount slot. Check the column header before assigning.
- If a single row shows both a debit AND a credit (typical for contra entries or bank-charge-and-tax pairs), emit them as TWO separate rows in the order they appear, NOT one row with both populated.
- If the row has a single amount with a "Dr" / "Cr" suffix or marker, route to the matching column.

Categorization rules (apply the FIRST match):
- "SALARY" / "SAL CREDIT" → Salary
- "RENT" as a credit → Rent Received
- "INT.", "INTEREST PAID", "SB INT", "FD INT" → Interest Income
- "DIV", "DIVIDEND" → Dividends
- "GSTN", "GSTIN", "GST PMT" → GST Payments
- "TDS", "26Q", "26QB" → TDS
- "ADV TAX", "SELF ASMNT", "CHALLAN 280" → Taxes Paid
- "EMI", "LOAN", "HDFC HL", "HOUSING LOAN" → Loan EMI
- "SIP", "MUTUAL FUND", "MF ", "ZERODHA", "GROWW", "UPSTOX" → Investments
- "NEFT", "IMPS", "UPI", "RTGS" with personal counterparty → Transfers
- Debits to vendors (rent, utilities, office, travel, ads) → Business Expenses
- Credits from customers to a business account → Business Income
- Grocery, shopping, restaurants, personal consumption → Personal
- Otherwise → Other

Counterparty extraction:
- UPI "UPI/<ref>/<note>/<vpa>/..." → VPA or payee name after the VPA
- NEFT/IMPS/RTGS "...-NAME-REF" → the NAME segment
- POS → merchant name (SWIGGY, AMAZON, ZOMATO)
- Cheque / cash → "Cheque", "Cash deposit"
- Bank charges ("SB INT", "ATM WDL CHG") → the charge type
- If nothing identifiable, empty. NEVER copy the entire narration.

DO NOT invent, summarize, or group transactions. Every row in the input text that shows a date + amount must appear. The trailer count MUST match the rows you emit.`;

export const BANK_STATEMENT_PROMPT = `You are parsing an Indian bank statement (PDF or image). Return ONLY a JSON object. No markdown fences. No prose.

This prompt deliberately does NOT ask for transaction amounts. The bank's printed running balance column is the most legible, deterministic data on the page (bold, right-aligned, full-magnitude numbers in their own column). The server derives every signed amount as balance[i] - balance[i-1] from your output, which means you only have to read each balance correctly once. You will NOT be asked to extract the debit/credit column at all — focus all attention on reading dates, narrations, and balances precisely.

Schema (all fields required, use null where unknown):
{
  "bankName": "string or null",
  "accountNumberMasked": "XXXXNNNN (last 4 only) or null",
  "periodFrom": "YYYY-MM-DD or null",
  "periodTo": "YYYY-MM-DD or null",
  "currency": "INR",
  "openingBalance": number or null,
  "closingBalance": number or null,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "narration": "string (raw bank narration, max 200 chars; merge wrapped continuation lines into ONE narration — do NOT emit a second row for the wrap)",
      "type": "credit" | "debit",
      "balance": number or null,
      "category": one of ${BANK_STATEMENT_CATEGORIES.map(c => `"${c}"`).join(' | ')},
      "subcategory": string or null,
      "counterparty": "string or null (merchant name, UPI handle, payee/payer — see rules)",
      "reference": "string or null (UTR / transaction ref / cheque number if present)",
      "isRecurring": boolean
    }
  ]
}

CRITICAL — balance fidelity:
- The "balance" field is the bank's printed running balance for THAT row, copied digit-for-digit. Read every digit; do NOT recompute, round, or guess. Magnitude errors here corrupt every subsequent derived amount.
- "openingBalance" is the bank's printed opening / brought-forward balance for the statement period (usually the first balance line, often labelled "B/F" / "Opening Balance" / "Previous Balance").
- "closingBalance" is the bank's printed closing / carried-forward balance at the end of the statement.
- If a row genuinely has no printed balance (mid-statement page break, summary row), set "balance" to null and we'll fall back to your "type" field for that row.

CRITICAL — wrapped narration rows:
- UPI / NEFT narrations on dense statements often wrap onto a second visual line. The continuation line ("68-1@ok", "REF/12345" tail, etc.) is NOT a new transaction. Merge it into the previous row's narration.
- Phantom rows from un-merged wraps will be detected by the server (zero balance change) and dropped, but it's cleaner if you don't emit them in the first place.

"type" rules (used only as a fallback for rows missing balance):
- "credit" for inflow / deposit / Cr-marker rows.
- "debit" for outflow / withdrawal / Dr-marker rows.

Counterparty extraction rules (populate counterparty with the cleanest human-readable label):
- UPI pattern "UPI/<refno>/<note>/<vpa>/..." → use the VPA (e.g. "merchant@okhdfcbank") OR the payee name if clearly after the VPA.
- NEFT / IMPS / RTGS "NEFT-<IFSC>-<NAME>-<REF>" → use the NAME segment.
- Cheque / cash / self — use "Cheque", "Cash deposit", "Self transfer" accordingly.
- POS / merchant payments → use the merchant name (e.g. "SWIGGY", "AMAZON", "ZOMATO").
- Bank-initiated charges/interest ("SB INT", "ATM WDL CHG") → use the charge type as the label.
- If nothing identifiable, leave as null. Never copy the entire narration verbatim.

Reference extraction: pull UTR / cheque number / reference number (usually a 10–16 digit alphanumeric token) into the reference field. If none, null.

Categorization rules (apply the FIRST match):
- Narration contains "SALARY" / "SAL CREDIT" → Salary
- Narration contains "RENT" as a credit → Rent Received
- Narration contains "INT.", "INTEREST PAID", "SB INT", "FD INT" → Interest Income
- Narration contains "DIV", "DIVIDEND" → Dividends
- Narration contains "GSTN", "GSTIN", "GST PMT" → GST Payments
- Narration contains "TDS", "26Q", "26QB" → TDS
- Narration contains "ADV TAX", "SELF ASMNT", "CHALLAN 280" → Taxes Paid
- Narration contains "EMI", "LOAN", "HDFC HL", "HOUSING LOAN" → Loan EMI
- Narration contains "SIP", "MUTUAL FUND", "MF ", "ZERODHA", "GROWW", "UPSTOX" → Investments
- Narration contains "NEFT", "IMPS", "UPI", "RTGS" with a personal counterparty (not GSTIN) → Transfers
- Debits to vendors (rent, utilities, office supplies, travel, ads) → Business Expenses with appropriate subcategory
- Credits to a business account from customers → Business Income
- Grocery, shopping, restaurants, personal consumption → Personal
- Anything that doesn't match → Other

isRecurring = true when the same narration pattern appears at least twice with similar amounts (monthly salary, EMI, SIP, rent).

STRICT RULES:
- Output MUST be valid JSON. No commentary, no code fences.
- Escape quotes in strings. No literal newlines — use \\n.
- Include EVERY transaction you can read. Do NOT summarize or group.
- Dates must be YYYY-MM-DD. If the statement shows DD/MM/YYYY, convert.
- subcategory may be null when none of the listed subcategories fit.
- DO NOT include an "amount" field on transactions. The server derives it from the balance column.`;
