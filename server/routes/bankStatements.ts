// server/routes/bankStatements.ts
import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import Papa from 'papaparse';
import { extractVisionWithFallback } from '../lib/visionFallback.js';
import { callGeminiJson, type GeminiJsonResult } from '../lib/geminiJson.js';
import { BANK_STATEMENT_PROMPT, BANK_STATEMENT_CATEGORIES, buildConditionsBlock, countWords, MAX_CONDITION_WORDS } from '../lib/bankStatementPrompt.js';
import { classifyRow, extractCounterpartyAndReference, markRecurring } from '../lib/bankClassifier.js';
import { costForModel } from '../lib/gemini.js';
import { creditsForPages, creditsForCsvRows, PAGES_PER_CREDIT, CSV_ROWS_PER_CREDIT } from '../lib/creditPolicy.js';
import { enforceTokenQuota } from '../lib/tokenQuota.js';
import { estimateGeminiVision, estimateFromChars } from '../lib/tokenEstimate.js';
import { bankStatementRepo } from '../db/repositories/bankStatementRepo.js';
import { bankTransactionRepo, BankTransactionInput } from '../db/repositories/bankTransactionRepo.js';
import { bankStatementRuleRepo, BankStatementRuleRow } from '../db/repositories/bankStatementRuleRepo.js';
import { bankStatementConditionRepo, BankStatementConditionRow } from '../db/repositories/bankStatementConditionRepo.js';
import { userRepo } from '../db/repositories/userRepo.js';
import { featureUsageRepo } from '../db/repositories/featureUsageRepo.js';
import { usageRepo } from '../db/repositories/usageRepo.js';
import { getBillingUser } from '../lib/billing.js';
import { getUserLimits, getUsagePeriodStart } from '../lib/planLimits.js';
import { AuthRequest } from '../types.js';

const router = Router();

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if ((ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_MIME_TYPE'));
    }
  },
});

type ExtractedStatement = {
  bankName: string | null;
  accountNumberMasked: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  currency: string | null;
  // Vision path now reports the bank's printed opening/closing balance
  // at the top level. Used by deriveAmountsFromBalance to anchor the
  // first row (which has no prev row to subtract from) and by
  // verifyClosingBalance to assert the derived chain ties out.
  // Optional because the TSV path doesn't fill these and the server
  // falls back gracefully when null.
  openingBalance?: number | null;
  closingBalance?: number | null;
  // Account-side classification. 'asset' = customer's money sits in
  // the account (Savings / Current — balance is a CREDIT balance,
  // deposit ↑ balance, withdrawal ↓ balance — the default convention
  // every reconciler in this file historically assumed). 'liability'
  // = the bank's money sits in the account (Cash Credit / Overdraft /
  // Loan — balance is a DEBIT balance, withdrawal ↑ balance, deposit
  // ↓ balance — opposite sign on the delta).
  //
  // When set to 'liability', reconcileBalances inverts the sign of
  // every `balance[i] - balance[i-1]` delta before using it as the
  // signed transaction amount. Without this flag a CC account's
  // "By Cash" deposits got mis-classified as business expenses
  // (the 2026-05 J&K CC MORTG case): every deposit reduced the Dr
  // balance, producing a negative delta, which the server then
  // recorded as an outflow.
  //
  // Optional + defaults to 'asset' on the server when null/undefined —
  // back-compat with statements parsed before this field existed.
  accountKind?: 'asset' | 'liability' | null;
  transactions: unknown[];
};


/** Run async tasks in bounded-concurrency batches. Lets us parallelize chunk
 *  extraction without hammering Gemini with 6+ concurrent requests per key,
 *  which routinely trips rate limits on dense statements. */
async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}


function toNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[,\s]/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normalizeCategory(raw: unknown): string {
  if (typeof raw !== 'string') return 'Other';
  const match = BANK_STATEMENT_CATEGORIES.find(c => c.toLowerCase() === raw.toLowerCase());
  return match ?? 'Other';
}

/**
 * Coerce whatever Gemini returned into our canonical transaction shape.
 * Amount is always stored signed (positive = credit / inflow).
 *
 * The vision prompt no longer asks for `amount` — the server derives
 * it deterministically from the printed running balance column, which
 * is the most legible / least-error-prone field on the page. We still
 * accept `amount` here for backwards compatibility with the TSV path
 * (which extracts debit/credit columns and pre-signs them) and for the
 * fallback case where a row's balance is null.
 *
 * `type` ("credit" | "debit") is preserved as a sign hint used only
 * when balance-derivation can't run for a row (page boundary, blurred
 * balance cell). When balance IS available on both this row and the
 * previous one, deriveAmountsFromBalance overrides whatever amount we
 * stored here.
 */
/**
 * Final defence against PDF line-wrap splitting a single counterparty
 * name across two visual lines (e.g. "SURESH KUMAR" → "SURE\nSH KUMAR"
 * → wizard / vision sometimes emits "SURE" or "SH KUMAR" as separate
 * counterparties). The prompt already asks the model to merge wraps,
 * but for stragglers we run a deterministic pass over the unique
 * counterparty list and fold short orphan fragments back into a
 * neighbouring full name.
 *
 * Heuristic — fires when ALL of these hold:
 *   - one counterparty (orphan) is ≤4 ALL-CAPS characters with no spaces;
 *   - another counterparty exists whose name STARTS with those chars
 *     (e.g. orphan "SURE" + sibling "SURESH KUMAR" — orphan is the
 *     first half of the sibling's first token);
 *   - the orphan appears in at least one transaction whose raw
 *     narration also contains the full sibling name.
 *
 * Rewrites every transaction tagged with the orphan to use the
 * full sibling name instead.
 */
function mergeWrappedCounterparties(txs: BankTransactionInput[]): BankTransactionInput[] {
  if (txs.length === 0) return txs;
  const counterpartyNames = new Set<string>();
  for (const t of txs) if (t.counterparty) counterpartyNames.add(t.counterparty);

  // Build a map of orphan → full-name for each candidate pair.
  const remap = new Map<string, string>();
  for (const orphan of counterpartyNames) {
    const o = orphan.trim();
    if (!o || o.length > 4 || /\s/.test(o) || !/^[A-Z]+$/.test(o)) continue;
    // Find any other counterparty whose first token starts with the
    // orphan as a prefix and is strictly longer (i.e. orphan is the
    // wrapped first half).
    let bestMatch: string | null = null;
    let bestLen = Infinity;
    for (const candidate of counterpartyNames) {
      if (candidate === orphan) continue;
      const firstTok = candidate.trim().split(/\s+/)[0] ?? '';
      if (firstTok.length <= o.length) continue;
      if (!firstTok.startsWith(o)) continue;
      // Prefer the SHORTEST full name that matches — closer in length
      // to the orphan, more likely to be the actual wrapped pair.
      if (candidate.length < bestLen) { bestLen = candidate.length; bestMatch = candidate; }
    }
    if (!bestMatch) continue;
    // Confirm: at least one transaction tagged with the orphan has a
    // narration that also mentions the sibling's full string. Avoids
    // false positives where two unrelated names happen to share a
    // prefix.
    const sibling = bestMatch;
    const orphanTxs = txs.filter(t => t.counterparty === orphan);
    const corroborated = orphanTxs.some(t =>
      typeof t.narration === 'string' && t.narration.toUpperCase().includes(sibling),
    );
    if (corroborated) {
      remap.set(orphan, sibling);
    }
  }

  if (remap.size === 0) return txs;
  for (const [orphan, sibling] of remap) {
    console.log(`[bank-statements] wrap-merge: counterparty "${orphan}" → "${sibling}"`);
  }
  return txs.map(t => {
    if (t.counterparty && remap.has(t.counterparty)) {
      return { ...t, counterparty: remap.get(t.counterparty)! };
    }
    return t;
  });
}

function normalizeTransactions(raw: unknown[]): BankTransactionInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => {
    const obj = (t && typeof t === 'object') ? t as Record<string, unknown> : {};
    const type = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
    let amount = obj.amount === undefined || obj.amount === null ? 0 : toNumber(obj.amount);
    // If the model returned an absolute value and a type, apply sign from type
    if (type === 'debit' && amount > 0) amount = -amount;
    if (type === 'credit' && amount < 0) amount = Math.abs(amount);
    // When amount is missing entirely (vision path under the new
    // prompt) but type is present, encode the sign with a sentinel
    // magnitude of 0 — the actual magnitude lands in deriveAmountsFromBalance.
    if (amount === 0 && type === 'debit') amount = -0;        // signed zero preserves intent
    const balance = obj.balance === null || obj.balance === undefined ? null : toNumber(obj.balance);
    return {
      date: typeof obj.date === 'string' ? obj.date : null,
      narration: typeof obj.narration === 'string' ? obj.narration.slice(0, 500) : null,
      amount,
      balance,
      category: normalizeCategory(obj.category),
      subcategory: typeof obj.subcategory === 'string' ? obj.subcategory : null,
      counterparty: typeof obj.counterparty === 'string' ? obj.counterparty.slice(0, 200) : null,
      reference: typeof obj.reference === 'string' ? obj.reference.slice(0, 100) : null,
      isRecurring: obj.isRecurring === true,
    };
  });
}

/**
 * Apply user-defined rules: if a rule's match_text appears (case-insensitive)
 * inside the narration, override category and/or stamp counterparty_label.
 * Mutates a shallow copy — leaves originals alone. Rules are tried in order,
 * first match wins.
 */
function applyUserRules(txs: BankTransactionInput[], rules: BankStatementRuleRow[]): BankTransactionInput[] {
  if (!rules.length) return txs;
  return txs.map((tx) => {
    const hay = (tx.narration ?? '').toLowerCase();
    for (const rule of rules) {
      if (!rule.match_text) continue;
      if (hay.includes(rule.match_text.toLowerCase())) {
        return {
          ...tx,
          category: rule.category ? normalizeCategory(rule.category) : tx.category,
          counterparty: rule.counterparty_label ?? tx.counterparty,
        };
      }
    }
    return tx;
  });
}

function computeTotals(txs: BankTransactionInput[]): { inflow: number; outflow: number } {
  let inflow = 0;
  let outflow = 0;
  for (const tx of txs) {
    if (tx.amount >= 0) inflow += tx.amount;
    else outflow += Math.abs(tx.amount);
  }
  return { inflow, outflow };
}

/**
 * Derive each transaction's signed amount from the bank's printed
 * running balance column instead of trusting the AI's amount read.
 *
 * Why: vision OCR is non-deterministic on dense statements — even when
 * the model gets the credit/debit sign right, it routinely misreads a
 * digit on the magnitude (e.g. ₹500 instead of ₹5,000). Our previous
 * sign-only reconciliation passed those rows through silently, leaving
 * inflow/outflow totals off by tens of thousands. Subtracting the
 * printed balance column is exact arithmetic — no OCR variance, no
 * model hallucination, and it falls out of data the bank itself wrote.
 *
 * Mutates txs in-place. Returns:
 *   - amountOverridden: rows where the derived amount differed from
 *     the AI's value (used to populate the warning banner).
 *   - phantomDropped: rows filtered because their balance was
 *     unchanged (zero-delta rows are almost always wrap-induced
 *     duplicates from a UPI narration that spilled onto two lines).
 *
 * Falls back to the AI's amount on any row where balance is null.
 */
function deriveAmountsFromBalance(
  txs: BankTransactionInput[],
  openingBalance: number | null,
  /** 'asset' (default) = savings/current — balance ↑ = inflow (credit).
   *  'liability' = CC / OD / Loan — balance ↑ = withdrawal (debit),
   *  so we invert the sign of every delta before treating it as a
   *  signed amount. Null treated as 'asset' for back-compat. */
  accountKind: 'asset' | 'liability' | null = 'asset',
): {
  amountOverridden: number;
  phantomDropped: number;
} {
  let amountOverridden = 0;
  let phantomDropped = 0;
  const kept: BankTransactionInput[] = [];
  const deltaSign = accountKind === 'liability' ? -1 : 1;

  for (let i = 0; i < txs.length; i++) {
    const cur = txs[i];
    const prevBalance = i === 0 ? openingBalance : txs[i - 1].balance;

    if (prevBalance != null && cur.balance != null) {
      const delta = deltaSign * (cur.balance - prevBalance);
      // Phantom row detection: identical balance to the previous row
      // means no money moved on this line. UPI narrations on dense
      // statements sometimes wrap onto two visual lines and the AI
      // emits both as separate transactions. The continuation row
      // copies the same balance because that's what's printed next
      // to it. Drop these — keeping them would either inflate the
      // inflow/outflow with the AI's hallucinated amount or pollute
      // the row count with empty entries.
      if (Math.abs(delta) < 0.005) {
        // Edge case: a genuine 0.00 transaction (very rare — bank
        // bonus, contra-entry netting). Keep it if the AI did NOT
        // give it a non-trivial amount.
        if (Math.abs(cur.amount) < 0.005) {
          kept.push({ ...cur, amount: 0 });
        } else {
          phantomDropped++;
        }
        continue;
      }

      // Override. Track when the AI's value materially disagreed so
      // the warning banner can surface it.
      if (Math.abs(delta - cur.amount) > Math.max(1, Math.abs(delta) * 0.005)) {
        amountOverridden++;
      }
      kept.push({ ...cur, amount: delta });
      continue;
    }

    // Balance is null on either this row or the previous one — fall
    // back to whatever the AI gave us. This is the legacy path; on
    // statements with consistent balance printing it never fires.
    kept.push(cur);
  }

  // Replace the array contents in-place so callers using the same
  // reference see the filtered list.
  txs.length = 0;
  txs.push(...kept);

  return { amountOverridden, phantomDropped };
}

/**
 * Final integrity check: assert opening + sum(amounts) ≈ closing.
 * If this fails, the printed-balance chain itself has a gap somewhere
 * (likely a misread balance on one row that propagated forward via
 * deriveAmountsFromBalance), and our totals are still suspect even
 * though they look internally consistent.
 *
 * Returns null when either anchor is missing (older statements that
 * don't print explicit opening/closing) or when the sum ties out.
 * Returns a warning string the caller surfaces in reconciliationWarning.
 */
function verifyClosingBalance(
  txs: BankTransactionInput[],
  openingBalance: number | null,
  closingBalance: number | null,
  /** See deriveAmountsFromBalance — same sign-inversion logic.
   *  For a liability account a NET REPAYMENT of X reduces the Dr
   *  balance by X (so closing − opening = −X), but the signed
   *  transaction amounts sum to +X (net positive inflow = repayment
   *  inflows minus draws). Inverting the expected delta lines those
   *  up. Default 'asset' for back-compat. */
  accountKind: 'asset' | 'liability' | null = 'asset',
): string | null {
  if (openingBalance == null || closingBalance == null) return null;
  const sum = txs.reduce((s, t) => s + t.amount, 0);
  const deltaSign = accountKind === 'liability' ? -1 : 1;
  const expected = deltaSign * (closingBalance - openingBalance);
  const tol = Math.max(1, Math.abs(expected) * 0.005);
  if (Math.abs(sum - expected) <= tol) return null;
  const drift = sum - expected;

  // Walk the chain to find the FIRST row where opening + cumsum
  // diverges from the printed running balance.
  let cum = openingBalance;
  let firstBreak: { index: number; date: string | null; narration: string | null; expectedBalance: number; actualBalance: number; rowDelta: number } | null = null;
  for (let i = 0; i < txs.length; i++) {
    cum += txs[i].amount;
    const actual = txs[i].balance;
    if (actual == null) continue;
    const rowTol = Math.max(1, Math.abs(actual) * 0.005);
    if (Math.abs(cum - actual) > rowTol) {
      firstBreak = {
        index: i,
        date: txs[i].date,
        narration: txs[i].narration,
        expectedBalance: cum,
        actualBalance: actual,
        rowDelta: cum - actual,
      };
      break;
    }
  }

  // Same-date cluster context. When the divergence row shares its
  // date with neighbouring rows, the most likely cause is row
  // alignment / a missing row in a same-date cluster — not a
  // misread balance digit. The statement we hit this on (BoB 17pp)
  // had THREE rows on 2025-09-07 and the AI dropped the middle
  // one, shifting subsequent narrations up by one slot. Spot-checking
  // the date neighbourhood lets the diagnostic distinguish the two
  // hypotheses instead of always claiming "misread balance digit".
  let sameDateNeighbours = 0;
  if (firstBreak && firstBreak.date) {
    for (let j = Math.max(0, firstBreak.index - 3); j <= Math.min(txs.length - 1, firstBreak.index + 3); j++) {
      if (j !== firstBreak.index && txs[j].date === firstBreak.date) sameDateNeighbours++;
    }
  }
  const looksLikeMissingRow = !!firstBreak && sameDateNeighbours >= 1;

  if (firstBreak) {
    const narrationPreview = (firstBreak.narration ?? '').slice(0, 80);
    const hypothesis = looksLikeMissingRow
      ? 'likely a MISSING ROW in the same-date cluster (the row is gone, the chain is internally consistent without it). The narration printed below is from the row that took the missing row\'s slot, NOT the misread one.'
      : 'likely a misread balance digit on this row.';
    console.warn(`[bank-statements] balance chain first diverges at row ${firstBreak.index + 1} (date ${firstBreak.date ?? 'unknown'}, narration "${narrationPreview}"): expected balance ${firstBreak.expectedBalance.toFixed(2)}, printed balance ${firstBreak.actualBalance.toFixed(2)}, delta ${firstBreak.rowDelta.toFixed(2)}. Same-date neighbours: ${sameDateNeighbours}. Total drift across statement: ${drift.toFixed(2)}. Hypothesis: ${hypothesis}`);
  } else {
    console.warn(`[bank-statements] closing-balance mismatch (drift ${drift.toFixed(2)}) but every row's printed balance ties to cumsum within tolerance — likely an opening- or closing-balance OCR error rather than a per-row issue.`);
  }

  const breakSuffix = firstBreak
    ? looksLikeMissingRow
      ? ` Looks like a missing transaction near row ${firstBreak.index + 1} on ${firstBreak.date ?? 'unknown date'} — there are ${sameDateNeighbours} other transaction(s) on this date and the gap of ${Math.abs(firstBreak.rowDelta).toLocaleString('en-IN', { minimumFractionDigits: 2 })} matches one missing row. Please verify against the original PDF.`
      : ` First divergence at row ${firstBreak.index + 1} on ${firstBreak.date ?? 'unknown date'} — printed balance differs from running total by ${Math.abs(firstBreak.rowDelta).toLocaleString('en-IN', { minimumFractionDigits: 2 })}, possibly a misread balance digit.`
    : '';
  return `Opening + sum(transactions) = ${(openingBalance + sum).toLocaleString('en-IN', { minimumFractionDigits: 2 })} but the bank prints a closing balance of ${closingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })} — a difference of ${Math.abs(drift).toLocaleString('en-IN', { minimumFractionDigits: 2 })}.${breakSuffix}`;
}

/**
 * Drop phantom rows where the AI mistook an inline date inside an
 * adjacent row's narration for a new transaction anchor.
 *
 * Production examples on a BoB statement:
 *   - "Int.Pd:01-02-2025 to 30-04-2025" — emits 2 phantom rows dated
 *     01-02-2025 and 30-04-2025
 *   - "CMSLI/DMIFINPL/09-08-2025/_LIEN_REV" — emits 1 phantom row
 *     dated 09-08-2025
 *
 * Signature: balance == null (AI didn't see a real balance for the
 * imaginary row), and the row's date appears as a DD-MM-YYYY or
 * DD/MM/YYYY substring inside an ADJACENT row's narration. We check
 * both prev AND next narration because the model sometimes emits
 * phantoms BEFORE the real row that contains the inline date.
 *
 * Runs BEFORE deriveAmountsFromBalance so the balance-chain logic
 * doesn't try to recover amounts for these fake rows.
 */
function dropInlineDatePhantoms(txs: BankTransactionInput[]): { dropped: number; droppedRows: Array<{ index: number; date: string | null; matchedSide: 'prev' | 'next' }> } {
  if (txs.length < 2) return { dropped: 0, droppedRows: [] };
  let dropped = 0;
  const droppedRows: Array<{ index: number; date: string | null; matchedSide: 'prev' | 'next' }> = [];
  const kept: BankTransactionInput[] = [];
  for (let i = 0; i < txs.length; i++) {
    const cur = txs[i];
    const prev = i > 0 ? txs[i - 1] : null;
    const next = i < txs.length - 1 ? txs[i + 1] : null;
    if (cur.date && cur.balance == null) {
      const inPrev = prev?.narration && isInlineDateInNarration(cur.date, prev.narration);
      const inNext = next?.narration && isInlineDateInNarration(cur.date, next.narration);
      if (inPrev || inNext) {
        dropped++;
        droppedRows.push({ index: i, date: cur.date, matchedSide: inPrev ? 'prev' : 'next' });
        continue;
      }
    }
    kept.push(cur);
  }
  txs.length = 0;
  txs.push(...kept);
  return { dropped, droppedRows };
}

/** True when YYYY-MM-DD `date` appears as a DD-MM-YYYY or DD/MM/YYYY
 *  substring anywhere inside `narration`. */
function isInlineDateInNarration(date: string, narration: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const [, yyyy, mm, dd] = m;
  return narration.includes(`${dd}-${mm}-${yyyy}`) || narration.includes(`${dd}/${mm}/${yyyy}`);
}

interface BalanceMismatch {
  index: number;
  date: string | null;
  narration: string | null;
  expectedDelta: number;
  actualDelta: number;
}

/**
 * Reconcile each row's signed amount against the bank's printed
 * running balance. For row N with both balance(N) and balance(N-1)
 * extracted, balance(N) - balance(N-1) pins the row's signed amount
 * exactly — the bank's printed number is authoritative, the AI's
 * credit/debit classification is not.
 *
 * Three outcomes per mismatched row:
 *
 *   - Pure sign flip (|expected| ≈ |actual|, signs differ): the AI
 *     got the rupee amount right but put it on the wrong side of the
 *     ledger. We overwrite tx.amount with the printed delta. This
 *     is the dominant failure mode and produces the symmetric
 *     "inflow undercounts by X, outflow overcounts by X" drift
 *     pattern (e.g. 16-row Canara mismatch → ₹62K each-way drift,
 *     ₹1.23L net error).
 *
 *   - Column swap (amount and balance values landed in each other's
 *     columns upstream — typical for narrow-fee rows where pdfjs's
 *     column anchor drifts past the boundary). prev.balance + ±|cur.
 *     balance| ≈ |cur.amount| pins the swap. We overwrite both
 *     amount and balance with the corrected pair.
 *
 *   - Magnitudes still disagree after both candidates fail: real
 *     extraction error (AI misread a digit, missed a row, etc.). We
 *     can't pick a correct value, so we surface it for human review
 *     and leave tx.amount alone.
 *
 * Mutates txs in-place. Skips rows where either balance is null
 * (page boundaries, banks that don't print a per-row balance).
 */
function reconcileBalances(
  txs: BankTransactionInput[],
  /** See deriveAmountsFromBalance — same sign-inversion logic. */
  accountKind: 'asset' | 'liability' | null = 'asset',
): {
  autoCorrected: number;
  mismatches: BalanceMismatch[];
} {
  let autoCorrected = 0;
  const mismatches: BalanceMismatch[] = [];
  const deltaSign = accountKind === 'liability' ? -1 : 1;
  for (let i = 1; i < txs.length; i++) {
    const prev = txs[i - 1];
    const cur = txs[i];
    if (prev.balance == null || cur.balance == null) continue;
    const expectedDelta = deltaSign * (cur.balance - prev.balance);
    const actualDelta = cur.amount;
    // Tolerance: ₹1 absolute or 0.5% of the larger value (covers
    // rounding in printed balances).
    const tol = Math.max(1, Math.abs(actualDelta) * 0.005, Math.abs(expectedDelta) * 0.005);
    if (Math.abs(expectedDelta - actualDelta) <= tol) continue;

    if (Math.abs(Math.abs(expectedDelta) - Math.abs(actualDelta)) <= tol) {
      // Sign flip — printed balance is ground truth, overwrite.
      cur.amount = expectedDelta;
      autoCorrected++;
      continue;
    }

    // Column swap — amount and balance values landed in each other's
    // columns upstream. The corrected amount magnitude lives in
    // cur.balance and the corrected balance lives in |cur.amount|.
    // Verify against prev.balance: prev.balance + corrected_amount
    // should equal corrected_balance within a paisa.
    const sign = actualDelta < 0 ? -1 : 1;
    const correctedAmtCandA = sign * Math.abs(cur.balance);
    const correctedAmtCandB = -sign * Math.abs(cur.balance);
    const correctedBal = Math.abs(actualDelta);
    const errA = Math.abs((prev.balance + correctedAmtCandA) - correctedBal);
    const errB = Math.abs((prev.balance + correctedAmtCandB) - correctedBal);
    // Tight gate (5 paise) — only adopt when the swap explanation
    // produces a near-exact match against the printed balance,
    // otherwise we'd false-correct rows that have a different bug.
    if (errA < 0.05 && errA <= errB) {
      cur.amount = correctedAmtCandA;
      cur.balance = correctedBal;
      autoCorrected++;
      continue;
    }
    if (errB < 0.05) {
      cur.amount = correctedAmtCandB;
      cur.balance = correctedBal;
      autoCorrected++;
      continue;
    }

    mismatches.push({
      index: i,
      date: cur.date,
      narration: cur.narration,
      expectedDelta,
      actualDelta,
    });
  }
  return { autoCorrected, mismatches };
}

function enforceQuota(req: AuthRequest, res: Response): { ok: true; billingUserId: string; plan: string; creditsLimit: number; creditsUsed: number; creditsRemaining: number } | { ok: false } {
  const actor = userRepo.findById(req.user!.id);
  const billingUser = actor ? getBillingUser(actor) : undefined;
  const billingUserId = billingUser?.id ?? req.user!.id;
  const plan = billingUser?.plan ?? actor?.plan ?? 'free';
  const limitSource = billingUser ?? actor;
  // Per-feature bank-statement credit cap removed in favour of the
  // single cross-feature token budget. Track creditsUsed for analytics
  // display (still useful) but report creditsLimit/creditsRemaining as
  // 0 — UI should hide the "of Y" portion.
  const periodStart = limitSource ? getUsagePeriodStart(limitSource) : new Date(0).toISOString().replace('Z', '');
  let creditsUsed = 0;
  try {
    creditsUsed = featureUsageRepo.sumCreditsSinceForBillingUser(billingUserId, 'bank_statement_analyze', periodStart);
  } catch (err) {
    console.error('[bank-statements] Failed to read usage:', err);
  }
  return { ok: true, billingUserId, plan, creditsLimit: 0, creditsUsed, creditsRemaining: 0 };
}

/** Persist a completed analysis into a placeholder row created upfront.
 *  Two-phase: createPlaceholder (status='analyzing') happens at request
 *  start so the row is visible to a tab-close-and-reload, then this fills
 *  in extracted metadata + transactions and flips status to 'done'. */
function persistStatement(
  userId: string,
  statementId: string,
  data: ExtractedStatement,
  fallbackName: string,
) {
  const rawTxs = normalizeTransactions(data.transactions ?? []);
  const mergedTxs = mergeWrappedCounterparties(rawTxs);
  const rules = bankStatementRuleRepo.listByUser(userId);
  const txs = applyUserRules(mergedTxs, rules);

  // Phase 0: drop inline-date phantoms BEFORE balance derivation.
  // Phantoms are rows the AI hallucinated from inline date strings
  // ("Int.Pd:01-02-2025 to 30-04-2025" emits two fake rows;
  // "/09-08-2025/_LIEN_REV" emits one). Removing them before Phase 1
  // matters because the chain check downstream uses adjacency — if a
  // phantom sits between two real rows, the apparent gap distorts
  // diagnostics. Detector matches the row's date against
  // DD-MM-YYYY occurrences in EITHER neighbouring row's narration
  // (the AI sometimes emits phantoms before the source row, not
  // after). Gated on null-balance only — no longer requires zero
  // amount, since the AI assigns hallucinated amounts to phantoms
  // about half the time.
  const phantomResult = dropInlineDatePhantoms(txs);
  if (phantomResult.dropped > 0) {
    console.log(`[bank-statements] dropInlineDatePhantoms: dropped ${phantomResult.dropped} row(s) — ${phantomResult.droppedRows.map(r => `${r.date} (matched ${r.matchedSide} narration)`).join(', ')}`);
  }
  const inlineDatePhantomsDropped = phantomResult.dropped;

  // accountKind = 'liability' for CC / OD / Loan accounts where the
  // balance is a debit balance and the delta sign is inverted.
  // Defaults to 'asset' on null/undefined so existing savings /
  // current statements behave exactly as before.
  const accountKind: 'asset' | 'liability' = data.accountKind === 'liability' ? 'liability' : 'asset';

  // Phase 1: derive each amount from the printed running balance
  // delta. The AI's amount field is treated as a fallback (used only
  // for rows where balance is null on either side). Zero-delta rows
  // (a balance unchanged from prev row) drop out here as a second
  // layer of phantom defence.
  const opening = typeof data.openingBalance === 'number' ? data.openingBalance : null;
  const { amountOverridden, phantomDropped } = deriveAmountsFromBalance(txs, opening, accountKind);
  const totalPhantomDropped = phantomDropped + inlineDatePhantomsDropped;

  // Phase 2: legacy sign-flip / column-swap reconciliation. After
  // deriveAmountsFromBalance most rows already have authoritative
  // amounts; this catches the residual cases where balance was null
  // on one side and we fell back to the AI's value. Cheap to keep.
  const { autoCorrected, mismatches } = reconcileBalances(txs, accountKind);

  // Phase 3: integrity check — opening + sum should equal closing.
  // If not, the printed-balance chain itself has a misread somewhere
  // and our derived totals are still suspect. Surface as a warning.
  const closing = typeof data.closingBalance === 'number' ? data.closingBalance : null;
  const closingMismatch = verifyClosingBalance(txs, opening, closing, accountKind);

  const { inflow, outflow } = computeTotals(txs);
  const periodLabel = data.periodFrom && data.periodTo
    ? `${data.periodFrom} – ${data.periodTo}`
    : new Date().toISOString().slice(0, 10);
  const name = [data.bankName, periodLabel].filter(Boolean).join(' · ') || fallbackName;

  bankStatementRepo.updateAfterAnalyze(statementId, userId, {
    name,
    bankName: data.bankName ?? null,
    accountNumberMasked: data.accountNumberMasked ?? null,
    periodFrom: data.periodFrom ?? null,
    periodTo: data.periodTo ?? null,
    sourceFilename: null,  // already set on placeholder
    sourceMime: null,
    rawExtracted: JSON.stringify(data),
    accountKind: accountKind,
  });
  bankTransactionRepo.bulkInsert(statementId, txs);
  bankStatementRepo.updateTotals(statementId, inflow, outflow, txs.length);

  return { txCount: txs.length, autoCorrected, mismatches, amountOverridden, phantomDropped: totalPhantomDropped, closingMismatch };
}

function serializeStatement(row: ReturnType<typeof bankStatementRepo.findByIdForUser>) {
  if (!row) return null;
  // Cast for ALTER-TABLE-added columns the inferred row type doesn't
  // include yet. Frontend reads analyzeChunksTotal / Done while the
  // wizard's CSV categorisation runs to render "3 of 5 batches done".
  const r = row as unknown as Record<string, unknown>;
  return {
    id: row.id,
    name: row.name,
    bankName: row.bank_name,
    accountNumberMasked: row.account_number_masked,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    sourceFilename: row.source_filename,
    sourceMime: row.source_mime,
    totalInflow: row.total_inflow,
    totalOutflow: row.total_outflow,
    txCount: row.tx_count,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    analyzeChunksTotal: typeof r.analyze_chunks_total === 'number' ? r.analyze_chunks_total : 0,
    analyzeChunksDone: typeof r.analyze_chunks_done === 'number' ? r.analyze_chunks_done : 0,
    providerFallback: r.provider_fallback === 1,
  };
}

function serializeTransaction(row: ReturnType<typeof bankTransactionRepo.listByStatement>[number]) {
  return {
    id: row.id,
    date: row.tx_date,
    narration: row.narration,
    amount: row.amount,
    balance: row.balance,
    category: row.category,
    subcategory: row.subcategory,
    counterparty: row.counterparty,
    reference: row.reference,
    isRecurring: row.is_recurring === 1,
    userOverride: row.user_override === 1,
  };
}

function serializeRule(row: BankStatementRuleRow) {
  return {
    id: row.id,
    matchText: row.match_text,
    category: row.category,
    counterpartyLabel: row.counterparty_label,
    createdAt: row.created_at,
  };
}

// ── Routes ─────────────────────────────────────────────────────────────

// GET /api/bank-statements — list
router.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const rows = bankStatementRepo.findByUserId(req.user.id);
  const actor = userRepo.findById(req.user.id);
  const billingUser = actor ? getBillingUser(actor) : null;
  const periodStart = (billingUser ?? actor) ? getUsagePeriodStart(billingUser ?? actor!) : new Date(0).toISOString().replace('Z', '');
  const creditsUsed = billingUser
    ? featureUsageRepo.sumCreditsSinceForBillingUser(billingUser.id, 'bank_statement_analyze', periodStart)
    : 0;
  // Per-feature limit removed — only the cross-feature token budget
  // gates now. creditsLimit reported as 0 so the UI can hide the
  // "of Y" portion of the usage bar.
  res.json({
    statements: rows.map(serializeStatement),
    usage: {
      creditsUsed,
      creditsLimit: 0,
      pagesPerCredit: PAGES_PER_CREDIT.bank_statement,
      csvRowsPerCredit: CSV_ROWS_PER_CREDIT.bank_statement ?? 0,
    },
  });
});

// GET /api/bank-statements/rules — list user-defined categorization rules.
router.get('/rules', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const rules = bankStatementRuleRepo.listByUser(req.user.id).map(serializeRule);
  res.json({ rules });
});

// POST /api/bank-statements/rules — create a new rule.
router.post('/rules', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const matchText = typeof req.body?.matchText === 'string' ? req.body.matchText.trim() : '';
  if (!matchText) { res.status(400).json({ error: 'matchText is required' }); return; }
  const category = typeof req.body?.category === 'string' ? normalizeCategory(req.body.category) : null;
  const counterpartyLabel = typeof req.body?.counterpartyLabel === 'string' && req.body.counterpartyLabel.trim()
    ? req.body.counterpartyLabel.trim().slice(0, 200)
    : null;
  if (!category && !counterpartyLabel) {
    res.status(400).json({ error: 'Provide at least a category or counterpartyLabel' });
    return;
  }
  const row = bankStatementRuleRepo.create(req.user.id, matchText.slice(0, 200), category, counterpartyLabel);
  res.status(201).json({ rule: serializeRule(row) });
});

// DELETE /api/bank-statements/rules/:ruleId
router.delete('/rules/:ruleId', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const ok = bankStatementRuleRepo.delete(req.user.id, req.params.ruleId);
  if (!ok) { res.status(404).json({ error: 'Rule not found' }); return; }
  res.json({ success: true });
});

function serializeCondition(row: BankStatementConditionRow) {
  return { id: row.id, text: row.text, createdAt: row.created_at };
}

// GET /api/bank-statements/conditions — list user-defined parsing conditions.
router.get('/conditions', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const conditions = bankStatementConditionRepo.listByUser(req.user.id).map(serializeCondition);
  res.json({ conditions, maxWords: MAX_CONDITION_WORDS });
});

// POST /api/bank-statements/conditions — create a new condition.
router.post('/conditions', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) { res.status(400).json({ error: 'text is required' }); return; }
  if (countWords(text) > MAX_CONDITION_WORDS) {
    res.status(400).json({ error: `Condition exceeds the ${MAX_CONDITION_WORDS}-word limit` });
    return;
  }
  const row = bankStatementConditionRepo.create(req.user.id, text.slice(0, 1000));
  res.status(201).json({ condition: serializeCondition(row) });
});

// DELETE /api/bank-statements/conditions/:conditionId
router.delete('/conditions/:conditionId', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const ok = bankStatementConditionRepo.delete(req.user.id, req.params.conditionId);
  if (!ok) { res.status(404).json({ error: 'Condition not found' }); return; }
  res.json({ success: true });
});

// GET /api/bank-statements/:id — detail + transactions
router.get('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const row = bankStatementRepo.findByIdForUser(req.params.id, req.user.id);
  if (!row) { res.status(404).json({ error: 'Statement not found' }); return; }
  const txs = bankTransactionRepo.listByStatement(row.id);
  res.json({
    statement: serializeStatement(row),
    transactions: txs.map(serializeTransaction),
  });
});

// POST /api/bank-statements/analyze — multipart file OR JSON { csvText, filename? }
router.post(
  '/analyze',
  (req: Request, res: Response, next: NextFunction) => {
    const ct = req.headers['content-type'] ?? '';
    if (typeof ct === 'string' && ct.startsWith('multipart/form-data')) {
      upload.single('file')(req, res, (err) => {
        if (err) return next(err);
        next();
      });
    } else {
      next();
    }
  },
  async (req: AuthRequest, res: Response) => {
    if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }

    // Bank Statement Analyzer is available on all plans (including free).
    // Token-budget gate — the HARD quota check. Per-feature credit
    // logic below is computed for analytics display only and doesn't
    // reject. enforceTokenQuota responds 429 itself when the budget
    // is exhausted; we early-return on ok=false.
    //
    // Pre-flight estimate: compute the rough Gemini cost from the
    // upload size BEFORE we call the gate, so the gate can reject
    // a single-call overshoot up front instead of after the fact.
    // Gate also reserves the estimate for the duration of the request,
    // so two parallel uploads can't both pass on a thin remaining
    // budget and collectively bust the cap.
    const preflightEstimate = (() => {
      if (req.file) return estimateGeminiVision(req.file.size);
      // The pdfText / TSV path used to live here too — killed after the
      // wizard's column threshold loosened to 3, which routed every
      // grid-extractable PDF through the cheap CSV path and left only
      // genuinely-un-grid-able uploads to the vision path above.
      if (typeof req.body?.csvText === 'string') return estimateFromChars(req.body.csvText.length + 800);
      return 0;
    })();
    const tokenQuota = enforceTokenQuota(req, res, preflightEstimate);
    if (!tokenQuota.ok) return;
    // Reservation lives until the response closes — covers success,
    // failure, and client-aborted cases. The api_usage row written by
    // the route below replaces the reservation with real usage on the
    // next gate call.
    res.once('close', () => tokenQuota.release());
    const quota = enforceQuota(req, res);
    if (!quota.ok) return;

    // Load free-form parsing conditions for this user once and prepend them to
    // every prompt path (TSV chunks, vision, CSV). Empty string when the user
    // has none.
    const userConditions = bankStatementConditionRepo.listByUser(req.user.id);
    const conditionsBlock = buildConditionsBlock(userConditions);

    const isCsv = !req.file && typeof req.body?.csvText === 'string';

    if (!req.file && !isCsv) {
      // The legacy `pdfText` body shape used to land here and dispatch
      // to the chunked TSV extraction path. That path was retired —
      // every digital PDF now goes through the wizard → CSV path
      // (cheap deterministic classifier + a small ambiguous-rows AI
      // call), and un-grid-able PDFs land on the vision multipart
      // path above. Reject `pdfText` bodies explicitly so old clients
      // don't silently fail with a generic 400.
      if (typeof req.body?.pdfText === 'string') {
        res.status(410).json({
          error: 'The pdfText / TSV extraction endpoint was retired. Re-run the upload — the client extracts the grid in the browser and posts a CSV instead.',
        });
        return;
      }
      res.status(400).json({ error: 'Provide a PDF/image file or csvText body.' });
      return;
    }

    // SSE progress stream — kept for the CSV path's multi-batch
    // enrichment work (each ambiguous-row batch fires a progress
    // event). Vision is single-call and uses the JSON response.
    let sseOpen = false;
    const sendSse = (obj: unknown) => {
      if (!sseOpen) return;
      try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* client disconnected */ }
    };

    // Compute a fingerprint of the input so we can:
    //   1. Refuse a duplicate analysis if one's already running for this
    //      file (tab close + retry would otherwise fire a parallel run).
    //   2. Persist a status='analyzing' row UPFRONT — Node doesn't abort
    //      handlers on client disconnect, so the analysis keeps going even
    //      if the user reloads, and the row's there for them to find when
    //      they come back.
    let fileHash: string | null = null;
    if (req.file) {
      fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    } else if (isCsv) {
      fileHash = crypto.createHash('sha256').update(String(req.body.csvText)).digest('hex');
    }

    if (fileHash) {
      const inProgress = bankStatementRepo.findInProgressByHashForUser(req.user.id, fileHash);
      if (inProgress) {
        console.log(`[bank-statements] re-attaching to in-progress statement ${inProgress.id} instead of starting a new run`);
        const txs = bankTransactionRepo.listByStatement(inProgress.id).map(serializeTransaction);
        const payload = { statement: serializeStatement(inProgress), transactions: txs, txCount: txs.length, resumed: true };
        if (sseOpen) { sendSse({ type: 'done', ...payload }); res.end(); }
        else res.status(200).json(payload);
        return;
      }
      // Same-hash dedup for SUCCESSFULLY-completed runs. Without this, a
      // second upload of the same file re-runs Gemini and produces
      // slightly different totals than the first run because
      //   - chunks that 503 on one run vs the next get routed to the
      //     fallback model (T1 instead of T2),
      //   - the per-row salvage logic (both-debit-credit, trailer-undercount
      //     accept) makes interpretation calls that aren't bit-stable.
      // Reusing the existing row keeps the user's view consistent and
      // saves the duplicate Gemini spend. They can always delete the
      // existing one if they want a fresh analysis.
      const previouslyDone = bankStatementRepo.findDoneByHashForUser(req.user.id, fileHash);
      if (previouslyDone) {
        console.log(`[bank-statements] reusing existing successful analysis ${previouslyDone.id} for hash ${fileHash.slice(0, 12)}…`);
        const txs = bankTransactionRepo.listByStatement(previouslyDone.id).map(serializeTransaction);
        const payload = { statement: serializeStatement(previouslyDone), transactions: txs, txCount: txs.length, resumed: true, alreadyAnalyzed: true };
        if (sseOpen) { sendSse({ type: 'done', ...payload }); res.end(); }
        else res.status(200).json(payload);
        return;
      }
    }

    // Pre-flight credit check. Count the file's "size" up front in the
    // same units the credit policy uses (PDF pages for vision/pdfText,
    // CSV rows for csvText), translate to credits, and reject 4xx if
    // the user doesn't have enough remaining for the month. Avoids
    // starting an expensive run and then half-finishing when the cap
    // hits mid-flight.
    let pagesTotal = 0;
    let creditsNeeded = 0;
    let pagesUnit: 'pages' | 'rows' = 'pages';
    if (isCsv) {
      // Rough count without re-parsing the whole CSV — header + non-empty
      // lines. The full Papa.parse runs later in the CSV branch; close
      // enough for the pre-flight gate.
      const csvLines = String(req.body.csvText).split(/\r?\n/).filter(l => l.trim()).length;
      pagesTotal = Math.max(0, csvLines - 1); // minus header
      creditsNeeded = creditsForCsvRows('bank_statement', pagesTotal);
      pagesUnit = 'rows';
    } else if (req.file) {
      // Vision path on a scanned/image PDF — we don't have a cheap page
      // count from raw bytes here, so charge the minimum (1 credit /
      // 5 pages of headroom). The actual page count gets reconciled at
      // finish time via the chunk loop's pages_processed accumulator.
      pagesTotal = PAGES_PER_CREDIT.bank_statement;
      creditsNeeded = 1;
    }
    // Per-feature credit caps are no longer enforced — the token budget
    // (enforceTokenQuota at the route entry) is the sole quota gate.
    // creditsNeeded is still computed for display/analytics purposes.
    void creditsNeeded;
    void pagesUnit;

    // Upfront placeholder. Visible to any subsequent /api/bank-statements
    // GET while the analysis runs, even after this connection closes.
    const placeholderFilename = req.file?.originalname
      ?? (typeof req.body?.filename === 'string' ? req.body.filename : null)
      ?? (isCsv ? 'statement.csv' : 'statement.pdf');
    const placeholderMime = req.file?.mimetype ?? (isCsv ? 'text/csv' : 'application/pdf');
    const analyzeStartMs = Date.now();
    const placeholder = bankStatementRepo.createPlaceholder(req.user.id, quota.billingUserId, {
      name: placeholderFilename.replace(/\.(pdf|csv|jpe?g|png|webp)$/i, '') || 'Bank Statement',
      sourceFilename: placeholderFilename,
      sourceMime: placeholderMime,
      fileHash,
      pagesTotal,
    });

    try {
      let extracted: ExtractedStatement;
      let filename: string | null;
      let mimeType: string | null;

      if (req.file) {
        filename = req.file.originalname;
        mimeType = req.file.mimetype;
        // Vision path — Gemini 3.1 Flash-Lite Preview → 2.5 Flash-Lite
        // fallback. Single call replaces the earlier 6-batch chunking +
        // merge logic. Image uploads (jpeg/png/webp) flow through the
        // same helper since they're inherently single-page.
        const fullPrompt = `${conditionsBlock}${BANK_STATEMENT_PROMPT}`;
        {
          const visionResult = await extractVisionWithFallback<ExtractedStatement>(
            req.file.buffer,
            mimeType,
            fullPrompt,
            // Bumped to 64K so dense multi-page statements (BoB-style
            // 6 pages × ~25 txns) don't hit MAX_TOKENS and silently
            // truncate to page 1. visionFallback now throws on
            // MAX_TOKENS so any remaining truncation surfaces as an
            // explicit failure rather than corrupt totals.
            //
            // looksValid: tier-1 (Gemini 3.1 Flash-Lite Preview)
            // sometimes returns syntactically-valid JSON with an
            // EMPTY transactions array on huge / dense PDFs (15 MB
            // 21-page ICICI statement was the trigger). Without this
            // check the empty result was accepted and tier 2 never
            // fired — user saw a "successful" extraction with 0 rows.
            // Requiring at least one transaction in the parse forces
            // the fallback to Gemini 2.5 Flash-Lite, which handles
            // long PDFs more reliably.
            {
              maxTokens: 65_536,
              looksValid: (data) => {
                const txns = (data as { transactions?: unknown })?.transactions;
                return Array.isArray(txns) && txns.length > 0;
              },
            },
          );
          extracted = visionResult.data;
          // Defence in depth: if BOTH tiers returned an empty
          // transactions array, we'd silently persist a blank
          // statement. Treat that as an extraction failure so the
          // UI shows a useful error instead of a 0-row table the
          // user has to puzzle over. The caller already handles
          // errors with retry / "split the PDF" guidance.
          if (!extracted || !Array.isArray(extracted.transactions) || extracted.transactions.length === 0) {
            console.warn(`[bank-statements] vision returned 0 transactions for ${filename} (${req.file.size} bytes, mime=${mimeType}). Both tiers ran. Likely too large/dense — recommend the text path or splitting the PDF.`);
            res.status(422).json({
              error: 'AI vision could not extract any transactions from this PDF. The file may be too large or dense for vision OCR — try the column-mapping flow (the PDF has selectable text) or split it into smaller chunks.',
            });
            return;
          }
          (res.locals as Record<string, unknown>).geminiUsages = [{
            inputTokens: visionResult.inputTokens,
            outputTokens: visionResult.outputTokens,
            modelUsed: visionResult.modelUsed,
          }];
        }
      } else {
        // CSV path: client posted parsed CSV text; we already know the
        // structure (date / narration / debit / credit / balance), so the
        // only AI work is enrichment — categorise each row and fill in
        // bankName / period / counterparty if visible.
        //
        // Output shape: instead of asking Gemini to echo the full
        // ExtractedStatement schema (10 fields per row, ~250 chars),
        // we ask for a compact enrichment array (5 fields, ~80 chars
        // per row) and merge it server-side with the deterministic
        // input. That's a ~3× output shrink, which matters because
        // Gemini's practical output ceiling on flash-lite is ~16 K
        // tokens, and verbose UPI narrations on a 300-row Canara
        // statement push the full-schema response past that easily —
        // the model truncates and the JSON parse fails.
        filename = typeof req.body?.filename === 'string' ? req.body.filename : 'statement.csv';
        mimeType = 'text/csv';
        const parsed = Papa.parse(String(req.body.csvText), { header: true, skipEmptyLines: true });
        const rows = parsed.data as Record<string, string>[];
        const normalized = rows.map((r) => {
          const date = r.date ?? r.Date ?? r['Txn Date'] ?? r['Transaction Date'] ?? null;
          const narration = r.narration ?? r.Narration ?? r.Description ?? r['Particulars'] ?? '';
          const credit = toNumber(r.credit ?? r.Credit ?? r['Deposit Amt.'] ?? r.deposit ?? 0);
          const debit = toNumber(r.debit ?? r.Debit ?? r['Withdrawal Amt.'] ?? r.withdrawal ?? 0);
          const balance = r.balance ?? r.Balance ?? r['Closing Balance'] ?? null;
          const amountRaw = toNumber(r.amount ?? r.Amount ?? 0);
          const signedAmount = credit ? credit : debit ? -debit : amountRaw;
          return {
            date,
            narration,
            amount: signedAmount,
            type: signedAmount >= 0 ? 'credit' : 'debit',
            balance: balance ? toNumber(balance) : null,
          };
        });

        // ──── Server-side classifier pre-pass (Phase A token-cost cut) ────
        // Run the deterministic narration anchors over every row first.
        // Rows that match (typically 60-75% of an Indian bank statement —
        // bank charges, interest, EMI, salary, GST, recognizable UPI VPAs)
        // get their category/subcategory/counterparty/reference filled
        // in here for free. Only the unclassified rows are sent to AI,
        // which slashes input + output tokens proportionally.
        //
        // For rows that DO go to AI, we still pre-fill counterparty +
        // reference from the regex extractor — those are deterministic
        // even when category isn't, and pre-filling means the AI prompt
        // can focus on the category decision and produces shorter
        // output (the schema below drops counterparty/reference too).
        const ruleResults = normalized.map((row, index) => {
          const classified = classifyRow({ narration: row.narration, type: row.type as 'credit' | 'debit', amount: row.amount });
          if (classified) {
            return { index, row, classified, needsAi: false };
          }
          const { counterparty, reference } = extractCounterpartyAndReference(row.narration);
          return { index, row, classified: null, counterparty, reference, needsAi: true };
        });
        const ambiguous = ruleResults.filter(r => r.needsAi);
        const classified = ruleResults.filter(r => !r.needsAi);
        console.log(`[bank-statements] csv classifier pre-pass: ${classified.length}/${normalized.length} rows handled deterministically, ${ambiguous.length} sent to AI`);

        const CSV_BATCH_SIZE = 80;
        const CSV_BATCH_CONCURRENCY = 3;
        const CSV_MAX_OUTPUT_TOKENS = 16_384;

        interface EnrichmentResponse {
          bankName: string | null;
          accountNumberMasked: string | null;
          periodFrom: string | null;
          periodTo: string | null;
          currency: string | null;
          enrichments: Array<{
            category: string | null;
            subcategory: string | null;
          }>;
        }

        // Compact AI prompt — Phase A: classifier already handled the
        // 60-75% of rows that hit a known anchor (bank charges, interest,
        // EMI, salary, GST, etc.) AND already extracted counterparty +
        // reference for every row. The AI's job here is reduced to:
        //
        //   1. Decide category for the un-classified subset (typically
        //      "is this UPI/NEFT to a vendor → Business Expenses, or
        //      to a person → Transfers, or grocery/shopping → Personal").
        //   2. Optionally a subcategory.
        //   3. Read bankName / accountNumberMasked / period from the
        //      first batch's narrations.
        //
        // What we deleted: the 30-line categorisation rule list (now
        // server-side), counterparty extraction rules (regex-extracted
        // server-side), reference extraction rules, isRecurring guidance
        // (computed in markRecurring after merge). Output schema is
        // also slimmer — 2 fields per row vs 5, ~25-30 chars instead of
        // ~80, which directly cuts output tokens and lets bigger batches
        // fit in the same max_tokens ceiling without truncation.
        const buildEnrichmentPrompt = (batch: Array<{ narration: string; type: string; amount: number }>, isFirst: boolean) => `${conditionsBlock}You are categorising pre-extracted Indian bank-statement transactions that a deterministic rule-based classifier could not auto-tag. Return ONE JSON object — no markdown fences, no prose:

{
  "bankName": "string or null",
  "accountNumberMasked": "XXXXNNNN (last 4) or null",
  "periodFrom": "YYYY-MM-DD or null",
  "periodTo": "YYYY-MM-DD or null",
  "currency": "INR",
  "enrichments": [
    { "category": "...", "subcategory": "string or null" }
  ]
}

CRITICAL:
- enrichments MUST be the same length as INPUT_ROWS and in the same order. One enrichment object per input row, no skipping, no reordering.
- Do NOT echo date / amount / balance / narration / counterparty / reference. Those come from server-side extraction and are merged in after.
${isFirst
  ? '- Set bankName / accountNumberMasked / periodFrom / periodTo from context if you can read them in the narrations; null otherwise.'
  : '- Set bankName / accountNumberMasked / periodFrom / periodTo to null (this is a continuation batch).'}

category MUST be one of: ${BANK_STATEMENT_CATEGORIES.map(c => `"${c}"`).join(' | ')}.

You are seeing ONLY the rows the upstream classifier could not auto-tag. Common buckets (bank charges, interest, EMI, salary, GST, TDS, UPI/NEFT to personal counterparties, well-known merchants like Amazon / Swiggy / Ola / Netflix / IRCTC / Apollo / Byju's / MakeMyTrip etc.) are already handled — DO NOT re-examine the row for those patterns.

What these rows actually contain (one of):
- NEFT / IMPS / RTGS / UPI to a counterparty whose business-vs-personal nature isn't obvious from the name alone (e.g. "RAMESH SHARMA AND SONS", "BHAT TRADERS", "ABC ENTERPRISES")
- Cheque deposits / withdrawals with no merchant hint
- Cash narrations that didn't match any of the standard "BY CASH" / "CASH DEP" prefixes
- POS transactions to a local merchant we don't have an anchor for

Decide between:
- ENTERPRISES / TRADERS / PVT LTD / LIMITED / LLP / 15-digit GSTIN → Business Expenses (debit) / Business Income (credit)
- Clear personal name OR grocery/local-shop pattern → Personal · Shopping (use that subcategory when category is Personal)
- Genuinely ambiguous → Other (leave subcategory null)

INPUT_ROWS (${batch.length} rows):
${JSON.stringify(batch)}`;

        // Build a slim AI input row — narration + type + amount only.
        // The classifier already extracted counterparty + reference; the
        // AI doesn't need them and re-emitting them would just waste
        // tokens. The full ruleResults indices are kept on the wrapping
        // ambiguous[] array so we can stitch enrichments back into the
        // original positions when we merge below.
        type AiBatchRow = { narration: string; type: 'credit' | 'debit'; amount: number };
        const buildAiBatch = (slice: typeof ambiguous): AiBatchRow[] =>
          slice.map(r => ({ narration: r.row.narration, type: r.row.type as 'credit' | 'debit', amount: r.row.amount }));

        // Recursive bisect for AI batches — same pattern as before.
        // Halves on truncation, retries up to depth 3.
        const categorizeWithSplit = async (
          slice: typeof ambiguous,
          label: string,
          depth: number,
        ): Promise<{ slice: typeof ambiguous; enrichments: EnrichmentResponse['enrichments']; meta: EnrichmentResponse; inputTokens: number; outputTokens: number; modelUsed: string }> => {
          const t0 = Date.now();
          let result: GeminiJsonResult<EnrichmentResponse> | null = null;
          try {
            result = await callGeminiJson<EnrichmentResponse>(
              [{ role: 'user', content: buildEnrichmentPrompt(buildAiBatch(slice), label.endsWith('/0')) }],
              {
                maxTokens: CSV_MAX_OUTPUT_TOKENS,
                onFallback: () => { try { bankStatementRepo.markProviderFallback(placeholder.id); } catch (e) { console.warn('[bank-statements] markProviderFallback failed:', (e as Error).message); } },
              },
            );
            const enrichments = result.data.enrichments ?? [];
            if (enrichments.length < slice.length * 0.95) {
              throw new Error(`csv ${label}: enrichments undercount (${enrichments.length} of ${slice.length}) — likely truncation`);
            }
            console.log(`[bank-statements] csv ${label} ✓ ${enrichments.length} enrichments in ${Date.now() - t0}ms`);
            return {
              slice,
              enrichments,
              meta: result.data,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              modelUsed: result.modelUsed,
            };
          } catch (err) {
            const msg = (err as Error).message ?? String(err);
            const truncationLike = /undercount|parse failed|finish_reason=length|JSON/i.test(msg);
            if (result) {
              try {
                const failedClientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
                const failedCost = costForModel(result.modelUsed, result.inputTokens, result.outputTokens);
                usageRepo.logWithBilling(failedClientIp, req.user!.id, quota.billingUserId, result.inputTokens, result.outputTokens, failedCost, false, result.modelUsed, false, 'bank_statement', 0, 'failed');
              } catch (e) {
                console.error('[bank-statements] failed-batch log error', e);
              }
            }
            if (!truncationLike || depth >= 3 || slice.length <= 1) throw err;
            const mid = Math.ceil(slice.length / 2);
            const a = slice.slice(0, mid);
            const b = slice.slice(mid);
            console.warn(`[bank-statements] csv ${label} too dense (${slice.length} rows at depth ${depth}), bisecting → [${a.length}, ${b.length}]`);
            const [ra, rb] = await Promise.all([
              categorizeWithSplit(a, `${label}.a`, depth + 1),
              categorizeWithSplit(b, `${label}.b`, depth + 1),
            ]);
            return {
              slice: [...ra.slice, ...rb.slice],
              enrichments: [...ra.enrichments, ...rb.enrichments],
              meta: ra.meta,
              inputTokens: ra.inputTokens + rb.inputTokens,
              outputTokens: ra.outputTokens + rb.outputTokens,
              modelUsed: ra.modelUsed || rb.modelUsed,
            };
          }
        };

        // Map ambiguous[].index → enrichment, so when we walk the
        // original normalized[] we can pull either the classifier
        // result or the AI enrichment at that index.
        const aiEnrichmentsByIndex = new Map<number, { category: string; subcategory: string | null }>();
        let bankMeta: EnrichmentResponse = {
          bankName: null,
          accountNumberMasked: null,
          periodFrom: null,
          periodTo: null,
          currency: 'INR',
          enrichments: [],
        };
        const aiUsages: Array<{ inputTokens: number; outputTokens: number; modelUsed: string }> = [];

        if (ambiguous.length === 0) {
          // Best case — every row hit a rule. Skip the AI call entirely.
          // Bank metadata stays null; the dashboard handles that. If a
          // statement is 100% rule-classifiable AND the user wants the
          // bank name on charts, that comes from a future Phase B
          // change (client passes detected bank into upload).
          console.log('[bank-statements] csv path: 0 ambiguous rows — skipping AI call entirely');
          sendSse({ type: 'start', totalChunks: 0, pages: 0 });
        } else {
          const batches: Array<typeof ambiguous> = [];
          for (let i = 0; i < ambiguous.length; i += CSV_BATCH_SIZE) {
            batches.push(ambiguous.slice(i, i + CSV_BATCH_SIZE));
          }
          console.log(`[bank-statements] csv path: ${ambiguous.length} ambiguous rows → ${batches.length} batch(es) of up to ${CSV_BATCH_SIZE}`);
          sendSse({ type: 'start', totalChunks: batches.length, pages: batches.length });
          try { bankStatementRepo.setAnalyzeChunksTotal(placeholder.id, req.user!.id, batches.length); } catch (e) { console.error('[bank-statements] set chunks total failed', e); }

          const batchResults = await mapWithConcurrency(
            batches,
            CSV_BATCH_CONCURRENCY,
            async (slice, idx) => {
              const result = await categorizeWithSplit(slice, `batch ${idx + 1}/${batches.length}/0`, 0);
              try { bankStatementRepo.bumpAnalyzeChunksDone(placeholder.id, req.user!.id); } catch (e) { console.error('[bank-statements] bump chunks done failed', e); }
              sendSse({ type: 'progress', completed: idx + 1, total: batches.length, txInChunk: result.enrichments.length });
              return result;
            },
          );

          // First batch carries bank metadata.
          if (batchResults[0]) bankMeta = batchResults[0].meta;
          for (const br of batchResults) {
            br.slice.forEach((r, i) => {
              const e: Partial<EnrichmentResponse['enrichments'][number]> = br.enrichments[i] ?? {};
              const category = typeof e.category === 'string' && e.category.trim() ? e.category : 'Other';
              const subcategory = typeof e.subcategory === 'string' && e.subcategory.trim() ? e.subcategory : null;
              aiEnrichmentsByIndex.set(r.index, { category, subcategory });
            });
            aiUsages.push({ inputTokens: br.inputTokens, outputTokens: br.outputTokens, modelUsed: br.modelUsed });
          }
        }

        // Merge: walk normalized[] in order, fill each row from
        // classifier result OR AI enrichment, and run markRecurring
        // over the final list so the recurring flag rides on every row
        // regardless of which path produced its category.
        const mergedTransactions = ruleResults.map((r) => {
          const baseRow = {
            date: r.row.date,
            narration: r.row.narration,
            amount: r.row.amount,
            type: r.row.type,
            balance: r.row.balance,
            isRecurring: false,
          };
          if (r.classified) {
            return {
              ...baseRow,
              category: r.classified.category,
              subcategory: r.classified.subcategory,
              counterparty: r.classified.counterparty,
              reference: r.classified.reference,
            };
          }
          const ai = aiEnrichmentsByIndex.get(r.index);
          return {
            ...baseRow,
            category: ai?.category ?? 'Other',
            subcategory: ai?.subcategory ?? null,
            counterparty: r.counterparty ?? null,
            reference: r.reference ?? null,
          };
        });
        markRecurring(mergedTransactions);

        extracted = {
          bankName: bankMeta.bankName ?? null,
          accountNumberMasked: bankMeta.accountNumberMasked ?? null,
          periodFrom: bankMeta.periodFrom ?? null,
          periodTo: bankMeta.periodTo ?? null,
          currency: bankMeta.currency ?? 'INR',
          transactions: mergedTransactions,
        };
        (res.locals as Record<string, unknown>).geminiUsages = aiUsages;
      }

      // Honor a mid-flight cancel. If the user clicked Cancel while
      // Gemini was running, the placeholder row is now 'cancelled' —
      // don't overwrite it with extracted data and don't bill the slot
      // again (cancel route already debited featureUsage).
      if (bankStatementRepo.getStatus(placeholder.id, req.user.id) === 'cancelled') {
        console.log(`[bank-statements] statement ${placeholder.id} was cancelled mid-analysis; discarding ${extracted.transactions.length} extracted rows`);
        // Log the in-flight chunks' tokens to api_usage with
        // status='cancelled'. The chunks ran (Node doesn't abort
        // handlers on cancel — they completed before the cancel
        // detection check); their tokens are real spend that should
        // (a) appear in the admin Recent API Calls dashboard, and
        // (b) count toward the user's monthly token budget. Without
        // this, the chunked-TSV path leaks tokens into a dead-end
        // run that nobody sees and nobody pays for.
        try {
          const cancelClientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
          const usages = (res.locals as Record<string, unknown>).geminiUsages as
            Array<{ inputTokens: number; outputTokens: number; modelUsed: string }> | undefined;
          if (usages && usages.length > 0) {
            const inputTok = usages.reduce((a, u) => a + u.inputTokens, 0);
            const outputTok = usages.reduce((a, u) => a + u.outputTokens, 0);
            const cost = usages.reduce((a, u) => a + costForModel(u.modelUsed, u.inputTokens, u.outputTokens), 0);
            usageRepo.logWithBilling(cancelClientIp, req.user.id, quota.billingUserId, inputTok, outputTok, cost, false, usages[0].modelUsed, false, 'bank_statement', 0, 'cancelled');
          }
        } catch (err) {
          console.error('[bank-statements] cancelled-run cost log failed:', err);
        }
        const cancelledPayload = {
          statement: serializeStatement(bankStatementRepo.findByIdForUser(placeholder.id, req.user.id)),
          transactions: [],
          txCount: 0,
          cancelled: true,
        };
        if (sseOpen) { sendSse({ type: 'done', ...cancelledPayload }); res.end(); }
        else res.status(200).json(cancelledPayload);
        return;
      }
      const { txCount, autoCorrected, mismatches, amountOverridden, phantomDropped, closingMismatch } = persistStatement(req.user.id, placeholder.id, extracted, filename ?? 'Bank Statement');

      // Bill credits based on the actual file size processed. For PDF
      // paths pages_processed reflects chunks completed; for CSV the
      // route hasn't bumped it (single non-chunked Gemini call), so we
      // fall through to the upfront pagesTotal which IS the row count.
      try {
        const bankCredits = isCsv
          ? creditsForCsvRows('bank_statement', pagesTotal)
          : creditsForPages('bank_statement', pagesTotal);
        featureUsageRepo.logWithBilling(req.user.id, quota.billingUserId, 'bank_statement_analyze', bankCredits);
      } catch (err) {
        console.error('[bank-statements] Failed to log usage:', err);
      }

      // Log Gemini-side cost — aggregated across vision or pdfText-chunk
      // calls — so this feature appears in the admin API-cost dashboard.
      try {
        const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
        const usages = (res.locals as Record<string, unknown>).geminiUsages as
          Array<{ inputTokens: number; outputTokens: number; modelUsed: string }> | undefined;
        if (usages && usages.length > 0) {
          const inputTok = usages.reduce((a, u) => a + u.inputTokens, 0);
          const outputTok = usages.reduce((a, u) => a + u.outputTokens, 0);
          // Price each call by its actual model. The chunked TSV path
          // runs on gemini-2.5-flash / gemini-3-flash-preview; flat T2
          // rates were under-counting by 3-6x.
          const cost = usages.reduce((a, u) => a + costForModel(u.modelUsed, u.inputTokens, u.outputTokens), 0);
          // Attach the gate's pre-flight estimate to the summary row so
          // the admin dashboard can show estimate-vs-actual on this
          // request. Per-chunk / failure / cancel rows stay at 0.
          usageRepo.logWithBilling(clientIp, req.user.id, quota.billingUserId, inputTok, outputTok, cost, false, usages[0].modelUsed, false, 'bank_statement', txCount, 'success', tokenQuota.estimatedTokens, Date.now() - analyzeStartMs);
        }
      } catch (err) {
        console.error('[bank-statements] Failed to log cost:', err);
      }

      const transactions = bankTransactionRepo.listByStatement(placeholder.id).map(serializeTransaction);
      const warning = (res.locals as Record<string, unknown>).analyzerWarning as string | undefined;
      // Reconciliation banner. The vision path now derives every
      // signed amount directly from the bank's printed running
      // balance column, so most reads end up exact. The remaining
      // signals to surface:
      //   - amountOverridden: rows where the derived amount differed
      //     materially from what the AI originally read (informational
      //     — totals are already correct, but tells the user how often
      //     the AI was off if they're auditing).
      //   - phantomDropped: rows we filtered because their balance
      //     was unchanged (wrap-induced duplicates).
      //   - autoCorrected / mismatches: residual sign-flip and
      //     column-swap fixes from rows where balance was null and
      //     we fell back to the AI's amount.
      //   - closingMismatch: opening + sum != closing. Hard signal
      //     that one or more printed balances were misread upstream.
      const reconciliationWarning = (() => {
        const parts: string[] = [];
        if (amountOverridden > 0) {
          parts.push(`Replaced ${amountOverridden} transaction amount${amountOverridden === 1 ? '' : 's'} with values derived from the printed running balance — totals below reflect the bank's own arithmetic.`);
        }
        if (phantomDropped > 0) {
          parts.push(`Dropped ${phantomDropped} duplicate row${phantomDropped === 1 ? '' : 's'} that had no balance change (typically a wrapped UPI narration parsed twice).`);
        }
        if (autoCorrected > 0) {
          parts.push(`Auto-corrected ${autoCorrected} row${autoCorrected === 1 ? '' : 's'} where the AI's credit/debit sign disagreed with the printed running balance.`);
        }
        if (mismatches.length > 0) {
          parts.push(`${mismatches.length} row${mismatches.length === 1 ? '' : 's'} still need${mismatches.length === 1 ? 's' : ''} manual review — neither the printed balance nor a known correction pattern resolved the amount.`);
        }
        if (closingMismatch) {
          parts.push(closingMismatch);
        }
        return parts.length > 0 ? parts.join(' ') : null;
      })();
      const payload = {
        statement: serializeStatement(bankStatementRepo.findByIdForUser(placeholder.id, req.user.id)),
        transactions,
        txCount,
        ...(warning ? { warning } : {}),
        ...(reconciliationWarning ? { reconciliationWarning } : {}),
        ...(mismatches && mismatches.length > 0 ? { mismatches: mismatches.slice(0, 20) } : {}),
      };
      if (sseOpen) {
        sendSse({ type: 'done', ...payload });
        res.end();
      } else {
        res.status(200).json(payload);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[bank-statements] analyze error:', errMsg);
      // Mark the placeholder row as 'error' so the user sees it in the list
      // (and the polling loop stops) rather than a row stuck on 'analyzing'
      // forever. Leave the row in place — deleting would lose the error
      // message and prevent the user from understanding what went wrong.
      try {
        bankStatementRepo.setError(placeholder.id, req.user.id, errMsg);
      } catch (e) {
        console.error('[bank-statements] failed to mark statement as error:', e);
      }
      const body = {
        error: 'Failed to analyze statement.',
        detail: errMsg.slice(0, 400),
        statementId: placeholder.id,
        hint: 'If this is a large statement (150+ pages), try a CSV export instead. Scanned / image PDFs may also fail — re-save as a digital PDF and retry.',
      };
      if (sseOpen) {
        // SSE headers are already flushed, so we can't change status — emit
        // an error event and end the stream. The client parses this back into
        // a thrown Error, same shape as the JSON path.
        sendSse({ type: 'error', ...body });
        res.end();
      } else {
        res.status(500).json(body);
      }
    }
  },
);

// PATCH /api/bank-statements/:id — rename
router.patch('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }
  const ok = bankStatementRepo.updateName(req.params.id, req.user.id, name);
  if (!ok) { res.status(404).json({ error: 'Statement not found' }); return; }
  res.json({ statement: serializeStatement(bankStatementRepo.findByIdForUser(req.params.id, req.user.id)) });
});

// DELETE /api/bank-statements/:id
router.delete('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const ok = bankStatementRepo.deleteById(req.params.id, req.user.id);
  if (!ok) { res.status(404).json({ error: 'Statement not found' }); return; }
  res.json({ success: true });
});

// POST /api/bank-statements/:id/cancel — user-triggered cancel for a
// running analysis. Counts toward the monthly quota for the same reason
// ledger does: we already paid the Gemini cost for whatever chunks ran,
// and refunding the slot would make Generate→Cancel a free way past the
// monthly cap.
router.post('/:id/cancel', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const stmt = bankStatementRepo.findByIdForUser(req.params.id, req.user.id);
  if (!stmt) { res.status(404).json({ error: 'Statement not found' }); return; }
  if (stmt.status !== 'analyzing') {
    res.status(400).json({ error: `Statement already ${stmt.status}; nothing to cancel.` });
    return;
  }
  const ok = bankStatementRepo.cancel(stmt.id, req.user.id);
  if (!ok) { res.status(409).json({ error: 'Statement settled before cancel could apply.' }); return; }
  try {
    const actor = userRepo.findById(req.user.id);
    const billingUserId = actor ? getBillingUser(actor).id : req.user.id;
    // Cancel debits credits proportional to pages_processed (chunks
    // that finished before the cancel). 0 chunks done = 0 credits =
    // free retry, which is fair when the user catches a mis-upload
    // immediately. If cancel beat the first chunk we still log a
    // 0-credit row so the dashboard reflects the click.
    const after = bankStatementRepo.findByIdForUser(stmt.id, req.user.id);
    const cancelCredits = after && after.source_mime === 'text/csv'
      ? creditsForCsvRows('bank_statement', after.pages_processed || 0)
      : creditsForPages('bank_statement', after?.pages_processed || 0);
    featureUsageRepo.logWithBilling(req.user.id, billingUserId, 'bank_statement_analyze', cancelCredits);
  } catch (err) {
    console.error('[bank-statements] cancel feature_usage log failed', err);
  }
  res.json({ statement: serializeStatement(bankStatementRepo.findByIdForUser(stmt.id, req.user.id)) });
});

// PATCH /api/bank-statements/:id/transactions/:txId — reassign category
router.patch('/:id/transactions/:txId', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const { id, txId } = req.params;
  const category = typeof req.body?.category === 'string' ? normalizeCategory(req.body.category) : null;
  const subcategory = typeof req.body?.subcategory === 'string' ? req.body.subcategory : null;
  if (!category) { res.status(400).json({ error: 'category is required' }); return; }
  const ok = bankTransactionRepo.updateCategory(txId, id, req.user.id, category, subcategory);
  if (!ok) { res.status(404).json({ error: 'Transaction not found' }); return; }
  res.json({ success: true });
});

// GET /api/bank-statements/:id/export.csv — download categorized CSV
router.get('/:id/export.csv', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const row = bankStatementRepo.findByIdForUser(req.params.id, req.user.id);
  if (!row) { res.status(404).json({ error: 'Statement not found' }); return; }
  const txs = bankTransactionRepo.listByStatement(row.id);
  const csv = Papa.unparse({
    fields: ['Date', 'Narration', 'Counterparty', 'Reference', 'Type', 'Amount', 'Balance', 'Category', 'Subcategory', 'Recurring', 'UserOverride'],
    data: txs.map((t) => [
      t.tx_date ?? '',
      t.narration ?? '',
      t.counterparty ?? '',
      t.reference ?? '',
      t.amount >= 0 ? 'Credit' : 'Debit',
      Math.abs(t.amount),
      t.balance ?? '',
      t.category,
      t.subcategory ?? '',
      t.is_recurring ? 'Yes' : 'No',
      t.user_override ? 'Yes' : 'No',
    ]),
  });
  const safeName = (row.name || 'statement').replace(/[^a-z0-9_-]+/gi, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.csv"`);
  res.send(csv);
});

// Multer error handler — scoped to this router
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File exceeds the 10 MB size limit.' });
      return;
    }
    res.status(400).json({ error: `Upload error: ${err.message}` });
    return;
  }
  if (err instanceof Error && err.message === 'INVALID_MIME_TYPE') {
    res.status(400).json({ error: 'Invalid file type. Please upload a PDF or image (JPEG, PNG, WebP).' });
    return;
  }
  next(err);
});

export default router;
