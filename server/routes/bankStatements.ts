// server/routes/bankStatements.ts
import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import Papa from 'papaparse';
import { extractVisionWithFallback } from '../lib/visionFallback.js';
import { getPdfPageCount, splitPdfByPages, PDF_VISION_CHUNK_THRESHOLD } from '../lib/pdfChunker.js';
import { applyConditionsToStatement } from '../lib/bankConditionFilter.js';
import { extractPdfTextWithPaddleOcr } from '../lib/paddleOcr.js';
import { structureOcrTextIntoRows } from '../lib/paddleStructurer.js';
import type { GeminiJsonResult } from '../lib/geminiJson.js';
import { callBankEnrichment } from '../lib/bankEnrichmentClient.js';
import { getBreakerStatus } from '../lib/circuitBreaker.js';
import { BANK_STATEMENT_PROMPT, BANK_STATEMENT_CATEGORIES, buildConditionsBlock, countWords, MAX_CONDITION_WORDS, type BankStatementCategory } from '../lib/bankStatementPrompt.js';
import { classifyWithLearning, classifyRow, extractCounterpartyAndReference, extractNarrationFingerprint, markRecurring, unifyAmbiguousCounterparties, validateDirectionCategory, applyRetailBusinessPromotion } from '../lib/bankClassifier.js';
import { learnedClassificationsRepo } from '../db/repositories/learnedClassificationsRepo.js';
import { lookupAiClassification, recordAiClassification } from '../lib/bankAiClassificationCache.js';
import { extractBankMetadata } from '../lib/bankStatementMetadata.js';
import { detectAnomalies } from '../lib/bankAnomalyDetector.js';
import { bankTransactionAnomalyRepo } from '../db/repositories/bankTransactionAnomalyRepo.js';
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
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
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
  // When true, the transaction amounts arrived pre-signed from a
  // deterministic source (the wizard's column mapping, where the PDF
  // prints explicit WITHDRAWALS / DEPOSITS columns) and the server
  // must NOT second-guess them. Skips the balance-delta derivation
  // and sign-flip reconciliation phases entirely — those exist for
  // the vision path, where AI-read amounts genuinely need the printed
  // balance chain as ground truth. Running them on wizard CSVs is
  // actively harmful: banks encode CC balances inconsistently
  // (J&K prints "1383991.20Dr" on one product and "-12,79,294.23Dr"
  // on another), so any balance-derived sign convention is a coin
  // flip, and the derive phase was REPLACING correct printed amounts
  // with delta values that no longer tie to the bank's Grand Total.
  amountsAuthoritative?: boolean;
  // When true, each row's `amount` is the bank's printed Deposit/
  // Withdrawal figure, OCR'd as an INDEPENDENT value alongside the
  // running balance. deriveAmountsFromBalance cross-checks the two
  // and prefers the printed amount when they disagree — a single
  // misread balance otherwise amplifies into two huge phantom deltas
  // (one in, one out) that inflate both gross totals while leaving
  // net intact. Unlike amountsAuthoritative (wizard, fully trusted),
  // OCR amounts are still LLM-read so we keep the balance chain as a
  // co-validator rather than skipping derivation outright.
  amountsFromOcr?: boolean;
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
  /** True on the OCR path: each row's `amount` is the bank's printed
   *  Deposit/Withdrawal figure (signed by type), OCR'd independently
   *  of the running balance. When it disagrees with the balance delta
   *  we trust the printed amount — a self-contained per-row value
   *  can't amplify a single misread the way a balance-chain delta
   *  does (one bad balance → +X spike in, −X spike out → both gross
   *  totals inflate, net unchanged: the exact ICICI scanned-PDF bug).
   *  False (vision/default): amount is unreliable, balance delta wins. */
  printedAmountsReliable: boolean = false,
): {
  amountOverridden: number;
  phantomDropped: number;
  reconciledFromAmount: number;
} {
  let amountOverridden = 0;
  let phantomDropped = 0;
  let reconciledFromAmount = 0;
  const kept: BankTransactionInput[] = [];
  const deltaSign = accountKind === 'liability' ? -1 : 1;

  for (let i = 0; i < txs.length; i++) {
    const cur = txs[i];
    const prevBalance = i === 0 ? openingBalance : txs[i - 1].balance;
    // Printed amount (already signed by type for OCR rows). null when
    // not a reliable source or the cell was blank (normalizeTransactions
    // collapsed it to ~0).
    const printed = (printedAmountsReliable && Math.abs(cur.amount) >= 0.005) ? cur.amount : null;

    if (prevBalance != null && cur.balance != null) {
      const delta = deltaSign * (cur.balance - prevBalance);
      const tol = Math.max(1, Math.abs(delta) * 0.005);

      // Phantom row detection: identical balance to the previous row
      // AND no printed amount means no money moved on this line. UPI
      // narrations on dense statements sometimes wrap onto two visual
      // lines and the AI emits both as separate transactions; the
      // continuation row copies the same balance. Drop these. (If a
      // printed amount IS present on a zero-delta row, the balance was
      // misread, not the row — handled by the reconciliation below.)
      if (Math.abs(delta) < 0.005 && printed === null) {
        if (Math.abs(cur.amount) < 0.005) {
          kept.push({ ...cur, amount: 0 });
        } else {
          phantomDropped++;
        }
        continue;
      }

      if (printed !== null) {
        if (Math.abs(delta - printed) <= tol) {
          // Printed amount and balance delta agree — high confidence.
          kept.push({ ...cur, amount: delta });
        } else {
          // Disagreement → trust the self-contained printed amount.
          // The balance (and thus this/next delta) is the likely
          // misread; using the printed amount keeps gross totals
          // correct even though the running-balance column stays off
          // on the misread row.
          kept.push({ ...cur, amount: printed });
          reconciledFromAmount++;
        }
        continue;
      }

      // No printed amount — derive from balance delta (vision path,
      // or an OCR row whose amount cell was unreadable). Track when
      // the AI's value materially disagreed for the warning banner.
      if (Math.abs(delta - cur.amount) > tol) {
        amountOverridden++;
      }
      kept.push({ ...cur, amount: delta });
      continue;
    }

    // Balance is null on either this row or the previous one. Prefer a
    // printed amount when we have one; else fall back to whatever the
    // AI gave us (legacy path — rare on statements with consistent
    // balance printing).
    if (printed !== null) {
      kept.push({ ...cur, amount: printed });
    } else {
      kept.push(cur);
    }
  }

  // Replace the array contents in-place so callers using the same
  // reference see the filtered list.
  txs.length = 0;
  txs.push(...kept);

  return { amountOverridden, phantomDropped, reconciledFromAmount };
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

  // Phases 1-3 below re-derive amounts and signs from the printed
  // running-balance chain. They are VISION-PATH machinery: when the
  // AI reads a statement image, its amount/direction fields are
  // unreliable and the balance column is the best ground truth.
  //
  // Wizard-mapped CSVs are the opposite: amounts and direction come
  // from explicit Withdrawal/Deposit columns the user (or a bank
  // rule) mapped deterministically — those ARE the bank's printed
  // numbers, and the dashboard must tie to the bank's printed Grand
  // Total. Meanwhile the balance column's sign encoding varies by
  // product even within one bank (J&K: "1383991.20Dr" vs
  // "-12,79,294.23Dr"), so balance-derived amounts on this path
  // replaced correct values with garbage. amountsAuthoritative=true
  // (set by the CSV branch) skips all three phases.
  let amountOverridden = 0;
  let reconciledFromAmount = 0;
  let totalPhantomDropped = inlineDatePhantomsDropped;
  let autoCorrected = 0;
  let mismatches: ReturnType<typeof reconcileBalances>['mismatches'] = [];
  let closingMismatch: ReturnType<typeof verifyClosingBalance> = null;
  if (!data.amountsAuthoritative) {
    // Phase 1: derive each amount from the printed running balance
    // delta. On the OCR path the structurer also captured each row's
    // printed Deposit/Withdrawal figure; we pass amountsFromOcr so the
    // deriver cross-checks the two and prefers the self-contained
    // printed amount on disagreement (stops single-misread-balance
    // amplification). Vision rows have no printed amount → pure delta.
    const opening = typeof data.openingBalance === 'number' ? data.openingBalance : null;
    const derived = deriveAmountsFromBalance(txs, opening, accountKind, data.amountsFromOcr === true);
    amountOverridden = derived.amountOverridden;
    reconciledFromAmount = derived.reconciledFromAmount;
    totalPhantomDropped += derived.phantomDropped;
    if (reconciledFromAmount > 0) {
      console.log(`[bank-statements] balance reconciliation: ${reconciledFromAmount} row(s) used the printed amount over a disagreeing balance delta (likely OCR balance misreads)`);
    }

    // Phase 2: legacy sign-flip / column-swap reconciliation. After
    // deriveAmountsFromBalance most rows already have authoritative
    // amounts; this catches the residual cases where balance was null
    // on one side and we fell back to the AI's value. Cheap to keep.
    const reconciled = reconcileBalances(txs, accountKind);
    autoCorrected = reconciled.autoCorrected;
    mismatches = reconciled.mismatches;

    // Phase 3: integrity check — opening + sum should equal closing.
    // If not, the printed-balance chain itself has a misread somewhere
    // and our derived totals are still suspect. Surface as a warning.
    const closing = typeof data.closingBalance === 'number' ? data.closingBalance : null;
    closingMismatch = verifyClosingBalance(txs, opening, closing, accountKind);
  }

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
  // Compute narration fingerprint for each row before persist. Used
  // by the Phase 2 anomaly detector's "new counterparty" rule (cross-
  // statement history query) and as a fallback grouping key for the
  // Phase 3 party-wise breakdown when counterparty extraction
  // returned null. Empty fingerprints (pure-noise narrations) are
  // stored as NULL — queries treat those as "no history available"
  // rather than matching the empty string.
  const txsWithFingerprint = txs.map((tx) => {
    const fp = extractNarrationFingerprint(tx.narration);
    return { ...tx, fingerprint: fp.length > 0 ? fp : null };
  });
  bankTransactionRepo.bulkInsert(statementId, txsWithFingerprint);
  bankStatementRepo.updateTotals(statementId, inflow, outflow, txs.length);

  return { txCount: txs.length, autoCorrected, mismatches, amountOverridden, reconciledFromAmount, phantomDropped: totalPhantomDropped, closingMismatch };
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
    // Phase 3 — exposed so the party-wise breakdown can fall back to
    // fingerprint when counterparty extraction returned null. Legacy
    // rows pre-Phase-2 stay null; the UI handles both cases.
    fingerprint: row.fingerprint,
    // 2026-06 — visibility flag set by the post-extraction condition
    // filter. UI default: hide these rows from the main grid; surface
    // a "Show hidden (N)" toggle.
    hiddenByCondition: row.hidden_by_condition === 1,
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

// ─── Learned Classifications ────────────────────────────────────────
// Per-firm memory layer surfaced to the UI. Distinct from the legacy
// `/rules` endpoints above (which are per-user match_text rules
// entered manually). Learned rules are scoped to billing_user_id so
// the whole firm shares them — Pratik teaches it once, Riya benefits.

function serializeLearnedRule(
  row: import('../db/repositories/learnedClassificationsRepo.js').LearnedClassificationRow & { created_by_name?: string | null },
) {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    category: row.category,
    subcategory: row.subcategory,
    directionScope: row.direction_scope,
    sampleNarration: row.sample_narration,
    hitCount: row.hit_count,
    createdByName: row.created_by_name ?? null,
    disabled: !!row.disabled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAppliedAt: row.last_applied_at,
  };
}

// GET /api/bank-statements/learned-rules — full list for the firm.
// Listed by updatedAt DESC so recently-changed rules surface first.
router.get('/learned-rules', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const actor = userRepo.findById(req.user.id);
  if (!actor) { res.status(401).json({ error: 'User not found' }); return; }
  const billingUser = getBillingUser(actor);
  const rules = learnedClassificationsRepo
    .listForBillingUser(billingUser.id)
    .map(serializeLearnedRule);
  res.json({ rules });
});

// PATCH /api/bank-statements/learned-rules/:ruleId — edit category /
// subcategory, or toggle enabled/disabled. Accepts a partial body;
// only the fields that need to change are sent.
router.patch('/learned-rules/:ruleId', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const actor = userRepo.findById(req.user.id);
  if (!actor) { res.status(401).json({ error: 'User not found' }); return; }
  const billingUser = getBillingUser(actor);
  const { ruleId } = req.params;
  const rule = learnedClassificationsRepo.findById(ruleId, billingUser.id);
  if (!rule) { res.status(404).json({ error: 'Rule not found' }); return; }

  // Enable/disable toggle.
  if (typeof req.body?.disabled === 'boolean') {
    if (req.body.disabled) {
      learnedClassificationsRepo.disable(ruleId, billingUser.id);
    } else {
      learnedClassificationsRepo.enable(ruleId, billingUser.id);
    }
  }
  // Category / subcategory edit. Re-uses the upsert path so the unique
  // (billing_user, fingerprint, direction) constraint is enforced.
  if (typeof req.body?.category === 'string') {
    const category = normalizeCategory(req.body.category);
    if (!category) { res.status(400).json({ error: 'Invalid category' }); return; }
    const subcategory = typeof req.body?.subcategory === 'string' ? req.body.subcategory : null;
    learnedClassificationsRepo.upsert({
      billingUserId: billingUser.id,
      fingerprint: rule.fingerprint,
      category,
      subcategory,
      directionScope: rule.direction_scope,
      sampleNarration: rule.sample_narration,
      createdByUserId: req.user.id,
    });
  }
  const updated = learnedClassificationsRepo.findById(ruleId, billingUser.id);
  res.json({ rule: updated ? serializeLearnedRule(updated) : null });
});

// DELETE /api/bank-statements/learned-rules/:ruleId — hard delete.
// Distinct from PATCH { disabled: true } (soft-delete). UI exposes
// both: "Disable" keeps the rule visible for re-enable, "Delete"
// removes it entirely.
router.delete('/learned-rules/:ruleId', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const actor = userRepo.findById(req.user.id);
  if (!actor) { res.status(401).json({ error: 'User not found' }); return; }
  const billingUser = getBillingUser(actor);
  const ok = learnedClassificationsRepo.deleteById(req.params.ruleId, billingUser.id);
  if (!ok) { res.status(404).json({ error: 'Rule not found' }); return; }
  res.json({ success: true });
});

// POST /api/bank-statements/learned-rules/bulk-update — reassign the
// category for many rules at once (the management page's bulk-edit
// action). Single transaction so partial failures roll back.
router.post('/learned-rules/bulk-update', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const actor = userRepo.findById(req.user.id);
  if (!actor) { res.status(401).json({ error: 'User not found' }); return; }
  const billingUser = getBillingUser(actor);
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  if (ids.length === 0) { res.status(400).json({ error: 'ids array is required' }); return; }
  const category = typeof req.body?.category === 'string' ? normalizeCategory(req.body.category) : null;
  if (!category) { res.status(400).json({ error: 'category is required' }); return; }
  const subcategory = typeof req.body?.subcategory === 'string' ? req.body.subcategory : null;
  const changed = learnedClassificationsRepo.bulkUpdateCategory(billingUser.id, ids, category, subcategory);
  res.json({ changed });
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

// POST /api/bank-statements/:id/reclassify — re-run the deterministic
// classifier (the same anchors used at upload time) against every row
// of this statement. Rows that the user has manually overridden
// (user_override = 1) are left alone. Rows whose computed category
// differs from the stored one get updated in place. Useful after a
// classifier deploy: stale "Cash Withdrawal" tags on credit "By Cash"
// rows get flipped to "Cash Deposit" without re-uploading the PDF.
//
// Direction-validator runs after the per-row classify so mistakes
// stay self-healing (debit + Cash Deposit auto-flips to Cash
// Withdrawal, etc., matching the upload path exactly).
router.post('/:id/reclassify', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const stmt = bankStatementRepo.findByIdForUser(req.params.id, req.user.id);
  if (!stmt) { res.status(404).json({ error: 'Statement not found' }); return; }
  const result = bankTransactionRepo.reclassifyStatement(stmt.id, (row) => {
    const r = classifyRow({
      narration: row.narration ?? '',
      type: row.amount >= 0 ? 'credit' : 'debit',
      amount: Math.abs(row.amount),
    });
    if (!r) return null;
    // Apply the direction-mismatch flip / demote pass to the single
    // row by wrapping it in a one-element array (the validator
    // mutates in place and returns a count).
    const candidate = { type: row.amount >= 0 ? 'credit' as const : 'debit' as const, category: r.category, subcategory: r.subcategory };
    validateDirectionCategory([candidate]);
    return { category: candidate.category, subcategory: candidate.subcategory };
  });
  res.json({ success: true, ...result });
});

// POST /api/bank-statements/:id/flip-signs — escape hatch for the
// Cash-Credit / Overdraft / Loan sign convention. When auto-detect
// (isCashCredit on the upload side) gets the account type wrong —
// either fails to fire on a short loan statement OR fires on a
// savings account that happens to have a lot of Dr balances — the
// user clicks one button to negate every amount + balance in place.
// Recomputes statement totals so Inflow/Outflow update immediately.
// Idempotent against itself: clicking twice restores the original
// signs. No re-extraction needed, no Gemini cost, no upload cycle.
router.post('/:id/flip-signs', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const stmt = bankStatementRepo.findByIdForUser(req.params.id, req.user.id);
  if (!stmt) { res.status(404).json({ error: 'Statement not found' }); return; }
  const result = bankTransactionRepo.flipSigns(stmt.id);
  // Re-derive Inflow/Outflow off the post-flip rows so the summary
  // cards update without needing a separate refresh.
  const rows = bankTransactionRepo.listByStatement(stmt.id);
  let inflow = 0, outflow = 0;
  for (const r of rows) {
    if (r.amount > 0) inflow += r.amount;
    else if (r.amount < 0) outflow += -r.amount;
  }
  bankStatementRepo.updateTotals(stmt.id, inflow, outflow, rows.length);
  res.json({
    success: true,
    updated: result.updated,
    totalInflow: inflow,
    totalOutflow: outflow,
  });
});

// POST /api/bank-statements/:id/reapply-conditions — re-run the
// post-extraction filter against the user's CURRENT conditions list.
// Useful after the user adds/edits/removes a condition: the stored
// rows don't change, only their hidden_by_condition flag, so this is
// cheap (one AI batch per 150 rows) and fully reversible.
router.post('/:id/reapply-conditions', async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const stmt = bankStatementRepo.findByIdForUser(req.params.id, req.user.id);
  if (!stmt) { res.status(404).json({ error: 'Statement not found' }); return; }
  const conditions = bankStatementConditionRepo.listByUser(req.user.id);
  try {
    const hidden = await applyConditionsToStatement(
      stmt.id,
      conditions.map((c) => ({ id: c.id, text: c.text })),
    );
    res.json({ success: true, hidden, total: bankTransactionRepo.listByStatement(stmt.id).length });
  } catch (err) {
    console.warn('[bank-statements] reapply-conditions failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Failed to re-apply conditions' });
  }
});

// GET /api/bank-statements/:id — detail + transactions
router.get('/:id', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const row = bankStatementRepo.findByIdForUser(req.params.id, req.user.id);
  if (!row) { res.status(404).json({ error: 'Statement not found' }); return; }
  const txs = bankTransactionRepo.listByStatement(row.id);
  const anomalies = bankTransactionAnomalyRepo.listByStatement(row.id);
  res.json({
    statement: serializeStatement(row),
    transactions: txs.map(serializeTransaction),
    anomalies: anomalies.map((a) => ({
      id: a.id,
      transactionId: a.transaction_id,
      type: a.anomaly_type,
      severity: a.severity,
      reason: a.reason,
    })),
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

    // 2026-06: User conditions are NO LONGER prepended to the
    // extraction or enrichment prompts. The previous architecture
    // asked the model to "skip rows matching X" mid-extraction, which
    // produced silently-corrupted output: the AI obeyed inconsistently
    // (skipped some rows, kept others) AND rewrote the next row's
    // amount to make balance reconcile (a ₹1,500 credit became ₹1,480
    // after a ₹20 debit was skipped). Extraction must be a FAITHFUL
    // copy of the PDF; conditions apply as a post-extraction filter
    // against the stored rows (see `applyConditionsToStatement` below).
    // We still LOAD the conditions here because the post-extraction
    // pass needs them.
    const userConditions = bankStatementConditionRepo.listByUser(req.user.id);
    const conditionsBlock = ''; // empty — conditions no longer injected into prompts

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

        // 2026-06: PaddleOCR-first pipeline for scanned PDFs. The
        // column-mapping wizard (browser-side) handles all text PDFs
        // — anything reaching this route is already image-only or
        // wizard-failed. PaddleOCR is free (local CPU, no API tokens)
        // and emits row-aligned text that a cheap Gemini text call
        // structures into rows. Saves ~45% per upload vs Gemini
        // Vision and removes the under-extraction failure mode we
        // saw on dense statements (vision dropping rows under output
        // density pressure).
        //
        // PDF-only — images (jpeg/png/webp) skip OCR and go straight
        // to vision (single image, vision is the right tool there).
        // Any PaddleOCR failure (not installed, timeout, parse error)
        // is caught and falls back to vision so uploads never break
        // entirely while the operator debugs the OCR pipeline.
        let extractedFromOcr = false;
        if (mimeType === 'application/pdf') {
          try {
            const ocrStart = Date.now();
            console.log(`[bank-statements] PaddleOCR start: ${filename} (${req.file.size} bytes)`);
            const ocr = await extractPdfTextWithPaddleOcr(req.file.buffer);
            console.log(`[bank-statements] PaddleOCR done: ${ocr.pages.length} pages in ${ocr.durationMs}ms`);
            const structured = await structureOcrTextIntoRows(ocr.pages);
            console.log(`[bank-statements] structurer: ${structured.transactions.length} rows · in=${structured.inputTokens} out=${structured.outputTokens}`);
            extracted = {
              transactions: structured.transactions.map((r) => ({
                date: r.date,
                narration: r.narration,
                type: r.type,
                // Sign the printed amount by direction. persistStatement's
                // deriveAmountsFromBalance cross-checks this against the
                // running-balance delta and prefers it when they
                // disagree — a self-contained per-row amount can't
                // amplify a single misread the way a balance-chain delta
                // does. null amount → pure balance-delta fallback.
                amount: r.amount != null ? (r.type === 'credit' ? r.amount : -r.amount) : undefined,
                balance: r.balance,
              })),
              amountsFromOcr: true,
            } as ExtractedStatement;
            // Per-model usage split: the tiered structurer runs T2
            // first and escalates short-yield/error chunks to T1 —
            // each tier must be weighted by its own model in the
            // quota gate (T1 output weighs 15× vs T2's 4×).
            (res.locals as Record<string, unknown>).geminiUsages =
              structured.usages && structured.usages.length > 0
                ? structured.usages
                : [{
                    inputTokens: structured.inputTokens,
                    outputTokens: structured.outputTokens,
                    modelUsed: structured.modelUsed,
                  }];
            extractedFromOcr = true;
            const totalMs = Date.now() - ocrStart;
            console.log(`[bank-statements] OCR pipeline total: ${totalMs}ms (${(totalMs / Math.max(1, ocr.pages.length)).toFixed(0)}ms/page)`);
          } catch (err) {
            console.warn(`[bank-statements] PaddleOCR path failed, falling back to vision: ${(err as Error).message?.slice(0, 200)}`);
          }
        }

        // Vision fallback path — runs ONLY when PaddleOCR isn't
        // available / failed, or when the upload is a single image
        // (jpeg/png/webp) where OCR adds no value over direct vision.
        const fullPrompt = `${conditionsBlock}${BANK_STATEMENT_PROMPT}`;
        if (!extractedFromOcr) {
          // 2026-06: For PDFs above PDF_VISION_CHUNK_THRESHOLD pages
          // (default 40), split into page-range chunks before vision.
          // Single-pass extraction blows past Gemini's 64K output cap
          // on dense >100-page statements (154-page ICICI dump was the
          // trigger). Each chunk fits cleanly under the cap; we merge
          // the per-chunk transaction arrays into one ExtractedStatement.
          // Non-PDF uploads (image/jpeg, etc.) skip chunking and use
          // the original single-call path.
          let pdfPageCount: number | null = null;
          if (mimeType === 'application/pdf') {
            pdfPageCount = await getPdfPageCount(req.file.buffer);
          }
          const shouldChunk = pdfPageCount !== null && pdfPageCount > PDF_VISION_CHUNK_THRESHOLD;
          if (shouldChunk) {
            console.log(`[bank-statements] ${pdfPageCount}-page PDF exceeds chunk threshold (${PDF_VISION_CHUNK_THRESHOLD}); splitting`);
            const chunks = await splitPdfByPages(req.file.buffer);
            console.log(`[bank-statements] split into ${chunks.length} chunk(s)`);
            const allTransactions: ExtractedStatement['transactions'] = [];
            let mergedHead: ExtractedStatement | null = null;
            let totalInputTokens = 0;
            let totalOutputTokens = 0;
            let modelUsedLast = '';
            for (let i = 0; i < chunks.length; i++) {
              const c = chunks[i]!;
              const chunkResult = await extractVisionWithFallback<ExtractedStatement>(
                c.buffer,
                mimeType,
                fullPrompt,
                {
                  maxTokens: 65_536,
                  looksValid: (data) => {
                    const txns = (data as { transactions?: unknown })?.transactions;
                    return Array.isArray(txns) && txns.length > 0;
                  },
                },
              );
              totalInputTokens += chunkResult.inputTokens;
              totalOutputTokens += chunkResult.outputTokens;
              modelUsedLast = chunkResult.modelUsed;
              if (i === 0) mergedHead = chunkResult.data;
              if (Array.isArray(chunkResult.data?.transactions)) {
                allTransactions.push(...chunkResult.data.transactions);
              }
              console.log(`[bank-statements] chunk ${i + 1}/${chunks.length} (pages ${c.startPage}-${c.endPage}): ${chunkResult.data?.transactions?.length ?? 0} rows`);
            }
            extracted = {
              ...(mergedHead ?? {} as ExtractedStatement),
              transactions: allTransactions,
            };
            (res.locals as Record<string, unknown>).geminiUsages = [{
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              modelUsed: modelUsedLast,
            }];
          } else {
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
          (res.locals as Record<string, unknown>).geminiUsages = [{
            inputTokens: visionResult.inputTokens,
            outputTokens: visionResult.outputTokens,
            modelUsed: visionResult.modelUsed,
          }];
          } // end else (single-call vision path)
        } // end if (!extractedFromOcr) — vision fallback
          // Convergence point: extracted is populated by whichever
          // path ran (PaddleOCR + structurer, chunked vision, or
          // single-call vision). The "0 transactions" defence covers
          // ALL paths.
          //
          // 2026-06: this convergence used to sit INSIDE the
          // !extractedFromOcr branch (the old brace comment claimed
          // one `}` closed two blocks — it didn't). Net effect: OCR-
          // extracted rows skipped the classifier post-pass entirely
          // and every transaction landed as "Other" with no
          // counterparty, and the metadata backstop below never ran
          // (card showed "Bank Statement · Period not detected").
          if (!extracted || !Array.isArray(extracted.transactions) || extracted.transactions.length === 0) {
            console.warn(`[bank-statements] extraction returned 0 transactions for ${filename} (${req.file.size} bytes, mime=${mimeType}). Likely too large/dense — recommend the text path or splitting the PDF.`);
            res.status(422).json({
              error: 'AI vision could not extract any transactions from this PDF. The file may be too large or dense for vision OCR — try the column-mapping flow (the PDF has selectable text) or split it into smaller chunks.',
            });
            return;
          }
          // Metadata backstop. The vision prompt asks the model for
          // bankName / masked account / period, but the OCR structurer
          // deliberately doesn't (its rows are date/narration/type/
          // balance only) — without this the statement card renders
          // "Bank Statement · Period not detected". Same deterministic
          // extractor the CSV path uses: bank name from filename +
          // narration frequency, period from min/max row dates. Only
          // fills fields the upstream path left empty.
          if (!extracted.bankName || !extracted.periodFrom || !extracted.periodTo || !extracted.accountNumberMasked) {
            const metaRows = (extracted.transactions as Array<{ date?: string | null; narration?: string; type?: string; balance?: number | null }>)
              .map(t => ({
                date: typeof t.date === 'string' ? t.date : null,
                narration: typeof t.narration === 'string' ? t.narration : '',
                amount: 0, // unused by the metadata extractor; amounts derive later
                type: t.type === 'credit' ? 'credit' : 'debit',
                balance: typeof t.balance === 'number' ? t.balance : null,
              }));
            const meta = extractBankMetadata(filename, metaRows);
            extracted.bankName = extracted.bankName ?? meta.bankName;
            extracted.accountNumberMasked = extracted.accountNumberMasked ?? meta.accountNumberMasked;
            extracted.periodFrom = extracted.periodFrom ?? meta.periodFrom;
            extracted.periodTo = extracted.periodTo ?? meta.periodTo;
          }
          // Vision returns SLIM rows: { date, narration, type, balance }
          // only. The categorization fields (category / subcategory /
          // counterparty / reference) are emitted by the server-side
          // narration-anchor classifier here, mirroring what the CSV
          // path does. This is the single biggest vision token win:
          // the prompt no longer asks the model to produce 5 extra
          // fields per row, and the JSON output collapses from ~250
          // chars/row to ~80 chars/row.
          //
          // Rows that match a classifier rule (~70% on typical Indian
          // statements) get their category / subcategory / counterparty
          // / reference set deterministically. Rows that don't match
          // default to category="Other" with regex-extracted counterparty
          // / reference. We deliberately do NOT run a second AI batch
          // for vision-extracted rows — the vision path is already the
          // expensive path; the user accepts "Other" as the floor for
          // ambiguous rows on image-only PDFs and can re-tag via UI.
          if (Array.isArray(extracted.transactions)) {
            type VisionRow = {
              narration: string;
              type: 'credit' | 'debit';
              amount?: number;
              category?: string;
              subcategory?: string | null;
              counterparty?: string | null;
              reference?: string | null;
            };
            // Vision path post-pass: learned rules + deterministic anchors
            // over the AI-extracted rows. The AI may have set its own
            // category already, but we let our deterministic layers win
            // — same rationale as the CSV path: testable, free, and the
            // memory layer captures the user's specific corrections.
            const visionLearnedLookup = (fp: string, dir: 'credit' | 'debit') =>
              learnedClassificationsRepo.lookupForClassify(quota.billingUserId, fp, dir);
            const visionTierCounts = { learned: 0, anchor: 0, unclassified: 0, conflicts: 0 };
            const visionLearnedHitIds = new Set<string>();
            for (const row of extracted.transactions as VisionRow[]) {
              if (!row || typeof row.narration !== 'string') continue;
              const out = classifyWithLearning(
                {
                  narration: row.narration,
                  type: row.type,
                  amount: typeof row.amount === 'number' ? row.amount : 0,
                },
                visionLearnedLookup,
              );
              visionTierCounts[out.tier]++;
              if (out.anchorConflict) visionTierCounts.conflicts++;
              if (out.learnedRuleId) visionLearnedHitIds.add(out.learnedRuleId);
              if (out.result) {
                row.category = out.result.category;
                row.subcategory = out.result.subcategory;
                row.counterparty = out.result.counterparty;
                row.reference = out.result.reference;
              } else {
                const extr = extractCounterpartyAndReference(row.narration);
                row.category = 'Other';
                row.subcategory = null;
                row.counterparty = extr.counterparty;
                row.reference = extr.reference;
              }
            }
            for (const id of visionLearnedHitIds) {
              learnedClassificationsRepo.recordHit(id);
            }
            console.log(`[bank-statements] ${extractedFromOcr ? 'ocr' : 'vision'} classifier post-pass: ${visionTierCounts.learned} learned, ${visionTierCounts.anchor} anchor, ${visionTierCounts.unclassified} → Other (${visionTierCounts.conflicts} learned/anchor conflicts)`);
            // Now that category / subcategory are set, the consistency
            // pass can back-fill any obvious cross-row inconsistency
            // (same counterparty appearing with different categories).
            unifyAmbiguousCounterparties(extracted.transactions as Array<{
              counterparty: string | null;
              type: 'credit' | 'debit';
              category: string;
              subcategory: string | null;
            }>);
            // Direction/category sanity check (see CSV-path comment).
            validateDirectionCategory(extracted.transactions as Array<{
              type: 'credit' | 'debit';
              category: string;
              subcategory: string | null;
            }>);
            // Retail-business promotion. Note: vision rows don't have
            // `amount` set yet (derived from balance delta later in
            // persistStatement), so we pass `Math.abs(balance delta)`
            // as a fallback when amount is missing — but it's fine if
            // we miss some rows here: the heuristic is approximate
            // anyway. The CSV path is where this matters most; vision
            // statements rarely have the 30+ small credits pattern.
            applyRetailBusinessPromotion(extracted.transactions as Array<{
              type: 'credit' | 'debit';
              amount: number;
              counterparty: string | null;
              category: string;
              subcategory: string | null;
            }>);
            // markRecurring needs `amount`, which is derived from
            // balance deltas in persistStatement. So it can't run here
            // for vision rows — would be a no-op with undefined amounts.
            // Acceptable for the vision path: recurring detection is a
            // dashboard nicety, not a correctness signal.
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
        // Run the learned-rule lookup + deterministic narration anchors
        // over every row first. Rows that match (typically 60-75% of an
        // Indian bank statement — bank charges, interest, EMI, salary,
        // GST, recognizable UPI VPAs — plus this firm's remembered
        // counterparties on top) get their category/subcategory/
        // counterparty/reference filled in here for free. Only the
        // unclassified rows are sent to AI, which slashes input + output
        // tokens proportionally.
        //
        // For rows that DO go to AI, we still pre-fill counterparty +
        // reference from the regex extractor — those are deterministic
        // even when category isn't, and pre-filling means the AI prompt
        // can focus on the category decision and produces shorter
        // output (the schema below drops counterparty/reference too).
        const learnedLookup = (fp: string, dir: 'credit' | 'debit') =>
          learnedClassificationsRepo.lookupForClassify(quota.billingUserId, fp, dir);
        const tierCounts = { learned: 0, anchor: 0, aiCache: 0, unclassified: 0, conflicts: 0 };
        const learnedHitIds = new Set<string>();
        const ruleResults = normalized.map((row, index) => {
          const out = classifyWithLearning(
            { narration: row.narration, type: row.type as 'credit' | 'debit', amount: row.amount },
            learnedLookup,
          );
          if (out.anchorConflict) {
            tierCounts.conflicts++;
            console.log(`[bank-statements] learned/anchor conflict on "${row.narration.slice(0, 60)}": learned=${out.anchorConflict.learnedCategory} vs anchor=${out.anchorConflict.anchorCategory} — learned wins`);
          }
          if (out.learnedRuleId) learnedHitIds.add(out.learnedRuleId);
          if (out.result) {
            tierCounts[out.tier]++;
            return { index, row, classified: out.result, needsAi: false };
          }
          // Anchor + learned both missed. Check the in-memory AI-decision
          // cache for this firm/fingerprint before scheduling a Gemini
          // call — most multi-statement upload sessions hit the same
          // unfamiliar UPI VPAs across statements, and we already paid
          // the AI to classify them once. See bankAiClassificationCache
          // for safety rules (low-confidence floors NOT cached; 24h TTL).
          const { counterparty, reference } = extractCounterpartyAndReference(row.narration);
          const fp = extractNarrationFingerprint(row.narration);
          const cached = fp ? lookupAiClassification(quota.billingUserId, fp, row.type as 'credit' | 'debit') : null;
          if (cached) {
            tierCounts.aiCache++;
            return {
              index,
              row,
              classified: {
                category: cached.category as BankStatementCategory,
                subcategory: cached.subcategory,
                counterparty,
                reference,
              },
              needsAi: false,
            };
          }
          tierCounts.unclassified++;
          return { index, row, classified: null, counterparty, reference, fingerprint: fp, needsAi: true };
        });
        const ambiguous = ruleResults.filter(r => r.needsAi);
        const classified = ruleResults.filter(r => !r.needsAi);
        // Bump hit_count + last_applied_at on every learned rule that
        // fired this run. Single repo call per rule (not per row) so
        // a 500-row statement triggering one popular rule writes once,
        // not 500 times.
        for (const id of learnedHitIds) {
          learnedClassificationsRepo.recordHit(id);
        }
        console.log(`[bank-statements] csv classifier pre-pass: ${tierCounts.learned} learned, ${tierCounts.anchor} anchor, ${tierCounts.aiCache} ai-cache, ${tierCounts.unclassified} → AI (of ${normalized.length} rows; ${tierCounts.conflicts} learned/anchor conflicts)`);

        // Batch size lowered 80 → 40 (2026-05): empirically T2
        // (gemini-2.5-flash-lite) skips rows it can't categorize
        // confidently on dense batches, and 80-row batches hit the
        // undercount-bisect path on ~25% of uploads. Each bisect doubles
        // the API call count for that batch, amplifying upstream 503s
        // during Gemini outage windows. Smaller batches reduce both
        // failures (less for T2 to lose track of) AND the cost of
        // failures (no extra API calls on bisect). Concurrency stays
        // at 3 — we just run more, smaller batches concurrently.
        // Adaptive batch size: when the Gemini breaker is open / half_open
        // (i.e. we're inside or just exiting an upstream outage window),
        // shrink batches 40 → 25. Smaller batches truncate less often and
        // fail-and-bisect less often, so the recovery path costs fewer API
        // calls. Cost-neutral in steady state; reliability-positive during
        // 503 bursts. Threshold mirrors the failure_threshold the breaker
        // uses (5 consecutive fails) — even a `closed` breaker with ≥3
        // recent failures is treated as wobbly.
        const breakerInfo = getBreakerStatus().find(b => b.upstream === 'gemini');
        const breakerWobbly =
          breakerInfo?.state === 'open' ||
          breakerInfo?.state === 'half_open' ||
          (breakerInfo?.failures ?? 0) >= 3;
        const CSV_BATCH_SIZE = breakerWobbly ? 25 : 40;
        if (breakerWobbly) {
          console.log(`[bank-statements] csv batch size shrunk 40 → 25 (gemini breaker state=${breakerInfo?.state}, failures=${breakerInfo?.failures})`);
        }
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

        // Compact schemas + cacheable static prefix.
        //
        // Why the split:
        //   - The CSV path fires 5-15 batches per statement. Splitting
        //     the prompt into a STATIC prefix (instructions + conditions
        //     + category enum) and a DYNAMIC tail (just the row batch)
        //     lets the native Gemini API cache the static portion ONCE
        //     per statement and reuse it across every subsequent batch
        //     — the cached input runs at ~25% of normal cost.
        //   - Output is a top-level array of [category, subcategory|null]
        //     pairs. No wrapping object, no per-row key labels. Output
        //     tokens are 4× more expensive than input on T2, so every
        //     character we cut from the response scales by batch count.
        //   - Input schema is TSV (narration\ttype\tamount) instead of
        //     JSON.stringify of an array of objects. Removes per-row
        //     `{"narration":"`, `","type":"`, `","amount":` overhead.
        //     ~25% input shrink on the dynamic tail.
        //   - Bank metadata (name / masked account / period) was
        //     previously asked for in an `m` field; that's now extracted
        //     server-side from filename + narrations + row dates (see
        //     extractBankMetadata). The prompt no longer mentions it.
        //
        // Because the prompt has zero per-batch variance, the cache
        // key is identical across every batch within a statement and
        // across every statement uploaded by the same user with the
        // same conditions block within the cache TTL.
        const STATIC_PREFIX = `${conditionsBlock}You categorise Indian bank-statement rows the rule-based pre-pass could not auto-tag. Return ONE JSON array, no fences, no prose:

[[category, subcategory_or_null], ...]

Rules:
- The array MUST be the same length and order as INPUT_ROWS. No skipping, no reordering.
- category ∈ {${BANK_STATEMENT_CATEGORIES.map(c => `"${c}"`).join(',')}}.
- DIRECTION DISCIPLINE (CRITICAL — wrong direction = wrong answer):
   * type="credit" rows can ONLY be: Business Income, Salary, Rent Received, Interest Income, Bank Interest (Cr), Dividends, Cash Deposit, Transfers, Personal, Other.
   * type="debit" rows can ONLY be: Business Expenses, Cash Withdrawal, Loan EMI, Bank Charges, Bank Interest (Dr), GST Payments, TDS, Taxes Paid, Investments, Insurance, Mobile Charges, Electricity Charges, Water Charges, Transfers, Personal, Other.
   * NEVER tag a debit row as "Cash Deposit" or "Business Income". NEVER tag a credit row as "Cash Withdrawal" or "Business Expenses". The type column tells you the direction — read it first.
- Upstream already handled bank charges, EMI, salary, GST, TDS, and well-known merchants. You see only UPI/NEFT/IMPS/RTGS to ambiguous counterparties, cheques, cash, local POS.
- Any narration containing "cash" or "deposit" in any form → credit rows go to "Cash Deposit" (subcategory "Other"); debit rows go to "Cash Withdrawal" (subcategory "Other").
- ENTERPRISES/TRADERS/PVT LTD/LIMITED/LLP/15-digit GSTIN → "Business Expenses" (debit) / "Business Income" (credit).
- Clear personal name OR grocery/local-shop pattern → "Personal" with subcategory "Shopping".
- Genuinely ambiguous → "Other" with null subcategory.

INPUT_ROWS — TSV, one row per line, columns narration<TAB>type<TAB>amount:
`;

        // Build the dynamic tail — TSV serialization of the batch.
        // Tabs / newlines in narrations are scrubbed to spaces so the
        // separator stays unambiguous. Amount is rounded to integer
        // paise (no decimal noise in the prompt).
        const buildTail = (slice: typeof ambiguous): string =>
          slice
            .map(r => {
              const narr = r.row.narration.replace(/[\t\r\n]+/g, ' ').trim();
              return `${narr}\t${r.row.type}\t${r.row.amount}`;
            })
            .join('\n');

        // Compact response shape from the model — a top-level array
        // of [category, subcategory|null] tuples. We translate back to
        // the existing EnrichmentResponse shape so the downstream merge
        // code is unchanged.
        type CompactEnrichmentResponse = Array<[string | null, string | null] | null>;

        // Enrichment batch runner. 2026-05 rework:
        //
        // The OLD logic threw on enrichments.length < slice.length * 0.95
        // ("undercount") and recursively bisected the batch to retry. That
        // amplified upstream 503s during Gemini outages because each
        // bisect doubled the API-call count for the batch. It was also
        // mostly wasted work — T2's undercounts come from the model
        // SKIPPING rows it can't categorize confidently, NOT from output
        // truncation (the slim 2-field enrichment for 80 rows is ~500
        // tokens; we cap max_tokens at 16,384). Smaller batches skip the
        // same rows.
        //
        // New logic:
        //   - Accept any non-zero result. Pad missing rows with default
        //     { category: 'Other', subcategory: null } at the tail.
        //   - Bisect ONLY on a fatal failure (JSON parse / network /
        //     all-tier-503), where smaller input genuinely helps the
        //     model produce something parseable.
        //   - The padding strategy assumes missing rows are at the tail
        //     of the response array (empirically T2 truncates from the
        //     end). On the rare interior-skip case, all but the last few
        //     rows get correctly categorised — net better than nothing.
        const categorizeWithSplit = async (
          slice: typeof ambiguous,
          label: string,
          depth: number,
        ): Promise<{ slice: typeof ambiguous; enrichments: EnrichmentResponse['enrichments']; meta: EnrichmentResponse; inputTokens: number; outputTokens: number; modelUsed: string }> => {
          const t0 = Date.now();
          let result: GeminiJsonResult<EnrichmentResponse> | null = null;
          try {
            const compact = await callBankEnrichment<CompactEnrichmentResponse>(
              STATIC_PREFIX,
              buildTail(slice),
              {
                maxTokens: CSV_MAX_OUTPUT_TOKENS,
                onFallback: () => { try { bankStatementRepo.markProviderFallback(placeholder.id); } catch (e) { console.warn('[bank-statements] markProviderFallback failed:', (e as Error).message); } },
              },
            );
            // Translate compact [[cat, sub], ...] → existing
            // EnrichmentResponse shape. Bank metadata is now extracted
            // server-side (see extractBankMetadata), so the four meta
            // fields ride null through this code path; they're filled
            // in by the caller from the server-extracted values.
            const rRaw = Array.isArray(compact.data) ? compact.data : [];
            const enrichmentsResponse: EnrichmentResponse = {
              bankName: null,
              accountNumberMasked: null,
              periodFrom: null,
              periodTo: null,
              currency: 'INR',
              enrichments: rRaw.map(pair => ({
                category: Array.isArray(pair) ? (pair[0] ?? null) : null,
                subcategory: Array.isArray(pair) ? (pair[1] ?? null) : null,
              })),
            };
            result = {
              data: enrichmentsResponse,
              inputTokens: compact.inputTokens,
              outputTokens: compact.outputTokens,
              modelUsed: compact.modelUsed,
            };
            let enrichments = result.data.enrichments ?? [];
            // SALVAGE: pad missing rows with default-Other instead of
            // bisecting. The classifier already pre-filled counterparty
            // / reference via regex for these rows; only category +
            // subcategory remain undetermined. Defaulting to Other is
            // the user's-eye equivalent of "AI couldn't decide", which
            // is exactly what the missing-row state actually means.
            if (enrichments.length < slice.length) {
              const padded = enrichments.length;
              const missing = slice.length - enrichments.length;
              for (let i = 0; i < missing; i++) {
                enrichments.push({ category: 'Other', subcategory: null });
              }
              console.warn(`[bank-statements] csv ${label} undercount salvaged: model returned ${padded}/${slice.length} enrichments; padded ${missing} row(s) with category='Other'`);
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
            // Only bisect on FATAL failures — JSON parse error, network
            // error, all-tier-503. These are cases where a smaller input
            // size genuinely helps. Undercount alone no longer reaches
            // here (handled by the salvage path above), so this branch
            // is now strictly for parse / network errors.
            const fatalAndSplittable = /parse failed|finish_reason=length|JSON|network|timeout/i.test(msg);
            if (result) {
              try {
                const failedClientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
                const failedCost = costForModel(result.modelUsed, result.inputTokens, result.outputTokens);
                usageRepo.logWithBilling(failedClientIp, req.user!.id, quota.billingUserId, result.inputTokens, result.outputTokens, failedCost, false, result.modelUsed, false, 'bank_statement', 0, 'failed');
              } catch (e) {
                console.error('[bank-statements] failed-batch log error', e);
              }
            }
            if (!fatalAndSplittable || depth >= 3 || slice.length <= 1) throw err;
            const mid = Math.ceil(slice.length / 2);
            const a = slice.slice(0, mid);
            const b = slice.slice(mid);
            console.warn(`[bank-statements] csv ${label} fatal parse/network error (${slice.length} rows at depth ${depth}), bisecting → [${a.length}, ${b.length}]`);
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
        // Bank metadata is server-extracted (filename + narrations +
        // row dates). The LLM no longer reads or returns these fields,
        // which keeps the cached prompt prefix stable across every
        // batch and shrinks the response by 4 fields per batch.
        const serverMeta = extractBankMetadata(filename, normalized);
        const bankMeta: EnrichmentResponse = {
          bankName: serverMeta.bankName,
          accountNumberMasked: serverMeta.accountNumberMasked,
          periodFrom: serverMeta.periodFrom,
          periodTo: serverMeta.periodTo,
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
          // ──── In-statement fingerprint dedup ────
          //
          // Many statements contain the same fingerprint many times
          // (recurring UPI to one VPA, monthly transfer to the same
          // counterparty). Sending all of them to the LLM is pure
          // duplication — same input row → same answer. Group by
          // (fingerprint, direction), send ONE representative per
          // group, propagate the decision to siblings in a server-
          // side pass.
          //
          // Rows with empty fingerprint can't safely dedup (the
          // narration is too noisy to be sure two rows mean the same
          // thing); they ride through as singletons.
          //
          // Direction matters: a credit and a debit to the same
          // counterparty are genuinely different (income vs payment),
          // so the group key includes type.
          const groupKey = (fp: string, dir: string) => `${dir}|${fp}`;
          const representativeOriginalIndexByGroup = new Map<string, number>();
          const shadowToRepOriginalIndex = new Map<number, number>();
          const deduped: typeof ambiguous = [];
          for (const a of ambiguous) {
            const fp = (a as { fingerprint?: string }).fingerprint;
            if (!fp) {
              deduped.push(a);
              continue;
            }
            const key = groupKey(fp, a.row.type);
            const existingRep = representativeOriginalIndexByGroup.get(key);
            if (existingRep === undefined) {
              representativeOriginalIndexByGroup.set(key, a.index);
              deduped.push(a);
            } else {
              shadowToRepOriginalIndex.set(a.index, existingRep);
            }
          }
          const dedupRatio = ambiguous.length === 0 ? 1 : deduped.length / ambiguous.length;
          if (shadowToRepOriginalIndex.size > 0) {
            console.log(`[bank-statements] csv in-statement dedup: ${ambiguous.length} ambiguous → ${deduped.length} unique (${shadowToRepOriginalIndex.size} shadows, ${(dedupRatio * 100).toFixed(0)}% compression)`);
          }

          const batches: Array<typeof ambiguous> = [];
          for (let i = 0; i < deduped.length; i += CSV_BATCH_SIZE) {
            batches.push(deduped.slice(i, i + CSV_BATCH_SIZE));
          }
          console.log(`[bank-statements] csv path: ${deduped.length} unique rows → ${batches.length} batch(es) of up to ${CSV_BATCH_SIZE}`);
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

          for (const br of batchResults) {
            br.slice.forEach((r, i) => {
              const e: Partial<EnrichmentResponse['enrichments'][number]> = br.enrichments[i] ?? {};
              const category = typeof e.category === 'string' && e.category.trim() ? e.category : 'Other';
              const subcategory = typeof e.subcategory === 'string' && e.subcategory.trim() ? e.subcategory : null;
              aiEnrichmentsByIndex.set(r.index, { category, subcategory });
              // Write into the per-process AI-decision cache. The cache
              // itself drops low-confidence ('Other' + null subcategory)
              // rows, so we can safely call it for every result.
              const fp = (r as { fingerprint?: string }).fingerprint;
              if (fp) {
                recordAiClassification(quota.billingUserId, fp, r.row.type as 'credit' | 'debit', category, subcategory);
              }
            });
            aiUsages.push({ inputTokens: br.inputTokens, outputTokens: br.outputTokens, modelUsed: br.modelUsed });
          }

          // Propagate representative decisions to shadow rows. Done
          // AFTER all batches return so we don't depend on batch
          // ordering — a shadow's representative might be in a later
          // batch than the shadow itself.
          for (const [shadowIdx, repIdx] of shadowToRepOriginalIndex) {
            const repDecision = aiEnrichmentsByIndex.get(repIdx);
            if (repDecision) {
              aiEnrichmentsByIndex.set(shadowIdx, repDecision);
            }
            // Else: representative's batch failed and its row didn't
            // land in aiEnrichmentsByIndex. Shadow will fall through
            // to the 'Other' default in the merge below, same as if
            // the row itself had been the one to fail.
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
        // Same-counterparty consistency pass — the AI is noisy on
        // unfamiliar counterparties (a YES Bank upload had the same
        // BOYAAIRTEL.123 VPA tagged across 5 different category/
        // subcategory tuples). Group by normalized counterparty +
        // direction, find the majority, back-fill minority rows.
        unifyAmbiguousCounterparties(mergedTransactions as Array<{
          counterparty: string | null;
          type: 'credit' | 'debit';
          category: string;
          subcategory: string | null;
        }>);
        // Direction/category sanity check — catches AI emitting
        // impossible combinations like "DEBIT row tagged Business
        // Income". Demotes those to Other instead of letting them
        // skew the dashboard's Inflow vs Outflow totals.
        validateDirectionCategory(mergedTransactions as Array<{
          type: 'credit' | 'debit';
          category: string;
          subcategory: string | null;
        }>);
        // Retail-business-current-account detection — promotes the
        // many-small-credits-from-many-individuals pattern from
        // "Personal / Shopping" (the AI's default) to "Business Income
        // / Sales". The 2026-05 J&K Bank FOOD HUT upload had 708
        // customer payments misclassified this way; this pass recovers
        // them deterministically without an extra AI call.
        applyRetailBusinessPromotion(mergedTransactions as Array<{
          type: 'credit' | 'debit';
          amount: number;
          counterparty: string | null;
          category: string;
          subcategory: string | null;
        }>);

        extracted = {
          bankName: bankMeta.bankName ?? null,
          accountNumberMasked: bankMeta.accountNumberMasked ?? null,
          periodFrom: bankMeta.periodFrom ?? null,
          periodTo: bankMeta.periodTo ?? null,
          currency: bankMeta.currency ?? 'INR',
          // The wizard's client-side pdfGrid detects Cash Credit
          // statements (95%+ Dr-suffixed balances) and sends
          // accountKind='liability' on the upload body. Stored on
          // the statement for reference / display.
          accountKind: req.body?.accountKind === 'liability' ? 'liability' : 'asset',
          // Wizard-mapped amounts come from the PDF's explicit
          // Withdrawal/Deposit columns — they're the bank's printed
          // numbers and the server must not rewrite them from the
          // balance chain (whose sign encoding varies per product).
          // See ExtractedStatement.amountsAuthoritative.
          amountsAuthoritative: true,
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
      const { txCount, autoCorrected, mismatches, amountOverridden, reconciledFromAmount, phantomDropped, closingMismatch } = persistStatement(req.user.id, placeholder.id, extracted, filename ?? 'Bank Statement');

      // Phase 2 anomaly detector — runs against the just-persisted
      // rows (re-reading them to get the database-assigned IDs that
      // anomaly records need to FK to). Best-effort: a failure here
      // logs and continues; the analyze is still considered
      // successful — anomalies are an enrichment layer, not a
      // correctness signal.
      try {
        const persistedRows = bankTransactionRepo.listByStatement(placeholder.id);
        // History snapshot: distinct fingerprints from the firm's
        // prior statements within the 12-month lookback. Empty set
        // when the firm has no prior statements — the detector
        // short-circuits the new-counterparty rule in that case.
        const since = new Date();
        since.setDate(since.getDate() - 365);
        const sinceIso = since.toISOString().replace('Z', '').replace('T', ' ').slice(0, 19);
        const knownFingerprints = bankTransactionRepo.fingerprintsForBillingUserSince(
          quota.billingUserId,
          placeholder.id,
          sinceIso,
        );
        const hasPriorHistory = bankTransactionRepo.hasPriorStatementForBillingUser(
          quota.billingUserId,
          placeholder.id,
        );
        const anomalies = detectAnomalies(
          persistedRows.map((r) => ({
            id: r.id,
            date: r.tx_date,
            narration: r.narration,
            amount: r.amount,
            category: r.category,
            subcategory: r.subcategory,
            fingerprint: r.fingerprint,
          })),
          { knownFingerprints, hasPriorHistory },
        );
        bankTransactionAnomalyRepo.bulkInsert(placeholder.id, anomalies);
        if (anomalies.length > 0) {
          const warnCount = anomalies.filter((a) => a.severity === 'warn').length;
          const infoCount = anomalies.length - warnCount;
          console.log(`[bank-statements] anomaly detector: ${anomalies.length} flags (${warnCount} warn, ${infoCount} info) on ${persistedRows.length} rows`);
        }
      } catch (err) {
        console.error('[bank-statements] anomaly detection failed (non-fatal):', err);
      }

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

      // 2026-06: post-extraction filter pass. Conditions are no
      // longer injected into the extraction prompt (the AI was
      // corrupting amounts to keep balances reconciled across
      // skipped rows). Instead, we now apply them deterministically
      // against the stored, faithful rows AFTER insertion. Each
      // matching row gets hidden_by_condition=1; the row itself stays
      // in the table so balances reconcile and the user can toggle
      // visibility. Failures here are non-fatal — the rows just stay
      // visible. Done before the listByStatement call below so the
      // returned payload already carries the hidden flag.
      if (userConditions.length > 0) {
        try {
          const hiddenCount = await applyConditionsToStatement(
            placeholder.id,
            userConditions.map((c) => ({ id: c.id, text: c.text })),
          );
          console.log(`[bank-statements] post-extraction filter: ${hiddenCount} of ${txCount} rows hidden by user conditions`);
        } catch (err) {
          console.warn('[bank-statements] post-extraction filter failed:', err instanceof Error ? err.message : err);
        }
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
          parts.push(`Replaced ${amountOverridden} transaction amount${amountOverridden === 1 ? '' : 's'} with values derived from the printed running balance — totals reflect what actually moved through the account. If the bank's printed Grand Total disagrees, it's because some of the bank's PDF amount cells don't match its own balance column; we trust the balance column.`);
        }
        if (reconciledFromAmount > 0) {
          parts.push(`Corrected ${reconciledFromAmount} row${reconciledFromAmount === 1 ? '' : 's'} where the scanned amount and running balance disagreed — used the printed Deposit/Withdrawal figure, since a single misread balance would otherwise inflate both totals.`);
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
      // Surface anomalies in the analyze response so the frontend
      // can render the "Flagged transactions" section without an
      // extra round-trip. Matches the shape returned by GET /:id.
      const persistedAnomalies = bankTransactionAnomalyRepo.listByStatement(placeholder.id);
      const payload = {
        statement: serializeStatement(bankStatementRepo.findByIdForUser(placeholder.id, req.user.id)),
        transactions,
        txCount,
        anomalies: persistedAnomalies.map((a) => ({
          id: a.id,
          transactionId: a.transaction_id,
          type: a.anomaly_type,
          severity: a.severity,
          reason: a.reason,
        })),
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

// PATCH /api/bank-statements/:id/transactions/:txId — reassign
// category. Optionally also creates / updates a learned rule when
// `remember: 'always'` is passed: the narration is fingerprinted
// (server-side, so the frontend doesn't need to know the algorithm)
// and upserted into learned_classifications for the user's
// billing-firm. Next time a row in any of the firm's statements
// fingerprints to the same key, the classifier auto-applies this
// category — saving the round-trip to AI.
//
// Body: {
//   category: string,
//   subcategory?: string | null,
//   remember?: 'never' | 'always',  // default 'never'
//   narration?: string,             // required when remember='always'
//   direction?: 'credit' | 'debit' | 'either', // default 'either'
// }
router.patch('/:id/transactions/:txId', (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: 'Auth required' }); return; }
  const { id, txId } = req.params;
  const category = typeof req.body?.category === 'string' ? normalizeCategory(req.body.category) : null;
  const subcategory = typeof req.body?.subcategory === 'string' ? req.body.subcategory : null;
  if (!category) { res.status(400).json({ error: 'category is required' }); return; }
  const ok = bankTransactionRepo.updateCategory(txId, id, req.user.id, category, subcategory);
  if (!ok) { res.status(404).json({ error: 'Transaction not found' }); return; }

  // Optional: remember this correction as a learned rule. The
  // frontend sends narration + direction so we don't need a DB roundtrip
  // to read them from bank_transactions. Direction defaults to 'either'
  // so the rule applies to both credit and debit rows unless the
  // frontend opts in to a more specific scope.
  let learned: ReturnType<typeof serializeLearnedRule> | null = null;
  if (req.body?.remember === 'always') {
    const narration = typeof req.body?.narration === 'string' ? req.body.narration : '';
    if (narration.trim()) {
      const fingerprint = extractNarrationFingerprint(narration);
      // Empty fingerprint = the narration was all-noise. Skip silently
      // rather than 400 — the user clicked "remember", the row's
      // category still got persisted, just no rule was learnable.
      if (fingerprint) {
        const direction = req.body?.direction === 'credit' || req.body?.direction === 'debit'
          ? (req.body.direction as 'credit' | 'debit')
          : 'either';
        const actor = userRepo.findById(req.user.id);
        if (actor) {
          const billingUser = getBillingUser(actor);
          const rule = learnedClassificationsRepo.upsert({
            billingUserId: billingUser.id,
            fingerprint,
            category,
            subcategory,
            directionScope: direction,
            sampleNarration: narration.slice(0, 200),
            createdByUserId: req.user.id,
          });
          learned = serializeLearnedRule(rule);
        }
      }
    }
  }

  res.json({ success: true, learned });
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
      // Round to paise — raw floats leak precision noise like
      // 349.99999999999955 / 200.00000000000006 into the export
      // when amount = (balance - prev_balance) on a liability /
      // CC-style account where the running balance is computed in
      // float. Math.round(x * 100) / 100 caps at 2 dp without
      // turning the number into a string (Papa.unparse handles
      // numeric formatting itself).
      Math.round(Math.abs(t.amount) * 100) / 100,
      t.balance == null ? '' : Math.round(t.balance * 100) / 100,
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
