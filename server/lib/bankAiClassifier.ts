/**
 * AI tier of the bank-statement classifier: categorises the rows the
 * learned rules and deterministic anchors could not tag, via
 * callBankEnrichment (Claude Sonnet first while the launch offer runs,
 * Gemini as the rescue).
 *
 * Why this module exists (2026-11-13): the CSV upload path ran this tier
 * inline, but the scanned / vision statement path never did — its
 * unmatched rows went straight to remapOtherByDirection and came out as
 * "Business Income / Expenses — Uncategorised". A scanned PNB savings
 * account had 76 of 98 rows defaulted that way (savings interest, LPG
 * subsidy, PM-KISAN, an FD opened and closed). The vision path now calls
 * classifyRowsWithAi; the CSV path shares the same prompt
 * (BANK_AI_STATIC_PREFIX). The CSV path keeps its own batch runner (it
 * also drives progress events and per-batch failure rows).
 */

import { callBankEnrichment } from './bankEnrichmentClient.js';
import { BANK_STATEMENT_CATEGORIES } from './bankStatementPrompt.js';
import { extractNarrationFingerprint } from './bankClassifier.js';
import { lookupAiClassification, recordAiClassification } from './bankAiClassificationCache.js';

/** The cacheable static prompt: instructions + category enum. The row
 *  batch (TSV) is appended per call. */
export const BANK_AI_STATIC_PREFIX = `You categorise Indian bank-statement rows the rule-based pre-pass could not auto-tag. Return ONE JSON array, no fences, no prose:

[[category, subcategory_or_null], ...]

Rules:
- The array MUST be the same length and order as INPUT_ROWS. No skipping, no reordering.
- category ∈ {${BANK_STATEMENT_CATEGORIES.map(c => `"${c}"`).join(',')}}.
- DIRECTION DISCIPLINE (CRITICAL — wrong direction = wrong answer):
   * type="credit" rows can ONLY be: Business Income, Salary, Rent Received, Interest Income, Bank Interest (Cr), Dividends, Cash Deposit, Transfers, Personal, Other.
   * type="debit" rows can ONLY be: Business Expenses, Cash Withdrawal, Loan EMI, Bank Charges, Bank Interest (Dr), GST Payments, TDS, Taxes Paid, Investments, Insurance, Mobile Charges, Electricity Charges, Water Charges, Transfers, Personal, Other.
   * NEVER tag a debit row as "Cash Deposit" or "Business Income". NEVER tag a credit row as "Cash Withdrawal" or "Business Expenses". The type column tells you the direction — read it first.
- Upstream rules already tagged the rows they recognise (most bank charges, EMI, salary, GST, TDS, well-known merchants). You see the rest: UPI/NEFT/IMPS/RTGS to ambiguous counterparties, cheques, cash, local POS, and bank-specific codes.
- Any narration containing "cash" or "deposit" in any form → credit rows go to "Cash Deposit" (subcategory "Other"); debit rows go to "Cash Withdrawal" (subcategory "Other"). Exception: fixed-deposit lines below.
- Interest the bank credits on savings / FD (INT, INTT., INTEREST, "INTT. From ... to ...") → "Interest Income" (subcategory "Savings" or "FD").
- Government transfers to the account holder (DBT, LPG / gas subsidy, PM-KISAN, scholarship, pension, "SUBSIDY") → "Personal" (subcategory "Other"). They are not business income.
- Fixed deposit opened or funded (FDR, FD, TDR, "DAYS" term) on a debit → "Investments" (subcategory "FD"). FD closure / maturity / "Closure Proceeds" on a credit → "Transfers".
- Transfer between the holder's own accounts ("Tran to Operative Acct", sweep, own-account transfer) → "Transfers".
- Cheque book / passbook / statement charges → "Bank Charges".
- ENTERPRISES/TRADERS/PVT LTD/LIMITED/LLP/15-digit GSTIN → "Business Expenses" (debit) / "Business Income" (credit).
- Clear personal name OR grocery/local-shop pattern → "Personal" with subcategory "Shopping".
- Genuinely ambiguous → "Other" with null subcategory.

INPUT_ROWS — TSV, one row per line, columns narration<TAB>type<TAB>amount:
`;

export interface AiClassifyRow {
  narration: string;
  type: 'credit' | 'debit';
  /** Unsigned amount; 0 when unknown. */
  amount: number;
}

export interface AiDecision {
  category: string;
  subcategory: string | null;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
}

const BATCH_SIZE = 40;
const CONCURRENCY = 3;
const MAX_OUTPUT_TOKENS = 16_384;
const VALID = new Set<string>(BANK_STATEMENT_CATEGORIES);

type Compact = Array<[string | null, string | null] | null>;

async function mapWithConcurrency<T, U>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<U>): Promise<U[]> {
  const out = new Array<U>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

function tsv(rows: AiClassifyRow[]): string {
  return rows.map(r => `${r.narration.replace(/[\t\r\n]+/g, ' ').trim()}\t${r.type}\t${r.amount}`).join('\n');
}

/** One batch; bisects on a parse / network failure (depth ≤ 3). Missing
 *  trailing answers are padded with null (the caller keeps "Other"). */
async function runBatch(rows: AiClassifyRow[], usages: AiUsage[], onFallback: (() => void) | undefined, depth = 0): Promise<Array<AiDecision | null>> {
  try {
    const r = await callBankEnrichment<Compact>(BANK_AI_STATIC_PREFIX, tsv(rows), { maxTokens: MAX_OUTPUT_TOKENS, onFallback });
    usages.push({ inputTokens: r.inputTokens, outputTokens: r.outputTokens, modelUsed: r.modelUsed });
    const arr = Array.isArray(r.data) ? r.data : [];
    return rows.map((_, i) => {
      const pair = arr[i];
      const cat = Array.isArray(pair) && typeof pair[0] === 'string' ? pair[0].trim() : '';
      if (!VALID.has(cat)) return null;
      const sub = Array.isArray(pair) && typeof pair[1] === 'string' && pair[1].trim() ? pair[1].trim() : null;
      return { category: cat, subcategory: sub };
    });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (depth >= 3 || rows.length <= 1 || !/parse|finish_reason=length|JSON|network|timeout/i.test(msg)) throw err;
    const mid = Math.ceil(rows.length / 2);
    const [a, b] = await Promise.all([
      runBatch(rows.slice(0, mid), usages, onFallback, depth + 1),
      runBatch(rows.slice(mid), usages, onFallback, depth + 1),
    ]);
    return [...a, ...b];
  }
}

/**
 * Categorise rows with the AI tier. Rows with the same narration
 * fingerprint and direction are sent once; answers already in the
 * per-firm AI-decision cache are reused, and new ones are written to it.
 * A null decision means "no answer" — the caller keeps its fallback.
 * Batches that fail even after bisecting leave their rows null; the
 * function itself only throws if every batch failed.
 */
export async function classifyRowsWithAi(
  rows: AiClassifyRow[],
  opts: { billingUserId: string; onFallback?: () => void },
): Promise<{ decisions: Array<AiDecision | null>; usages: AiUsage[]; sent: number; cached: number }> {
  const decisions: Array<AiDecision | null> = new Array(rows.length).fill(null);
  const usages: AiUsage[] = [];
  const repByKey = new Map<string, number>();     // group key → index into `unique`
  const unique: Array<{ row: AiClassifyRow; fp: string; members: number[] }> = [];
  let cached = 0;

  rows.forEach((row, i) => {
    const fp = extractNarrationFingerprint(row.narration);
    if (fp) {
      const hit = lookupAiClassification(opts.billingUserId, fp, row.type);
      if (hit) { decisions[i] = { category: hit.category, subcategory: hit.subcategory }; cached++; return; }
      const key = `${row.type}|${fp}`;
      const rep = repByKey.get(key);
      if (rep !== undefined) { unique[rep].members.push(i); return; }
      repByKey.set(key, unique.length);
    }
    unique.push({ row, fp, members: [i] });
  });

  const batches: Array<typeof unique> = [];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) batches.push(unique.slice(i, i + BATCH_SIZE));

  let failed = 0;
  let firstErr: unknown = null;
  await mapWithConcurrency(batches, CONCURRENCY, async (batch) => {
    try {
      const answers = await runBatch(batch.map(u => u.row), usages, opts.onFallback);
      batch.forEach((u, j) => {
        const d = answers[j];
        if (!d) return;
        for (const m of u.members) decisions[m] = d;
        if (u.fp) recordAiClassification(opts.billingUserId, u.fp, u.row.type, d.category, d.subcategory);
      });
    } catch (err) {
      failed++;
      firstErr ??= err;
      console.warn(`[bankAiClassifier] batch of ${batch.length} failed: ${(err as Error).message?.slice(0, 160)}`);
    }
  });
  if (batches.length > 0 && failed === batches.length) throw firstErr;
  return { decisions, usages, sent: unique.length, cached };
}
