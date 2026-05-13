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

Schema (all fields required, use null where unknown):
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

CRITICAL — account-kind detection (asset vs liability):
- "accountKind" classifies the account itself, not any individual transaction.
- Set "accountKind": "asset" when the account is a SAVINGS, CURRENT, NRE / NRO, salary, or wallet account — i.e. customer's money sits in the account, balance is a CREDIT balance, deposits INCREASE the balance, withdrawals DECREASE it. This is the default — when in doubt, use "asset".
- Set "accountKind": "liability" when the account is a CASH CREDIT (CC), OVERDRAFT (OD), LOAN, KCC, MORTGAGE, or any working-capital credit line — i.e. the BANK's money is sitting in the account, balance is a DEBIT balance, withdrawals INCREASE the outstanding balance, repayments / deposits DECREASE it. Tells:
    * Every running balance carries a "Dr" / "DR" / "Dr." suffix (e.g. "510239.27Dr") — never just a bare number.
    * The printed account TYPE / SCHEME line contains words like "Cash Credit", "CC", "Overdraft", "OD", "Loan", "Mortgage", "KCC", "Term Loan", "Working Capital".
    * Narrations like "By Cash: N" represent the customer DEPOSITING cash into the credit line (reduces what's owed) — these decrease the Dr balance.
- Why this matters: the server derives every signed transaction amount as balance[i] - balance[i-1]. For an "asset" account, +delta = inflow / credit. For a "liability" account the convention INVERTS — +delta (Dr balance going up) means the customer drew more from the line, which is a debit / outflow. Reporting the wrong kind flips every transaction's debit/credit classification and turns deposits into expenses (the 2026-05 J&K CC MORTG case).
- Set "accountKind": null only if the document is so unusual you genuinely can't tell. The server then defaults to "asset", which is correct ~95% of the time.

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

CRITICAL — wrapped names across lines:
Many statements wrap a single name across two lines so it shows up in
the narration as e.g. "FD THROUGH DIGITALFD-...:SURE\nSH KUMAR" or
"...SANI\nL SETHI...". Reading naively yields phantom counterparties
"SURE", "SANI", "SH KUMAR", "L SETHI" — each gets its own row in the
counterparty list and totals split across them.
- ALWAYS join wrapped continuation lines into ONE counterparty before
  emitting. "SURE" + "SH KUMAR" → "SURESH KUMAR". "SANI" + "L SETHI"
  → "SANIL SETHI". "SURE" + "SH SETHI AND ASSOCIATES" → "SURESH SETHI
  AND ASSOCIATES".
- A short ALL-CAPS word (≤4 chars) at the END of a narration whose next
  line begins with another ALL-CAPS fragment is almost always a wrap.
  Concatenate the two fragments (no separator) and emit the joined
  string as the counterparty.
- Apply the same merge to the narration field itself — the wrapped
  name should appear as one word, not two.

Reference extraction: pull UTR / cheque number / reference number (usually a 10–16 digit alphanumeric token) into the reference field. If none, null.

Categorization rules (apply the FIRST match):
- Narration contains "SALARY" / "SAL CREDIT" → Salary
- Narration contains "RENT" as a credit → Rent Received
- Narration contains "INT.", "INTEREST PAID", "SB INT", "FD INT" → Interest Income
- Narration contains "DIV", "DIVIDEND" → Dividends
- Narration contains "GSTN", "GSTIN", "GST PMT" → GST Payments
- Narration contains "TDS", "26Q", "26QB" → TDS
- Narration contains "ADV TAX", "SELF ASMNT", "CHALLAN 280" → Taxes Paid
- Narration contains "EMI", "LOAN", "HDFC HL", "HOUSING LOAN", "LOAN RECOVERY" → Loan EMI
- Narration contains "SIP", "MUTUAL FUND", "MF ", "ZERODHA", "GROWW", "UPSTOX" → Investments
- Narration contains "NEFT", "IMPS", "UPI", "RTGS" with a personal counterparty (not GSTIN) → Transfers
- Narration starts with "By Cash", "BY CASH", "BY CSH", "CASH DEP", "CASH DEPOSIT" on a CREDIT row, OR contains "CAM/.../CASH DEP" / "CDM" on a credit → Cash Deposit (NOT Business Income — the customer paying cash into their own account is not a sale). Subcategory: "Counter" for over-the-counter / CC repayment, "CDM / ATM" for cash-deposit-machine, "Cheque" for self-cheque cash withdrawal/deposit pairs, "Other" otherwise.
- Debits to vendors (rent, utilities, office supplies, travel, ads) → Business Expenses with appropriate subcategory
- Credits to a business account from customers → Business Income
- Grocery, shopping, restaurants, personal consumption → Personal
- Anything that doesn't match → Other

Bank-fee narration anchors — apply BEFORE the generic NEFT/UPI/Transfers rule above. Each match also sets the listed subcategory:
- "ATM CHARGES" / "ATM ANN.CHRG" / "ATM WDR" / "ATM WDL CHG" / "DEBIT ATM CARD" → Bank Charges / ATM
- "CHRGS/NEFT" / "NEFT CHGS" / "CHRGS/IMPS" / "IMPS CHARGES" / "RTGS CHGS" / "RTGS-GST-COMMISSION" → Bank Charges / NEFT/IMPS/RTGS
- "SMS CHARGES" / "SMS CHRG" → Bank Charges / SMS
- "Min Bal Chrg" / "MAB CHRG" / "Avg bal Chgs" / "MINIMUM BALANCE CHARGES" → Bank Charges / Min Balance
- "LOAN_PROC" / "Loan Processing Fee" → Bank Charges / Loan Processing
- "CHEQUE BOOK CHGS" / "CHEQUE BOOK CHARGES" / "CHEQUE BOOK CHAREGS" → Bank Charges / Cheque
- "Cash Deposit Charges" / "CashDep Chgs" / "Cash Txn Chgs-Branch" → Bank Charges / Cash Txn
- "POS Rental" → Bank Charges / POS Rental
- "SoundBox Rent" → Bank Charges / SoundBox Rent
- "CIBIL" → Bank Charges / CIBIL
- "Penal Charges" / "Penal Cha" → Bank Charges / Penal
- "INSPC CHARGES" / "INSPECTION CHARGES" → Bank Charges / Inspection (note: INSPC is bank inspection charge, NOT insurance)
- "Reject Insufficient Balance" / "Outward Rejection Charges" / "Inward Rejection Charges" → Bank Charges / Rejection
- "DEBIT CARD ANNUAL FEE" → Bank Charges / Card Fee
- "ADHOC STMT CHGS" / "ACCT MAIN CHARGES" / "INCIDENTAL CHARGES" / "LOW DENOMINATION CHARGE" → Bank Charges / Other
- "Int.Coll" → Bank Interest (Dr) / Loan Interest
- "Int.Pd:" / "CREDIT INTEREST" → Bank Interest (Cr)
- "INS-" / "INS_" / "Insurance" / "_PROPERTY_INS_" / "_INS_RENEWAL_" → Insurance / Premium
- "BIL/BPAY/BSNL" / "PAYTMBSNL" → Mobile Charges / BSNL
- "BIL/BPAY/AIRTEL" / "PAYTMAIRTEL" → Mobile Charges / Airtel
- "BIL/BPAY/JIO" / "PAYTMJIO" → Mobile Charges / Jio
- "BILL DK POWER" / "BILL DKP" / DISCOM names → Electricity Charges / DISCOM
- "WATER BILL" → Water Charges / Municipal

isRecurring = true when the same narration pattern appears at least twice with similar amounts (monthly salary, EMI, SIP, rent).

STRICT RULES:
- Output MUST be valid JSON. No commentary, no code fences.
- Escape quotes in strings. No literal newlines — use \\n.
- Include EVERY transaction you can read. Do NOT summarize or group.
- Dates must be YYYY-MM-DD. If the statement shows DD/MM/YYYY, convert.
- subcategory may be null when none of the listed subcategories fit.
- DO NOT include an "amount" field on transactions. The server derives it from the balance column.`;
