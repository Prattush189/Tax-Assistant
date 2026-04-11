/**
 * Extracts enum + description data from the CBDT ITR schemas into TypeScript
 * modules consumable by the client and server.
 *
 * Output:
 *   server/lib/itr/enums/states.ts        — 38 Indian state codes + labels
 *   server/lib/itr/enums/countries.ts     — ~250 country codes + labels
 *   server/lib/itr/enums/natureOfBusiness.ts — CBDT business/profession codes (ITR-4)
 *   server/lib/itr/enums/sections.ts      — TDS section codes pulled from ITR-1
 *
 * Labels are parsed from the JSON Schema `description` fields, which follow the
 * format "CODE:Label; CODE:Label; ...".
 *
 * Run: npm run itr:enums
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemasDir = path.join(__dirname, '..', 'lib', 'itr', 'schemas');
const enumsDir = path.join(__dirname, '..', 'lib', 'itr', 'enums');

if (!fs.existsSync(enumsDir)) {
  fs.mkdirSync(enumsDir, { recursive: true });
}

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;
interface Option {
  code: string;
  label: string;
}

function load(name: string): Json {
  return JSON.parse(fs.readFileSync(path.join(schemasDir, name), 'utf-8')) as Json;
}

/**
 * Walks a JSON Schema tree and invokes the visitor on every sub-object that
 * contains an `enum` array and a `description` string.
 */
function walk(node: unknown, visitor: (node: Record<string, unknown>) => void): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visitor);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.enum) && typeof obj.description === 'string') {
    visitor(obj);
  }
  for (const v of Object.values(obj)) walk(v, visitor);
}

/**
 * Parses a description like "01-Andaman; 02-AP; ..." or "CODE:Label; CODE:Label"
 * or the comma-separated NoB variant "01001 - Tea , 01002 - Coffee , ..." into
 * [{code, label}] records. Tolerates both colon- and hyphen-separated variants
 * that appear throughout the CBDT schemas.
 */
function parseDescription(desc: string): Map<string, string> {
  const result = new Map<string, string>();
  // Primary split: semicolons.
  let parts = desc.split(';');
  // Fallback: comma-space-digits (NoB style). Split at ` , ` only when followed
  // by a 5-digit code or a short alnum code followed by a dash, so labels with
  // natural commas survive.
  if (parts.length < 5) {
    parts = desc.split(/\s*,\s*(?=[A-Z0-9_]{2,6}\s*[-:])/);
  }
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const m = /^([^:\-]+?)[:\-]\s*(.+)$/.exec(p);
    if (!m) continue;
    const code = m[1].trim();
    const label = m[2].trim().replace(/\s+/g, ' ');
    if (code && label) {
      if (!result.has(code)) result.set(code, label);
    }
  }
  return result;
}

/**
 * Finds the schema subtree whose enum values exactly match a known "anchor"
 * set. Used to locate the canonical StateCode / CountryCode / NatOfBusinessCode
 * nodes when there are multiple enums in the schema.
 */
function findEnumByAnchor(
  schema: Json,
  anchors: string[],
): Record<string, unknown> | null {
  let best: Record<string, unknown> | null = null;
  let bestSize = 0;
  walk(schema, (node) => {
    const values = (node.enum as string[]).map((v) => String(v));
    const anchorHits = anchors.filter((a) => values.includes(a)).length;
    if (anchorHits === anchors.length && values.length > bestSize) {
      best = node;
      bestSize = values.length;
    }
  });
  return best;
}

function nodeToOptions(node: Record<string, unknown>): Option[] {
  const values = (node.enum as string[]).map((v) => String(v));
  const labels = parseDescription(String(node.description));
  return values.map((code) => ({
    code,
    label: labels.get(code) ?? code,
  }));
}

function emitModule(fileName: string, constName: string, options: Option[], header: string) {
  const lines: string[] = [];
  lines.push('/* eslint-disable */');
  lines.push('/**');
  lines.push(' * Auto-generated from CBDT ITR JSON schema.');
  lines.push(' * Do not edit manually — run `npm run itr:enums` instead.');
  lines.push(` * ${header}`);
  lines.push(' */');
  lines.push('');
  lines.push('export interface ItrEnumOption {');
  lines.push('  code: string;');
  lines.push('  label: string;');
  lines.push('}');
  lines.push('');
  lines.push(`export const ${constName}: readonly ItrEnumOption[] = [`);
  for (const opt of options) {
    const label = opt.label.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    lines.push(`  { code: ${JSON.stringify(opt.code)}, label: ${JSON.stringify(label)} },`);
  }
  lines.push('] as const;');
  lines.push('');
  lines.push(`export type ${constName}Code = typeof ${constName}[number]['code'];`);
  lines.push('');
  fs.writeFileSync(path.join(enumsDir, fileName), lines.join('\n'), 'utf-8');
  console.log(`[itr:enums] wrote ${fileName} (${options.length} options)`);
}

function main() {
  const itr1 = load('itr1.schema.json');
  const itr4 = load('itr4.schema.json');

  // State codes — anchor on Delhi (09), Karnataka (15), Maharashtra (19)
  const stateNode = findEnumByAnchor(itr1, ['09', '15', '19', '99']);
  if (!stateNode) throw new Error('Could not locate StateCode enum');
  emitModule(
    'states.ts',
    'STATES',
    nodeToOptions(stateNode),
    'Indian state codes (incl. UTs + 99:Foreign). Used in PersonalInfo.Address.StateCode and donee addresses.',
  );

  // Country codes — anchor on India (91), US (2), UK (44)
  const countryNode = findEnumByAnchor(itr1, ['91', '2', '44']);
  if (!countryNode) throw new Error('Could not locate CountryCode enum');
  emitModule(
    'countries.ts',
    'COUNTRIES',
    nodeToOptions(countryNode),
    'Country calling codes per CBDT enum. Used in PersonalInfo.Address.CountryCode.',
  );

  // Nature of Business / Profession — ITR-4 specific. The 44AD nature codes
  // live under CodeAD (~350 5-digit codes). Profession (44ADA) codes live
  // under CodeADA. Transport (44AE) uses a much shorter code set. We collect
  // the union across all large enums whose codes are 5-digit numeric strings.
  const nobMap = new Map<string, string>();
  walk(itr4, (node) => {
    const values = (node.enum as unknown[]).map(String);
    if (values.length < 20) return;
    const digit5 = values.filter((v) => /^\d{5}/.test(v));
    if (digit5.length < 20) return;
    for (const [code, label] of parseDescription(String(node.description))) {
      if (!nobMap.has(code)) nobMap.set(code, label);
    }
  });
  const nobOptions: Option[] = Array.from(nobMap, ([code, label]) => ({ code, label }))
    .sort((a, b) => a.code.localeCompare(b.code));
  emitModule(
    'natureOfBusiness.ts',
    'NATURE_OF_BUSINESS',
    nobOptions,
    'CBDT Nature-of-Business / Profession codes for ITR-4 presumptive schemes (44AD / 44ADA / 44AE).',
  );

  // TDS Section codes — these live in many places. Collect unique values from
  // the TDSonOthThanSals nodes in both schemas.
  const sectionSet = new Map<string, string>();
  for (const schema of [itr1, itr4]) {
    walk(schema, (node) => {
      const desc = String(node.description);
      if (desc.includes('194A') || desc.includes('194C') || desc.includes('192')) {
        for (const [code, label] of parseDescription(desc)) {
          if (!sectionSet.has(code)) sectionSet.set(code, label);
        }
      }
    });
  }
  const sectionOptions: Option[] = Array.from(sectionSet, ([code, label]) => ({ code, label }))
    .sort((a, b) => a.code.localeCompare(b.code));
  emitModule(
    'sections.ts',
    'TDS_SECTIONS',
    sectionOptions,
    'TDS section codes referenced in ITR schemas. Aligned with tdsEngine.ts sections where possible.',
  );

  console.log('[itr:enums] done');
}

try {
  main();
} catch (err) {
  console.error('[itr:enums] failed:', err);
  process.exit(1);
}
