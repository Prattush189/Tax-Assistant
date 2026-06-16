/**
 * Post-extraction filter: apply the user's free-form bank-statement
 * conditions ("ignore UPI under 500", "hide salary credits", etc.) as
 * a VISIBILITY flag on stored rows.
 *
 * Why this exists separately from extraction:
 *
 * The previous architecture injected the conditions text into the
 * vision and CSV-enrichment prompts and asked the model to skip rows
 * mid-extraction. Production runs showed two failure modes that made
 * that approach unworkable:
 *
 *   1. Inconsistent application — the model obeyed the filter on some
 *      rows and ignored it on others (167 UPI <500 rows leaked through
 *      a "ignore UPI under 500" condition on a single ICICI statement).
 *   2. Silent amount corruption — when the model DID skip a row, the
 *      next row's balance carried a gap, and the model "helpfully"
 *      rewrote that next row's amount to make the balance reconcile.
 *      A ₹1,500 credit became ₹1,480 after a ₹20 debit was skipped.
 *      Balance-continuity passed, hiding the corruption from naïve
 *      verification.
 *
 * The fix is to keep extraction faithful (every row in the PDF lands
 * in the table with original amounts) and apply conditions as a
 * post-process VISIBILITY flag. The row is still there, just marked
 * `hidden_by_condition = 1`; the UI defaults to hiding it but offers
 * a "Show hidden (N)" toggle so the user can verify the filter did
 * what they expected.
 *
 * This module owns the AI call that interprets the free-form
 * condition text against each row. It does NOT modify amounts, dates,
 * or narrations — only the visibility flag.
 */

import { streamGeminiChat } from './geminiChat.js';
import { GEMINI_CHAT_MODEL_T2, GEMINI_API_KEYS } from './gemini.js';
import { bankTransactionRepo, type BankTransactionRow } from '../db/repositories/bankTransactionRepo.js';

export interface ConditionInput {
  id: string;
  text: string;
}

// ─── Deterministic numeric-threshold conditions ──────────────────────
//
// The single most common condition is an amount cutoff — "ignore
// transactions under 500", "hide anything below ₹100", "exclude
// debits over 1 lakh". Routing those through the LLM is both wasteful
// and unreliable: this module's own history (see the file header) is a
// catalogue of the model applying a numeric filter to some rows and
// silently ignoring others. A `<`/`>` comparison is exact arithmetic —
// it belongs in code, not a prompt. We parse the cutoff here and only
// fall back to the AI for genuinely semantic conditions ("exclude ATM
// withdrawals", "hide salary credits").

type RowPredicate = (row: { narration: string; amount: number }) => boolean;

const MAGNITUDE: Record<string, number> = {
  hundred: 100,
  k: 1_000, thousand: 1_000,
  lakh: 100_000, lakhs: 100_000, lac: 100_000, lacs: 100_000,
  crore: 10_000_000, crores: 10_000_000, cr: 10_000_000,
};

// Words allowed to surround the comparison without making the condition
// "semantic". If anything else survives after we strip the operator,
// number, currency and direction tokens, the condition is too complex
// to trust to code and we hand it to the AI instead.
const FILLER_WORDS = new Set([
  'ignore', 'hide', 'exclude', 'skip', 'drop', 'remove', 'omit', 'filter', 'out',
  'dont', 'do', 'not', 'no', 'show', 'only', 'keep', 'please',
  'transaction', 'transactions', 'txn', 'txns', 'entry', 'entries', 'row', 'rows',
  'statement', 'statements', 'line', 'lines', 'item', 'items', 'payment', 'payments',
  'all', 'any', 'every', 'each', 'the', 'a', 'an', 'of', 'with', 'that', 'which', 'are', 'is', 'be', 'in',
  'anything', 'everything', 'something', 'nothing', 'thing', 'things', 'one', 'ones',
  'amount', 'amounts', 'amt', 'value', 'valued', 'worth', 'having', 'whose', 'where', 'when',
  'and', 'or', 'than', 'then', 'to', 'up', 'upto', 'at', 'rs', 'inr', 'rupee', 'rupees',
  'less', 'lesser', 'smaller', 'lower', 'fewer', 'below', 'under',
  'more', 'greater', 'larger', 'bigger', 'higher', 'over', 'above', 'exceeding', 'exceeds', 'exceed',
  'least', 'most', 'maximum', 'minimum', 'max', 'min', 'equal', 'exactly', 'atleast', 'atmost',
]);

const DIRECTION_WORDS = new Set([
  'debit', 'debits', 'withdrawal', 'withdrawals', 'withdrawn', 'spent', 'outgoing', 'dr',
  'credit', 'credits', 'deposit', 'deposits', 'received', 'incoming', 'inflow', 'cr',
]);

/**
 * Parse a free-form condition into a deterministic row predicate, or
 * return null when the text isn't a simple amount-threshold filter
 * (caller falls back to the AI for those). Recognises:
 *   - direction: debit / credit / withdrawal / deposit (optional)
 *   - comparison: under/below/less than → `<`; up to/at most → `<=`;
 *     over/above/more than → `>`; at least/minimum → `>=`
 *   - amount with magnitude: 500, 1,000, ₹100, 50k, 1.5 lakh, 2 cr
 * Safety gate: any leftover meaningful word (e.g. "salary", "atm",
 * "zomato") disqualifies the fast path so we never under- or
 * over-hide on a condition that carries extra meaning.
 */
export function parseDeterministicCondition(text: string): RowPredicate | null {
  let s = text.toLowerCase().trim();
  s = s.replace(/[₹]/g, ' ').replace(/(\d),(?=\d)/g, '$1'); // drop ₹ and thousands-commas

  // Comparison operator. Order matters: check the "or equal" variants
  // and the longer phrases first.
  let op: 'lt' | 'lte' | 'gt' | 'gte' | null = null;
  if (/\b(?:at least|atleast|minimum|min|no less than|>=)\b/.test(s)) op = 'gte';
  else if (/\b(?:over|above|more than|greater than|bigger than|larger than|higher than|exceed(?:s|ing)?|>)\b/.test(s)) op = 'gt';
  else if (/\b(?:up ?to|upto|at most|atmost|maximum|no more than|<=)\b/.test(s)) op = 'lte';
  else if (/\b(?:under|below|less than|lesser than|smaller than|lower than|fewer than|<)\b/.test(s)) op = 'lt';
  if (!op) return null;

  // Amount, with an optional magnitude word immediately after it.
  const m = s.match(/(\d+(?:\.\d+)?)\s*(hundred|thousand|lakhs?|lacs?|crores?|cr|k)?\b/);
  if (!m) return null;
  const amount = parseFloat(m[1]) * (m[2] ? MAGNITUDE[m[2]] ?? 1 : 1);
  if (!(amount > 0)) return null;

  // Optional direction filter.
  let dir: 'credit' | 'debit' | null = null;
  if (/\b(?:debit|debits|withdrawal|withdrawals|withdrawn|spent|outgoing)\b/.test(s)) dir = 'debit';
  else if (/\b(?:credit|credits|deposit|deposits|received|incoming|inflow)\b/.test(s)) dir = 'credit';

  // Safety gate: strip the number+magnitude and any comparison symbols,
  // then confirm every remaining word is filler or a direction word.
  const residual = s
    .replace(/(\d+(?:\.\d+)?)\s*(hundred|thousand|lakhs?|lacs?|crores?|cr|k)?\b/g, ' ')
    .replace(/[<>=≤≥.]/g, ' ');
  for (const w of residual.split(/\s+/)) {
    if (!w) continue;
    if (FILLER_WORDS.has(w) || DIRECTION_WORDS.has(w)) continue;
    return null; // a meaningful word survived → too complex for the fast path
  }

  return (row) => {
    if (dir === 'credit' && row.amount < 0) return false;
    if (dir === 'debit' && row.amount >= 0) return false;
    const abs = Math.abs(row.amount);
    switch (op) {
      case 'lt': return abs < amount;
      case 'lte': return abs <= amount;
      case 'gt': return abs > amount;
      case 'gte': return abs >= amount;
    }
    return false;
  };
}

/**
 * Apply the conditions list to every row of the statement. Updates
 * the `hidden_by_condition` flag in place. Returns the count of rows
 * marked hidden.
 *
 * Numeric-threshold conditions are evaluated deterministically in code
 * (exact, free, never inconsistent). Only genuinely semantic
 * conditions go to the AI — one batch per ~150 rows so the model
 * context stays small and the output JSON stays parseable.
 *
 * No-op (returns 0) when conditions is empty. When the only conditions
 * are semantic AND no API key is configured, the deterministic pass
 * still runs; the semantic pass is silently skipped.
 */
export async function applyConditionsToStatement(
  statementId: string,
  conditions: ConditionInput[],
): Promise<number> {
  if (conditions.length === 0) {
    // Clear any prior hidden flags from a previous condition set.
    bankTransactionRepo.replaceHiddenSet(statementId, []);
    return 0;
  }
  const rows = bankTransactionRepo.listByStatement(statementId);
  if (rows.length === 0) return 0;

  // Split conditions: deterministic numeric thresholds vs semantic.
  const predicates: RowPredicate[] = [];
  const aiConditions: ConditionInput[] = [];
  for (const c of conditions) {
    const pred = parseDeterministicCondition(c.text);
    if (pred) predicates.push(pred);
    else aiConditions.push(c);
  }

  const hiddenIds = new Set<string>();

  // Deterministic pass — exact, no AI.
  if (predicates.length > 0) {
    for (const r of rows) {
      const row = { narration: r.narration ?? '', amount: r.amount };
      if (predicates.some((p) => p(row))) hiddenIds.add(r.id);
    }
    console.log(`[bankConditionFilter] deterministic pass: ${hiddenIds.size} of ${rows.length} rows hidden by ${predicates.length} numeric condition(s)`);
  }

  // Semantic pass — only the conditions we couldn't parse.
  if (aiConditions.length > 0) {
    const apiKey = GEMINI_API_KEYS[0] ?? '';
    if (!apiKey) {
      console.warn('[bankConditionFilter] no Gemini API key — skipping semantic conditions');
    } else {
      const conditionsList = aiConditions
        .map((c, i) => `${i + 1}. ${c.text.trim().replace(/\s+/g, ' ')}`)
        .join('\n');
      const BATCH = 150;
      for (let start = 0; start < rows.length; start += BATCH) {
        const slice = rows.slice(start, start + BATCH);
        const batchHidden = await runFilterBatch(slice, conditionsList, apiKey);
        for (const id of batchHidden) hiddenIds.add(id);
      }
    }
  }

  const hiddenList = [...hiddenIds];
  bankTransactionRepo.replaceHiddenSet(statementId, hiddenList);
  return hiddenList.length;
}

/**
 * Single AI batch. The model sees the condition list + a compact TSV
 * of rows (id, narration, type, amount). It returns a JSON array of
 * the row-ids that match ANY condition — those get hidden.
 */
async function runFilterBatch(
  rows: BankTransactionRow[],
  conditionsList: string,
  apiKey: string,
): Promise<string[]> {
  const tsv = rows
    .map((r) => {
      const narr = (r.narration ?? '').replace(/[\t\r\n]+/g, ' ').trim();
      const type = r.amount >= 0 ? 'credit' : 'debit';
      const amt = Math.abs(r.amount);
      return `${r.id}\t${narr}\t${type}\t${amt}`;
    })
    .join('\n');

  const prompt = `You apply free-form user filters to Indian bank-statement rows.

USER CONDITIONS (each row should be HIDDEN if it matches ANY condition):
${conditionsList}

ROWS — TSV, one per line, columns id<TAB>narration<TAB>type<TAB>amount:
${tsv}

Return STRICT JSON: {"hide":["<row-id>", "<row-id>", ...]}
Rules:
- Include the id verbatim — do not alter, prefix, or truncate.
- A row is HIDDEN only when at least one condition matches. When in doubt, do NOT hide (leave visible).
- "amount" is the absolute amount in INR (positive). "type" tells the direction.
- Numerical comparisons interpret the user's wording literally ("under 500" = amount < 500; "above 1 lakh" = amount > 100000).
- No prose, no markdown fences, no explanation. Just the JSON object.`;

  let buffer = '';
  try {
    for await (const chunk of streamGeminiChat(
      GEMINI_CHAT_MODEL_T2,
      '',
      [],
      prompt,
      apiKey,
      8192,
      false,
      false,
    )) {
      if (chunk.text) buffer += chunk.text;
    }
  } catch (err) {
    console.warn('[bankConditionFilter] Gemini call failed:', err instanceof Error ? err.message : err);
    return [];
  }

  // Tolerant parse: strip fences if the model emitted them despite
  // instructions; pick the first {...} block; fail-quiet on parse
  // errors (return empty so the row stays visible — filter never
  // hides a row by accident).
  const cleaned = buffer.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    console.warn('[bankConditionFilter] no JSON object in response');
    return [];
  }
  try {
    const parsed = JSON.parse(match[0]) as { hide?: unknown };
    if (!Array.isArray(parsed.hide)) return [];
    const validIds = new Set(rows.map((r) => r.id));
    return parsed.hide.filter((x): x is string => typeof x === 'string' && validIds.has(x));
  } catch (err) {
    console.warn('[bankConditionFilter] JSON parse failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
