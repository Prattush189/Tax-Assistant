/**
 * Rules-based labeler for the deduped payee export. Encodes the
 * categorization judgment that's OBJECTIVE from the narration (bank
 * charges, GST/TCS/TDS, interest, salary, investments, payment
 * aggregators, known merchants, and business counterparties by
 * direction) and flags the rest — bare person-name transfers whose
 * category depends on the firm's relationship to the payee — as
 * needs_human for the owner to resolve.
 *
 * Generalizes to the full 9,418-payee export and future data; this is
 * the reusable "judgment as rules" artifact, not a one-off hand-label.
 *
 * Run: npx tsx scripts/label-payees.mts [--in <path>] [--out <path>]
 */
import fs from 'node:fs';

const argv = process.argv;
const getArg = (f: string, d: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const IN = getArg('--in', 'C:/Users/Prattush/Downloads/payees-review-min5.json');
const OUT = getArg('--out', 'payees-labeled.json');

interface Payee {
  fingerprint: string; count: number; direction: 'credit' | 'debit'; mixed: boolean;
  current_category: string; sample_narration: string;
  label: string | null; confidence: 'high' | 'medium' | 'low' | null; needs_human: boolean;
}

const rows: Payee[] = JSON.parse(fs.readFileSync(IN, 'utf8'));

// Business-entity markers: presence ⇒ the counterparty is a business, so
// direction decides expense vs income.
const BIZ = /\b(traders?|trading|automobiles?|auto\s?parts?|auto\s?corp|autos?\b|motors?|distributors?|lubricants?|petroleum|enterprises?|enterpri|industries|engineering|eng\s?works|springs?|company|companies|\bcorp\b|\bpvt\b|private\s?limited|\bllp\b|sons\b|agencies|agency|\bstores?\b|medico|medical|pharma|provisions?|provi\b|udyog|impex|exports?|imports?|associates?|\basso\b|entertainmen|fillin|snack|chemic|soap)\b/i;

function classify(p: Payee): { label: string; confidence: 'high' | 'medium' | 'low'; needs_human: boolean } {
  const s = (p.sample_narration + ' ' + p.fingerprint).toLowerCase();
  const dir = p.direction;
  const H = (label: string) => ({ label, confidence: 'high' as const, needs_human: false });
  const M = (label: string) => ({ label, confidence: 'medium' as const, needs_human: false });
  const L = (label: string, human = true) => ({ label, confidence: 'low' as const, needs_human: human });

  // ── Structural / objective (high confidence) ──
  if (/\bint\.?coll\b/.test(s)) return H('Bank Interest (Dr)');               // interest charged on loan/OD
  if (/\bint\.?pd\b|interest\s?paid|\bdep\s?int\b/.test(s)) return H('Bank Interest (Cr)'); // interest credited
  if (/sundaram\s?mf|\bmutual\s?fund|\bsip\b|nippon|\bmf\b|zerodha|groww|\bnse\b|\bbse\b|smallcase/.test(s)) return H('Investments');
  if (/\bsalary\b/.test(s)) return H('Salary');
  if (/\btcs\b/.test(s)) return H('Taxes Paid');
  if (/\btds\b/.test(s)) return H('TDS');
  if (/\bgst\b/.test(s)) return H('GST Payments');
  if (/charges?|chrgs|\bsc\b|markup|\bdcc\b|cashtxnchgs|sms\s?charge|min\s?bal|amb\b|\bnwd\b/.test(s)
      && /chrgs|charge|markup|dcc|cashtxnchgs|sms\s?charge|min\s?bal/.test(s)) return H('Bank Charges');
  if (/insurance|\blic\b|life\s?insur|policy|premium/.test(s)) return H('Insurance');
  if (/electricity|pspcl|pseb|jpdcl|kpdcl|\bbijli\b|power\s?bill/.test(s)) return H('Electricity Charges');
  if (/\bemi\b|\bloan\b|bajaj\s?fin|\bhdb\b|tata\s?cap|home\s?loan|car\s?loan/.test(s)) return H('Loan EMI');

  // ── Payment aggregators / settlements ⇒ merchant receipts ──
  if (/phonepe|pine\s?labs|pinelab|razorpay|bharatpe|mswipe|billdesk|cashfree|ccavenue|skilworth|sett\s?bp|settlement|paytm\s?qr|\bp2m\b.*\b(cr)\b/.test(s)) {
    return dir === 'credit' ? H('Business Income') : M('Business Expenses');
  }

  // ── Known merchants ──
  if (/jiomart.?b\s?2b|jiomartb2b/.test(s)) return H('Business Expenses');
  if (/\bgoogle\b|microsoft|adobe|\baws\b|godaddy|hostinger|delhivery|shiprocket|\bdtdc\b|bluedart|courier/.test(s)) return H('Business Expenses');
  if (/zomato|swiggy|blinkit|zepto|bigbasket|dominos|mcdonald/.test(s)) return L('Personal', false); // food: usually personal, low conf
  if (/trip\.com|makemytrip|irctc|indigo|spicejet|\bola\b|\buber\b|redbus/.test(s)) return L('Personal');

  // ── Bank-internal / transfer markers ──
  if (/sweep\s?transfer|sweep\b/.test(s)) return H('Transfers');
  if (/suspence|suspense/.test(s)) return L('Other', true);
  if (/impsp2ao|impsp2ai|imps\s?outwrd|imps\s?inward|\bonus\b|^cr$|^dr$|^crv$|\betxn\b|\betfr\b|\bp2p\b\s*$/.test(p.fingerprint)) {
    return L('Transfers', true);
  }

  // ── Business counterparty (entity name) ⇒ direction decides ──
  if (BIZ.test(s)) {
    return dir === 'debit' ? M('Business Expenses') : M('Business Income');
  }

  // ── Bare person name / unknown ⇒ owner must decide relationship ──
  // Keep a best-guess from the current label if it's a confident class,
  // else Personal — but flag for human either way.
  const cur = p.current_category;
  const guess = (cur && cur !== 'Other' && cur !== 'Transfers') ? cur : 'Personal';
  return L(guess, true);
}

let humanCount = 0;
const conf = { high: 0, medium: 0, low: 0 };
const byCat = new Map<string, number>();
const labeled = rows.map((p) => {
  const r = classify(p);
  if (r.needs_human) humanCount++;
  conf[r.confidence]++;
  byCat.set(r.label, (byCat.get(r.label) ?? 0) + 1);
  return { ...p, label: r.label, confidence: r.confidence, needs_human: r.needs_human };
});

fs.writeFileSync(OUT, JSON.stringify(labeled, null, 2));

const rowsCovered = labeled.reduce((a, b) => a + b.count, 0);
const autoRows = labeled.filter(p => !p.needs_human).reduce((a, b) => a + b.count, 0);
console.log(`Labeled ${labeled.length} payees → ${OUT}`);
console.log(`Confidence: ${conf.high} high, ${conf.medium} medium, ${conf.low} low`);
console.log(`Auto-labeled (no human needed): ${labeled.length - humanCount} payees / ${autoRows} rows (${(100 * autoRows / rowsCovered).toFixed(0)}% of volume)`);
console.log(`Needs your review: ${humanCount} payees`);
console.log('\nLabel distribution:');
[...byCat.entries()].sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  ${String(n).padStart(4)}  ${c}`));
