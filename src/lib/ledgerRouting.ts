/**
 * Where an uploaded ledger goes — there is no column-mapping screen. An
 * accounting-software rule whose rows are usable (transactions, account
 * headers or a named party) and not contradicted by the ledger's own
 * running balances is submitted as is; any other digital ledger goes to
 * the server's AI reader and is filed in Format Support Requests so a
 * rule can be added. Scans go to the AI reader too (vision), after the
 * uploader's cost confirmation.
 *
 * Pure decisions only (no UI), shared by the single-ledger uploader and
 * the compare view, and run over every sample by
 * scripts/smoke-ledger-routing.mts.
 */
import { gridLog } from './gridDebug';
import {
  applyMapping,
  mappedRowsBalanceAgreement,
  mappedRowsToExtractedLedger,
  suggestMapping,
  type ColumnMapping,
  type MappedRow,
  type PdfGrid,
} from './pdfGrid';
import { detectAndMapLedgerErp } from './perLedgerErpRules';
import type { LedgerFormatMeta } from '../services/api';

export type LedgerMapCheck = ReturnType<typeof mapLedger>;

export type LedgerRoute =
  /** Mapped in the browser: submit `checked.extracted` (pre-extracted). */
  | { kind: 'mapped'; software: string; checked: LedgerMapCheck }
  /** The server's AI reader (PDF text, sheet text, or vision for a scan).
   *  `meta` absent = a scan: confirm the cost, nothing to file. */
  | { kind: 'reader'; meta?: LedgerFormatMeta };

/** Running-balance agreement per account: balances restart at every
 *  account header, so each consecutive run of one account is walked on
 *  its own (and may run Dr- or Cr-wise). */
export function ledgerRowsBalanceAgreement(rows: MappedRow[]): { checkpoints: number; agreeing: number } {
  let checkpoints = 0;
  let agreeing = 0;
  let start = 0;
  for (let i = 1; i <= rows.length; i++) {
    if (i === rows.length || rows[i].account !== rows[start].account) {
      const a = mappedRowsBalanceAgreement(rows.slice(start, i));
      checkpoints += a.checkpoints;
      agreeing += a.agreeing;
      start = i;
    }
  }
  return { checkpoints, agreeing };
}

/** Single-account exports (Tally / Finsys "Ledger Account : <NAME>"
 *  banner with ONE party) carry the party in the banner, not in
 *  account-separator rows. */
export function partyFromBanner(grid: PdfGrid): string | undefined {
  const bannerText = grid.rows.slice(0, 30).flat().filter(Boolean).join(' ');
  const partyMatch = /(?:ledger\s+account|account|statement\s+of\s+account|acc\s*[:.])\s*[:.]?\s*([A-Z][A-Z0-9 &.,'\-/()]{3,80})/i.exec(bannerText);
  return partyMatch?.[1]?.trim().replace(/\s{2,}/g, ' ');
}

/** Apply a mapping, build the ledger, and test it. `usable`: it has
 *  transactions and either account headers or a party name (one
 *  "Default" account would audit a multi-account book as one account
 *  and produce wrong totals). `contradicted` / `proven`: enough running
 *  balances to judge, and too few / nearly all of them agree. */
export function mapLedger(grid: PdfGrid, mapping: ColumnMapping) {
  const mapped = applyMapping(grid, mapping, 'ledger');
  const { checkpoints, agreeing } = ledgerRowsBalanceAgreement(mapped.rows);
  const party = partyFromBanner(grid);
  const extracted = mapped.rows.length > 0 ? mappedRowsToExtractedLedger(mapped.rows, party) : null;
  const noAccounts = !!extracted && extracted.accounts.length === 1 && extracted.accounts[0].name === 'Default' && !party;
  const enough = checkpoints >= 5;
  return {
    mapped,
    extracted,
    checkpoints,
    agreeing,
    noAccounts,
    usable: mapped.rows.length > 0 && !noAccounts,
    contradicted: enough && agreeing < checkpoints * 0.9,
    proven: enough && agreeing >= checkpoints * 0.9,
  };
}

function describeMiss(c: LedgerMapCheck): string {
  if (c.mapped.rows.length === 0) return 'mapped no rows';
  if (c.noAccounts) return 'found no account headers or party name';
  if (c.checkpoints < 5) return `only ${c.checkpoints} running balance(s) to check it against`;
  return `only ${c.agreeing}/${c.checkpoints} running balances agree`;
}

/** Software named in an unrecognised ledger's banner, for the filed
 *  format request ("Tally (layout not recognised)"). */
const SOFTWARE_NAMES: Array<[RegExp, string]> = [
  [/\btally\b/i, 'Tally'], [/\bbusy\b/i, 'Busy'], [/\bmarg\b/i, 'Marg'], [/\bfinsys\b/i, 'Finsys'],
  [/\bzoho\b/i, 'Zoho Books'], [/\bvyapar\b/i, 'Vyapar'], [/\bsaral\b/i, 'Saral'], [/\bmiracle\b/i, 'Miracle'],
  [/\bquickbooks\b/i, 'QuickBooks'], [/\bsap\b/i, 'SAP'], [/\berpnext\b/i, 'ERPNext'], [/\blogic\b/i, 'Logic ERP'],
];
function guessSoftware(grid: PdfGrid | null): string | undefined {
  if (!grid) return undefined;
  const text = grid.rows.slice(0, 40).flat().join(' ');
  const hit = SOFTWARE_NAMES.find(([re]) => re.test(text));
  return hit ? `${hit[1]} (layout not recognised)` : undefined;
}

/** Rows per "page" of reader text. The server packs pages into ~8K-char
 *  chunks and never splits a page, so a sheet sent as one block would be
 *  one oversized chunk. */
const READER_ROWS_PER_PAGE = 60;

/**
 * A ledger's grid as tab-separated rows for the AI reader, header line
 * repeated at the top of every page. For a sheet it is the only text the
 * reader gets. For a PDF it is a second reading next to the PDF's plain
 * text, because each fails on different layouts (7 samples, % of rows
 * right): plain text loses which column a lone amount sat in (Tally
 * 68%, Tally Compact 60% — Debit/Credit flips), while the grid can get
 * its cells miscounted across empty ones (Marg 42% — Balance read as
 * Credit). The server reads both and keeps the one whose running
 * balances agree more (see the ledger route).
 */
export function ledgerReaderText(grid: PdfGrid): string {
  const clean = (c: unknown) => String(c ?? '').replace(/\s+/g, ' ').trim();
  const src = grid.rows.filter(r => r.some(c => clean(c)));
  // Drop all-blank columns (Excel exports are full of spacer columns).
  const used = Array.from({ length: grid.columnCount }, (_, c) => src.some(r => clean(r[c]) !== ''));
  const pick = (r: ReadonlyArray<unknown>) => used.flatMap((u, c) => (u ? [clean(r[c])] : [])).join('\t');
  const header = pick(grid.columnHeaders);
  const body = src.map(pick).filter(l => l !== header);
  const pages: string[] = [];
  for (let i = 0; i < body.length; i += READER_ROWS_PER_PAGE) {
    pages.push([...(header.replace(/\t/g, '') ? [header] : []), ...body.slice(i, i + READER_ROWS_PER_PAGE)].join('\n'));
  }
  return pages.join('\n\n--- PAGE BREAK ---\n\n');
}

/** What the AI column mapper sees: the grid's header and first 45
 *  non-empty rows (enough to tell a voucher-number column headed
 *  "Debit" from the real amounts). */
export function aiMappingSample(grid: PdfGrid): { header: string[]; rows: string[][]; columnCount: number } {
  const clean = (c: unknown) => String(c ?? '').replace(/\s+/g, ' ').trim();
  return {
    header: Array.from({ length: grid.columnCount }, (_, i) => clean(grid.columnHeaders[i])),
    rows: grid.rows.filter(r => r.some(c => clean(c))).slice(0, 45).map(r => r.map(clean)),
    columnCount: grid.columnCount,
  };
}

/**
 * Keep an AI column mapping only when the ledger itself proves it: the
 * rows come out usable, at least 5 running balances can be checked and
 * ≥99% agree (correct mappings agreed on every balance; a book whose
 * accounts collapsed into one still passed 95% — its only disagreements
 * were the 5 account boundaries), and no more than 10% of dated rows were dropped for
 * having no amount (a grid that merged the amount into another cell —
 * Tally layouts the rules reshape — loses 68-130% that way; correct
 * mappings lose 0-9%, opening/total lines). A ledger with no running
 * balance can't prove a mapping, so it is transcribed instead.
 */
export function checkAiMapping(grid: PdfGrid, roles: ColumnMapping['roles']): { checked: LedgerMapCheck; verified: boolean; why: string } {
  const checked = mapLedger(grid, { roles });
  const { stats } = checked.mapped;
  const skippedOk = stats.skippedNoAmount <= Math.max(3, stats.transactions * 0.1);
  const balancesOk = checked.checkpoints >= 5 && checked.agreeing >= checked.checkpoints * 0.99;
  const why = !checked.usable ? describeMiss(checked)
    : !skippedOk ? `${stats.skippedNoAmount} dated rows had no amount under the mapped columns`
    : !balancesOk ? (checked.checkpoints < 5 ? 'no running balances to prove it' : `only ${checked.agreeing}/${checked.checkpoints} running balances agree`)
    : `${checked.agreeing}/${checked.checkpoints} running balances agree`;
  return { checked, verified: checked.usable && skippedOk && balancesOk, why };
}

/** A matched rule: its rows if usable and not contradicted by the
 *  balances, else the AI reader. `detected.grid` is the rule's
 *  preprocessed grid (Tally splits a merged "Vch No. Debit" column),
 *  which is what `detected.mapping.roles` is indexed against. */
function ruleRoute(software: string, grid: PdfGrid, mapping: ColumnMapping): LedgerRoute {
  const checked = mapLedger(grid, mapping);
  if (!checked.usable || checked.contradicted) {
    gridLog(`[ledgerRouting] ${software} rule matched but ${describeMiss(checked)} — AI reader`);
    return { kind: 'reader', meta: { formatReason: 'rule-mismatch', detectedSoftware: software } };
  }
  gridLog(`[ledgerRouting] ${software}: ${checked.mapped.rows.length} rows, ${checked.agreeing}/${checked.checkpoints} running balances agree — submitting`);
  return { kind: 'mapped', software, checked };
}

/** PDF (grid from extractPdfGrid; null or near-empty = no text layer). */
export function routeLedgerPdf(grid: PdfGrid | null): LedgerRoute {
  // Per-ERP deterministic column rule (Tally / Busy / Marg / Finsys…).
  const detected = detectAndMapLedgerErp(grid);
  if (detected && grid) return ruleRoute(detected.erp, detected.grid, detected.mapping);
  // No rule but a text layer: an unfamiliar layout. A guessed column
  // mapping is how ledgers got mis-read, so the AI reader takes it.
  if (grid && grid.rows.length >= 3) {
    gridLog(`[ledgerRouting] no software rule matched (cols=${grid.columnCount}, rows=${grid.rows.length}) — AI reader`);
    return { kind: 'reader', meta: { formatReason: 'no-rule', detectedSoftware: guessSoftware(grid) } };
  }
  // No usable text layer: a scan for vision.
  return { kind: 'reader' };
}

/** CSV / Excel: a software rule, else the header-based column guess — a
 *  rule is kept unless the balances contradict it, a guess only when
 *  they prove it. Otherwise the sheet goes to the AI reader as text. */
export function routeLedgerSheet(grid: PdfGrid): LedgerRoute {
  const detected = detectAndMapLedgerErp(grid);
  if (detected) {
    const route = ruleRoute(detected.erp, detected.grid, detected.mapping);
    if (route.kind === 'mapped') return route;
  }
  const guess = mapLedger(grid, suggestMapping(grid));
  if (!detected && guess.usable && guess.proven) {
    gridLog(`[ledgerRouting] sheet columns recognised from the header: ${guess.agreeing}/${guess.checkpoints} running balances agree — submitting`);
    return { kind: 'mapped', software: 'Columns recognised', checked: guess };
  }
  gridLog(`[ledgerRouting] sheet not mappable (${detected ? `${detected.erp} rule unusable` : `header guess: ${describeMiss(guess)}`}) — AI reader`);
  return {
    kind: 'reader',
    meta: { formatReason: detected ? 'rule-mismatch' : 'no-rule', detectedSoftware: detected?.erp ?? guessSoftware(grid) },
  };
}
