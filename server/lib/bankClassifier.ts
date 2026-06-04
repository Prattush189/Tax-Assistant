/**
 * Deterministic narration → (category, subcategory, counterparty,
 * reference) classifier. Replaces the AI categorization step for the
 * 60-75% of bank-statement rows whose narration matches a known
 * anchor (bank charges, interest, UPI/NEFT/RTGS, POS, salary, EMI,
 * GST, TDS).
 *
 * Why server-side:
 *   - Cuts ~70% of rows from the AI pass. Each AI-bound row costs
 *     ~130 weighted tokens; classifier rows cost zero.
 *   - Deterministic = testable. Categorization regressions become
 *     bug reports against a regex table, not "the model felt
 *     differently today" prompt engineering.
 *   - Source of truth for the dashboard buckets sits in code
 *     (versioned, reviewable) rather than a 8K-char prompt string.
 *
 * Returning null is reserved for genuinely-ambiguous narrations
 * (e.g. "ABC ENTERPRISES" — could be Business Expenses, Investments,
 * or Personal depending on the user's context). Null rows fall
 * through to the small AI enrichment batch the routes still keep.
 *
 * Anchor lists are derived from BANK CHARGES FORMAT.xlsx (the
 * user's hand-curated category wishlist) plus the UPI/NEFT/RTGS
 * patterns Indian bank statements have used unchanged for ~5 years.
 */

import type { BankStatementCategory } from './bankStatementPrompt.js';

export interface ClassifierInput {
  narration: string;
  /** 'credit' = inflow, 'debit' = outflow. Some rules depend on
   *  direction (RENT credit → Rent Received vs RENT debit →
   *  Business Expenses, INTEREST PAID credit vs debit, etc). */
  type: 'credit' | 'debit';
  /** Absolute amount in INR. Currently unused by classification
   *  rules but plumbed in case future rules need amount thresholds
   *  (e.g. ATM > ₹X is rare → Personal/large-cash, not Bank Charges). */
  amount?: number;
}

export interface ClassifierResult {
  category: BankStatementCategory;
  subcategory: string | null;
  counterparty: string | null;
  reference: string | null;
}

/**
 * Anchor table. Order matters — rules are tried top-to-bottom,
 * first match wins. Specific anchors (e.g. "MAB CHRG") MUST come
 * before generic ones (e.g. "BAL CHRG") to avoid false-positives.
 *
 * Each rule is a single regex tested against the LOWERCASED
 * narration. Lowercasing avoids per-rule case-insensitivity flag
 * boilerplate and is empirically safe — Indian bank narrations
 * rarely encode meaning in case.
 */
interface Rule {
  /** Pattern matched against the lowercased narration. */
  pattern: RegExp;
  /** Static category, OR a function that picks based on direction. */
  category: BankStatementCategory | ((input: ClassifierInput) => BankStatementCategory | null);
  /** Static subcategory, or null. */
  subcategory?: string | null;
  /** If set, restricts the rule to rows of this direction. */
  direction?: 'credit' | 'debit';
  /** Human-readable label for debugging / smoke tests. */
  name: string;
}

const RULES: Rule[] = [
  // ─── Bank Charges ──────────────────────────────────────────────
  // The xlsx wishlist drives this whole block. Listed in the same
  // order as the user's reference document so future edits map
  // 1:1 onto the source.

  // ATM
  { name: 'atm-charges-quarterly', pattern: /\batm charges\b|atm ann\.?chrg|atm ann chrg|atm wdr\b|atm wdl chg|debit atm card|atm.* annual fee/i, category: 'Bank Charges', subcategory: 'ATM' },

  // Wire-transfer fees (NEFT/IMPS/RTGS) — anchor on the CHRGS/CHGS
  // prefix the bank uses for charges so we don't confuse with the
  // transfer narration itself.
  { name: 'wire-charges', pattern: /chrgs?\/(neft|imps|rtgs)|(?:neft|imps|rtgs) chgs|rtgs[-\s]?gst[-\s]?commission|imps charges/i, category: 'Bank Charges', subcategory: 'NEFT/IMPS/RTGS' },

  // SMS
  { name: 'sms-charges', pattern: /sms (?:charges|chrg)/i, category: 'Bank Charges', subcategory: 'SMS' },

  // Min Balance — distinct subcategory because the user tracks it.
  // Cover both "Min Bal Chrg", "MAB CHRG" (Monthly Average Balance),
  // "Avg bal Chgs", "MINIMUM BALANCE CHARGES".
  // "MAB" (Monthly Average Balance — used by most private banks) and
  // "AMB" (Account Minimum Balance — J&K Bank's wording) both denote
  // the same penalty: customer's average balance fell below the
  // required floor. Group both into the same subcategory so the
  // dashboard rolls them up cleanly.
  { name: 'min-balance', pattern: /\bmab chrg\b|min bal chrg|avg bal chgs|minimum balance charges|\bamb\s+charges?\b/i, category: 'Bank Charges', subcategory: 'Min Balance' },

  // Loan processing
  { name: 'loan-processing', pattern: /loan_proc|loan processing fee/i, category: 'Bank Charges', subcategory: 'Loan Processing' },

  // CIBIL
  { name: 'cibil', pattern: /\bcibil\b/i, category: 'Bank Charges', subcategory: 'CIBIL' },

  // Cheque book
  { name: 'cheque-book', pattern: /cheque book ch(?:gs|arges|aregs)/i, category: 'Bank Charges', subcategory: 'Cheque' },

  // Cash transaction charges (separate from cash deposit/withdrawal
  // counter ops themselves — those are Transfers if recorded as
  // credit/debit lines).
  //
  // 2026-06 update: ICICI / HDFC frequently emit these labels with NO
  // spaces ("CashTxnChgs-Branch-Dec25+GST", "CashDepChgs", "CashChgs").
  // The original space-separated patterns missed every one of them in
  // the user's ICICI sample. Both forms — spaced and spaceless — now
  // share a single regex group via `\s*` between tokens.
  { name: 'cash-txn-charges', pattern: /cash\s*deposit\s*charges|cash\s*dep\s*chgs|cash\s*txn\s*chgs|cash\s*chgs/i, category: 'Bank Charges', subcategory: 'Cash Txn' },

  // POS / SoundBox rentals (recurring fixed fees)
  { name: 'pos-rental', pattern: /pos rental/i, category: 'Bank Charges', subcategory: 'POS Rental' },
  { name: 'soundbox-rent', pattern: /soundbox rent/i, category: 'Bank Charges', subcategory: 'SoundBox Rent' },

  // Penal
  { name: 'penal', pattern: /penal cha?(?:rges)?\b|reject insufficient balance/i, category: 'Bank Charges', subcategory: 'Penal' },

  // Inspection — bank inspection charge, NOT insurance. INSPC was
  // a known confound in the old AI prompt (it sometimes tagged
  // these as Insurance). The deterministic rule here gets it right.
  { name: 'inspection', pattern: /\binspc charges\b|inspection charges/i, category: 'Bank Charges', subcategory: 'Inspection' },

  // Cheque return / rejection
  // Rejection / cheque-return charges. Banks word this several ways:
  // "Outward Rejection Charges" / "Inward Rejection Charges" (J&K Bank
  // / PNB style) and "INWARD CHQ RETURN CHRGS" / "Cheque Return Chg"
  // (YES Bank / HDFC style). Both variants are the same fee — bank
  // charged you for a bounced cheque, inward (someone gave you a
  // cheque that bounced) or outward (your cheque bounced).
  { name: 'rejection', pattern: /(?:outward|inward)\s+(?:rejection|chq\s*return|cheque\s*return)\s+ch(?:gs?|arges?|rgs)?|chq\s*return\s+ch(?:gs?|arges?|rgs)?/i, category: 'Bank Charges', subcategory: 'Rejection' },

  // Card fees
  { name: 'card-annual-fee', pattern: /debit card annual fee/i, category: 'Bank Charges', subcategory: 'Card Fee' },

  // Catch-all bank-charge anchors. Listed last in this block so
  // specific subcategories above always win. ADHOC STMT / ACCT MAIN
  // / INCIDENTAL / LOW DENOMINATION map to the "Other" subcategory.
  { name: 'misc-bank-charges', pattern: /adhoc stmt chgs|acct main charges|incidental charges|low denomination charge/i, category: 'Bank Charges', subcategory: 'Other' },

  // ─── Bank Interest ─────────────────────────────────────────────
  // "Int.Coll" = interest collected on debit balance (always Dr to
  // the customer). "Int.Pd:" = interest paid by bank to customer
  // (always Cr). Direction-anchored so a misformatted line doesn't
  // get filed wrong.
  { name: 'int-collected', pattern: /int\.coll\b|loan interest|od interest/i, category: 'Bank Interest (Dr)', subcategory: 'Loan Interest', direction: 'debit' },
  // J&K Bank narrations for loan-account interest charges. "MARGIN
  // TERM LOAN" / standalone "MARGIN" / "PART PERIOD INTEREST" are all
  // periodic interest debits on a Cash Credit / Term Loan account.
  // Without these rules the AI tagged them Business Expenses, which
  // is technically a debit but misses that it's interest, not vendor
  // spend.
  { name: 'jkbank-margin-loan', pattern: /^margin\s+term\s+loan\b|^margin$|part\s+period\s+interest/i, category: 'Bank Interest (Dr)', subcategory: 'Loan Interest', direction: 'debit' },
  { name: 'int-paid', pattern: /int\.pd:|credit interest/i, category: 'Bank Interest (Cr)', subcategory: 'Savings', direction: 'credit' },

  // ─── Insurance ─────────────────────────────────────────────────
  // The xlsx hint distinguishes "INSPC" (inspection charge) from
  // "INS-" / "INS_" / "Insurance" (premium). Inspection rule above
  // already absorbed INSPC; this catches the remainder.
  { name: 'insurance', pattern: /\bins[-_]|\binsurance\b|_ins_renewal_|_property_ins_|premium.*paid/i, category: 'Insurance', subcategory: 'Premium' },

  // ─── Telecom recharges (Mobile Charges) ────────────────────────
  // The xlsx lists BIL/BPAY/<TELCO> + PAYTM<TELCO> as known
  // patterns. Each telco maps to a distinct subcategory.
  { name: 'mobile-bsnl', pattern: /bil\/bpay\/bsnl|paytmbsnl/i, category: 'Mobile Charges', subcategory: 'BSNL' },
  { name: 'mobile-airtel', pattern: /bil\/bpay\/airtel|paytmairtel/i, category: 'Mobile Charges', subcategory: 'Airtel' },
  { name: 'mobile-jio', pattern: /bil\/bpay\/jio|paytmjio/i, category: 'Mobile Charges', subcategory: 'Jio' },

  // ─── Utilities ─────────────────────────────────────────────────
  // "BILL DK POWER DEVELOPMENT" / "BILL DKP" → Electricity (the
  // user's J&K Discom). Generic: any bill payment containing
  // POWER/DISCOM/electricity → Electricity.
  { name: 'electricity', pattern: /bill dkp\b|bill dk power|electricity bill|\bdiscom\b|bill payment.*power/i, category: 'Electricity Charges', subcategory: 'DISCOM' },
  { name: 'water', pattern: /water bill|municipal.*water/i, category: 'Water Charges', subcategory: 'Municipal' },

  // ─── Loan EMI ──────────────────────────────────────────────────
  // EMI is the obvious one. "Loan Recovery" is JKBank's term for an
  // EMI debit on a loan account. "HOUSING LOAN" / "HDFC HL" cover
  // the mortgage shorthand banks use.
  { name: 'loan-emi', pattern: /\bemi\b|loan recovery|housing loan|hdfc hl\b|home loan emi|car loan emi/i, category: 'Loan EMI', subcategory: null, direction: 'debit' },

  // ─── Salary ────────────────────────────────────────────────────
  // Salary is always a credit. The "SALARY" / "SAL CREDIT" /
  // "SAL FOR" tokens are how Indian banks tag payroll.
  { name: 'salary', pattern: /\bsalary\b|sal credit|sal for|salary credit/i, category: 'Salary', direction: 'credit' },

  // ─── Rent ──────────────────────────────────────────────────────
  // RENT as a credit = Rent Received. RENT as a debit = Business
  // Expenses (Rent subcategory). Direction-split rule below uses the
  // function-form category to handle both cases in one rule.
  {
    name: 'rent',
    pattern: /\brent\b/i,
    category: (input) => input.type === 'credit' ? 'Rent Received' : 'Business Expenses',
    subcategory: null,
  },

  // ─── Investments ───────────────────────────────────────────────
  // SIP / mutual-fund platforms have very recognizable narrations.
  { name: 'investments', pattern: /\bsip\b|mutual fund|\bmf-|\bzerodha\b|\bgroww\b|\bupstox\b|\bicici prudential\b/i, category: 'Investments', subcategory: 'MF' },

  // ─── GST / TDS / Taxes ────────────────────────────────────────
  // These match before generic NEFT/UPI rules so a GST payment via
  // NEFT lands in GST Payments, not Transfers.
  { name: 'gst-payment', pattern: /gst pmt|gstn-?\d|gstin\s*\d{15}|gst payment|\bcgst\b|\bsgst\b|\bigst\b/i, category: 'GST Payments', subcategory: null, direction: 'debit' },
  { name: 'tds', pattern: /\btds\b|26q[bc]?|tds payment/i, category: 'TDS', subcategory: null, direction: 'debit' },
  { name: 'taxes-paid', pattern: /\badv tax\b|self asmnt|self assessment|challan 280|advance tax/i, category: 'Taxes Paid', subcategory: 'Advance Tax', direction: 'debit' },

  // ─── Interest Income (NOT Bank Interest Cr) ───────────────────
  // FD / SB interest credits to a separate FD account. Distinct
  // from the "Bank Interest (Cr)" anchor above which is the
  // bank-statement-specific Int.Pd line.
  { name: 'interest-income', pattern: /\bsb int\b|\bfd int\b|interest paid|fixed deposit interest/i, category: 'Interest Income', subcategory: 'Other', direction: 'credit' },

  // ─── Dividends ─────────────────────────────────────────────────
  { name: 'dividend', pattern: /\bdividend\b|\bdiv\b.*credit/i, category: 'Dividends', direction: 'credit' },

  // ─── Cash Deposit ──────────────────────────────────────────────
  // Cash INFLOW to the account. Three common channels:
  //   - "By Cash: N" — J&K Bank Cash Credit narration where the
  //     customer deposits cash at the counter. Common in CC MORTG /
  //     CASH CREDIT SCHEME formats. The transfer-personal rule below
  //     also matches `^by cash\b`, so this rule sits before it and
  //     wins on the credit side. Debit-direction "By Cash" rows
  //     (rare — would mean cash withdrawal narrated this way) fall
  //     through to the existing logic.
  //   - "BY CASH - <branch>" — savings/current cash deposit, branch
  //     location appended (e.g. "BY CASH -SRINAGAR - KARAN NAGAR").
  //   - "CASH DEP" / "CASH DEPOSIT" / "CAM/.../CASH DEP-" — cash
  //     deposit machine (CDM) / cash acceptor machine (CAM)
  //     narrations on ICICI / HDFC / Axis statements.
  //
  // Direction-locked to credit so a "CASH PAID" / "CASH WDL" line
  // doesn't accidentally get filed as a deposit. The narration alone
  // ("Cash") is ambiguous about direction; the column the row landed
  // in is authoritative.
  //
  // Without this rule the rows landed in "Business Income" via the
  // AI fallback (Cash Credit deposit screenshots from May 2026 were
  // the trigger). User wanted them in a distinct bucket so cash
  // movements don't inflate operating-revenue totals.
  {
    name: 'cash-deposit-counter',
    pattern: /^by\s+(?:cash|csh)\b|^cash\s+dep(?:osit)?\b/i,
    category: 'Cash Deposit',
    subcategory: 'Counter',
    direction: 'credit',
  },
  {
    name: 'cash-deposit-cdm',
    // CAM / CDM narrations: "CAM/25271OAR/CASH DEP-Other/02-10-25/5228".
    // The "CASH DEP" segment is the tell; the CAM prefix is the
    // machine identifier (Cash Acceptor Machine).
    pattern: /\bcam\b.*\bcash\s*dep|\bcdm\b|cash\s*deposit\s*machine|cash\s*acceptor/i,
    category: 'Cash Deposit',
    subcategory: 'CDM / ATM',
    direction: 'credit',
  },
  // Broad catch-all per user direction (2026-06): "wherever the word
  // cash or deposit appears in a narration, in any format, classify
  // it as Cash Deposit." Direction-locked to credit because Cash
  // Deposit is semantically an INFLOW — a debit row containing
  // "cash" is almost always a withdrawal / cash-out, which is a
  // different bucket and would mislead the dashboard if filed here.
  //
  // The specific channel-aware rules above (counter, CDM/CAM) still
  // own precise subcategory tagging because rule order is top-down;
  // this rule only fires when neither of them matched. Bank-charge
  // rules earlier in the table (`cash-txn-charges`, `cash-deposit
  // charges`) are direction-agnostic and would still fire on debit
  // cash-deposit-CHARGE rows because they run before this catch-all.
  //
  // Word-boundary anchor on `cash` so a counterparty named
  // "CASHFREE" / "Cashpoor Pvt Ltd" doesn't false-positive.
  // `\bdeposit` (no trailing \b) also matches "deposits" / "deposited"
  // / "depositor" — all legitimate variants of the same intent.
  // "Deposit Insurance Corporation" (DICGC) refunds are rare on
  // ordinary CA / SB statements; if one shows up it'll land here,
  // which is reasonable (it IS a deposit-related credit).
  {
    name: 'cash-or-deposit-broad',
    pattern: /\bcash\b|\bdeposit/i,
    category: 'Cash Deposit',
    subcategory: 'Other',
    direction: 'credit',
  },

  // ─── Cash Withdrawal (debit side, mirror of Cash Deposit) ─────
  // ATM / CDM cash withdrawal narrations: "CAM/34761HRY/CASH WDL/...",
  // "ATM WDL", "ATM CASH WITHDRAWAL". CAM = Cash Acceptor Machine but
  // ICICI also routes WDL (withdrawal) lines through the same CAM
  // prefix, so the WDL token is the tell.
  {
    name: 'cash-withdrawal-atm-cdm',
    pattern: /\bcam\b.*\bcash\s*wdl|\batm\b.*\bcash\s*(?:wdl|withdrawal)|cash\s*wdl|cash\s*withdrawal/i,
    category: 'Cash Withdrawal',
    subcategory: 'ATM / CDM',
    direction: 'debit',
  },
  // Counter / self-cheque cash withdrawals: "CASH PAID:Self 3476 DELHI",
  // "CASH PAID-SELF", "BY CASH" (debit). Direction-locked so a credit
  // "BY CASH" still falls to the Cash Deposit counter rule above.
  {
    name: 'cash-withdrawal-counter',
    pattern: /^cash\s*paid\b|cash\s*paid\s*[:\-]\s*self|self\s*cheque|self\s*chq|^by\s+cash\b/i,
    category: 'Cash Withdrawal',
    subcategory: 'Counter',
    direction: 'debit',
  },

  // ─── TRFR FROM: / TRFR TO: (J&K Bank-style internal transfer) ──
  // "TRFR FROM:THE WANI FOOTWEAR" / "TRFR TO:PARTY NAME". Direction-
  // agnostic: the type column says credit/debit and the rule simply
  // tags it as Transfers — counterparty is extracted from the segment
  // after the colon. Without this rule a clean ₹1,00,000 transfer-in
  // defaulted to "Other" in the ICICI sample.
  {
    name: 'trfr-internal',
    pattern: /^trfr\s+(?:from|to)\s*:/i,
    category: 'Transfers',
    subcategory: null,
  },

  // ─── Cloud / SaaS (Business Expenses · Software) ──────────────
  // Match BEFORE the generic e-commerce / AMAZON rules so AWS doesn't
  // get tagged as Personal · E-commerce. All direction-anchored to
  // debit — these are always outflows on an Indian operating account.
  // Patterns use word boundaries to avoid false-positives on common
  // English substrings (e.g. `\bgithub\b` matches "GITHUB" but not
  // "GITHUBARI"; `\bslack\b` matches "SLACK" but not "SLACKEN").
  { name: 'aws', pattern: /\baws\b|amazon\s+web\s+services|amazonaws/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },
  { name: 'google-cloud', pattern: /google\s+cloud|\bgcp\b/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },
  { name: 'google-workspace', pattern: /google\s+workspace|g[\s-]?suite/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },
  { name: 'azure', pattern: /microsoft\s+azure|\bazure\s+/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },
  { name: 'microsoft-365', pattern: /microsoft\s*365|office\s*365|ms[\s-]?office/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },
  { name: 'github', pattern: /\bgithub\b/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },
  { name: 'gitlab', pattern: /\bgitlab\b/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },
  { name: 'figma', pattern: /\bfigma\b/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },
  { name: 'slack', pattern: /\bslack\b/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },
  { name: 'notion', pattern: /\bnotion\b(?!\s+of)/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },
  { name: 'zoho', pattern: /\bzoho\b/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },
  { name: 'salesforce', pattern: /salesforce/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },
  { name: 'shopify', pattern: /\bshopify\b/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },
  { name: 'razorpay', pattern: /razorpay/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },
  { name: 'cashfree', pattern: /cashfree/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },
  { name: 'stripe', pattern: /\bstripe\b/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },
  { name: 'adobe', pattern: /\badobe\b/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },
  { name: 'atlassian', pattern: /atlassian|\bjira\b|confluence/i, category: 'Business Expenses', subcategory: 'Software', direction: 'debit' },

  // ─── Marketing / Ads (Business Expenses · Marketing) ──────────
  { name: 'google-ads', pattern: /google\s+ads|google\s+adwords|\badwords\b/i, category: 'Business Expenses', subcategory: 'Marketing', direction: 'debit' },
  { name: 'meta-ads', pattern: /meta\s+(?:ads|platforms)|facebook\s+ads|instagram\s+ads/i, category: 'Business Expenses', subcategory: 'Marketing', direction: 'debit' },
  { name: 'linkedin-ads', pattern: /linkedin\s+(?:ads|premium|sales)/i, category: 'Business Expenses', subcategory: 'Marketing', direction: 'debit' },

  // ─── E-commerce (Personal · E-commerce) ───────────────────────
  // Amazon comes AFTER the AWS rule above and excludes the PRIME /
  // PRIME VIDEO subscription variant via lookahead — Prime Video is
  // tagged Subscriptions, not E-commerce. The lookahead is belt-and-
  // braces: the Subscriptions block below has an `amazon-prime` rule
  // that would catch it anyway, but the lookahead means we don't
  // depend on rule-order discipline for the right answer.
  { name: 'amazon', pattern: /\bamazon(?!\s+(?:web|aws|prime))/i, category: 'Personal', subcategory: 'E-commerce', direction: 'debit' },
  { name: 'flipkart', pattern: /\bflipkart\b/i, category: 'Personal', subcategory: 'E-commerce', direction: 'debit' },
  { name: 'myntra', pattern: /\bmyntra\b/i, category: 'Personal', subcategory: 'E-commerce', direction: 'debit' },
  { name: 'meesho', pattern: /\bmeesho\b/i, category: 'Personal', subcategory: 'E-commerce', direction: 'debit' },
  { name: 'ajio', pattern: /\bajio\b/i, category: 'Personal', subcategory: 'E-commerce', direction: 'debit' },
  { name: 'nykaa', pattern: /\bnykaa\b/i, category: 'Personal', subcategory: 'E-commerce', direction: 'debit' },
  { name: 'tatacliq', pattern: /tata\s*cliq|tatacliq/i, category: 'Personal', subcategory: 'E-commerce', direction: 'debit' },
  { name: 'snapdeal', pattern: /snapdeal/i, category: 'Personal', subcategory: 'E-commerce', direction: 'debit' },
  { name: 'firstcry', pattern: /firstcry/i, category: 'Personal', subcategory: 'E-commerce', direction: 'debit' },
  { name: 'pepperfry', pattern: /pepperfry/i, category: 'Personal', subcategory: 'E-commerce', direction: 'debit' },

  // ─── Food Delivery (Personal · Food Delivery) ─────────────────
  // Swiggy Instamart is quick-commerce, not food delivery — match
  // that variant FIRST so it goes to the right subcategory. Same for
  // "swiggy genie" (errands) which we lump under Food Delivery for
  // simplicity.
  { name: 'swiggy-instamart', pattern: /swiggy\s*instamart|swiggy\s*store/i, category: 'Personal', subcategory: 'Quick Commerce', direction: 'debit' },
  { name: 'swiggy', pattern: /\bswiggy\b/i, category: 'Personal', subcategory: 'Food Delivery', direction: 'debit' },
  { name: 'zomato', pattern: /\bzomato\b/i, category: 'Personal', subcategory: 'Food Delivery', direction: 'debit' },
  { name: 'eatfit', pattern: /eat\.?fit|\beatfit\b/i, category: 'Personal', subcategory: 'Food Delivery', direction: 'debit' },
  { name: 'dunzo', pattern: /\bdunzo\b/i, category: 'Personal', subcategory: 'Food Delivery', direction: 'debit' },

  // ─── Quick Commerce / Grocery (Personal · Quick Commerce) ─────
  { name: 'blinkit', pattern: /\bblinkit\b|grofers/i, category: 'Personal', subcategory: 'Quick Commerce', direction: 'debit' },
  { name: 'zepto', pattern: /\bzepto\b/i, category: 'Personal', subcategory: 'Quick Commerce', direction: 'debit' },
  { name: 'bigbasket', pattern: /big\s*basket|bigbasket/i, category: 'Personal', subcategory: 'Quick Commerce', direction: 'debit' },
  { name: 'jiomart', pattern: /\bjiomart\b|jio\s*mart/i, category: 'Personal', subcategory: 'Quick Commerce', direction: 'debit' },

  // ─── Cabs / Transport (Personal · Cabs) ───────────────────────
  // `\bola\b` is safe — word-boundary on both sides means "OLAMONEY"
  // (one word) and "BANGALORE" (no boundary inside) don't match.
  // Standalone "OLA" tokens in narrations (POS OLA, UPI/.../ola@ybl)
  // do match.
  { name: 'olamoney', pattern: /olamoney|ola\s*money|ola\s*postpaid/i, category: 'Personal', subcategory: 'Cabs', direction: 'debit' },
  { name: 'ola', pattern: /\bola\b/i, category: 'Personal', subcategory: 'Cabs', direction: 'debit' },
  { name: 'uber', pattern: /\buber\b/i, category: 'Personal', subcategory: 'Cabs', direction: 'debit' },
  { name: 'rapido', pattern: /\brapido\b/i, category: 'Personal', subcategory: 'Cabs', direction: 'debit' },
  { name: 'redbus', pattern: /\bredbus\b/i, category: 'Personal', subcategory: 'Cabs', direction: 'debit' },

  // ─── Subscriptions / OTT (Personal · Subscriptions) ──────────
  // Amazon Prime Video appears as "AMAZON PRIME" / "AMAZON PRIME VIDEO"
  // in POS narrations. The generic amazon E-commerce rule above
  // explicitly excludes the PRIME variant via lookahead, so this rule
  // fires correctly for prime-video subscriptions.
  { name: 'amazon-prime', pattern: /amazon\s*prime|prime\s*video/i, category: 'Personal', subcategory: 'Subscriptions', direction: 'debit' },
  { name: 'netflix', pattern: /\bnetflix\b/i, category: 'Personal', subcategory: 'Subscriptions', direction: 'debit' },
  { name: 'spotify', pattern: /\bspotify\b/i, category: 'Personal', subcategory: 'Subscriptions', direction: 'debit' },
  { name: 'hotstar', pattern: /\bhotstar\b|disney\+|disney\s*plus/i, category: 'Personal', subcategory: 'Subscriptions', direction: 'debit' },
  { name: 'youtube', pattern: /youtube\s*premium|google\s*\*?\s*youtube/i, category: 'Personal', subcategory: 'Subscriptions', direction: 'debit' },
  { name: 'zee5', pattern: /\bzee5\b|zee\s*5/i, category: 'Personal', subcategory: 'Subscriptions', direction: 'debit' },
  { name: 'sonyliv', pattern: /sonyliv|sony\s*liv/i, category: 'Personal', subcategory: 'Subscriptions', direction: 'debit' },
  { name: 'appletv', pattern: /apple\.com\/?bill|apple\s*tv|itunes/i, category: 'Personal', subcategory: 'Subscriptions', direction: 'debit' },
  { name: 'google-play', pattern: /google\s*\*?\s*play|playstore/i, category: 'Personal', subcategory: 'Subscriptions', direction: 'debit' },
  { name: 'altbalaji', pattern: /alt\s*balaji|altbalaji/i, category: 'Personal', subcategory: 'Subscriptions', direction: 'debit' },

  // ─── Fuel (Personal · Fuel) ──────────────────────────────────
  // Tight patterns — "IOC" alone is too short / generic; require
  // the longer "INDIAN OIL" / "INDIANOIL" string. "HPCL" / "HP RETAIL"
  // is safe (no overlap with HP Inc. hardware). "SHELL" alone is
  // risky (shell company), so require fuel-context tokens.
  { name: 'indian-oil', pattern: /indian\s*oil|indianoil|\biocl\b/i, category: 'Personal', subcategory: 'Fuel', direction: 'debit' },
  { name: 'hpcl', pattern: /\bhpcl\b|hp\s*retail|hp\s*petrol/i, category: 'Personal', subcategory: 'Fuel', direction: 'debit' },
  { name: 'bpcl', pattern: /\bbpcl\b|bharat\s*petroleum/i, category: 'Personal', subcategory: 'Fuel', direction: 'debit' },
  { name: 'reliance-petroleum', pattern: /reliance\s*petro|ril\s*petrol/i, category: 'Personal', subcategory: 'Fuel', direction: 'debit' },
  { name: 'shell-petrol', pattern: /shell\s*(?:petrol|fuel|outlet|retail)/i, category: 'Personal', subcategory: 'Fuel', direction: 'debit' },
  { name: 'nayara', pattern: /\bnayara\b/i, category: 'Personal', subcategory: 'Fuel', direction: 'debit' },

  // ─── Telecom standalone recharge (Personal · Telecom) ─────────
  // The earlier "Mobile Charges" rules catch the bank's BIL/BPAY
  // bill-pay format (Bharat BillPay infrastructure). This block
  // catches direct recharges (UPI / POS to a telco merchant) which
  // appear with telco brand alone, no BIL/BPAY prefix.
  //
  // `\bjio\b` safe (3 letters, no English collision). `\bairtel\b`
  // safe. `\bvi\b` is risky in theory but word boundaries make it
  // safe in practice (VISA / VIDEO / VIBRANT all fail the \b...\b
  // check). `\bbsnl\b` safe.
  { name: 'airtel-recharge', pattern: /\bairtel\b/i, category: 'Personal', subcategory: 'Telecom', direction: 'debit' },
  { name: 'jio-recharge', pattern: /\bjio\b(?!mart)|reliance\s+jio/i, category: 'Personal', subcategory: 'Telecom', direction: 'debit' },
  { name: 'vi-recharge', pattern: /vodafone\s+idea|\bvi\b\s+(?:india|postpaid|prepaid|recharge)|vodafone/i, category: 'Personal', subcategory: 'Telecom', direction: 'debit' },
  { name: 'bsnl-recharge', pattern: /\bbsnl\b/i, category: 'Personal', subcategory: 'Telecom', direction: 'debit' },

  // ─── Restaurants (Personal · Restaurants) ─────────────────────
  // Chain restaurants only — long tail of mom-and-pop restaurants
  // falls to AI fallback. Patterns require word boundaries so
  // "DOMINO'S" matches but a string containing "domino" inside
  // another word doesn't.
  { name: 'dominos', pattern: /domino'?s/i, category: 'Personal', subcategory: 'Restaurants', direction: 'debit' },
  { name: 'pizzahut', pattern: /pizza\s*hut|pizzahut/i, category: 'Personal', subcategory: 'Restaurants', direction: 'debit' },
  { name: 'mcdonalds', pattern: /mcdonald'?s|\bmcd\b/i, category: 'Personal', subcategory: 'Restaurants', direction: 'debit' },
  { name: 'kfc', pattern: /\bkfc\b/i, category: 'Personal', subcategory: 'Restaurants', direction: 'debit' },
  { name: 'burgerking', pattern: /burger\s*king|burgerking/i, category: 'Personal', subcategory: 'Restaurants', direction: 'debit' },
  { name: 'barbeque-nation', pattern: /barbeque\s*nation|bbq\s*nation/i, category: 'Personal', subcategory: 'Restaurants', direction: 'debit' },
  { name: 'starbucks', pattern: /starbucks/i, category: 'Personal', subcategory: 'Restaurants', direction: 'debit' },
  { name: 'subway', pattern: /\bsubway\b/i, category: 'Personal', subcategory: 'Restaurants', direction: 'debit' },
  { name: 'haldirams', pattern: /haldiram'?s/i, category: 'Personal', subcategory: 'Restaurants', direction: 'debit' },

  // ─── Healthcare (Personal · Healthcare) ──────────────────────
  { name: '1mg', pattern: /\b1mg\b|tata\s*1mg/i, category: 'Personal', subcategory: 'Healthcare', direction: 'debit' },
  { name: 'pharmeasy', pattern: /pharmeasy|pharm\s*easy/i, category: 'Personal', subcategory: 'Healthcare', direction: 'debit' },
  { name: 'netmeds', pattern: /netmeds/i, category: 'Personal', subcategory: 'Healthcare', direction: 'debit' },
  { name: 'apollo-pharmacy', pattern: /apollo\s*pharmacy|apollo\s*hospitals?/i, category: 'Personal', subcategory: 'Healthcare', direction: 'debit' },
  { name: 'practo', pattern: /\bpracto\b/i, category: 'Personal', subcategory: 'Healthcare', direction: 'debit' },
  { name: 'medplus', pattern: /\bmedplus\b/i, category: 'Personal', subcategory: 'Healthcare', direction: 'debit' },

  // ─── Education (Personal · Education) ────────────────────────
  { name: 'byjus', pattern: /byju'?s|byjus/i, category: 'Personal', subcategory: 'Education', direction: 'debit' },
  { name: 'unacademy', pattern: /unacademy/i, category: 'Personal', subcategory: 'Education', direction: 'debit' },
  { name: 'coursera', pattern: /coursera/i, category: 'Personal', subcategory: 'Education', direction: 'debit' },
  { name: 'udemy', pattern: /\budemy\b/i, category: 'Personal', subcategory: 'Education', direction: 'debit' },
  { name: 'vedantu', pattern: /vedantu/i, category: 'Personal', subcategory: 'Education', direction: 'debit' },
  { name: 'whitehat', pattern: /whitehat\s*jr/i, category: 'Personal', subcategory: 'Education', direction: 'debit' },

  // ─── Travel (Personal · Travel) ──────────────────────────────
  // Booking platforms + hotel chains. IRCTC ticket booking shows up
  // as "IRCTC" or "IRCTC ECOMM" in narrations — capture both.
  { name: 'makemytrip', pattern: /makemytrip|\bmmt\b\s+(?:online|hotels?)|\bmmtonline\b/i, category: 'Personal', subcategory: 'Travel', direction: 'debit' },
  { name: 'yatra', pattern: /\byatra\b\s*(?:online|trips?)?/i, category: 'Personal', subcategory: 'Travel', direction: 'debit' },
  { name: 'cleartrip', pattern: /cleartrip/i, category: 'Personal', subcategory: 'Travel', direction: 'debit' },
  { name: 'goibibo', pattern: /goibibo/i, category: 'Personal', subcategory: 'Travel', direction: 'debit' },
  { name: 'easemytrip', pattern: /easemytrip|ease\s*my\s*trip/i, category: 'Personal', subcategory: 'Travel', direction: 'debit' },
  { name: 'irctc', pattern: /\birctc\b/i, category: 'Personal', subcategory: 'Travel', direction: 'debit' },
  { name: 'oyo', pattern: /\boyo\b/i, category: 'Personal', subcategory: 'Travel', direction: 'debit' },
  { name: 'booking', pattern: /booking\.com|booking\.holdings/i, category: 'Personal', subcategory: 'Travel', direction: 'debit' },
  { name: 'agoda', pattern: /\bagoda\b/i, category: 'Personal', subcategory: 'Travel', direction: 'debit' },
  { name: 'airbnb', pattern: /airbnb/i, category: 'Personal', subcategory: 'Travel', direction: 'debit' },

  // ─── Entertainment (Personal · Entertainment) ────────────────
  { name: 'bookmyshow', pattern: /bookmyshow|book\s*my\s*show/i, category: 'Personal', subcategory: 'Entertainment', direction: 'debit' },
  { name: 'pvr', pattern: /\bpvr\b|pvr\s*cinemas?/i, category: 'Personal', subcategory: 'Entertainment', direction: 'debit' },
  { name: 'inox', pattern: /\binox\b/i, category: 'Personal', subcategory: 'Entertainment', direction: 'debit' },
  { name: 'steam', pattern: /steampowered|steam\s*games/i, category: 'Personal', subcategory: 'Entertainment', direction: 'debit' },
  { name: 'playstation', pattern: /playstation|\bpsn\b/i, category: 'Personal', subcategory: 'Entertainment', direction: 'debit' },

  // ─── Investments — platform anchors (Investments) ─────────────
  // Existing 'investments' rule above catches SIP / MF / Zerodha /
  // Groww / Upstox. Add the rest of the major Indian brokerage and
  // direct-MF platforms so they don't need AI judgment.
  { name: 'kuvera', pattern: /\bkuvera\b/i, category: 'Investments', subcategory: 'MF', direction: 'debit' },
  { name: 'coin-by-zerodha', pattern: /coin\s*by\s*zerodha|kuvera\s*coin/i, category: 'Investments', subcategory: 'MF', direction: 'debit' },
  { name: 'paytm-money', pattern: /paytm\s*money/i, category: 'Investments', subcategory: 'MF', direction: 'debit' },
  { name: 'angel-one', pattern: /angel\s*one|angel\s*broking/i, category: 'Investments', subcategory: 'Stocks', direction: 'debit' },
  { name: 'icicidirect', pattern: /icici\s*direct|icicidirect/i, category: 'Investments', subcategory: 'Stocks', direction: 'debit' },
  { name: 'hdfc-securities', pattern: /hdfc\s*sec(?:urities)?/i, category: 'Investments', subcategory: 'Stocks', direction: 'debit' },
  { name: 'kotak-securities', pattern: /kotak\s*sec(?:urities)?/i, category: 'Investments', subcategory: 'Stocks', direction: 'debit' },
  { name: 'cdsl-nsdl', pattern: /\bcdsl\b|\bnsdl\b/i, category: 'Investments', subcategory: 'Other', direction: 'debit' },

  // ─── Insurance — known aggregator platforms (Insurance · Premium)
  // The earlier 'insurance' anchor catches generic "INS-" / "INS_" /
  // "_PROPERTY_INS_" tells. Aggregators have brand-recognizable names.
  { name: 'policybazaar', pattern: /policy\s*bazaar|policybazaar/i, category: 'Insurance', subcategory: 'Premium', direction: 'debit' },
  { name: 'acko', pattern: /\backo\b/i, category: 'Insurance', subcategory: 'Premium', direction: 'debit' },
  { name: 'digit-insurance', pattern: /go\s*digit|\bdigit\s+insurance/i, category: 'Insurance', subcategory: 'Premium', direction: 'debit' },
  { name: 'hdfc-ergo', pattern: /hdfc\s*ergo/i, category: 'Insurance', subcategory: 'Premium', direction: 'debit' },
  { name: 'icici-lombard', pattern: /icici\s*lombard/i, category: 'Insurance', subcategory: 'Premium', direction: 'debit' },

  // ─── Transfers (UPI / NEFT / IMPS / RTGS / mTFR) ──────────────
  // Generic transfer rule fires LAST in this group so all the
  // specific charge / EMI / GST / salary anchors above win first.
  // Direction is irrelevant for Transfers — both inbound NEFT
  // credits and outbound UPI debits classify as Transfers when
  // counterparty looks personal. The classifier returns Transfers;
  // if the user wants Business Income / Business Expenses split,
  // that requires AI judgment on the counterparty (handled by the
  // unclassified-AI-fallback the routes still keep).
  //
  // Note: this rule alone is NOT enough to safely classify every
  // UPI/NEFT line — an outgoing NEFT to a vendor is Business
  // Expenses, not Transfers. So we ONLY apply this rule when the
  // counterparty looks personal (lowercase VPA, or short personal
  // name). The fallback path (return null → AI) handles the rest.
  // Implementation: only fire when narration is a clean transfer
  // pattern with NO business-expense markers.
  {
    name: 'transfer-personal',
    // The pattern matches transfer prefixes; the category function
    // applies a heuristic on the counterparty text to decide whether
    // it's clearly personal. When it's not clear, return null and
    // let AI take it.
    pattern: /^(?:upi[-/]|neft[-\s]?cr|neft[-\s]?dr|imps[-/]|rtgs[-/]|mtfr\/|mmt\/imps\/|^by cash\b|^trf\b)/i,
    category: (input) => {
      // Only auto-classify as Transfers when the counterparty looks
      // like a personal name / VPA. Business-looking counterparties
      // (ALL CAPS company names, "ENTERPRISES" / "TRADERS" / "PVT
      // LTD" suffixes) need AI judgment.
      const cp = extractCounterparty(input.narration) ?? '';
      if (!cp) return null; // can't tell — punt to AI
      if (/(?:enterprises|traders|pvt|ltd|llp|limited|industries|company|corporation|services|solutions|llp)\b/i.test(cp)) {
        return null; // looks like a business — AI handles it
      }
      // VPAs (lowercase + @) are almost always personal
      if (/@(?:ok[a-z]+|paytm|ybl|axl|upi|airtel|ibl|hdfc|sbi|icici)/i.test(cp)) {
        return 'Transfers';
      }
      // Short name (1-3 words, mostly title-case) = personal
      const words = cp.split(/\s+/).filter(Boolean);
      if (words.length <= 3) return 'Transfers';
      return null; // ambiguous
    },
    subcategory: null,
  },
];

// ─── Counterparty extractor ──────────────────────────────────────
// Best-effort regex extraction. Order: UPI VPA → NEFT/IMPS/RTGS
// name segment → mTFR (JKBank) name → POS merchant → bank-charge
// type label. Returns null when nothing matches; the AI fallback
// path then handles wrapped names ("SURE\nSH KUMAR" cases).

const COUNTERPARTY_PATTERNS: Array<{ name: string; pattern: RegExp; group: number }> = [
  // UPI: "UPI/<refno>/<note>/<vpa>/..." — VPA is the 4th segment.
  // Or "UPI-<NAME>-..." (no slashes) — name is the 2nd segment.
  { name: 'upi-vpa', pattern: /upi\/\w+\/[^/]*\/([\w.\-]+@[\w]+)/i, group: 1 },
  { name: 'upi-vpa-from', pattern: /\bfrom:\s*([\w.\-]+@[\w]+)/i, group: 1 },
  { name: 'upi-vpa-to', pattern: /\bto:\s*([\w.\-]+@[\w]+)/i, group: 1 },

  // ICICI 5-segment UPI format:
  //   UPI/<vpa-or-name>/<remark>/<BANK>/<RRN>/<icici-internal-ref>
  // The 2nd segment is the counterparty — it's either a VPA local-part
  // (no @, e.g. "ahlamfarooq36-2") or a NAME ("MOHSIN NAY"). Anchored
  // to "upi/" prefix and a digit-only RRN (10+ digits) in the 5th
  // segment so the pattern doesn't false-positive on older 4-segment
  // formats handled by `upi-name` below. Added 2026-06 after the
  // ICICI sample showed ~half of all rows falling through to "Other"
  // because the original `upi-vpa` pattern looked for "@" in the 4th
  // segment (which on ICICI is the RRN, not the VPA).
  // 2nd segment is the counterparty: a VPA local-part ("iddyakhan713@ok"),
  // a bare name with possible spaces ("MOHSIN NAY"), or a VPA-prefix
  // ("ahlamfarooq36-2"). Captured as anything-but-slash up to 60 chars.
  // The RRN-anchor (`\d{10,}` somewhere later in the string) keeps us
  // honest — it ensures we only fire on real ICICI-style UPI rows, not
  // on a stray "UPI/Hi/..." comment.
  { name: 'upi-icici-2nd-seg', pattern: /^upi\/([^/]{2,60})\/[\s\S]*?\d{10,}/i, group: 1 },

  // 4-segment format with a leading numeric ref: "UPI/123456/<note>/<NAME>"
  { name: 'upi-name', pattern: /upi[-/]\d+\/[^/]+\/([A-Za-z][A-Za-z .'&-]{2,40})/i, group: 1 },

  // NEFT / IMPS / RTGS: "NEFT-<IFSC>-<NAME>-<REF>" or "...-<NAME>-...".
  // The NAME segment sits between two dashes and is usually all caps.
  { name: 'wire-name', pattern: /(?:neft|imps|rtgs)[\s-]?(?:cr|dr)?-[A-Z0-9]+-([A-Z][A-Z0-9 .'&-]{2,50})/i, group: 1 },

  // mTFR (JKBank's mobile transfer prefix): "mTFR/<phone>/<NAME>"
  { name: 'mtfr-name', pattern: /mtfr\/\d+\/([A-Za-z][A-Za-z0-9 .'&-]{2,50})/i, group: 1 },

  // MMT / IMPS (ICICI's MoneyMultiplier / IMPS): "MMT/IMPS/<RRN>/<name>/<IFSC>"
  { name: 'mmt-imps', pattern: /mmt\/imps\/\d+\/([A-Za-z][A-Za-z .'&-]{1,40})/i, group: 1 },

  // TRFR FROM:<NAME> / TRFR TO:<NAME> — bank's internal transfer
  // narration (also seen as "TRANSFER FROM:" on some formats). The
  // name segment may include uppercase letters, digits, spaces, and
  // common punctuation.
  { name: 'trfr-name', pattern: /trfr\s+(?:from|to)\s*:\s*([A-Za-z][A-Za-z0-9 .'&-]{1,60})/i, group: 1 },

  // POS / merchant: "POS XXXXX MERCHANT" or "DEBIT-POS-MERCHANT"
  { name: 'pos-merchant', pattern: /pos[\s-]+\d*\s*([A-Za-z][A-Za-z0-9 .'&-]{2,40})/i, group: 1 },

  // Cheque deposit / withdrawal — counterparty is implicit
  { name: 'cheque', pattern: /\b(?:clg|chq|cheque)\b/i, group: 0 },
];

export function extractCounterparty(narration: string): string | null {
  if (!narration) return null;
  for (const { name, pattern, group } of COUNTERPARTY_PATTERNS) {
    const m = pattern.exec(narration);
    if (m) {
      if (name === 'cheque') return 'Cheque';
      const raw = (m[group] ?? '').trim();
      if (!raw) continue;
      // Trim trailing junk: dash-separated reference suffixes ("-IDFC0",
      // "-XXXXXX0034"), trailing pure-numeric segments, repeated whitespace.
      let cleaned = raw
        .replace(/\s*-\s*[A-Z0-9X]{6,}$/i, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+$/, '')
        .trim();
      // For UPI VPAs, also strip any trailing forward-slash suffix the
      // regex didn't already trim.
      if (cleaned.includes('@')) {
        cleaned = cleaned.split(/[/]/)[0]!.trim();
      }
      if (cleaned.length < 2) continue;
      return cleaned;
    }
  }
  // Bank-charge label fallback: e.g. "ATM CHARGES QUARTERLY" → "ATM
  // Charges". Strips trailing periodicity tokens.
  if (/charges?$|chrg$|chgs?$/i.test(narration.trim())) {
    return narration.trim().replace(/\s+(quarterly|monthly|annually|incl gst.*)$/i, '');
  }
  return null;
}

// ─── Reference extractor ─────────────────────────────────────────
// UTR / cheque / txn ref number — usually a 10-16 digit alphanumeric
// token. The regex below matches the common Indian patterns; if no
// match, returns null and AI can have a go on the unclassified path.

const REFERENCE_PATTERN = /\b(?:utr[:\s-]*)?([A-Z]{0,4}\d{10,18})\b/i;

export function extractReference(narration: string): string | null {
  if (!narration) return null;
  const m = REFERENCE_PATTERN.exec(narration);
  if (!m) return null;
  const candidate = (m[1] ?? '').trim();
  // Reject the IFSC-prefix-only case — "HDFC0000859" by itself is an
  // IFSC code, not a transaction reference.
  if (/^(?:HDFC|ICIC|SBIN|AXIS|UTIB|PUNB|YESB|JAKA|CNRB|CITIN|UBIN)\d{7}$/i.test(candidate)) return null;
  return candidate;
}

// ─── Narration fingerprint ────────────────────────────────────────
//
// Strip every volatile element from a narration so two transactions
// with the same counterparty but different dates / UPI refs / cheque
// numbers / amounts collapse to the same stable key. Used as the
// lookup key for the learned-classifications memory layer.
//
// Examples of what should fingerprint to the same value:
//   "UPI/123456789012/Payment to ACME DISTRIBUTORS/utib/xxxxxx@axisbank/UPI"
//   "UPI-N987654321098-PAYMENT-TO-ACME DISTRIBUTORS-axisbank"
//   "PAYMENT TO ACME DISTRIBUTORS UPI 555555555555"
//     → "payment to acme distributors"
//
// Strategy:
//   1. Lowercase everything (Indian narrations rarely encode meaning
//      in case).
//   2. Strip dates in common formats (DD/MM/YYYY, DD-MM-YY, etc.).
//   3. Strip transaction-id-shaped tokens (digit runs ≥ 6, alpha-
//      numeric refs after UPI/NEFT/IMPS/RTGS/UTR/RRN keywords, IFSC
//      codes).
//   4. Strip amount-shaped tokens (digits with optional comma
//      grouping and decimals).
//   5. Strip common bank prefix/suffix noise ("BY TRANSFER",
//      "TO TRANSFER", "BY CASH", "FROM", "TO", "VIA").
//   6. Strip standalone bank/wire-method tokens that don't identify
//      a counterparty (UPI, NEFT, IMPS, RTGS, ATM, POS, ECS, NACH).
//   7. Strip punctuation noise (/, \, -, _, #, @, : repeated).
//   8. Collapse whitespace.
//
// Why a fingerprint instead of just the counterparty: extractCounterparty
// already tries to identify the merchant/party, but it returns null
// for ~30% of rows where the pattern doesn't match. The fingerprint is
// a fallback that almost always returns SOMETHING (even if noisy), and
// what it returns is still stable across narration variants. Two rows
// that share a counterparty will share a fingerprint even when the
// counterparty extractor failed on both.

const DATE_PATTERNS: RegExp[] = [
  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (and 2-digit-year variants).
  // Anchored to non-word so we don't bite into longer numeric tokens.
  /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/g,
  // YYYY/MM/DD ISO-ish.
  /\b\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}\b/g,
  // Month names — short narrations sometimes say "JAN-25" / "FEB 2026".
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[\s/\-.]*\d{1,4}\b/gi,
];

// Bank/payment-method noise tokens. These are standalone — we strip
// them as whole words, not as substrings (so we don't accidentally
// strip "upi" from "upiwala").
//
// Three groups:
//   a) Wire methods + transaction verbs — never identifying.
//   b) Currency / amount-formatting boilerplate — Rs / INR / Rupees.
//   c) Bank short-names matching the IFSC-prefix list. These leak
//      into narrations frequently (sender-bank label, receiver-bank
//      label, "via HDFC", etc.) and bias fingerprints away from the
//      actual counterparty. Stripping them makes "HDFC HOME LOAN EMI"
//      and "ICICI HOME LOAN EMI" share a fingerprint (correct — both
//      are home-loan EMIs from the user's perspective).
const NOISE_WORDS = new Set([
  // (a) wire methods + verbs
  'upi', 'neft', 'imps', 'rtgs', 'atm', 'pos', 'ecs', 'nach',
  'by', 'to', 'from', 'via', 'ref', 'refno', 'txn', 'trf',
  'transfer', 'payment', 'pmt', 'recd', 'received', 'sent',
  'credit', 'debit', 'cash', 'inward', 'outward',
  'purchase', 'purch', 'spend', 'spends',
  // (b) currency / amount boilerplate
  'rs', 'inr', 'rupees', 'rupee', 'amt', 'amount',
  // (c) bank short-names — IFSC-prefix list + common variants
  'hdfc', 'icic', 'icici', 'sbi', 'sbin', 'state',
  'axis', 'axisbank', 'utib',
  'kotak', 'kkbk',
  'punb', 'pnb', 'punjab',
  'yes', 'yesb', 'yesbank',
  'bob', 'bobl', 'bobm', 'baroda',
  'idfc', 'idfcf', 'idfcbank',
  'indusind', 'idbi',
  'canara', 'cnrb',
  'union', 'ubin',
  'jaka', 'jkb',
  'citin', 'citi',
  'hsbc', 'scb', 'rbl', 'rblb',
  'federal', 'dcb', 'cosmos', 'sbm',
  'iob', 'iobu',
]);

// IFSC-shaped tokens — strip these because they identify a bank
// branch, not the counterparty. Format: 4 alpha + 0 + 6 alphanumeric.
const IFSC_PATTERN = /\b[a-z]{4}0[a-z0-9]{6}\b/gi;

// Long alphanumeric refs that follow UPI/NEFT/IMPS/RTGS/UTR/RRN
// keywords OR sit standalone as digit runs ≥ 6 chars. The 6-char
// floor is below cheque-number length (cheques are typically 6+ —
// borderline. We accept that fingerprints occasionally lose a
// suffix-cheque-number; the cost is small relative to over-keeping
// noise).
const REF_AFTER_KEYWORD = /(?:upi|neft|imps|rtgs|utr|rrn|txn|ref)[\s\-/.:#]*[a-z0-9]{6,}/gi;
const STANDALONE_DIGIT_RUN = /\b\d{6,}\b/g;
// Alphanumeric tokens that look like refs (≥ 4 alpha + ≥ 6 digit
// mixed). Catches "N123456789012", "P000216", "HDFCR52025040112345678".
const ALPHANUM_REF = /\b[a-z]{1,8}\d{6,}\b/gi;

// Amount-shaped tokens: 1,23,456.78 or 100000.00 or 1500/-.
const AMOUNT_PATTERN = /\b\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?\b|\b\d+\.\d{1,2}\b|\b\d+\/?-?\b/g;

/**
 * Strip the volatile parts of a narration and return a stable key.
 * Returns an empty string if the narration is empty / all noise — the
 * caller treats empty fingerprints as "no learnable signature here"
 * and skips the lookup.
 */
export function extractNarrationFingerprint(narration: string | null): string {
  if (!narration) return '';
  let s = String(narration).toLowerCase();

  // 1. Dates
  for (const p of DATE_PATTERNS) s = s.replace(p, ' ');
  // 2. IFSC codes
  s = s.replace(IFSC_PATTERN, ' ');
  // 3. Reference tokens after UPI/NEFT/etc keywords — strip the whole
  //    "neft-n123" cluster so we don't leave the keyword behind.
  s = s.replace(REF_AFTER_KEYWORD, ' ');
  // 4. Alphanumeric refs (P000216, N123456789012)
  s = s.replace(ALPHANUM_REF, ' ');
  // 5. Standalone long digit runs (cheque numbers, txn IDs)
  s = s.replace(STANDALONE_DIGIT_RUN, ' ');
  // 6. Amounts. NOTE: keep short 1-5 digit numbers — they can be part
  //    of legitimate counterparty names ("M3 ENTERPRISES", "247 CARS").
  s = s.replace(AMOUNT_PATTERN, ' ');
  // 6b. Anonymisation VPAs: "xxxxxx@axisbank", "******@kotak". Strip
  //     these BEFORE the masked-card pass — otherwise the masked-card
  //     pass eats just the "xxxxxx" prefix and strands "@axisbank" as
  //     an orphan token in the output. Genuine VPAs ("foo@axisbank")
  //     are preserved because the pattern requires 3+ consecutive
  //     x's or asterisks in the prefix.
  s = s.replace(/\b[x*]{3,}@\S+/gi, ' ');
  // 6c. Masked card numbers: "5555XXXX1234", "XXXXX1234", "1234XXXX".
  //     Any token mixing digits with 2+ consecutive X/x. Strip whole
  //     token — the actual digits are per-card noise that varies
  //     across transactions with the same merchant.
  s = s.replace(/\b\d*[xX*]{2,}\d*\b/g, ' ');
  // 7. Punctuation → space. Keep @ for UPI VPAs (foo@axisbank stays
  //    identifying), strip everything else.
  s = s.replace(/[/\\\-_#:.,;()\[\]{}<>!?*&^%$+=|"']/g, ' ');
  // 8. Drop noise words. Splits on whitespace, filters, rejoins.
  const tokens = s.split(/\s+/).filter((tok) => {
    if (!tok) return false;
    if (NOISE_WORDS.has(tok)) return false;
    // Single-char tokens are almost always noise residue ("a", "x")
    if (tok.length === 1) return false;
    // Pure-digit short tokens that survived — also noise.
    if (/^\d+$/.test(tok)) return false;
    return true;
  });
  // 9. Collapse whitespace.
  return tokens.join(' ').trim();
}

// ─── Public entry ────────────────────────────────────────────────

/**
 * Classify a single bank-statement row. Returns:
 *
 *   - { category, subcategory, counterparty, reference } when the
 *     narration matched a known anchor (caller persists directly,
 *     no AI call needed).
 *   - null when no anchor matched (caller queues the row for AI).
 *
 * Counterparty and reference are extracted opportunistically EVEN
 * when category classification fails. That way, a row that ends up
 * going to AI for category still benefits from regex-derived
 * counterparty/reference and the AI doesn't have to redo that work.
 */
export function classifyRow(input: ClassifierInput): ClassifierResult | null {
  const lower = input.narration.toLowerCase();
  for (const rule of RULES) {
    if (rule.direction && rule.direction !== input.type) continue;
    if (!rule.pattern.test(lower)) continue;
    const cat = typeof rule.category === 'function' ? rule.category(input) : rule.category;
    if (cat === null) continue; // rule's category function declined — try next rule
    return {
      category: cat,
      subcategory: rule.subcategory ?? null,
      counterparty: extractCounterparty(input.narration),
      reference: extractReference(input.narration),
    };
  }
  return null;
}

/**
 * Just the opportunistic counterparty + reference extraction, with
 * no category. Used when the route has decided to send a row to AI
 * for classification but still wants to benefit from the regex
 * extraction (so the AI prompt doesn't have to redo it).
 */
export function extractCounterpartyAndReference(narration: string): {
  counterparty: string | null;
  reference: string | null;
} {
  return {
    counterparty: extractCounterparty(narration),
    reference: extractReference(narration),
  };
}

// ─── Learned-rule integration ─────────────────────────────────────

/**
 * Row passed to the learnedLookup callback. We keep the shape minimal
 * so consumers don't have to import the repo's row type — the only
 * fields the classifier needs are id, category, subcategory.
 */
export interface LearnedRuleLike {
  id: string;
  category: string;
  subcategory: string | null;
}

export type LearnedLookupFn = (
  fingerprint: string,
  direction: 'credit' | 'debit',
) => LearnedRuleLike | null;

export interface ClassifyWithLearningResult {
  /** Which tier produced the classification. 'learned' = a remembered
   *  rule fired; 'anchor' = the deterministic regex pass fired;
   *  'unclassified' = neither, caller should send the row to AI. */
  tier: 'learned' | 'anchor' | 'unclassified';
  /** The classifier output. Null only when tier is 'unclassified'. */
  result: ClassifierResult | null;
  /** ID of the learned rule that fired, when tier === 'learned'. The
   *  route uses this to batch-call recordHit() after the run, so each
   *  rule's hit_count and last_applied_at reflect actual usage. */
  learnedRuleId: string | null;
  /** Diagnostic: if a learned rule fired AND a deterministic anchor
   *  would have returned a different category, both are captured here
   *  so the telemetry logger can flag conflicts for later review.
   *  Conflicts are not errors — learned wins per the locked
   *  precedence — but tracking them helps the user spot stale
   *  remembered rules. */
  anchorConflict: { learnedCategory: string; anchorCategory: string } | null;
}

/**
 * Classify a row with the learned-rule layer in front of the
 * deterministic anchors. Precedence (locked 2026-05-22):
 *
 *   1. Learned rule (per billing user, by fingerprint).
 *   2. Deterministic anchor.
 *   3. AI fallback (caller's responsibility — we return tier =
 *      'unclassified' and let the caller queue the row).
 *
 * `learnedLookup` is a callback so this module stays free of DB
 * dependencies (the repo is wired in by the route). It returns the
 * matching rule or null.
 *
 * We ALWAYS compute the anchor result, even when a learned rule fires,
 * because:
 *   - The anchor's `counterparty` / `reference` extraction is still
 *     useful to attach to the row (the learned rule only carries
 *     category + subcategory).
 *   - Conflict detection: learned-vs-anchor disagreement is a
 *     diagnostic worth logging.
 */
export function classifyWithLearning(
  input: ClassifierInput,
  learnedLookup: LearnedLookupFn,
): ClassifyWithLearningResult {
  const fingerprint = extractNarrationFingerprint(input.narration);
  const anchorResult = classifyRow(input);

  if (fingerprint.length > 0) {
    const learned = learnedLookup(fingerprint, input.type);
    if (learned) {
      // Learned rule wins. Inherit counterparty/reference from the
      // anchor result when available, otherwise compute fresh — the
      // anchor may have returned null (no category match) but still
      // populated counterparty as a side effect via classifyRow.
      const counterparty = anchorResult?.counterparty ?? extractCounterparty(input.narration);
      const reference = anchorResult?.reference ?? extractReference(input.narration);
      const conflict =
        anchorResult && anchorResult.category !== learned.category
          ? { learnedCategory: learned.category, anchorCategory: anchorResult.category }
          : null;
      return {
        tier: 'learned',
        result: {
          category: learned.category as BankStatementCategory,
          subcategory: learned.subcategory,
          counterparty,
          reference,
        },
        learnedRuleId: learned.id,
        anchorConflict: conflict,
      };
    }
  }

  if (anchorResult) {
    return {
      tier: 'anchor',
      result: anchorResult,
      learnedRuleId: null,
      anchorConflict: null,
    };
  }

  return {
    tier: 'unclassified',
    result: null,
    learnedRuleId: null,
    anchorConflict: null,
  };
}

/**
 * Mark recurring transactions in-place. A row is recurring when the
 * SAME narration prefix appears at least twice in the rows array
 * with similar amounts (within 10%). Run after classification so
 * the recurring flag rides along with the classified row regardless
 * of where the category came from (rule or AI).
 *
 * Pattern key strategy:
 *   - Strip dates / numeric refs from the narration.
 *   - Lowercase + collapse whitespace.
 *   - Take the first 60 chars (enough to disambiguate, short enough
 *     that a UPI ref number doesn't break grouping).
 */
export function markRecurring<T extends { narration: string; amount: number; isRecurring?: boolean }>(rows: T[]): void {
  const buckets = new Map<string, Array<{ index: number; amount: number }>>();
  rows.forEach((r, i) => {
    const key = patternKey(r.narration);
    if (!key) return;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push({ index: i, amount: Math.abs(r.amount) });
  });
  for (const [, occurrences] of buckets) {
    if (occurrences.length < 2) continue;
    // Group occurrences by similar amount (±10%). A bucket counts as
    // recurring only when ≥2 occurrences sit in the same amount band
    // — that excludes "UPI/personal/various amounts" from being
    // mis-flagged just because the prefix repeats.
    const sorted = [...occurrences].sort((a, b) => a.amount - b.amount);
    let groupStart = 0;
    while (groupStart < sorted.length) {
      let groupEnd = groupStart + 1;
      while (groupEnd < sorted.length && sorted[groupEnd].amount <= sorted[groupStart].amount * 1.10) {
        groupEnd++;
      }
      if (groupEnd - groupStart >= 2) {
        for (let k = groupStart; k < groupEnd; k++) {
          rows[sorted[k].index].isRecurring = true;
        }
      }
      groupStart = groupEnd;
    }
  }
}

function patternKey(narration: string): string {
  if (!narration) return '';
  return narration
    .toLowerCase()
    // Strip 8+ digit refs (UTRs, account numbers, txn ids).
    .replace(/\d{8,}/g, '')
    // Strip dates.
    .replace(/\d{1,2}[/.\-]\d{1,2}[/.\-]\d{1,4}/g, '')
    .replace(/\b\d{1,2}-\w{3}-\d{4}\b/g, '')
    // Collapse whitespace and slashes.
    .replace(/[/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * Normalise a counterparty string so trivial UPI-handle variants
 * collapse onto a single identity. The same person commonly appears
 * across rows with different bank suffixes ("@okicici" / "@okaxis" /
 * "@oksbi") and version digits ("boyaairtel.123-1" / "-2" / "-3");
 * those are mechanically equivalent and should not split the
 * consistency-vote bucket.
 *
 * Normalisation steps:
 *   - Lowercase.
 *   - Strip the @bank-suffix (everything from "@" onwards).
 *   - Strip a trailing "-N" version segment (single-digit variants only).
 *   - Strip trailing whitespace / punctuation.
 *
 * Non-VPA counterparties (POS merchants, NEFT names) pass through
 * lowercase-and-trim only.
 */
export function normalizeCounterpartyKey(counterparty: string | null): string {
  if (!counterparty) return '';
  return counterparty
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/-\d{1,2}$/, '')
    .replace(/[\s.,'-]+$/, '')
    .trim();
}

/**
 * Same-counterparty consistency pass — applied AFTER the classifier
 * pre-pass AND the AI enrichment, BEFORE persisting transactions.
 *
 * Problem this solves: when a row falls through to the AI fallback
 * (counterparty isn't a recognized merchant or anchor), the model
 * can give different category answers across batches for what's
 * obviously the same payee. A 25-transaction account with a single
 * recurring vendor (the BOYAAIRTEL.123 case from a real YES Bank
 * upload) ended up tagged Business Expenses ×15, Personal/Shopping
 * ×7, Transfers ×1, Business Income ×1, Transfers ×1 — same VPA.
 *
 * Fix: group rows by (normalised counterparty, direction), find the
 * majority (category, subcategory) tuple, back-fill any minority row
 * to that tuple. Direction-split prevents flattening payments-to-vendor
 * (Business Expenses) with refunds-from-vendor (Business Income) into
 * one bucket.
 *
 * Skipped cases:
 *   - Empty / null counterparty (too noisy — would group every cash
 *     deposit / cheque / unidentified row together).
 *   - Groups smaller than 3 rows (one-off transactions; the AI's call
 *     is the best we have).
 *   - Groups already consistent (1 distinct tuple — nothing to do).
 *   - Groups with no clear majority — keep the AI's per-row calls
 *     rather than apply a tiebreaker that could spread wrong tags.
 *
 * Returns the number of rows whose category/subcategory was changed.
 */
export function unifyAmbiguousCounterparties<T extends {
  counterparty: string | null;
  type: 'credit' | 'debit';
  category: string;
  subcategory: string | null;
}>(rows: T[]): number {
  type Key = string;
  const buckets = new Map<Key, T[]>();
  for (const r of rows) {
    const key = normalizeCounterpartyKey(r.counterparty);
    if (!key) continue;
    const groupKey = `${key}::${r.type}`;
    if (!buckets.has(groupKey)) buckets.set(groupKey, []);
    buckets.get(groupKey)!.push(r);
  }

  let totalChanged = 0;
  for (const [groupKey, group] of buckets) {
    if (group.length < 3) continue;

    // Count (category, subcategory) tuples.
    const tally = new Map<string, number>();
    for (const r of group) {
      const tup = `${r.category}::${r.subcategory ?? ''}`;
      tally.set(tup, (tally.get(tup) ?? 0) + 1);
    }
    if (tally.size < 2) continue; // already unanimous

    // Find the most-common tuple. Require strict plurality with at
    // least half the group OR ≥3 occurrences — avoids unifying a
    // 4-way split (1/1/1/1) where the "winner" is arbitrary.
    let bestTuple = '';
    let bestCount = 0;
    let runnerUpCount = 0;
    for (const [t, c] of tally) {
      if (c > bestCount) {
        runnerUpCount = bestCount;
        bestCount = c;
        bestTuple = t;
      } else if (c > runnerUpCount) {
        runnerUpCount = c;
      }
    }
    const requiredCount = Math.max(3, Math.ceil(group.length / 2));
    if (bestCount < requiredCount) continue;
    if (bestCount === runnerUpCount) continue; // tied — no clear majority

    const [bestCategory, bestSubRaw] = bestTuple.split('::');
    const bestSubcategory = bestSubRaw === '' ? null : bestSubRaw;

    let changed = 0;
    for (const r of group) {
      const currentTuple = `${r.category}::${r.subcategory ?? ''}`;
      if (currentTuple === bestTuple) continue;
      r.category = bestCategory;
      r.subcategory = bestSubcategory;
      changed++;
    }
    if (changed > 0) {
      totalChanged += changed;
      const cpDisplay = group[0].counterparty?.slice(0, 60) ?? '(unknown)';
      console.log(`[bank-classifier] counterparty consistency: '${cpDisplay}' (${groupKey.split('::')[1]}, ${group.length} rows, ${tally.size} variants) → unified ${changed} row(s) to ${bestTuple}`);
    }
  }
  return totalChanged;
}

/**
 * Direction-category sanity check. Some categories are direction-locked
 * by definition:
 *   - Inflow-only ("Business Income", "Cash Deposit", "Salary",
 *     "Interest Income", "Bank Interest (Cr)", "Dividends",
 *     "Rent Received") cannot be a debit.
 *   - Outflow-only ("Business Expenses", "Loan EMI", "Bank Charges",
 *     "Bank Interest (Dr)", "GST Payments", "TDS", "Taxes Paid",
 *     "Investments", "Insurance", "Mobile Charges", "Electricity
 *     Charges", "Water Charges") cannot be a credit.
 *
 * When the AI emits an impossible combination (e.g. "DEBIT row tagged
 * Business Income") we don't try to flip it to a sensible alternative
 * — guessing the right replacement category risks introducing a new
 * error. Demote to "Other" with null subcategory; the row appears
 * unclassified on the dashboard and the user can re-tag.
 *
 * Returns the number of rows changed.
 */
const INFLOW_ONLY_CATEGORIES = new Set<string>([
  'Business Income', 'Cash Deposit', 'Salary', 'Interest Income',
  'Bank Interest (Cr)', 'Dividends', 'Rent Received',
]);
const OUTFLOW_ONLY_CATEGORIES = new Set<string>([
  'Business Expenses', 'Cash Withdrawal', 'Loan EMI', 'Bank Charges',
  'Bank Interest (Dr)', 'GST Payments', 'TDS', 'Taxes Paid',
  'Investments', 'Insurance', 'Mobile Charges',
  'Electricity Charges', 'Water Charges',
]);

// 2026-06: when the AI returns a category in the wrong direction, the
// intent is usually obvious — a debit row tagged Cash Deposit was meant
// to be Cash Withdrawal; a credit row tagged Business Expenses was
// meant to be Business Income. Mapping these pairs preserves user
// signal instead of dropping every mistake to "Other" where the
// dashboard can't show it.
const DIRECTION_FLIP_PAIRS: Record<string, string> = {
  'Cash Deposit': 'Cash Withdrawal',
  'Cash Withdrawal': 'Cash Deposit',
  'Business Income': 'Business Expenses',
  'Business Expenses': 'Business Income',
};

/**
 * Detect the "retail business current account" pattern and promote
 * matching credits to Business Income / Sales.
 *
 * Why this exists: the AI enrichment prompt sees one batch of rows
 * at a time and has no access to account-level metadata (account
 * type, holder's business). When the account holder runs a small
 * retail business (food shop, kirana, salon, etc.), they receive
 * many small UPI/IMPS credits from individual customers. The AI
 * defaults those to "Personal / Shopping" because the counterparty
 * is a personal name with no business marker — but on a CURRENT
 * ACCOUNT receiving 30+ such credits from 20+ distinct payers,
 * they are almost always Business Income.
 *
 * The 2026-05 J&K Bank FOOD HUT case made this stark: 708 of 832
 * credits were tagged Personal/Shopping when they were ₹1–₹890
 * customer payments to a food vendor. Net Business Income on the
 * dashboard came out at ₹0 instead of ~₹4L.
 *
 * Heuristic: if the row set contains
 *   - ≥ MIN_CREDIT_ROWS small credits (amount ≤ SMALL_AMOUNT_THRESHOLD)
 *   - From ≥ MIN_DISTINCT_CPS distinct (normalised) counterparties
 * then the statement looks like a retail business current account.
 * Promote any small credit currently tagged Personal/Other/null
 * category to Business Income / Sales.
 *
 * Tuning notes:
 *   - SMALL_AMOUNT_THRESHOLD = 5000 catches typical retail purchases
 *     (food, kirana, mobile recharge). Larger credits stay un-
 *     promoted — those need AI judgment.
 *   - MIN_DISTINCT_CPS = 20: a personal account receives money from
 *     5-10 friends/family in a year; 20+ distinct senders is a
 *     business signal.
 *   - MIN_CREDIT_ROWS = 30: filters out tiny statements where the
 *     pattern is noise. (Statements with <30 credits get whatever
 *     the AI decided.)
 *
 * Returns { promoted, statementType } so the caller can log /
 * surface the detection.
 */
const RETAIL_BUSINESS_SMALL_AMOUNT_THRESHOLD = 5000;
const RETAIL_BUSINESS_MIN_DISTINCT_CPS = 20;
const RETAIL_BUSINESS_MIN_CREDIT_ROWS = 30;

export function applyRetailBusinessPromotion<T extends {
  type: 'credit' | 'debit';
  amount: number;
  counterparty: string | null;
  category: string;
  subcategory: string | null;
}>(rows: T[]): { promoted: number; statementType: string | null } {
  const smallCredits = rows.filter(
    r => r.type === 'credit' && Math.abs(r.amount) > 0 && Math.abs(r.amount) <= RETAIL_BUSINESS_SMALL_AMOUNT_THRESHOLD,
  );
  if (smallCredits.length < RETAIL_BUSINESS_MIN_CREDIT_ROWS) {
    return { promoted: 0, statementType: null };
  }
  const cpSet = new Set<string>();
  for (const r of smallCredits) {
    const key = normalizeCounterpartyKey(r.counterparty);
    if (key) cpSet.add(key);
  }
  if (cpSet.size < RETAIL_BUSINESS_MIN_DISTINCT_CPS) {
    return { promoted: 0, statementType: null };
  }

  // Pattern matches. Promote small credits that are sitting in
  // "Personal" / "Other" / empty category. Skip anything the
  // classifier or AI already confidently tagged as something
  // specific (Salary, Rent Received, Cash Deposit, Bank Interest
  // (Cr), Business Income, Dividends, Interest Income, Transfers).
  // Those are direction-correct credits with deliberate categories;
  // we don't override them.
  const PROMOTABLE_FROM = new Set<string>(['Personal', 'Other', '']);
  let promoted = 0;
  for (const r of rows) {
    if (r.type !== 'credit') continue;
    if (Math.abs(r.amount) > RETAIL_BUSINESS_SMALL_AMOUNT_THRESHOLD) continue;
    if (!PROMOTABLE_FROM.has(r.category)) continue;
    r.category = 'Business Income';
    r.subcategory = 'Sales';
    promoted++;
  }
  console.log(`[bank-classifier] retail-business detection: ${smallCredits.length} small credits from ${cpSet.size} distinct counterparties → promoted ${promoted} row(s) to Business Income / Sales`);
  return { promoted, statementType: 'retail_business_current' };
}

export function validateDirectionCategory<T extends {
  type: 'credit' | 'debit';
  category: string;
  subcategory: string | null;
}>(rows: T[]): number {
  let changed = 0;
  for (const r of rows) {
    const bad =
      (r.type === 'debit'  && INFLOW_ONLY_CATEGORIES.has(r.category)) ||
      (r.type === 'credit' && OUTFLOW_ONLY_CATEGORIES.has(r.category));
    if (!bad) continue;
    // Prefer flipping to the obvious symmetric counterpart so a credit
    // accidentally tagged "Business Expenses" becomes "Business Income"
    // instead of disappearing into "Other". Only the four pairs in
    // DIRECTION_FLIP_PAIRS are safe — pairs like Salary↔(nothing
    // sensible) stay demoted. Subcategory is dropped because the AI's
    // subcategory was chosen for the wrong-direction category and is
    // unlikely to be right for the flipped one.
    const flipped = DIRECTION_FLIP_PAIRS[r.category];
    if (flipped) {
      console.warn(`[bank-classifier] direction/category mismatch: ${r.type} row tagged "${r.category}" — flipped to "${flipped}"`);
      r.category = flipped;
      r.subcategory = null;
    } else {
      console.warn(`[bank-classifier] direction/category mismatch: ${r.type} row tagged "${r.category}" — demoted to Other`);
      r.category = 'Other';
      r.subcategory = null;
    }
    changed++;
  }
  return changed;
}
