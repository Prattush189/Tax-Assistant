/**
 * ITR JSON Schema validator (CBDT Draft-04 schemas).
 *
 * Schemas are loaded + compiled once at module import time and cached.
 * Module-load is safe: if a schema file is missing we log a warning and
 * return a no-op validator so the rest of the server still boots (matches
 * the pattern used for gemini.ts after the 2026-04-11 load-crash fix).
 */
import Ajv, { ErrorObject, ValidateFunction } from 'ajv-draft-04';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemasDir = path.join(__dirname, 'schemas');

export type ItrFormType = 'ITR1' | 'ITR4';

export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    path: string;
    message: string;
    params?: Record<string, unknown>;
  }>;
}

function loadSchema(fileName: string): object | null {
  const schemaPath = path.join(schemasDir, fileName);
  if (!fs.existsSync(schemaPath)) {
    console.warn(`[ITR] Schema not found: ${schemaPath} — validator disabled for this form`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  } catch (err) {
    console.error(`[ITR] Failed to parse schema ${fileName}:`, err);
    return null;
  }
}

// Ajv Draft-04 instance — allErrors to collect everything in one pass; strict
// is off because CBDT schemas use `$schema` and `allOf`+`pattern` combinations
// that trip ajv's strict mode.
const ajv = new Ajv({
  allErrors: true,
  strict: false,
});

const itr1Schema = loadSchema('itr1.schema.json');
const itr4Schema = loadSchema('itr4.schema.json');

let validateItr1Fn: ValidateFunction | null = null;
let validateItr4Fn: ValidateFunction | null = null;

try {
  if (itr1Schema) {
    validateItr1Fn = ajv.compile(itr1Schema);
    console.log('[ITR] ITR-1 schema compiled');
  }
} catch (err) {
  console.error('[ITR] Failed to compile ITR-1 schema:', err);
}

try {
  if (itr4Schema) {
    validateItr4Fn = ajv.compile(itr4Schema);
    console.log('[ITR] ITR-4 schema compiled');
  }
} catch (err) {
  console.error('[ITR] Failed to compile ITR-4 schema:', err);
}

function formatErrors(errors: ErrorObject[] | null | undefined): ValidationResult['errors'] {
  if (!errors) return [];
  return errors.map((e) => ({
    path: e.instancePath || e.schemaPath || '(root)',
    message: e.message ?? 'unknown error',
    params: e.params as Record<string, unknown> | undefined,
  }));
}

function validateWith(fn: ValidateFunction | null, payload: unknown): ValidationResult {
  if (!fn) {
    return {
      valid: false,
      errors: [{ path: '(root)', message: 'Validator not available — schema failed to load' }],
    };
  }
  const ok = fn(payload);
  if (ok) return { valid: true, errors: [] };
  return { valid: false, errors: formatErrors(fn.errors) };
}

export function validateItr1(payload: unknown): ValidationResult {
  return validateWith(validateItr1Fn, payload);
}

export function validateItr4(payload: unknown): ValidationResult {
  return validateWith(validateItr4Fn, payload);
}

export function validateItr(formType: ItrFormType, payload: unknown): ValidationResult {
  if (formType === 'ITR1') return validateItr1(payload);
  if (formType === 'ITR4') return validateItr4(payload);
  return {
    valid: false,
    errors: [{ path: '(root)', message: `Unknown form type: ${String(formType)}` }],
  };
}
