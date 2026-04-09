/**
 * validate-golden.ts
 *
 * Validation harness for Phase 10: Scoring & Integration Validation (Plan 01)
 * Runs 15 golden queries against live RAG and reports pass/fail per query.
 * Also confirms SCOR-01 (topK=5) and SCOR-02 (human-readable source labels).
 *
 * Usage:         npx tsx server/rag/validate-golden.ts
 * Debug mode:    RAG_DEBUG=1 npx tsx server/rag/validate-golden.ts
 *
 * Exits 0 if all checks pass, 1 if any fail.
 * NOTE: Some baseline failures are expected before Plan 02 scoring tuning.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initRAG, retrieveContextWithRefs } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Types ──

interface GoldenQuery {
  id: string;
  query: string;
  expectedDomain: string;
  expectedSources: string[];
  expectedSectionRefs: string[];
  expectedValues?: string[];
  notes: string;
}

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

// ── Helpers ──

const DEBUG = process.env.RAG_DEBUG === '1';

function check(name: string, passed: boolean, detail: string): CheckResult {
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}`);
  if (!passed) {
    console.log(`       Detail: ${detail}`);
  }
  return { name, passed, detail };
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Main ──

async function main(): Promise<void> {
  console.log('=== Golden Query Validation — Phase 10 Baseline ===\n');

  // Load golden queries
  const goldenQueries: GoldenQuery[] = JSON.parse(
    readFileSync(join(__dirname, '..', 'data', 'golden-queries.json'), 'utf-8')
  );
  console.log(`Loaded ${goldenQueries.length} golden queries from golden-queries.json\n`);

  // Initialize RAG
  console.log('Initializing RAG...');
  initRAG();
  console.log('');

  const results: CheckResult[] = [];

  // ── SCOR-01: Confirm topK=5 returns exactly 5 chunks ──
  {
    console.log('--- SCOR-01: topK=5 confirmation ---');
    const scor01Result = retrieveContextWithRefs('income tax', 5);
    const chunkCount = scor01Result?.references.length ?? 0;
    results.push(check(
      'SCOR-01: topK=5 returns 5 chunks',
      chunkCount === 5,
      `returned ${chunkCount} chunks (expected 5)`
    ));
    console.log('');
  }

  // ── Per-query checks ──
  const tokenCounts: number[] = [];

  for (const q of goldenQueries) {
    console.log(`--- ${q.id}: ${q.query.slice(0, 60)}${q.query.length > 60 ? '...' : ''} ---`);

    const result = retrieveContextWithRefs(q.query, 5);

    if (!result || result.references.length === 0) {
      results.push(check(
        `${q.id}: returned results`,
        false,
        'No results returned from RAG'
      ));
      console.log('');
      continue;
    }

    const refs = result.references;

    // Track token budget
    const totalChars = refs.reduce((sum, r) => sum + r.text.length, 0);
    const queryTokens = approxTokens(refs.reduce((acc, r) => acc + r.text, ''));
    tokenCounts.push(queryTokens);

    // Debug output: per-chunk detail
    if (DEBUG) {
      console.log(`  [DEBUG] ${refs.length} chunks returned:`);
      refs.forEach((r, i) => {
        const sectionLabel = r.section.slice(0, 50);
        console.log(`    ${i + 1}. source=${r.source} | section=${sectionLabel} | ~chars=${r.text.length}`);
      });
    }

    // Check 1: Source match — at least one expectedSource appears in results
    const actualSources = refs.map(r => r.source);
    const sourceMatch = q.expectedSources.some(s => actualSources.includes(s));
    results.push(check(
      `${q.id}: expected source present`,
      sourceMatch,
      `expected one of [${q.expectedSources.join(', ')}] — got [${actualSources.join(', ')}]`
    ));

    // Check 2: SCOR-02 — all returned refs have human-readable labels (not raw source IDs)
    const badLabels = refs.filter(r => !r.label || r.label === r.source);
    const labelsOk = badLabels.length === 0;
    results.push(check(
      `${q.id}: source labels are human-readable`,
      labelsOk,
      labelsOk
        ? `all ${refs.length} refs have proper labels`
        : `bad labels: ${badLabels.map(r => `source=${r.source} label="${r.label}"`).join(', ')}`
    ));

    // Check 3: Value match (if expectedValues defined and non-empty)
    if (q.expectedValues && q.expectedValues.length > 0) {
      for (const expectedValue of q.expectedValues) {
        const allText = refs.map(r => r.text).join(' ');
        const valueFound = allText.includes(expectedValue);
        results.push(check(
          `${q.id}: expected value '${expectedValue}' found in results`,
          valueFound,
          valueFound
            ? 'value found'
            : `value '${expectedValue}' not found in any of the ${refs.length} returned chunks`
        ));
      }
    }

    console.log('');
  }

  // ── Token budget summary ──
  console.log('--- Token Budget Report ---');
  if (tokenCounts.length > 0) {
    const avgTokens = Math.round(tokenCounts.reduce((a, b) => a + b, 0) / tokenCounts.length);
    const maxTokens = Math.max(...tokenCounts);
    const TARGET = 3000;
    const budgetPass = avgTokens <= TARGET;
    const maxWarn = maxTokens > TARGET;

    results.push(check(
      `Token budget: avg=${avgTokens} max=${maxTokens} target=${TARGET}`,
      budgetPass,
      budgetPass
        ? `Average within budget (${avgTokens} <= ${TARGET})`
        : `Average ${avgTokens} exceeds target ${TARGET}`
    ));

    if (budgetPass && maxWarn) {
      console.log(`       [WARN] Worst-case ${maxTokens} tokens exceeds target=${TARGET} even though average passes`);
    }
  } else {
    console.log('[SKIP] No token counts collected — all queries returned empty results');
  }

  console.log('');

  // ── Final summary ──
  console.log('=== Summary ===');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailed checks (expected baseline failures before Plan 02 tuning):');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}`);
      console.log(`    ${r.detail}`);
    });
    process.exit(1);
  } else {
    console.log('\nAll checks PASSED.');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Validation script error:', err);
  process.exit(1);
});
