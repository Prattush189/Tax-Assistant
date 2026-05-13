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
  'Cash Deposit',
  'Investments',
  'Loan EMI',
  'Taxes Paid',
  'Bank Charges',
  'Bank Interest (Dr)',
  'Bank Interest (Cr)',
  'Insurance',
  'Mobile Charges',
  'Electricity Charges',
  'Water Charges',
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
  'Business Expenses': ['Rent', 'Utilities', 'Travel', 'Office', 'Marketing', 'Professional Fees', 'Software', 'Other'],
  // Personal subcategories surface merchant-class drilldowns on the
  // dashboard. The classifier (bankClassifier.ts) sets these
  // deterministically based on narration patterns for ~50 well-known
  // Indian merchants; rows that don't match a pattern fall to AI for
  // a category-only judgement (no subcategory inferred there — kept
  // null until the user re-tags from the UI).
  Personal: [
    'E-commerce',     // Amazon, Flipkart, Myntra, Meesho, Ajio, Nykaa, Tata CLiQ, Snapdeal
    'Food Delivery',  // Swiggy, Zomato, EatFit, Dunzo (restaurant pickup)
    'Quick Commerce', // Blinkit, Zepto, BigBasket, Swiggy Instamart, Dunzo
    'Cabs',           // Ola, Uber, Rapido
    'Subscriptions',  // Netflix, Spotify, Hotstar, YouTube Premium, Amazon Prime, ZEE5, Sony LIV
    'Fuel',           // Indian Oil, HPCL, BPCL, Shell, Nayara, Reliance Petroleum
    'Telecom',        // Standalone Airtel/Jio/Vi/BSNL recharges (BIL/BPAY pattern → Mobile Charges instead)
    'Restaurants',    // Domino's, Pizza Hut, McDonald's, KFC, Burger King, Barbeque Nation
    'Healthcare',     // 1mg, PharmEasy, Netmeds, Apollo Pharmacy, Practo
    'Education',      // Byju's, Unacademy, Coursera, Udemy
    'Travel',         // MakeMyTrip, Yatra, Cleartrip, IRCTC, Goibibo, EaseMyTrip, OYO, Booking.com
    'Entertainment',  // BookMyShow, PVR, INOX, gaming (Steam, PlayStation, Xbox)
    'Shopping',       // Other retail merchants the AI tags as Personal but doesn't fit the above
    'Other',
  ],
  Transfers: [],
  // Cash Deposit covers cash INFLOWS to the account: counter deposits
  // ("By Cash:", "BY CASH"), cash-deposit-machine drops (CDM/CAM
  // narrations), and self-cheque cash deposits. Withdrawals stay
  // under the existing flow (CDM/cheque debits land in Transfers or
  // an AI-judged category). Subcategories let the dashboard split
  // counter vs machine deposits if the user wants.
  'Cash Deposit': ['Counter', 'CDM / ATM', 'Cheque', 'Other'],
  Investments: ['SIP', 'MF', 'Stocks', 'FD'],
  'Loan EMI': ['Home', 'Car', 'Business', 'Personal'],
  'Taxes Paid': ['Advance Tax', 'Self Assessment'],
  // Bank Charges subcategories track the buckets the user maintains
  // in BANK CHARGES FORMAT.xlsx so the dashboard rolls up the way
  // they expect. New buckets added: SoundBox/POS Rent, CIBIL,
  // Cash Txn (deposit/withdrawal counter charges), Penal, Inspection,
  // Rejection (inward / outward cheque returns), Card Fees.
  'Bank Charges': [
    'ATM', 'NEFT/IMPS/RTGS', 'SMS', 'Min Balance', 'Loan Processing',
    'Cheque', 'GST', 'POS Rental', 'SoundBox Rent', 'CIBIL',
    'Cash Txn', 'Penal', 'Inspection', 'Rejection', 'Card Fee', 'Other',
  ],
  'Bank Interest (Dr)': ['Loan Interest', 'OD Interest', 'Other'],
  'Bank Interest (Cr)': ['Savings', 'FD', 'Other'],
  Insurance: ['Premium', 'Renewal', 'Other'],
  'Mobile Charges': ['BSNL', 'Airtel', 'Jio', 'Vi', 'Other'],
  'Electricity Charges': ['DISCOM', 'Other'],
  'Water Charges': ['Municipal', 'Other'],
  Other: [],
};

export const BANK_STATEMENT_PROMPT = `You are parsing an Indian bank statement (PDF or image). Return ONLY a JSON object. No markdown fences. No prose.

CRITICAL — read every page:
- The PDF may have multiple pages (often 6–20 for a year-long statement).
- You MUST process EVERY page and emit EVERY transaction, not just the first page.
- The "transactions" array should contain rows from page 1, page 2, page 3, … through to the last page, in chronological order.
- Page headers ("Statement of transactions in Savings Account ..."), banners, ads, "Page X of Y" footers — ignore them, they are not transactions.
- Do NOT stop after page 1 even if the structure repeats. The statement is one logical table that wraps across pages.
- If you find yourself summarising or sampling, STOP and start over emitting every row.

This prompt deliberately does NOT ask for transaction amounts. The bank's printed running balance column is the most legible, deterministic data on the page (bold, right-aligned, full-magnitude numbers in their own column). The server derives every signed amount as balance[i] - balance[i-1] from your output, which means you only have to read each balance correctly once. You will NOT be asked to extract the debit/credit column at all — focus all attention on reading dates, narrations, and balances precisely.

Schema (all fields required, use null where unknown). The output is intentionally MINIMAL — category / subcategory / counterparty / reference / isRecurring are computed server-side from your output by a deterministic narration-anchor classifier + small AI fallback. You ONLY need to read date / narration / type / balance off the statement; do not emit any other per-row fields:
{
  "bankName": "string or null",
  "accountNumberMasked": "XXXXNNNN (last 4 only) or null",
  "periodFrom": "YYYY-MM-DD or null",
  "periodTo": "YYYY-MM-DD or null",
  "currency": "INR",
  "openingBalance": number or null,
  "closingBalance": number or null,
  "accountKind": "asset" | "liability" | null,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "narration": "string (raw bank narration, max 120 chars — trim trailing padding/timestamps; merge wrapped continuation lines into ONE narration — do NOT emit a second row for the wrap)",
      "type": "credit" | "debit",
      "balance": number or null
    }
  ]
}

CRITICAL — balance fidelity:
- The "balance" field is the bank's printed running balance for THAT row, copied digit-for-digit. Read every digit; do NOT recompute, round, or guess. Magnitude errors here corrupt every subsequent derived amount.
- "openingBalance" is the bank's printed opening / brought-forward balance for the statement period (usually the first balance line, often labelled "B/F" / "Opening Balance" / "Previous Balance").
- "closingBalance" is the bank's printed closing / carried-forward balance at the end of the statement.
- If a row genuinely has no printed balance (mid-statement page break, summary row), set "balance" to null and we'll fall back to your "type" field for that row.

CRITICAL — account-kind detection (asset vs liability):
- "accountKind" classifies the account itself, not any individual transaction.
- Set "accountKind": "asset" when the account is a SAVINGS, CURRENT, NRE / NRO, salary, or wallet account — i.e. customer's money sits in the account, balance is a CREDIT balance, deposits INCREASE the balance, withdrawals DECREASE it. This is the default — when in doubt, use "asset".
- Set "accountKind": "liability" when the account is a CASH CREDIT (CC), OVERDRAFT (OD), LOAN, KCC, MORTGAGE, or any working-capital credit line — i.e. the BANK's money is sitting in the account, balance is a DEBIT balance, withdrawals INCREASE the outstanding balance, repayments / deposits DECREASE it. Tells:
    * Every running balance carries a "Dr" / "DR" / "Dr." suffix (e.g. "510239.27Dr") — never just a bare number.
    * The printed account TYPE / SCHEME line contains words like "Cash Credit", "CC", "Overdraft", "OD", "Loan", "Mortgage", "KCC", "Term Loan", "Working Capital".
    * Narrations like "By Cash: N" represent the customer DEPOSITING cash into the credit line (reduces what's owed) — these decrease the Dr balance.
- Why this matters: the server derives every signed transaction amount as balance[i] - balance[i-1]. For an "asset" account, +delta = inflow / credit. For a "liability" account the convention INVERTS — +delta (Dr balance going up) means the customer drew more from the line, which is a debit / outflow. Reporting the wrong kind flips every transaction's debit/credit classification and turns deposits into expenses (the 2026-05 J&K CC MORTG case).
- Set "accountKind": null only if the document is so unusual you genuinely can't tell. The server then defaults to "asset", which is correct ~95% of the time.

CRITICAL — loan / CC / OD opening balance traps:
- On liability accounts the opening balance is the SINGLE most error-prone read. If you anchor it to the wrong field, every row's signed amount comes out wrong.
- WHEN "accountKind" is "liability":
    * The opening balance MUST come from one of: an explicit "B/F" / "Opening Balance" / "Previous Balance" / "Balance Brought Forward" line, OR the running balance printed on the FIRST transaction row.
    * The opening balance is NOT the "Limit" / "Sanctioned Amount" / "Sanctioned Limit" / "Drawing Power" / "DP" / "Credit Limit" field. Those are CAPS on how much the customer can draw — they're displayed in the account-info header alongside totals but they are NOT a running-balance anchor.
    * For a newly-disbursed loan with no prior statement, the opening balance is ZERO. The first transaction is then a debit equal to the disbursement amount (the customer now owes that much).
    * If you cannot find an explicit B/F line AND the statement looks like the first month of a new loan (small transaction count, "Sanction Date" matches the statement period, first row is a large drawdown), set "openingBalance": 0 and "openingBalanceSource": "new_loan".
- WHEN explicit Debit AND Credit columns are present in the table header (e.g. SBI's "Debit | Credit | Balance" layout, the J&K Bank loan statement "WITHDRAWALS | DEPOSITS | BALANCE" layout):
    * Read the per-row amount DIRECTLY from whichever of the two columns is populated. That is the source of truth, not balance arithmetic. Use the balance-delta only as a cross-check.
    * If the row's Debit column has a number → "type": "debit", amount = that number.
    * If the row's Credit column has a number → "type": "credit", amount = that number.
    * If both are populated, emit two separate transactions (contra entry).
    * If neither is populated AND the balance column has a value → fall back to balance-delta, but flag suspicious by setting "balance": null so the server skips that row's amount derivation.
- WORKED EXAMPLE (SBI EB-TL-SGY term loan, statement period 31-10-2025 to 10-11-2025):
    Account info: "Limit : 4,98,900.00", "Sanction Date : 31/10/2025", "Cleared Balance : 3,49,308.00 DR"
    Transactions:
      Row 1: Debit 3,49,230 / Credit (empty) / Balance 3,49,230 DR — narration "DEBIT TRANSFER TFR TO 43000661256"
      Row 2: Debit 78       / Credit (empty) / Balance 3,49,308 DR — narration "PART PERIOD INTEREST"
    Correct read: accountKind="liability", openingBalance=0 (sanction date matches period start, first row is the disbursement). Row 1 type="debit" amount=349230. Row 2 type="debit" amount=78. Both DEBIT — confirmed by the "Statement Summary: Dr Count 2, Cr Count 0" footer.
    WRONG (the failure mode this section exists to prevent): anchor opening balance to Limit (498,900). Then row 1 delta = 349,230 - 498,900 = -149,670, classify as credit (DR balance went DOWN). Result: row 1 reported as Credit 149,670 — wrong sign AND wrong amount. Two bugs from one bad anchor.
- Cross-check using the Statement Summary footer if present ("Dr Count: N / Cr Count: M / Debits: X / Credits: Y"). The number of debits and credits in your transactions array should match these counts exactly. If they don't, you've inverted some rows — re-read with the column rule above.

CRITICAL — wrapped narration rows:
- UPI / NEFT narrations on dense statements often wrap onto a second visual line. The continuation line ("68-1@ok", "REF/12345" tail, etc.) is NOT a new transaction. Merge it into the previous row's narration.
- Phantom rows from un-merged wraps will be detected by the server (zero balance change) and dropped, but it's cleaner if you don't emit them in the first place.

"type" rules (used only as a fallback for rows missing balance):
- "credit" for inflow / deposit / Cr-marker rows.
- "debit" for outflow / withdrawal / Dr-marker rows.

CRITICAL — wrapped narrations across lines:
Many statements wrap long narrations onto a second visual line (e.g. a UPI handle or counterparty name continues on the next line). Read them as ONE logical narration, not two transactions. Concatenate the wrapped fragments into a single string (with a space between them where the wrap is between separate tokens, no separator when it's mid-word). Examples: "UPI/.../SURE\nSH KUMAR" → "UPI/.../SURESH KUMAR" (mid-word wrap, joined). "NEFT-HDFC-RAMESH\nKUMAR" → "NEFT-HDFC-RAMESH KUMAR" (between tokens).

STRICT RULES:
- Output MUST be valid JSON. No commentary, no code fences.
- Escape quotes in strings. No literal newlines — use \\n.
- Include EVERY transaction you can read. Do NOT summarize or group.
- Dates must be YYYY-MM-DD. If the statement shows DD/MM/YYYY, convert.
- DO NOT emit an "amount", "category", "subcategory", "counterparty", "reference", or "isRecurring" field. Server-side post-processing fills those — emitting them just costs output tokens.`;
