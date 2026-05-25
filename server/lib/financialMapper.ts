/**
 * Shared AI-mapper for both CMA and TB → BS wizards. Takes a list
 * of {index, label} row references and a canonical chart of
 * accounts, returns the suggested canonical key per row.
 *
 * Why server-side: the Gemini call needs an API key. Same shape
 * keeps the frontend dumb — it just POSTs labels and renders the
 * answers as if they were heuristic suggestions.
 *
 * Cost: one call per analyze. Typical SME TB is 30-80 rows, fits
 * in a single ~1500-token call. Token quota gated by the route.
 */

import { callGeminiJson } from './geminiJson.js';

export interface MapperRowInput {
  index: number;
  label: string;
}

export interface MapperKeyOption {
  /** Canonical key (the value returned). */
  key: string;
  /** Human-readable label shown alongside the key in the prompt so
   *  the model can match semantically without needing the regex
   *  hints. */
  label: string;
  /** Group hint — helps the model understand context (P&L vs BS). */
  group: string;
}

export interface MapperResult {
  suggestions: Array<{ index: number; key: string | null }>;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Build a single Gemini call that classifies all rows in one go.
 * Returns null for rows the model believes shouldn't map (control
 * accounts, sub-totals already in the chart, opening balance).
 */
export async function aiSuggestMappings(
  rows: MapperRowInput[],
  options: MapperKeyOption[],
  contextNote?: string,
): Promise<MapperResult> {
  if (rows.length === 0) {
    return { suggestions: [], modelUsed: 'no-call', inputTokens: 0, outputTokens: 0 };
  }

  // Build a compact prompt. Each option is one line; each row is
  // one numbered line. The output schema enforces that the response
  // is one row per input index.
  const optionList = options
    .map((o) => `  - ${o.key} | ${o.group} | ${o.label}`)
    .join('\n');
  const rowList = rows
    .map((r) => `${r.index}. ${r.label.slice(0, 200)}`)
    .join('\n');

  const systemPrompt = [
    'You are an Indian chartered accountant classifying ledger account names.',
    'For each row below, pick the SINGLE best canonical key from the option list.',
    'If a row is clearly a sub-total, header, or control account that should NOT appear in financial statements (e.g. "TOTAL", "Suspense Account", "Difference in Trial Balance"), output null.',
    'Use semantic understanding — "Power & Fuel" is an operating expense even though it doesn\'t literally say "expense".',
    contextNote ? `Context: ${contextNote}` : '',
    '',
    'Canonical options (format: key | group | description):',
    optionList,
  ].filter(Boolean).join('\n');

  const userPrompt = [
    'Classify these rows. Output JSON only.',
    '',
    rowList,
    '',
    'Output schema: { "results": [{"index": number, "key": string | null}, ...] }',
    'IMPORTANT: include every row index from the input (in order). Use null for non-mappable rows.',
  ].join('\n');

  const result = await callGeminiJson<{ results?: Array<{ index: unknown; key: unknown }> }>(
    [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ],
    {
      maxTokens: Math.max(2048, rows.length * 40),
      // Use the cheap tier — this is a classification task, not a
      // generation task. flash-lite handles it well and costs a
      // fraction of pro.
      primaryModel: 'gemini-2.5-flash-lite',
    },
  );

  // Sanitise the model response. Allow it to skip rows (we fill
  // those with null), but reject any out-of-range indexes or
  // unknown keys. Defensive — gemini occasionally hallucinates an
  // extra row or invents a key.
  const optionKeys = new Set(options.map((o) => o.key));
  const rowIndexes = new Set(rows.map((r) => r.index));
  const byIndex = new Map<number, string | null>();
  const raw = Array.isArray(result.data?.results) ? result.data!.results! : [];
  for (const entry of raw) {
    const idx = typeof entry.index === 'number' ? entry.index : -1;
    if (!rowIndexes.has(idx)) continue;
    const k = entry.key === null ? null : typeof entry.key === 'string' ? entry.key : null;
    if (k !== null && !optionKeys.has(k)) continue;
    byIndex.set(idx, k);
  }
  const suggestions: MapperResult['suggestions'] = rows.map((r) => ({
    index: r.index,
    key: byIndex.has(r.index) ? byIndex.get(r.index)! : null,
  }));

  return {
    suggestions,
    modelUsed: result.modelUsed,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}
