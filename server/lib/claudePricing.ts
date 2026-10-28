/**
 * Claude per-token prices (Anthropic first-party API, USD).
 *
 * Kept in its own dependency-free module so lib/gemini.ts can price
 * Claude rows in costForModel() without importing the Claude client
 * (which pulls in the DB for the admin switch).
 *
 * `inputTokens` follows the Gemini convention used across api_usage:
 * it INCLUDES cached tokens, and `cachedInputTokens` is the subset
 * served from cache. We don't send cache_control yet, so cache writes
 * never happen and need no premium here.
 */

interface ClaudeRate { input: number; output: number; cacheRead: number }

const CLAUDE_RATES: Record<string, ClaudeRate> = {
  'claude-opus-5-5':   { input: 4.00 / 1_000_000, output: 20.00 / 1_000_000, cacheRead: 0.20 / 1_000_000 },
  'claude-sonnet-5-5': { input: 2.00 / 1_000_000, output: 10.00 / 1_000_000, cacheRead: 0.20 / 1_000_000 },
  'claude-haiku-5-5':  { input: 0.10 / 1_000_000, output: 0.50 / 1_000_000,  cacheRead: 0.01 / 1_000_000 },
};

export function isClaudeModel(model: string | null | undefined): boolean {
  return !!model && model.startsWith('claude-');
}

export function costForClaude(model: string, inputTokens: number, outputTokens: number, cachedInputTokens = 0): number {
  // Unknown Claude id (e.g. a CLAUDE_MODEL override) → price as Opus so
  // the dashboard over- rather than under-reports.
  const r = CLAUDE_RATES[model] ?? CLAUDE_RATES['claude-opus-5-5'];
  const cached = Math.max(0, Math.min(cachedInputTokens, inputTokens));
  // Haiku 5.5 bills the whole request at 5× once the prompt passes 100K.
  const mult = model === 'claude-haiku-5-5' && inputTokens > 100_000 ? 5 : 1;
  return ((inputTokens - cached) * r.input + cached * r.cacheRead + outputTokens * r.output) * mult;
}
