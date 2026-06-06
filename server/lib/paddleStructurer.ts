/**
 * Stage 2 of the scanned-PDF pipeline: take the raw, page-segmented
 * OCR text from PaddleOCR and structure it into transaction rows.
 *
 * Why a Gemini text call (not a deterministic parser):
 *   Indian bank statements have ~20 commonly-encountered formats
 *   (ICICI savings, HDFC current, SBI, Axis, Kotak, J&K Bank, BoB,
 *   PNB, plus 5-6 PSU variants and Cash Credit / OD layouts). Hand-
 *   maintaining 20 per-bank regex parsers is a maintenance burden
 *   and each bank tweaks its print format every 12-18 months.
 *
 *   A single text-only Gemini 3.1 Flash-Lite call sees the OCR text
 *   (~5-8K input tokens) and emits JSON rows (~10-20K output tokens).
 *   At $0.25/M in + $1.50/M out, that's ~$0.015-0.020 per statement
 *   — roughly half what Gemini Vision was costing per upload, and
 *   the model has the OCR text already row-aligned so it just needs
 *   to STRUCTURE, not extract.
 *
 * Output schema mirrors what `extractVisionWithFallback` returned so
 * the downstream classifier / validator path doesn't need to change.
 */

import { streamGeminiChat } from './geminiChat.js';
import { GEMINI_CHAT_MODEL_T1, GEMINI_API_KEYS } from './gemini.js';

export interface StructuredOcrRow {
  date: string | null;            // YYYY-MM-DD
  narration: string;
  type: 'credit' | 'debit';
  balance: number | null;
}

export interface StructuredOcrResult {
  transactions: StructuredOcrRow[];
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
}

export async function structureOcrTextIntoRows(
  pages: string[],
): Promise<StructuredOcrResult> {
  const apiKey = GEMINI_API_KEYS[0] ?? '';
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set — cannot structure OCR text');
  }

  // Tag each page so the model can resolve repeated narrations
  // (e.g. recurring UPI to the same VPA) and so we can spot which
  // page the model dropped rows from if diagnostics are needed.
  const combinedText = pages
    .map((p, i) => `=== PAGE ${i + 1} ===\n${p.trim()}`)
    .join('\n\n');

  const prompt = `You receive the OCR text of an Indian bank statement. An OCR engine has already extracted the text page-by-page; your job is to PARSE this text into structured transaction rows.

CRITICAL RULES:
- DO NOT INVENT data. Only output rows that are clearly visible in the OCR text.
- Extract EVERY transaction row you can see. Do not skip rows that look repetitive (recurring UPI, identical amounts) — the user wants the full ledger.
- Skip non-transaction lines: column headers, page headers/footers, "BROUGHT FORWARD" / "B/F" / "OPENING BALANCE" stubs, page totals, watermarks.
- OCR text may have minor errors (rupee symbol mistaken for 7, lowercase l vs digit 1). Apply minimal correction only when the bank-statement context makes the right value obvious (e.g. "balance" column should be a number).
- If a row's date or balance is unreadable, skip the row entirely. Do not guess.

OUTPUT — STRICT JSON, no markdown fences, no prose:
{"transactions": [{"date": "YYYY-MM-DD", "narration": "...", "type": "credit"|"debit", "balance": <number>}, ...]}

FIELD RULES:
- date: ISO YYYY-MM-DD. Convert from the bank's printed format (DD/MM/YYYY, DD-MMM-YY, DD-MMM-YYYY).
- narration: the transaction description, cleaned. Preserve banking codes (UPI/NEFT/IMPS/RTGS/MMT/CAM/CHEQUE/BIL/TRFR) and counterparty names. Drop OCR garbage characters that aren't word characters or common punctuation.
- type: "credit" if money came INTO the account, "debit" if money went OUT. Read the deposit/withdrawal column placement. On a Cash Credit / OD account, "By Cash" / "By Transfer" lines are credits (reducing dr balance) and "To" lines are debits.
- balance: the running balance AFTER this transaction, as a plain number (no commas, no rupee symbol). null only if truly unreadable.
- Do NOT emit "amount" — the server derives it from balance gaps.

OCR TEXT:
${combinedText}`;

  let buffer = '';
  let inputTokens = 0;
  let outputTokens = 0;
  for await (const chunk of streamGeminiChat(
    GEMINI_CHAT_MODEL_T1,
    '',
    [],
    prompt,
    apiKey,
    // 32K output cap — plenty for ~1,200 rows at ~25 tokens each.
    // PaddleOCR-style text input keeps density pressure off the
    // model (it sees what's there, doesn't have to read images),
    // so the same model that drops rows during vision parses
    // cleanly here.
    32768,
    false,
    false,
  )) {
    if (chunk.text) buffer += chunk.text;
    if (typeof chunk.inputTokens === 'number') inputTokens = chunk.inputTokens;
    if (typeof chunk.outputTokens === 'number') outputTokens = chunk.outputTokens;
  }

  const cleaned = buffer
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(
      `Structurer returned no JSON object; first 200 chars: ${cleaned.slice(0, 200)}`,
    );
  }
  let parsed: { transactions?: unknown };
  try {
    parsed = JSON.parse(match[0]) as { transactions?: unknown };
  } catch (e) {
    throw new Error(`Structurer JSON parse failed: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed.transactions)) {
    throw new Error('Structurer output missing "transactions" array');
  }

  const transactions: StructuredOcrRow[] = [];
  for (const row of parsed.transactions as Array<Record<string, unknown>>) {
    if (typeof row !== 'object' || row === null) continue;
    const date = typeof row.date === 'string' ? row.date : null;
    const narration = typeof row.narration === 'string' ? row.narration : '';
    const type = row.type === 'credit' || row.type === 'debit' ? row.type : null;
    const balance =
      typeof row.balance === 'number'
        ? row.balance
        : typeof row.balance === 'string' && row.balance.trim() !== ''
          ? Number(row.balance.replace(/[,\s]/g, ''))
          : null;
    if (!narration || !type) continue;
    transactions.push({
      date,
      narration,
      type,
      balance: balance !== null && Number.isFinite(balance) ? balance : null,
    });
  }

  return {
    transactions,
    inputTokens,
    outputTokens,
    modelUsed: GEMINI_CHAT_MODEL_T1,
  };
}
