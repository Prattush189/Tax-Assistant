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
  { name: 'min-balance', pattern: /\bmab chrg\b|min bal chrg|avg bal chgs|minimum balance charges/i, category: 'Bank Charges', subcategory: 'Min Balance' },

  // Loan processing
  { name: 'loan-processing', pattern: /loan_proc|loan processing fee/i, category: 'Bank Charges', subcategory: 'Loan Processing' },

  // CIBIL
  { name: 'cibil', pattern: /\bcibil\b/i, category: 'Bank Charges', subcategory: 'CIBIL' },

  // Cheque book
  { name: 'cheque-book', pattern: /cheque book ch(?:gs|arges|aregs)/i, category: 'Bank Charges', subcategory: 'Cheque' },

  // Cash transaction charges (separate from cash deposit/withdrawal
  // counter ops themselves — those are Transfers if recorded as
  // credit/debit lines).
  { name: 'cash-txn-charges', pattern: /cash deposit charges|cashdep chgs|cash txn chgs/i, category: 'Bank Charges', subcategory: 'Cash Txn' },

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
    pattern: /^(?:upi[-/]|neft[-\s]?cr|neft[-\s]?dr|imps[-/]|rtgs[-/]|mtfr\/|^by cash\b|^trf\b)/i,
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
  { name: 'upi-name', pattern: /upi[-/]\d+\/[^/]+\/([A-Za-z][A-Za-z .'&-]{2,40})/i, group: 1 },

  // NEFT / IMPS / RTGS: "NEFT-<IFSC>-<NAME>-<REF>" or "...-<NAME>-...".
  // The NAME segment sits between two dashes and is usually all caps.
  { name: 'wire-name', pattern: /(?:neft|imps|rtgs)[\s-]?(?:cr|dr)?-[A-Z0-9]+-([A-Z][A-Z0-9 .'&-]{2,50})/i, group: 1 },

  // mTFR (JKBank's mobile transfer prefix): "mTFR/<phone>/<NAME>"
  { name: 'mtfr-name', pattern: /mtfr\/\d+\/([A-Za-z][A-Za-z0-9 .'&-]{2,50})/i, group: 1 },

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
