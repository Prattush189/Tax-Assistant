// server/lib/bankStatementPrompt.ts

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

After the last transaction row, emit exactly one trailer line:
---END:<N>---
where <N> is the total count of transaction rows you just emitted. This is required — we verify it to detect truncation.

BEFORE the first transaction row, emit exactly one header line with the statement metadata, tab-separated with 5 fields:
HEADER<TAB>bankName<TAB>accountNumberMasked<TAB>periodFrom<TAB>periodTo
Use null (the literal string "null") for any field you can't determine. Example:
HEADER\tHDFC Bank\tXXXX1234\t2024-04-01\t2024-04-30

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

Schema (all fields required, use null where unknown):
{
  "bankName": "string or null",
  "accountNumberMasked": "XXXXNNNN (last 4 only) or null",
  "periodFrom": "YYYY-MM-DD or null",
  "periodTo": "YYYY-MM-DD or null",
  "currency": "INR",
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "narration": "string (raw bank narration, max 200 chars)",
      "amount": number (positive for credit/inflow, negative for debit/outflow),
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
- If you cannot determine the balance for a row, set it to null.
- subcategory may be null when none of the listed subcategories fit.`;
