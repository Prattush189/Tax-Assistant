/**
 * CBDT CreationInfo constants and helpers.
 *
 * SWCreatedBy / JSONCreatedBy follow the CBDT pattern `[S][W][0-9]{8}`. We
 * don't have a registered CBDT software ID yet (see .planning/sessions/ITR-
 * FILING-FEATURE-PLAN.md §10.1) so a placeholder is used — the gov Common
 * Utility rewrites this on re-export before upload, which is the documented
 * hand-off flow for the MVP.
 */

export const ITR_SW_VERSION = '1.0';
export const ITR_SW_ID_PLACEHOLDER = 'SW00000000';
export const ITR_INTERMEDIARY_CITY_DEFAULT = 'Delhi';

/** Returns YYYY-MM-DD in IST (Asia/Kolkata). */
export function istDateString(now: Date = new Date()): string {
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface CreationInfoFields {
  SWVersionNo: string;
  SWCreatedBy: string;
  JSONCreatedBy: string;
  JSONCreationDate: string;
  IntermediaryCity: string;
  Digest: string;
}

/**
 * Builds a CreationInfo object with the Digest slot left as '-'. Call
 * `stampDigest` after you have the canonical JSON to replace it.
 */
export function buildCreationInfo(
  opts: {
    swId?: string;
    intermediaryCity?: string;
    now?: Date;
  } = {},
): CreationInfoFields {
  const swId = opts.swId ?? ITR_SW_ID_PLACEHOLDER;
  return {
    SWVersionNo: ITR_SW_VERSION,
    SWCreatedBy: swId,
    JSONCreatedBy: swId,
    JSONCreationDate: istDateString(opts.now),
    IntermediaryCity: opts.intermediaryCity ?? ITR_INTERMEDIARY_CITY_DEFAULT,
    Digest: '-',
  };
}
