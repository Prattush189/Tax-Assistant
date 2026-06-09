import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── Indian Number Formatting ──────────────────────────────────────────────

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Show paise IF the amount has a non-zero fractional part, otherwise
 *  no decimals. Right format for transaction-row amounts where most
 *  rows are whole-rupee (₹2,000) but a handful are paisa-precise
 *  (₹5.90 CHRGS, ₹28,966.32 NEFT). Rounding the paisa rows hides
 *  small bank-fee values and makes ₹0.50 look like ₹1. */
export function formatINRSmart(amount: number): string {
  const hasFraction = Math.abs(amount % 1) > 0.0049;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(amount);
}

/** Full Indian-format with paise — for headline numbers where the
 *  user is reconciling against a bank/ledger statement and even a
 *  rupee of drift matters. Compact L/Cr formatting hides up to ₹50K
 *  of difference behind a "₹15.17L" label, which is the wrong UX
 *  on a numbers-must-tie page. */
export function formatINRPrecise(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatINRCompact(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)}Cr`;
  if (amount >= 100000)   return `₹${(amount / 100000).toFixed(2)}L`;
  return formatINR(amount);
}

// ── Error message scrubbing ─────────────────────────────────────────────

/**
 * Strip AI-provider brand names from any user-facing string. Server-side
 * code already takes care to phrase user-facing errors generically (e.g.
 * "The AI service is temporarily unavailable.") but we cannot guarantee
 * every code path is clean — third-party errors, future regressions, and
 * raw upstream response bodies can all leak the word "gemini" / "claude"
 * / a model name. This helper is the last line of defence on the render
 * side: any error string that ends up in the DOM gets washed through it
 * first.
 *
 * Replacements:
 *   - "gemini[-/space anything]" → "AI service"
 *   - "claude[-/space anything]" → "AI service"
 *   - "anthropic" → "AI service"
 *   - Model-prefix tokens like `gemini-2.5-flash-lite`,
 *     `gemini-3.1-flash-lite-preview`, `claude-sonnet-4-5` → "AI service"
 *   - `Upstream "<name>"` → `Upstream service` (defensive — older error
 *     messages may still phrase it this way)
 *
 * Case-insensitive. Preserves the surrounding sentence so dashboard
 * raw-error displays stay readable.
 */
export function scrubProviderName(raw: string | null | undefined): string {
  if (!raw) return '';
  let out = String(raw);
  // Model identifiers first — matched as a brand prefix followed by
  // model-version characters only ([-.\w]), so the substitution stops
  // at the first space / punctuation that ends the model identifier.
  // Avoids the greedy-match bug where "Gemini gemini-2.5-flash-lite HTTP
  // 503" would eat past the model name into context.
  out = out.replace(/\b(?:gemini|claude)[-.][\w.-]+/gi, 'AI service');
  // Bare provider mentions (no model suffix).
  out = out.replace(/\b(?:gemini|claude|anthropic)\b/gi, 'AI service');
  // "Upstream "<name>"" idiom (legacy circuit-breaker error format).
  // After the bare-word replacement above the inner string is already
  // "AI service" — but the leading "Upstream" + quotes leak a brand-
  // shaped phrasing. Collapse to a clean "AI service is ...".
  out = out.replace(/\bUpstream\s+["']?AI service["']?/gi, 'AI service');
  // Collapse repeated "AI service AI service" runs the substitutions
  // above can create (e.g. "Gemini Gemini gemini-2.5" first becomes
  // "AI service AI service AI service" — collapse to one).
  out = out.replace(/(\bAI service\b)(\s+AI service\b)+/g, '$1');
  return out;
}

// ── Date Formatting ─────────────────────────────────────────────────────

/**
 * Format any date-like value as DD/MM/YYYY.
 * Accepts ISO strings ("2025-07-31"), epoch ms, or Date objects.
 * Returns an empty string for invalid/falsy input.
 */
export function formatDate(input: string | number | Date | null | undefined): string {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
