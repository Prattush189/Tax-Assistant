/**
 * Strip hallucinated `[cite: …]` tokens from chat output.
 *
 * With Search grounding on, Gemini 3.x sometimes emits machine-style
 * citation tokens instead of the prose `(per …)` form the prompt asks
 * for. Production shows three shapes, none of which reference anything
 * we can resolve:
 *   [cite: 1.2.2]                       dotted numerics
 *   [cite: Section 139(8A) of the …]    free text
 *   [cite: WhatsApp Image ….jpeg]       the user's OWN attachment name
 * They were streamed straight to the user and persisted verbatim. The
 * real grounding sources arrive separately in groundingMetadata and are
 * surfaced beneath the answer, so these tokens carry no information.
 *
 * Two entry points:
 *   stripCiteMarkers(text)  — full-pass, for the persisted message.
 *   CiteMarkerStreamFilter  — chunk-safe, for the live SSE stream. A
 *     marker can straddle chunk boundaries ("… [ci" + "te: 1.2.2] …"),
 *     so the filter holds back a trailing fragment that could still be
 *     the start of a marker and releases it once it is known not to be.
 */

const MARKER = /\[cite:[^\]]*\]/g;
const PREFIX = '[cite:';

/** Remove complete markers and tidy the whitespace they leave behind. */
export function stripCiteMarkers(text: string): string {
  if (!text.includes(PREFIX)) return text;
  return text
    .replace(MARKER, '')
    // "text [cite: x]." -> "text."   /   "a [cite: x], b" -> "a, b"
    .replace(/[ \t]+([.,;:)\]])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

/** True when `tail` could still grow into a `[cite:` marker. */
function couldBeMarkerStart(tail: string): boolean {
  return tail.length < PREFIX.length ? PREFIX.startsWith(tail) : tail.startsWith(PREFIX);
}

export class CiteMarkerStreamFilter {
  private carry = '';

  /** Feed a chunk; returns the text safe to emit now. */
  push(chunk: string): string {
    const pending = this.carry + chunk;
    this.carry = '';
    if (!pending.includes('[')) return pending;

    const cleaned = pending.replace(MARKER, '');
    // Anything after the last '[' that has no closing ']' yet is a
    // candidate fragment. Hold it back only if it can still become a
    // marker — a lone "[" or "[ci" qualifies; "[Source" does not.
    const open = cleaned.lastIndexOf('[');
    if (open === -1) return cleaned;
    const tail = cleaned.slice(open);
    if (tail.includes(']') || !couldBeMarkerStart(tail)) return cleaned;
    this.carry = tail;
    return cleaned.slice(0, open);
  }

  /** End of stream: release whatever is held. An unterminated marker
   *  fragment at the very end is garbage and is dropped; a plain "[" is
   *  returned untouched. */
  flush(): string {
    const tail = this.carry;
    this.carry = '';
    if (!tail) return '';
    return tail.startsWith(PREFIX) ? '' : tail;
  }
}
