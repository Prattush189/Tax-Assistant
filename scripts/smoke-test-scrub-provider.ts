import { scrubProviderName } from '../src/lib/utils';

const cases: Array<[string | null, string]> = [
  ['Upstream "gemini" is temporarily unavailable. Retry in 60s.', 'classic breaker msg'],
  ['Gemini gemini-2.5-flash-lite HTTP 503: high demand', 'provider + model both'],
  ['AI service error 503: rate limit exceeded', 'already-clean friendly msg'],
  ['claude-sonnet-4-5 returned 429', 'claude model'],
  ['Anthropic API rejected the request', 'bare provider name'],
  ['gemini-3.1-flash-lite-preview returned no candidates', 'model only'],
  ['The AI service is temporarily unavailable. Retry in 60s.', 'idempotent'],
  [null, 'null input'],
  ['', 'empty input'],
  ['failed: Gemini Gemini gemini-2.5', 'multiple mentions collapse'],
];

let pass = 0;
let fail = 0;
for (const [input, label] of cases) {
  const result = scrubProviderName(input);
  const leak = /\b(gemini|claude|anthropic)\b/i.test(result);
  if (leak) {
    fail++;
    console.log(`FAIL [${label}]\n  in : ${JSON.stringify(input)}\n  out: ${JSON.stringify(result)}`);
  } else {
    pass++;
    console.log(`pass [${label}]: ${JSON.stringify(input)} -> ${JSON.stringify(result)}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
