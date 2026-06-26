/** Chat reasoning ("thinking") level, persisted across sessions.
 *  'low' = Fast (snappy), 'high' = Deep (Gemini 3 thinks harder — better
 *  for multi-step tax problems, a bit slower). Shared by the composer
 *  toggle (ChatInput) and the send path (useChatManager). */
export type ReasoningLevel = 'low' | 'high';

const KEY = 'chat-reasoning-level';

export function getReasoningLevel(): ReasoningLevel {
  try {
    return localStorage.getItem(KEY) === 'high' ? 'high' : 'low';
  } catch {
    return 'low';
  }
}

export function setReasoningLevel(v: ReasoningLevel): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* localStorage unavailable — fall back to the default each load */
  }
}
