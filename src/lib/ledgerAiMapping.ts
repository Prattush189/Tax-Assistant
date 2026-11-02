/**
 * First try for a ledger no software rule maps: the server's model names
 * the grid's columns (and files the upload in Format Support Requests),
 * the rows are then built from the grid here, and the result is kept only
 * when the ledger's own running balances prove it (checkAiMapping). A
 * mapping that isn't proven — or no answer at all — leaves the ledger to
 * AI transcription. Shared by the ledger uploader and the compare view.
 */
import { gridLog } from './gridDebug';
import type { PdfGrid } from './pdfGrid';
import { aiMappingSample, checkAiMapping, type LedgerMapCheck } from './ledgerRouting';
import { suggestLedgerMapping, type LedgerFormatMeta } from '../services/api';

export async function mapLedgerWithAi(
  file: File,
  grid: PdfGrid,
  meta: LedgerFormatMeta,
): Promise<{ checked: LedgerMapCheck | null; filed: boolean }> {
  try {
    const { roles, filed } = await suggestLedgerMapping(file, aiMappingSample(grid), meta);
    const { checked, verified, why } = checkAiMapping(grid, roles);
    gridLog(`[ledgerAiMapping] AI mapping ${JSON.stringify(roles)} — ${verified ? 'proven' : 'not proven'}: ${why}`);
    return { checked: verified ? checked : null, filed };
  } catch (err) {
    console.warn('[ledgerAiMapping] AI column mapping failed:', err);
    return { checked: null, filed: !!(err as { filed?: boolean }).filed };
  }
}
