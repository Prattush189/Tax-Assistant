/**
 * Typical credits per action at the full rate — the client's fallback
 * until the server's numbers (GET usage → credits.estimates, from
 * server/lib/credits.ts CREDIT_ESTIMATES) have loaded. Keep in step with
 * that file; the server's numbers win whenever they are present.
 *
 * Chat runs on Gemini; notices, documents, bank statements and ledgers
 * on Claude Sonnet 5.5 with web search (since 2026-11-13).
 */
export const CREDIT_ESTIMATES_FALLBACK: Readonly<Record<string, number>> = {
  chat_fast: 1,
  chat_deep: 8,
  notice_draft: 70,
  notice_pdf_read: 25,
  bank_statement: 15,
  ledger_scrutiny: 200,
};
