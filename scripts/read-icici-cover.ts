/**
 * Pull just the cover / summary lines from page 1 of the ICICI PDF
 * so we can compare against the extracted CSV without re-running the
 * whole bank-statement pipeline.
 */
import fs from 'fs';
import { splitPdfByPages } from '../server/lib/pdfChunker';
import { extractGeminiVision } from '../server/lib/geminiVision';
import { GEMINI_CHAT_MODEL_T1, GEMINI_API_KEYS } from '../server/lib/gemini';

const PDF = 'C:/Users/Prattush/Downloads/ICICI BANK FORMAT-2.pdf';
const buf = fs.readFileSync(PDF);
const chunks = await splitPdfByPages(buf, 1);
console.log('total pages:', chunks.length);
const page1 = chunks[0]!;

const prompt = `This is page 1 of an ICICI bank statement. Read it carefully and return STRICT JSON:

{
  "openingBalance": "<value as printed, e.g. ₹0.02 or 680.44>",
  "closingBalance": "<value as printed>",
  "totalCredits": "<sum of credits as printed in any summary table>",
  "totalDebits": "<sum of debits as printed>",
  "transactionsCount": "<count if printed>",
  "accountType": "<e.g. Savings, Current, Cash Credit>",
  "statementPeriod": "<e.g. 01-Apr-2025 to 31-Mar-2026>",
  "verbatimSummary": "<any 'Statement Summary' or 'Account Summary' lines, exactly as printed>"
}

If a field isn't printed on the page, use null. Do NOT compute anything — only return what is visibly printed on the page. No prose.`;

const result = await extractGeminiVision<{
  openingBalance: string | null;
  closingBalance: string | null;
  totalCredits: string | null;
  totalDebits: string | null;
  transactionsCount: string | null;
  accountType: string | null;
  statementPeriod: string | null;
  verbatimSummary: string | null;
}>(page1.buffer, 'application/pdf', prompt, {
  maxTokens: 2048,
  model: GEMINI_CHAT_MODEL_T1,
});

console.log('GEMINI_API_KEYS loaded:', GEMINI_API_KEYS.length > 0);
console.log('--- Cover summary as Gemini reads it ---');
console.log(JSON.stringify(result.data, null, 2));
console.log('input tokens:', result.inputTokens, ' output tokens:', result.outputTokens);
