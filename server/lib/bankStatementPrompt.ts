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
