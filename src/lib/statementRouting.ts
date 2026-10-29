/**
 * Where an uploaded bank statement goes — there is no column-mapping
 * screen. A bank rule (or the J&K RPT parser) whose rows don't contradict
 * the statement's own printed running balance is submitted as is;
 * everything else goes to the server's AI reader (checked against the
 * same balance) and, when it's a digital format, is filed in Format
 * Support Requests so a rule can be added.
 *
 * Pure decisions only (no UI), so scripts/smoke-statement-routing.mts
 * can run every sample statement through exactly what the uploader does.
 */
import { gridLog } from './gridDebug';
import {
  applyMapping,
  mappedRowsBalanceAgreement,
  rowsToFakeGrid,
  suggestMapping,
  type ColumnMapping,
  type PdfGrid,
} from './pdfGrid';
import { detectAndMapBank } from './perBankRules';
import { detectJkbankRptFormat, extractJkbankRpt } from './jkbankRptParser';
import type { StatementFormatMeta } from '../services/api';

export type MapCheck = ReturnType<typeof mapAndCheck>;

export type StatementRoute =
  /** A ledger dropped on the statements page. */
  | { kind: 'ledger'; erp: string }
  /** Mapped in the browser: submit `checked.mapped` as CSV. */
  | { kind: 'mapped'; bank: string; checked: MapCheck }
  /** The server's AI reader (the file itself, or a sheet as TSV).
   *  `meta` absent = a scan, nothing to file as a format request. */
  | { kind: 'reader'; meta?: StatementFormatMeta };

/** Apply a mapping and test the rows against the statement's own printed
 *  running balance — the check that lets a mapping go through with no
 *  review screen. `contradicted`: enough balances to judge and too few
 *  agree (a rule that matched by fingerprint but maps the columns
 *  wrongly). `proven`: enough balances and nearly all agree. */
export function mapAndCheck(grid: PdfGrid, mapping: ColumnMapping) {
  const mapped = applyMapping(grid, mapping, 'bank');
  const { checkpoints, agreeing } = mappedRowsBalanceAgreement(mapped.rows);
  const enough = checkpoints >= 5;
  return {
    mapped,
    checkpoints,
    agreeing,
    contradicted: enough && agreeing < checkpoints * 0.9,
    proven: enough && agreeing >= checkpoints * 0.9,
  };
}

/** A matched rule's route: its rows, unless they come out empty or the
 *  balances contradict them — then the AI reader. `grid` must be the
 *  rule's preprocessed grid (Kotak etc. reshape columns), which is what
 *  `mapping.roles` is indexed against. */
function ruleRoute(bank: string, grid: PdfGrid, mapping: ColumnMapping): StatementRoute {
  const checked = mapAndCheck(grid, mapping);
  if (checked.mapped.rows.length === 0 || checked.contradicted) {
    gridLog(`[statementRouting] ${bank} rule matched but ${checked.mapped.rows.length === 0 ? 'mapped no rows' : `only ${checked.agreeing}/${checked.checkpoints} balances agree`} — AI reader`);
    return { kind: 'reader', meta: { formatReason: 'rule-mismatch', detectedBank: bank } };
  }
  gridLog(`[statementRouting] ${bank}: ${checked.agreeing}/${checked.checkpoints} balances agree — submitting`);
  return { kind: 'mapped', bank, checked };
}

/** Best-effort bank name for an auto-filed format request: the IFSC
 *  printed next to an "IFSC" label in the statement banner (narrations
 *  quote other banks' IFSCs, so the label is required). */
const IFSC_BANKS: Record<string, string> = {
  UTIB: 'Axis Bank', SBIN: 'State Bank of India', BARB: 'Bank of Baroda', UBIN: 'Union Bank of India',
  CNRB: 'Canara Bank', PUNB: 'Punjab National Bank', IOBA: 'Indian Overseas Bank', IDIB: 'Indian Bank',
  BKID: 'Bank of India', CBIN: 'Central Bank of India', UCBA: 'UCO Bank', PSIB: 'Punjab & Sind Bank',
  MAHB: 'Bank of Maharashtra', HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', IBKL: 'IDBI Bank', KKBK: 'Kotak Mahindra Bank',
  YESB: 'Yes Bank', INDB: 'IndusInd Bank', FDRL: 'Federal Bank', IDFB: 'IDFC First Bank', RATN: 'RBL Bank',
  BDBL: 'Bandhan Bank', AUBL: 'AU Small Finance Bank', KARB: 'Karnataka Bank', KVBL: 'Karur Vysya Bank',
  SIBL: 'South Indian Bank', CSBK: 'CSB Bank', JAKA: 'J&K Bank', DLXB: 'Dhanlaxmi Bank', TMBL: 'Tamilnad Mercantile Bank',
};
export function guessBankFromIfsc(grid: PdfGrid | null): string | undefined {
  if (!grid) return undefined;
  const text = grid.rows.slice(0, 60).flat().join(' ');
  const m = /\bifsc\b(?:\s*(?:code|no\.?))?[^A-Za-z0-9]{0,20}([A-Z]{4})0[A-Z0-9]{6}\b/i.exec(text);
  if (!m) return undefined;
  const code = m[1].toUpperCase();
  return IFSC_BANKS[code] ? `${IFSC_BANKS[code]} (IFSC ${code})` : `Unrecognised bank (IFSC ${code})`;
}

/** A spreadsheet as tab-separated text for the AI reader, with the
 *  all-blank spacer columns bank Excel exports are full of removed. */
export function rowsToTsv(rows: string[][]): string {
  const width = Math.max(0, ...rows.map(r => r.length));
  const used = Array.from({ length: width }, (_, c) => rows.some(r => String(r[c] ?? '').trim() !== ''));
  return rows
    .filter(r => r.some(c => String(c ?? '').trim()))
    .map(r => used.flatMap((u, c) => (u ? [String(r[c] ?? '').replace(/[\t\r\n]+/g, ' ').trim()] : [])).join('\t'))
    .join('\n');
}

/**
 * CSV / Excel: a bank rule, else the header-based column guess — a rule
 * is kept unless the balances contradict it, a guess only when they
 * prove it. Otherwise 'reader' = the sheet goes to the AI reader as TSV.
 */
export function routeSpreadsheet(grid: PdfGrid): StatementRoute {
  const detected = detectAndMapBank(grid);
  if (detected) {
    const route = ruleRoute(detected.bank, detected.grid, detected.mapping);
    if (route.kind === 'mapped') return route;
  }
  const guess = mapAndCheck(grid, suggestMapping(grid));
  if (!detected && guess.proven && guess.mapped.rows.length > 0) {
    gridLog(`[statementRouting] spreadsheet columns recognised from the header: ${guess.agreeing}/${guess.checkpoints} balances agree — submitting`);
    return { kind: 'mapped', bank: 'Columns recognised', checked: guess };
  }
  gridLog(`[statementRouting] spreadsheet not mappable (${detected ? `${detected.bank} rule disagrees` : `header guess ${guess.agreeing}/${guess.checkpoints}`}) — AI reader`);
  return {
    kind: 'reader',
    meta: { formatReason: detected ? 'rule-mismatch' : 'no-rule', detectedBank: detected?.bank ?? guessBankFromIfsc(grid) },
  };
}

/** PDF (grid from extractPdfGrid; null or near-empty = no text layer). */
export async function routePdf(grid: PdfGrid | null, file: File): Promise<StatementRoute> {
  // Wrong-page guard. If the user dropped a ledger PDF (Tally / Busy /
  // Marg / Finsys) here, the per-bank rule will miss and the AI reader
  // would turn a ledger into a "statement". Surface a pointed error.
  const ledgerFingerprints = [
    { fp: 'generated by finsys erp', erp: 'Finsys ERP' },
    { fp: 'totals c/f', erp: 'Busy' },
    { fp: 'totals b/f', erp: 'Busy' },
    { fp: 'balance c/f:', erp: 'Marg' },
    { fp: 'balance b/f:', erp: 'Marg' },
    { fp: 'continued..', erp: 'Tally' },
    { fp: 'sundry debtors', erp: 'a ledger' },
    { fp: 'sundry creditors', erp: 'a ledger' },
  ];
  const earlyText = grid ? grid.rows.slice(0, 100).flat().join(' ').toLowerCase() : '';
  const ledgerHit = ledgerFingerprints.find(l => earlyText.includes(l.fp));
  if (ledgerHit) {
    gridLog(`[statementRouting] looks like ${ledgerHit.erp} — wrong page`);
    return { kind: 'ledger', erp: ledgerHit.erp };
  }

  // Per-bank deterministic column rule FIRST — it runs on the
  // already-parsed grid (cheap, no I/O). The J&K RPT detection below
  // re-opens and re-reads the WHOLE PDF (a second full pdfjs parse), so
  // we only pay for it when no per-bank rule matched. Previously RPT ran
  // for every upload, doubling the parse time and causing a multi-second
  // UI freeze on larger statements (24-page HDFC report etc.).
  const detected = detectAndMapBank(grid);
  if (!detected && grid) {
    // Diagnostic: when no per-bank rule matched, surface the grid shape +
    // the fingerprint window the detector scanned, so a "should have
    // matched but didn't" case is debuggable straight from the browser
    // console. Mirror detectAndMapBank's 60-row window and test every SBI
    // marker — if all are false but cols===6 the layout is SBI yet the
    // cover page didn't surface a fingerprint (widen further); if
    // cols!==6 the grid itself differs from the test fixture.
    const fpWindow = grid.rows.slice(0, 60).flat().join(' ').toLowerCase();
    const sbiMarkers = {
      email: fpWindow.includes('sbi.co.in'),
      name: fpWindow.includes('state bank of india'),
      ifsc: /\bsbin0\d{4,}\b/i.test(fpWindow),
      relSummary: fpWindow.includes('relationship summary'),
      myBranchInfo: /\bmy information\b.*\bbranch information\b/i.test(fpWindow),
    };
    gridLog(`[statementRouting] no per-bank rule matched — cols=${grid.columnCount}, rows=${grid.rows.length}, headers=${JSON.stringify(grid.columnHeaders)}, sbi-markers=${JSON.stringify(sbiMarkers)}`);
  }
  if (detected && grid) return ruleRoute(detected.bank, detected.grid, detected.mapping);

  // J&K Bank "RPT" / "RPTNFS" / loan-recovery report format. The grid
  // extractor can't recover this layout (date is split into 5 separate
  // x-positions, transactions span 2 lines, narrations wrap mid-word).
  // The parser works on raw pdfjs text items and emits MappedRow; they
  // become a 5-column grid (Date, Narration, Debit, Credit, Balance) so
  // they take the same mapping + balance check as a rule match.
  try {
    if (await detectJkbankRptFormat(file)) {
      gridLog('[statementRouting] detected J&K Bank RPT/RPTNFS format — invoking dedicated parser');
      const rows = await extractJkbankRpt(file);
      const fakeGrid = rows && rows.length > 0
        ? rowsToFakeGrid([
            ['Date', 'Narration', 'Debit', 'Credit', 'Balance'],
            ...rows.map(r => [
              r.date ?? '',
              r.narration,
              r.amount < 0 ? Math.abs(r.amount).toFixed(2) : '',
              r.amount > 0 ? r.amount.toFixed(2) : '',
              r.balance != null ? r.balance.toFixed(2) : '',
            ]),
          ])
        : null;
      if (fakeGrid) return ruleRoute('J&K Bank Report', fakeGrid, { roles: ['date', 'narration', 'debit', 'credit', 'balance'] } as ColumnMapping);
      console.warn('[statementRouting] RPT detected but the parser gave no usable rows; falling through to the AI reader');
    }
  } catch (rptErr) {
    // Detection failure is non-fatal (a password-protected file lands
    // here too) — fall through. Log so a recurring break is visible.
    console.warn('[statementRouting] RPT detection threw:', rptErr);
  }

  // Banks whose PDFs carry no usable table: BoB packs all transaction
  // text into one column; Union/CBI/BoI/Indian Bank/IDBI ship multi-row
  // headers that bleed into data; Axis and SBI's common exports are
  // glyph-rendered / image-only. HDFC / ICICI / Canara / PNB / Yes Bank /
  // J&K Bank have deterministic rules above.
  const KNOWN_VISION_ONLY_BANKS = [
    'bank of baroda', 'bob',
    'union bank',
    'central bank of india',
    'bank of india',
    'indian bank',
    'idbi',
    'axis bank', 'axisbank', 'utib0',
    'state bank of india', 'sbin0',
  ];
  const fingerprint = grid ? grid.rows.slice(0, 30).flat().join(' ').toLowerCase() : '';
  const matchedBank = KNOWN_VISION_ONLY_BANKS.find(b => fingerprint.includes(b));
  // A bank name can appear INSIDE a transaction narration ("Dr AXIS BANK
  // C/A"), so only treat it as a known-difficult bank when there's no
  // clean dated table: ≥3 columns and several rows carrying a date.
  const dateLike = /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/;
  const datedRows = grid ? grid.rows.filter(r => r.some(c => dateLike.test(c ?? ''))).length : 0;
  const looksLikeRealTable = !!grid && (grid.columnCount ?? 0) >= 3 && datedRows >= 5;
  if (matchedBank && !looksLikeRealTable) {
    gridLog(`[statementRouting] detected ${matchedBank} — AI reader (no clean table to map)`);
    return { kind: 'reader', meta: { formatReason: 'known-difficult-bank', detectedBank: guessBankFromIfsc(grid) ?? matchedBank } };
  }

  // No bank rule matched: an unknown digital format. A guessed mapping
  // on an unfamiliar layout is how statements got mis-read, so the AI
  // reader takes it (Claude, checked against the printed running
  // balance, else PaddleOCR).
  if (grid && grid.rows.length >= 3 && (grid.columnCount ?? 0) >= 3) {
    gridLog('[statementRouting] no bank rule matched — AI reader');
    return { kind: 'reader', meta: { formatReason: 'no-rule', detectedBank: guessBankFromIfsc(grid) } };
  }
  // No usable grid (no text layer / glyph-rendered / too sparse): a scan
  // for the OCR pipeline — nothing a rule could be built from.
  if (grid) gridLog(`[statementRouting] only ${grid.columnCount} columns / ${grid.rows.length} rows — scanned, AI reader`);
  return { kind: 'reader' };
}
