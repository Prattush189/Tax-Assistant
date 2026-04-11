/**
 * Regenerates TypeScript interfaces from the CBDT ITR JSON schemas.
 * Run with: npm run itr:types
 *
 * The generated files live at server/lib/itr/types/Itr1.ts and Itr4.ts.
 * They are committed to the repo. Re-run whenever CBDT ships an updated schema.
 */
import { compileFromFile } from 'json-schema-to-typescript';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemasDir = path.join(__dirname, '..', 'lib', 'itr', 'schemas');
const typesDir = path.join(__dirname, '..', 'lib', 'itr', 'types');

if (!fs.existsSync(typesDir)) {
  fs.mkdirSync(typesDir, { recursive: true });
}

const options = {
  bannerComment:
    '/* eslint-disable */\n/**\n * Auto-generated from CBDT ITR JSON schema.\n * Do not edit manually — run `npm run itr:types` instead.\n */\n',
  style: {
    singleQuote: true,
    semi: true,
  },
  additionalProperties: false,
  unreachableDefinitions: true,
};

async function generate(schemaFile: string, outFile: string, rootName: string) {
  const schemaPath = path.join(schemasDir, schemaFile);
  const outPath = path.join(typesDir, outFile);
  console.log(`[itr:types] ${schemaFile} -> ${outFile} (root: ${rootName})`);
  const ts = await compileFromFile(schemaPath, { ...options, cwd: schemasDir });
  fs.writeFileSync(outPath, ts, 'utf-8');
  console.log(`[itr:types] wrote ${outPath} (${ts.split('\n').length} lines)`);
}

async function main() {
  await generate('itr1.schema.json', 'Itr1.ts', 'Itr1Root');
  await generate('itr4.schema.json', 'Itr4.ts', 'Itr4Root');
  console.log('[itr:types] done');
}

main().catch((err) => {
  console.error('[itr:types] failed:', err);
  process.exit(1);
});
