/**
 * Typical credits per action at the NORMAL (Gemini) price — the client's
 * fallback until the server's numbers (GET usage -> credits.estimates,
 * from server/lib/credits.ts CREDIT_ESTIMATES) have loaded. Keep in step
 * with that file; the server's numbers win whenever they are present.
 * During the launch offer the non-chat ones are halved on screen
 * (src/lib/launchOffer.ts offerFactorFor).
 */
export const CREDIT_ESTIMATES_FALLBACK: Readonly<Record<string, number>> = {
  chat_fast: 1,
  chat_deep: 8,
  notice_draft: 4,
  notice_pdf_read: 2,
  bank_statement: 3,
  ledger_scrutiny: 27,
};
