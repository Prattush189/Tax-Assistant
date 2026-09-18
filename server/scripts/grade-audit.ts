import 'dotenv/config';
import fs from 'fs/promises';
import { GEMINI_API_KEY_RAW } from '../lib/gemini.js';

const SYSTEM_PROMPT = `You are a senior Indian Chartered Accountant acting as a STRICT-BUT-FAIR quality
auditor for an AI tax chatbot. You are given a (question, answer) pair that the
chatbot produced. Your job is to decide whether the ANSWER is correct and safe
to rely on under Indian tax/finance law, and to flag errors precisely.

CONTEXT
- Jurisdiction: India. Default year FY 2025-26 / AY 2026-27 unless the question
  fixes another year. IT Act 1961 still governs FY 2025-26; the IT Act 2025
  (effective 1 Apr 2026) renumbers sections — a section-number change alone is
  NOT an error if the substance is right.
- Verify any rate, threshold, limit, due date, or section the answer asserts.
  Use web search / authoritative sources (incometax.gov.in, cbic-gst.gov.in,
  the bare Acts, CBDT/CBIC circulars) before grading. Trust authoritative
  sources over your own memory; tax law changes every Budget.

HOW TO GRADE — assign exactly one verdict:
- "ok"    : the answer's substantive tax conclusion is correct. Minor wording,
            extra caveats, verbosity, missing citations, or old-vs-new section
            numbering do NOT make it wrong. An answer that explains a rule
            ("gifts from non-relatives are taxable above Rs.50,000") and then
            correctly applies it is "ok".
- "wrong" : the answer states a materially incorrect tax position — wrong rate,
            wrong eligibility, wrong exemption/limit, wrong section that changes
            the substance, or a wrong yes/no conclusion.
- "risky" : not outright wrong, but materially incomplete or misleading in a way
            that could cause a taxpayer to act incorrectly (e.g. omits a
            critical condition, gives one regime's number as universal,
            over-confident where the law is genuinely uncertain).
- "na"    : cannot fairly grade — the question is not a tax/finance factual
            question, is chit-chat, is too vague, OR 'hadAttachment' is true and
            the answer clearly depended on a document you cannot see.

CALIBRATION (avoid false positives — they erode trust in the audit):
- Default to "ok" when the conclusion is right. Only escalate on a CONCRETE,
  checkable error you can name.
- Watch the known traps the chatbot may get wrong AND that weak sources online
  get wrong — judge these on the actual statute, e.g.:
  * "Relative" for gift exemption [Explanation to s.56(2)(x)] is a CLOSED list
    that INCLUDES the spouse of a brother/sister/parent's-sibling. So a gift
    from sister's husband (jija), brother's wife (bhabhi), spouse's siblings and
    their spouses, and in-laws is EXEMPT. Cousins / nephews / nieces are NOT
    relatives. Do not mark a correct "exempt" answer as wrong here.
  * New-regime slabs/rebate (s.87A up to Rs.60,000 / Rs.12,00,000 income for
    FY 2025-26), LTCG 12.5% with Rs.1,25,000 exemption (post 23-Jul-2024),
    STCG 20% on equity, crypto 30% u/s 115BBH, no set-off of crypto losses.
- If you are not sure after searching, use "risky" with low severity and say so
  in 'issue' — do not guess "wrong".

SEVERITY (only for "wrong"/"risky"; use null for "ok"/"na"):
- "high"   : likely to cause a wrong filing, a penalty, or a significant
             rupee error.
- "medium" : real error but lower stakes or easily caught.
- "low"    : minor inaccuracy / imprecision.

OUTPUT
Return ONLY a JSON object for the pair (no prose, no markdown fence), shape:
{
  "answerId": <number, copy from input>,
  "verdict": "ok" | "wrong" | "risky" | "na",
  "severity": "low" | "medium" | "high" | null,
  "issue": <string one-liner naming the error, or null if verdict is "ok"/"na">,
  "correction": <string: the corrected answer in 1-3 sentences, or null>
}
`;

// Usage: npx tsx server/scripts/grade-audit.ts <chat-audit-export.json> [maxPairs]
// Writes <input>-judged.json next to the input and resumes from it, so an
// interrupted run never re-pays for pairs already graded. User-reported
// answers are graded first. Cost: one grounded Gemini 3.8 call per pair.
async function main() {
  const inputPath = process.argv[2];
  const maxPairs = Number(process.argv[3] ?? Infinity);
  if (!inputPath) throw new Error('Usage: npx tsx server/scripts/grade-audit.ts <chat-audit-export.json> [maxPairs]');
  const outputPath = inputPath.replace(/\.json$/i, '') + '-judged.json';

  const resumeFrom = await fs.readFile(outputPath, 'utf-8').catch(() => null);
  console.log('Reading ' + (resumeFrom ? outputPath + ' (resuming)' : inputPath));
  const payload = JSON.parse(resumeFrom ?? await fs.readFile(inputPath, 'utf-8'));

  const pairs = [...payload.pairs].sort((a: any, b: any) => Number(!!b.userReported) - Number(!!a.userReported));
  const todo = pairs.filter((p: any) => !p.verdict).slice(0, maxPairs);
  console.log(pairs.length + ' pairs, ' + todo.length + ' to grade.');

  const API_KEY = GEMINI_API_KEY_RAW || process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    throw new Error('GOOGLE_AI_API_KEY / GEMINI_API_KEY is not set');
  }

  const MODEL_NAME = 'gemini-3.8-flash';
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL_NAME + ':generateContent';

  let count = 0;
  for (const pair of todo) {
    count++;
    console.log('Grading ' + count + '/' + todo.length + ' (answerId: ' + pair.answerId + (pair.userReported ? ', reported: ' + pair.userReported : '') + ')...');

    const userPrompt = 'Grade this chatbot answer.\n\nanswerId: ' + pair.answerId + '\nhadAttachment: ' + pair.hadAttachment + '\n\nQUESTION:\n' + pair.question + '\n\nANSWER:\n' + pair.answer + '\n';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents: [{
            role: 'user',
            parts: [{ text: userPrompt }]
          }],
          tools: [
            { googleSearch: {} }
          ]
        })
      });

      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' ' + await response.text());
      }

      const resJson = await response.json();
      const parts: Array<{ text?: string; thought?: boolean }> = resJson.candidates?.[0]?.content?.parts ?? [];
      const text = parts.filter(p => !p.thought && p.text).map(p => p.text).join('') || '{}';
      // JSON mode can't be combined with search grounding, so pull the
      // object out of the text.
      const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      
      pair.verdict = parsed.verdict ?? null;
      pair.severity = parsed.severity ?? null;
      pair.issue = parsed.issue ?? null;
      pair.correction = parsed.correction ?? null;

    } catch (err: any) {
      console.error('Error on answerId ' + pair.answerId + ':', err.message);
    }

    // Checkpoint after every pair so a crash or Ctrl+C loses nothing.
    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf-8');
    await new Promise(r => setTimeout(r, 2000));
  }

  const tally: Record<string, number> = {};
  for (const p of payload.pairs) tally[p.verdict ?? 'ungraded'] = (tally[p.verdict ?? 'ungraded'] ?? 0) + 1;
  console.log('Done! ' + JSON.stringify(tally) + ' -> ' + outputPath);
}

main().catch(console.error);
