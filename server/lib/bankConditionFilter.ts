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

/**
 * Apply the conditions list to every row of the statement. Updates
 * the `hidden_by_condition` flag in place. Returns the count of rows
 * marked hidden.
 *
 * No-op (returns 0) when:
 *   - conditions is empty
 *   - no API key is configured (caller should treat as silent skip,
 *     not as an error — the visibility flag stays at its default 0)
 *
 * The AI call is intentionally simple — one batch per ~150 rows so
 * the model context stays small and the output JSON stays parseable.
 * Output is a list of row-IDs to hide; everything else is kept.
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
  const apiKey = GEMINI_API_KEYS[0] ?? '';
  if (!apiKey) {
    console.warn('[bankConditionFilter] no Gemini API key — skipping filter');
    return 0;
  }
  const rows = bankTransactionRepo.listByStatement(statementId);
  if (rows.length === 0) return 0;

  // Build the static condition block ONCE — same for every batch so
  // the prompt-cache key is identical across batches.
  const conditionsList = conditions
    .map((c, i) => `${i + 1}. ${c.text.trim().replace(/\s+/g, ' ')}`)
    .join('\n');

  const BATCH = 150;
  const hiddenIds: string[] = [];
  for (let start = 0; start < rows.length; start += BATCH) {
    const slice = rows.slice(start, start + BATCH);
    const batchHidden = await runFilterBatch(slice, conditionsList, apiKey);
    hiddenIds.push(...batchHidden);
  }
  bankTransactionRepo.replaceHiddenSet(statementId, hiddenIds);
  return hiddenIds.length;
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
