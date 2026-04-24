/**
 * Pinned facts injected into the chat system prompt.
 *
 * This is the SINGLE SOURCE OF TRUTH for every tax rate / threshold / limit
 * the AI is allowed to quote as definitive. Anything not in here is subject
 * to the model's (frequently stale) training data.
 *
 * The engines in `src/data/taxRules/*.ts` and `src/lib/tdsEngine.ts` have
 * their own copies of these values. To guard against drift, the companion
 * `server/scripts/check-chat-facts.ts` verifies that the values in this
 * file match the engine values at build time — run it via
 * `npm run check:chat-facts`. Any mismatch fails the check with the
 * specific field that diverged.
 *
 * When you update a value here (e.g. a new Finance Act changes a rate):
 *   1. Update the engine value in src/data/taxRules/ or src/lib/tdsEngine.ts
 *   2. Update the same value in this file
 *   3. Run `npm run check:chat-facts`
 *   4. Add/update a case in server/scripts/chat-eval.ts if it's a commonly-
 *      asked rate.
 */

// ── Income-tax slabs & rebates ───────────────────────────────────────────
// Kept in lockstep with src/data/taxRules/fy2025-26.ts (FY_2025_26 export).

export const NEW_REGIME_FY_2025_26 = {
  standardDeduction: 75_000,
  rebateMax: 60_000,
  rebateThreshold: 12_00_000,
  slabs: [
    { upTo: 4_00_000, rate: 0.00 },
    { upTo: 8_00_000, rate: 0.05 },
    { upTo: 12_00_000, rate: 0.10 },
    { upTo: 16_00_000, rate: 0.15 },
    { upTo: 20_00_000, rate: 0.20 },
    { upTo: 24_00_000, rate: 0.25 },
    { upTo: Infinity, rate: 0.30 },
  ],
} as const;

export const NEW_REGIME_FY_2024_25 = {
  standardDeductionPostJulyBudget: 75_000,
  standardDeductionPreJulyBudget: 50_000,
  rebateMax: 25_000,
  rebateThreshold: 7_00_000,
  slabs: [
    { upTo: 3_00_000, rate: 0.00 },
    { upTo: 7_00_000, rate: 0.05 },
    { upTo: 10_00_000, rate: 0.10 },
    { upTo: 12_00_000, rate: 0.15 },
    { upTo: 15_00_000, rate: 0.20 },
    { upTo: Infinity, rate: 0.30 },
  ],
} as const;

export const OLD_REGIME = {
  standardDeduction: 50_000,
  rebateMax: 12_500,
  rebateThreshold: 5_00_000,
  slabs: {
    below60: [
      { upTo: 2_50_000, rate: 0.00 },
      { upTo: 5_00_000, rate: 0.05 },
      { upTo: 10_00_000, rate: 0.20 },
      { upTo: Infinity, rate: 0.30 },
    ],
    senior60to80: [
      { upTo: 3_00_000, rate: 0.00 },
      { upTo: 5_00_000, rate: 0.05 },
      { upTo: 10_00_000, rate: 0.20 },
      { upTo: Infinity, rate: 0.30 },
    ],
    superSenior80plus: [
      { upTo: 5_00_000, rate: 0.00 },
      { upTo: 10_00_000, rate: 0.20 },
      { upTo: Infinity, rate: 0.30 },
    ],
  },
} as const;

// ── Surcharge ────────────────────────────────────────────────────────────
// Finance Act 2023: new regime capped at 25% above ₹2Cr; old regime retains
// the 37% band above ₹5Cr.
export const SURCHARGE = {
  newRegimeMaxRate: 0.25,
  oldRegimeMaxRate: 0.37,
  healthAndEducationCess: 0.04,
} as const;

// ── Capital gains (Budget 2024, effective 23 Jul 2024) ───────────────────
// Training data of most LLMs still has the pre-Jul-2024 rates
// (10% LTCG / 15% STCG / 20%-with-indexation). Keep these pinned forever.
export const CAPITAL_GAINS_POST_23_JUL_2024 = {
  equity: {
    ltcgRate: 0.125,
    ltcgExemptionPerYear: 1_25_000,
    ltcgHoldingMonths: 12,
    stcgRate: 0.20,
    stcgHoldingMonths: 12,
  },
  realEstate: {
    ltcgRateWithoutIndexation: 0.125,
    ltcgRateWithIndexationPreJul2024OptionResidentIndivHUF: 0.20,
    ltcgHoldingMonths: 24,
  },
  other: {
    ltcgRateWithoutIndexation: 0.125,
    ltcgHoldingMonths: 24,
  },
  debtMfPostApr2023: 'slab', // §50AA — always STCG at slab rate
  section54_54F_exemptionCapRupees: 10_00_00_000, // ₹10Cr (Budget 2023)
  rebate87A_notAvailableOnSpecialRates: true, // CBDT clarification Jul 2024
} as const;

// ── GST ──────────────────────────────────────────────────────────────────
// 56th GST Council meeting (Sep 2025) collapsed the slab structure to
// 0 / 5 / 18 / 40% plus special rates (3% gold, 0.25% rough diamonds).
export const GST = {
  rates: [0, 5, 18, 40] as const,
  specialRates: [3, 0.25] as const,
  registrationThresholdGoodsRupees: 40_00_000,
  registrationThresholdServicesRupees: 20_00_000,
  registrationThresholdSpecialStatesRupees: 10_00_000,
} as const;

// ── TDS (top-20 commonly-cited) ──────────────────────────────────────────
// Values mirror src/lib/tdsEngine.ts `RESIDENT_SECTIONS` for FY 2025-26.
// When the engine changes a rate/threshold for a new FY, update here and
// rerun check:chat-facts.
export const TDS_COMMON_FY_2025_26 = [
  { sec: '192', desc: 'Salary', rate: 'slab' as const, threshold: 'basic exemption' },
  { sec: '194', desc: 'Dividends', rate: 0.10, threshold: 10_000 },
  { sec: '194A', desc: 'Interest (non-securities)', rate: 0.10, threshold: 50_000, seniorThreshold: 1_00_000 },
  { sec: '194C', desc: 'Contractor payment', rate: 0.01, rateFirm: 0.02, threshold: 30_000, aggregateThreshold: 1_00_000 },
  { sec: '194H', desc: 'Commission / brokerage', rate: 0.02, threshold: 20_000 },
  { sec: '194-I', desc: 'Rent (plant/machinery 2%, land/building 10%)', rateLand: 0.10, ratePlant: 0.02, threshold: 6_00_000 },
  { sec: '194-IB', desc: 'Rent by individuals not under tax audit', rate: 0.02, threshold: 50_000, note: 'per month' },
  { sec: '194J', desc: 'Professional / technical fees', rate: 0.10, rateTechnical: 0.02, threshold: 50_000 },
  { sec: '194Q', desc: 'Purchase of goods', rate: 0.001, threshold: 50_00_000, turnoverTrigger: 10_00_00_000 },
  { sec: '194S', desc: 'VDA (crypto) transfer', rate: 0.01, threshold: 10_000, specifiedPersonThreshold: 50_000 },
  { sec: '194T', desc: 'Partner remuneration/interest (new — Apr 2025)', rate: 0.10, threshold: 20_000 },
  { sec: '206C(1G)', desc: 'TCS on foreign remittance (LRS)', rateAbove10L: 0.20, rateEduMedical: 0.05, threshold: 10_00_000 },
  { sec: '206C(1H)', desc: 'TCS on sale of goods', rate: 0.001, threshold: 50_00_000 },
  { sec: '194N', desc: 'Cash withdrawal (non-ITR filer: more stringent)', rate: 0.02, thresholdStandard: 1_00_00_000, thresholdNonFiler: 20_00_000 },
  { sec: 'PAN missing', desc: 'Rate when PAN not furnished', rate: 0.20, note: '§206AA' },
] as const;

// ── NPS ──────────────────────────────────────────────────────────────────
export const NPS = {
  employerDeductionLimitNewRegime: 0.14, // Budget 2024: raised from 10% to 14% of salary in new regime
  employerDeductionLimitOldRegime: 0.10, // unchanged
  employeeSelfContributionLimit_80CCD1B: 50_000,
  section80CCD1_overallLimit: 1_50_000, // combined with 80C
} as const;

// ── VDA (Virtual Digital Asset) taxation §115BBH ─────────────────────────
export const VDA = {
  flatRate: 0.30,
  cessApplied: true, // 4% health & education cess on top
  lossSetOff: false,
  lossCarryForward: false,
  deductionsAllowed: false, // only cost of acquisition
  tdsSection194S_rate: 0.01,
} as const;

// ── Presumptive taxation §44AD / §44ADA / §44AE ──────────────────────────
export const PRESUMPTIVE = {
  section44AD: {
    turnoverLimitCashDominantRupees: 2_00_00_000,       // ₹2Cr if cash receipts > 5%
    turnoverLimitLargelyDigitalRupees: 3_00_00_000,     // ₹3Cr if cash receipts ≤ 5%
    presumedIncomeRateCash: 0.08,
    presumedIncomeRateDigital: 0.06,
  },
  section44ADA: {
    grossReceiptsLimitCashDominantRupees: 50_00_000,    // ₹50L if cash receipts > 5%
    grossReceiptsLimitLargelyDigitalRupees: 75_00_000,  // ₹75L if cash receipts ≤ 5%
    presumedIncomeRate: 0.50,
  },
} as const;

// ── House property (§24(b) interest deduction) ───────────────────────────
export const HOUSE_PROPERTY = {
  selfOccupiedInterestCapRupees: 2_00_000,
  letOutInterestCapRupees: Infinity, // actual interest, but loss set-off capped at ₹2L/year
  setOffAgainstOtherHeadsCapRupees: 2_00_000,
  newRegime_24bAvailable: 'let-out only', // new regime disallows SOP interest
} as const;

// ── Miscellaneous Finance-Act changes the model often misses ─────────────
export const MISC_RECENT = {
  angelTaxRepealed: '1 Apr 2025 (Finance Act 2024 removed §56(2)(viib))',
  buybackTaxShiftedToShareholder: '1 Oct 2024 (Finance Act 2024 — taxed as deemed dividend)',
  indexationAbolishedForMostAssets: '23 Jul 2024 (Finance Act 2024 — except real-estate grandfathering)',
  debtMF_alwaysSlab_if_purchased_on_or_after: '1 Apr 2023 (§50AA)',
  newTaxRegimeDefault: 'AY 2024-25 onwards (§115BAC)',
  panAadhaarLinkPenaltyRupees: 1000,
  ITAct2025EffectiveFrom: '1 Apr 2026',
} as const;

// ── §87A rebate nuance (commonly-missed CBDT clarification) ──────────────
export const REBATE_87A_NUANCE = {
  newRegimeMaxRebateFY25_26: 60_000,
  newRegimeIncomeCapFY25_26: 12_00_000,
  oldRegimeMaxRebate: 12_500,
  oldRegimeIncomeCap: 5_00_000,
  availableOnSpecialRates: false, // NOT on STCG 111A or LTCG 112/112A per CBDT Jul 2024
  marginalReliefAvailable: true, // Tax cannot exceed income-above-threshold
} as const;

// ── Prompt builder ────────────────────────────────────────────────────────
// Pure formatting — no logic. Generates the "FACTS" block that gets spliced
// into SYSTEM_INSTRUCTION.

function pct(n: number): string {
  // Round to 2 decimals first to dodge float artefacts like 0.14*100 = 14.00…02
  const v = Math.round(n * 10_000) / 100;
  return (Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, '')) + '%';
}
function rupees(n: number): string {
  if (n === Infinity) return 'no cap';
  if (n >= 1_00_00_000) {
    const cr = n / 1_00_00_000;
    return `₹${Number.isInteger(cr) ? cr : cr.toFixed(2)}Cr`;
  }
  if (n >= 1_00_000) {
    const l = n / 1_00_000;
    return `₹${Number.isInteger(l) ? l : l.toFixed(2)}L`;
  }
  // Below ₹1L: render with Indian comma grouping (₹12,500 not ₹13K) — rounded
  // values lose the precision users need for deduction-limit answers.
  return '₹' + n.toLocaleString('en-IN');
}

export function buildChatFactsBlock(): string {
  const nr = NEW_REGIME_FY_2025_26;
  const or = OLD_REGIME;
  const cg = CAPITAL_GAINS_POST_23_JUL_2024;
  const lines: string[] = [];

  lines.push('INCOME TAX (use these — your training data may be stale for some of these):');
  lines.push(`- NEW REGIME FY 2025-26 (AY 2026-27) — default under §115BAC: ${nr.slabs.map(s => s.upTo === Infinity ? `${pct(s.rate)} above ${rupees(nr.slabs[nr.slabs.length - 2].upTo)}` : `up to ${rupees(s.upTo)} ${pct(s.rate)}`).join(', ')}. Standard deduction ${rupees(nr.standardDeduction)}, §87A rebate max ${rupees(nr.rebateMax)} if income ≤ ${rupees(nr.rebateThreshold)}.`);
  lines.push(`- NEW REGIME FY 2024-25: 0–3L nil, 3–7L 5%, 7–10L 10%, 10–12L 15%, 12–15L 20%, 15L+ 30%. Std deduction ${rupees(NEW_REGIME_FY_2024_25.standardDeductionPreJulyBudget)} (raised to ${rupees(NEW_REGIME_FY_2024_25.standardDeductionPostJulyBudget)} post July 2024 Budget). §87A rebate max ${rupees(NEW_REGIME_FY_2024_25.rebateMax)} if income ≤ ${rupees(NEW_REGIME_FY_2024_25.rebateThreshold)}.`);
  lines.push(`- OLD REGIME (all FYs): Below-60 — up to ${rupees(or.slabs.below60[0].upTo)} nil, ${rupees(or.slabs.below60[0].upTo)}–${rupees(or.slabs.below60[1].upTo)} ${pct(or.slabs.below60[1].rate)}, ${rupees(or.slabs.below60[1].upTo)}–${rupees(or.slabs.below60[2].upTo)} ${pct(or.slabs.below60[2].rate)}, above ${rupees(or.slabs.below60[2].upTo)} ${pct(or.slabs.below60[3].rate)}. Senior(60-80): 0–3L nil. Super-senior(80+): 0–5L nil. Std deduction ${rupees(or.standardDeduction)}, §87A rebate max ${rupees(or.rebateMax)} if income ≤ ${rupees(or.rebateThreshold)}.`);
  lines.push(`- Surcharge: new regime capped at ${pct(SURCHARGE.newRegimeMaxRate)}, old regime up to ${pct(SURCHARGE.oldRegimeMaxRate)}. Health & education cess ${pct(SURCHARGE.healthAndEducationCess)}.`);
  lines.push(`- §87A rebate does NOT apply to income taxed at special rates (STCG §111A / LTCG §112 / §112A). CBDT clarification, July 2024. Marginal relief still available.`);
  lines.push(`- New tax regime is the DEFAULT since AY 2024-25 (§115BAC). Taxpayers must opt OUT to use the old regime.`);

  lines.push('');
  lines.push('CAPITAL GAINS (Budget 2024 reset — effective 23 Jul 2024; your training data is almost certainly stale here, use these values):');
  lines.push(`- LTCG listed equity / equity MF / business-trust units (§112A, new §196): ${pct(cg.equity.ltcgRate)} on gains above ${rupees(cg.equity.ltcgExemptionPerYear)}/year. Holding ≥ ${cg.equity.ltcgHoldingMonths} months. STT must be paid. NO indexation. (Was 10% above ₹1L pre-23-Jul-2024.)`);
  lines.push(`- STCG listed equity / equity MF / business-trust units (§111A, new §195): ${pct(cg.equity.stcgRate)} flat. (Was 15% pre-23-Jul-2024.)`);
  lines.push(`- LTCG other assets — unlisted shares, gold, bonds, debt MF bought before 1 Apr 2023 (§112, new §196): ${pct(cg.other.ltcgRateWithoutIndexation)} without indexation. Holding ≥ ${cg.other.ltcgHoldingMonths} months.`);
  lines.push(`- LTCG real estate (land/building): ${pct(cg.realEstate.ltcgRateWithoutIndexation)} without indexation. For property bought before 23 Jul 2024, resident individuals/HUFs may OPT for ${pct(cg.realEstate.ltcgRateWithIndexationPreJul2024OptionResidentIndivHUF)} WITH indexation (grandfathering — property only). Holding ≥ ${cg.realEstate.ltcgHoldingMonths} months.`);
  lines.push(`- §54 / §54F exemption ceiling: ${rupees(cg.section54_54F_exemptionCapRupees)} (Budget 2023 cap).`);
  lines.push(`- Debt MF bought on/after 1 Apr 2023: always STCG at slab rate regardless of holding period (§50AA).`);

  lines.push('');
  lines.push('VDA / CRYPTO (§115BBH + §194S):');
  lines.push(`- Flat ${pct(VDA.flatRate)} on transfer income + ${pct(SURCHARGE.healthAndEducationCess)} cess. NO loss set-off, NO carry-forward, NO deductions except cost of acquisition.`);
  lines.push(`- §194S TDS: ${pct(VDA.tdsSection194S_rate)} on transfer above ${rupees(10_000)} (${rupees(50_000)} for specified persons).`);

  lines.push('');
  lines.push('TDS / TCS (commonly-asked sections, FY 2025-26):');
  for (const t of TDS_COMMON_FY_2025_26) {
    const parts: string[] = [`§${t.sec} ${t.desc}:`];
    if ('rate' in t && typeof t.rate === 'number') parts.push(pct(t.rate));
    if ('rate' in t && typeof t.rate === 'string') parts.push(t.rate);
    if ('rateLand' in t) parts.push(`${pct(t.rateLand)} land/${pct(t.ratePlant)} plant`);
    if ('rateAbove10L' in t) parts.push(`${pct(t.rateAbove10L)} above ₹10L (${pct(t.rateEduMedical)} for education/medical)`);
    if ('rateTechnical' in t) parts.push(`${pct(t.rateTechnical)} for technical fees`);
    if ('threshold' in t && typeof t.threshold === 'number') parts.push(`threshold ${rupees(t.threshold)}${'note' in t && t.note ? ' ' + t.note : ''}`);
    if ('threshold' in t && typeof t.threshold === 'string') parts.push(`threshold: ${t.threshold}`);
    if ('seniorThreshold' in t) parts.push(`(senior citizens ${rupees(t.seniorThreshold)})`);
    lines.push(`- ${parts.join(' ')}`);
  }
  lines.push(`- Without PAN (§206AA): rate defaults to max of prescribed rate, 20%, or twice the applicable rate.`);

  lines.push('');
  lines.push('NPS:');
  lines.push(`- §80CCD(2) employer contribution: deductible up to ${pct(NPS.employerDeductionLimitNewRegime)} of salary in new regime (raised from ${pct(NPS.employerDeductionLimitOldRegime)} in Budget 2024), ${pct(NPS.employerDeductionLimitOldRegime)} in old regime.`);
  lines.push(`- §80CCD(1B) self contribution: extra ${rupees(NPS.employeeSelfContributionLimit_80CCD1B)} (old regime only, over and above §80C ceiling).`);

  lines.push('');
  lines.push('PRESUMPTIVE TAXATION (§44AD / §44ADA):');
  lines.push(`- §44AD (small business): turnover ≤ ${rupees(PRESUMPTIVE.section44AD.turnoverLimitCashDominantRupees)} (or ${rupees(PRESUMPTIVE.section44AD.turnoverLimitLargelyDigitalRupees)} if cash receipts ≤ 5%). Presumed income ${pct(PRESUMPTIVE.section44AD.presumedIncomeRateCash)} cash / ${pct(PRESUMPTIVE.section44AD.presumedIncomeRateDigital)} digital.`);
  lines.push(`- §44ADA (specified professionals): gross receipts ≤ ${rupees(PRESUMPTIVE.section44ADA.grossReceiptsLimitCashDominantRupees)} (or ${rupees(PRESUMPTIVE.section44ADA.grossReceiptsLimitLargelyDigitalRupees)} if cash receipts ≤ 5%). Presumed income ${pct(PRESUMPTIVE.section44ADA.presumedIncomeRate)}.`);

  lines.push('');
  lines.push('HOUSE PROPERTY (§24(b) interest deduction):');
  lines.push(`- Self-occupied property: interest cap ${rupees(HOUSE_PROPERTY.selfOccupiedInterestCapRupees)}/year (OLD regime only). New regime disallows SOP interest entirely.`);
  lines.push(`- Let-out property: actual interest deductible, but set-off against other income heads capped at ${rupees(HOUSE_PROPERTY.setOffAgainstOtherHeadsCapRupees)}/year (excess carried forward 8 years).`);

  lines.push('');
  lines.push('GST (post 56th Council, Sep 2025):');
  lines.push(`- Slabs: ${GST.rates.map(r => `${r}%`).join(' / ')}. Special: ${GST.specialRates.map(r => `${r}%`).join(' / ')} (gold / rough diamonds).`);
  lines.push(`- Registration threshold: ${rupees(GST.registrationThresholdGoodsRupees)} (goods) / ${rupees(GST.registrationThresholdServicesRupees)} (services) / ${rupees(GST.registrationThresholdSpecialStatesRupees)} (special-category states).`);

  lines.push('');
  lines.push('OTHER RECENT CHANGES (your training data may miss these):');
  lines.push(`- Angel tax §56(2)(viib): repealed from ${MISC_RECENT.angelTaxRepealed}.`);
  lines.push(`- Buyback tax §115QA: from ${MISC_RECENT.buybackTaxShiftedToShareholder}, taxed in shareholder's hands as deemed dividend.`);
  lines.push(`- IT Act 2025 replaces IT Act 1961 effective ${MISC_RECENT.ITAct2025EffectiveFrom}.`);
  lines.push(`- PAN-Aadhaar linking missed: PAN inoperative + penalty ${rupees(MISC_RECENT.panAadhaarLinkPenaltyRupees)} to reactivate.`);

  return lines.join('\n');
}
