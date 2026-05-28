/**
 * Final review + Excel export. Runs the full projection, MPBF, ratios,
 * and optionally stress test on the current draft, then surfaces:
 *   - Validation issues blocking export (missing firm, no mapping, etc.)
 *   - Summary preview tiles (revenue trajectory, MPBF, DSCR)
 *   - The Download button — builds the workbook and triggers a save.
 *
 * Heavy computation runs inside useMemo so the user can flip
 * back/forth between steps without recomputing on every render.
 */
import { useMemo, useState } from 'react';
import { Download, AlertTriangle, CheckCircle2, Sparkles, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../../itr/shared/Inputs';
import { cn, formatINR } from '../../../lib/utils';
import { markCmaExported, generateCmaNarrative } from '../../../services/api';
import { resolveHistorical } from '../lib/resolveHistorical';
import { runProjection } from '../lib/projectionEngine';
import { computeMpbf } from '../lib/mpbf';
import { computeRatios, gradeRatio } from '../lib/ratios';
import { applyStressTest } from '../lib/stressTest';
import { buildCmaWorkbook } from '../lib/excelExport';
import { buildProjectReportDefaults, buildBepDefaults } from '../lib/phase2Defaults';
import type { CmaDraft } from '../lib/uiModel';

interface Props {
  draft: CmaDraft;
  draftId: string | null;
  /** Optional — when supplied, the Phase 2 editor section appears and
   *  edits persist via the parent manager (which saves to the server
   *  on debounce). Without it, the Phase 2 editor renders read-only. */
  onChange?: (next: CmaDraft) => void;
}

interface ValidationIssue {
  level: 'error' | 'warning';
  text: string;
}

function validate(draft: CmaDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!draft.firm?.firmName?.trim()) issues.push({ level: 'error', text: 'Firm name is required.' });
  if (!draft.historical?.rows?.length) issues.push({ level: 'error', text: 'Upload a P&L + BS file first.' });
  if (!draft.historical?.yearLabels?.[0] || !draft.historical?.yearLabels?.[1]) {
    issues.push({ level: 'warning', text: 'Year labels are empty — projected columns will not reference real years.' });
  }
  if ((draft.mapping?.length ?? 0) < 5) {
    issues.push({ level: 'warning', text: 'Very few rows mapped to canonical accounts — output may have gaps.' });
  }
  if (!draft.mpbfMethod) issues.push({ level: 'error', text: 'Pick an MPBF method (Horizon & MPBF step).' });
  if (!draft.projectionHorizon) issues.push({ level: 'warning', text: 'Projection horizon not set — defaulting to 3 years.' });
  if ((draft.assumptions?.length ?? 0) === 0) {
    issues.push({ level: 'warning', text: 'No growth assumptions set — all projected lines flatline from latest historical.' });
  }
  return issues;
}

export function ReviewStep({ draft, draftId, onChange }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [phase2Open, setPhase2Open] = useState(false);
  const [generatingNarrative, setGeneratingNarrative] = useState(false);
  const issues = useMemo(() => validate(draft), [draft]);
  const hasErrors = issues.some((i) => i.level === 'error');
  const projectReportDefaults = useMemo(() => buildProjectReportDefaults(draft), [draft]);
  const bepDefaults = useMemo(() => buildBepDefaults(), []);

  const setReportField = <K extends keyof NonNullable<CmaDraft['projectReport']>>(
    key: K,
    value: NonNullable<CmaDraft['projectReport']>[K],
  ) => {
    if (!onChange) return;
    onChange({
      ...draft,
      projectReport: { ...(draft.projectReport ?? {}), [key]: value },
    });
  };
  const setBepFraction = (key: string, fraction: number) => {
    if (!onChange) return;
    onChange({
      ...draft,
      bep: {
        ...(draft.bep ?? {}),
        variableFractionByKey: {
          ...(draft.bep?.variableFractionByKey ?? {}),
          [key]: fraction,
        },
      },
    });
  };

  const onGenerateNarrative = async () => {
    if (!onChange || !draftId) return;
    if (!draft.firm?.firmName || !draft.firm?.businessNature) {
      toast.error('Please set Firm Name and Nature of Business on the first step before generating an AI narrative.');
      return;
    }
    setGeneratingNarrative(true);
    try {
      // Pull latest revenue + proposed-loan total to give the model
      // enough context that the narrative isn't generic. Falls back
      // gracefully when computed isn't ready.
      const lastRevenue = computed
        ? (computed.projection.series.pl_revenue ?? []).at(-1) ?? null
        : null;
      const proposedLoan = (draft.termLoans ?? [])
        .filter(tl => tl.status === 'proposed')
        .reduce((s, tl) => s + (tl.principal ?? 0), 0);
      const result = await generateCmaNarrative(draftId, {
        firmName: draft.firm.firmName,
        businessNature: draft.firm.businessNature,
        state: draft.firm.state ?? undefined,
        applicationContext: draft.firm.applicationContext ?? undefined,
        latestRevenueLacs: typeof lastRevenue === 'number' ? lastRevenue / 100000 : null,
        proposedLoanLacs: proposedLoan > 0 ? proposedLoan / 100000 : null,
      });
      // Merge over existing user values — but only into fields the
      // user hasn't already populated, so re-clicking Generate
      // doesn't blow away manual edits. To explicitly re-generate a
      // field, the user can clear it first and click again.
      onChange({
        ...draft,
        projectReport: {
          ...(draft.projectReport ?? {}),
          briefProfile: draft.projectReport?.briefProfile?.trim() ? draft.projectReport.briefProfile : result.briefProfile,
          machineryDetails: draft.projectReport?.machineryDetails?.trim() ? draft.projectReport.machineryDetails : result.machineryDetails,
          premises: draft.projectReport?.premises?.trim() ? draft.projectReport.premises : result.premises,
          powerConnection: draft.projectReport?.powerConnection?.trim() ? draft.projectReport.powerConnection : result.powerConnection,
          rateOfInterestNotes: draft.projectReport?.rateOfInterestNotes?.trim() ? draft.projectReport.rateOfInterestNotes : result.rateOfInterestNotes,
        },
      });
      toast.success('AI narrative drafted. Review the text and edit anything before exporting.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI narrative generation failed');
    } finally {
      setGeneratingNarrative(false);
    }
  };

  const computed = useMemo(() => {
    if (hasErrors) return null;
    const rows = draft.historical?.rows ?? [];
    const yearCols = [
      draft.historical?.yearColumnA ?? Math.max(0, (rows[0]?.length ?? 1) - 2),
      draft.historical?.yearColumnB ?? Math.max(1, (rows[0]?.length ?? 1) - 1),
    ];
    const yearLabels = [
      draft.historical?.yearLabels?.[0] ?? 'Y1',
      draft.historical?.yearLabels?.[1] ?? 'Y2',
    ];
    const historical = resolveHistorical(rows, yearCols, draft.mapping ?? []);
    const projection = runProjection(draft, historical, yearLabels);
    const firstP = projection.firstProjectedIndex;
    const projectedTurnover = (projection.series.pl_revenue ?? []).slice(firstP);
    const projectedCa = projection.derived.totalCurrentAssets.slice(firstP);
    const projectedInv = (projection.series.bs_inventory ?? []).slice(firstP);
    const projectedClOther = projection.derived.workingCapitalGap
      .map((gap, i) => projection.derived.totalCurrentAssets[i] - gap)
      .slice(firstP);
    const mpbf = computeMpbf(draft.mpbfMethod ?? 'tandon_ii', {
      projectedTurnover,
      totalCurrentAssets: projectedCa,
      inventory: projectedInv,
      currentLiabExcludingBank: projectedClOther,
    });
    const ratios = computeRatios(projection);
    const stress = draft.stress?.enabled
      ? applyStressTest(projection, draft.stress.salesMissPct ?? 10)
      : null;
    return { projection, mpbf, ratios, stress };
  }, [draft, hasErrors]);

  const onDownload = async () => {
    if (!computed) return;
    setDownloading(true);
    try {
      const blob = await buildCmaWorkbook({
        draft,
        projection: computed.projection,
        ratios: computed.ratios,
        mpbf: computed.mpbf,
        stress: computed.stress,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (draft.firm?.firmName ?? 'cma-report').replace(/[^a-z0-9_-]+/gi, '_');
      a.download = `${safeName}-CMA-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      if (draftId) {
        try { await markCmaExported(draftId); } catch { /* non-fatal */ }
      }
      toast.success('CMA report downloaded.');
    } catch (err) {
      console.error('[cma] export failed', err);
      toast.error(err instanceof Error ? err.message : 'Excel export failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      {issues.length > 0 && (
        <Card>
          <div className="space-y-2">
            {issues.map((iss, i) => (
              <div
                key={i}
                className={cn(
                  'flex items-start gap-2 text-sm rounded-lg px-3 py-2',
                  iss.level === 'error'
                    ? 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300'
                    : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300',
                )}
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{iss.text}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {computed && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StatTile
              label="Projected sales (final year)"
              value={formatINR((computed.projection.series.pl_revenue ?? []).at(-1) ?? 0)}
              tone="ok"
            />
            <StatTile
              label={`MPBF (final year, ${computed.mpbf.methodLabel})`}
              value={formatINR(computed.mpbf.mpbfByYear.at(-1) ?? 0)}
              tone="ok"
            />
            <StatTile
              label="DSCR (final projected year)"
              value={(computed.ratios.dscr.at(-1) ?? 0).toFixed(2) + 'x'}
              tone={gradeRatio('dscr', computed.ratios.dscr.at(-1) ?? 0) === 'ok' ? 'ok' : 'warn'}
            />
          </div>

          <Card title="Key ratios — projected years">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/60 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Ratio</th>
                    {computed.projection.yearLabels.slice(computed.projection.firstProjectedIndex).map((label) => (
                      <th key={label} className="px-3 py-2 text-right font-medium">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {([
                    ['DSCR', computed.ratios.dscr, 'dscr'],
                    ['Current Ratio', computed.ratios.currentRatio, 'currentRatio'],
                    ['Quick Ratio', computed.ratios.quickRatio, 'quickRatio'],
                    ['TOL / TNW', computed.ratios.tolTnw, 'tolTnw'],
                    ['Interest Coverage', computed.ratios.interestCoverage, 'interestCoverage'],
                  ] as const).map(([label, arr, key]) => (
                    <tr key={label}>
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{label}</td>
                      {arr.slice(computed.projection.firstProjectedIndex).map((v, i) => {
                        const grade = gradeRatio(key, v);
                        return (
                          <td
                            key={i}
                            className={cn(
                              'px-3 py-2 text-right tabular-nums',
                              grade === 'ok' ? 'text-emerald-700 dark:text-emerald-400'
                                : grade === 'borderline' ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-rose-700 dark:text-rose-400',
                            )}
                          >
                            {v > 0 ? v.toFixed(2) + 'x' : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {computed.stress && (
            <Card title={`Stress scenario — sales miss ${draft.stress?.salesMissPct ?? 10}%`}>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <StressCell
                  label="DSCR (final year)"
                  base={computed.ratios.dscr.at(-1) ?? 0}
                  stressed={computed.stress.ratios.dscr.at(-1) ?? 0}
                  formatter={(n) => n.toFixed(2) + 'x'}
                />
                <StressCell
                  label="PAT (final year)"
                  base={computed.projection.derived.profitAfterTax.at(-1) ?? 0}
                  stressed={computed.stress.projection.derived.profitAfterTax.at(-1) ?? 0}
                  formatter={formatINR}
                />
                <StressCell
                  label="EBITDA margin (final year)"
                  base={computed.ratios.ebitdaMargin.at(-1) ?? 0}
                  stressed={computed.stress.ratios.ebitdaMargin.at(-1) ?? 0}
                  formatter={(n) => n.toFixed(1) + '%'}
                />
              </div>
            </Card>
          )}
        </>
      )}

      {/* Phase 2 — Project Report + BEP overrides. Hidden behind a
          disclosure so users who just want a default export aren't
          forced through it. Every field has a sensible default
          surfaced as placeholder text; the user only types when they
          want to override. */}
      {onChange && (
        <Card>
          <button
            type="button"
            onClick={() => setPhase2Open(o => !o)}
            className="flex items-center justify-between w-full text-sm font-medium text-gray-700 dark:text-gray-200"
          >
            <span>Project Report &amp; BEP overrides{phase2Open ? '' : ' (auto-filled — click to edit)'}</span>
            <span className="text-gray-400 text-xs">{phase2Open ? '▾' : '▸'}</span>
          </button>
          {phase2Open && (
            <div className="mt-4 space-y-4 text-sm">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Credit Request (shown on Introduction sheet)</label>
                <input
                  type="text"
                  value={draft.projectReport?.creditRequest ?? ''}
                  placeholder={projectReportDefaults.creditRequest ?? 'e.g. Rs. 83.75 Lacs Term Loan + Rs. 70 Lacs CC enhancement'}
                  onChange={(e) => setReportField('creditRequest', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">Brief Profile (free text — appears under "BRIEF PROFILE" on Introduction)</label>
                  <button
                    type="button"
                    onClick={onGenerateNarrative}
                    disabled={generatingNarrative || !draftId}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Calls Gemini to draft a project-report narrative based on the firm info. Empty fields get filled; existing edits are preserved."
                  >
                    {generatingNarrative ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {generatingNarrative ? 'Generating…' : 'Generate with AI'}
                  </button>
                </div>
                <textarea
                  value={draft.projectReport?.briefProfile ?? ''}
                  placeholder={projectReportDefaults.briefProfile}
                  onChange={(e) => setReportField('briefProfile', e.target.value)}
                  rows={5}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-sans"
                />
                <p className="text-xs text-gray-400 mt-1">Multi-line. One paragraph per line break. Default is generated from firm name + nature of business; edit for specifics. AI generation also fills Machinery / Premises / Power / ROI notes on the Introduction sheet.</p>
              </div>
              <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
                <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">BEP — Variable cost % per line (used by the BEP sheet)</div>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    ['pl_cogs', 'Cost of Goods Sold'],
                    ['pl_operating_expense', 'Selling, Gen &amp; Admin'],
                    ['pl_depreciation', 'Depreciation'],
                    ['pl_finance_cost', 'Interest / Finance Cost'],
                  ] as const).map(([key, label]) => {
                    const current = draft.bep?.variableFractionByKey?.[key];
                    const defaultVal = bepDefaults.variableFractionByKey?.[key] ?? 0;
                    return (
                      <label key={key} className="flex items-center gap-2 text-xs">
                        <span className="w-44 text-gray-500 dark:text-gray-400" dangerouslySetInnerHTML={{ __html: label }} />
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={current ?? defaultVal}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (!Number.isFinite(v)) return;
                            setBepFraction(key, Math.max(0, Math.min(1, v)));
                          }}
                          className="w-20 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm"
                        />
                        <span className="text-gray-400">({Math.round((current ?? defaultVal) * 100)}% variable)</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-2">0 = fully fixed, 1 = fully variable. Defaults: COGS 100%, SG&amp;A 20%, Dep 0%, Interest 0%.</p>
              </div>
            </div>
          )}
        </Card>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {computed ? 'Ready to download. The Excel file has live formulas — every output cell is auditable.' : 'Resolve the errors above to enable download.'}
        </p>
        <button
          type="button"
          onClick={onDownload}
          disabled={!computed || downloading}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" />
          {downloading ? 'Building Excel…' : 'Download CMA report'}
        </button>
      </div>
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-4">
      <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-medium">{label}</p>
      <p className={cn(
        'text-lg font-bold mt-1 tabular-nums',
        tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400',
      )}>{value}</p>
    </div>
  );
}

function StressCell({ label, base, stressed, formatter }: { label: string; base: number; stressed: number; formatter: (n: number) => string }) {
  const delta = stressed - base;
  return (
    <div>
      <p className="text-[11px] uppercase text-gray-500 dark:text-gray-400 font-medium tracking-wider">{label}</p>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{formatter(base)}</span>
        <span className="text-xs text-gray-400">→</span>
        <span className="text-sm font-medium text-amber-700 dark:text-amber-400">{formatter(stressed)}</span>
      </div>
      <p className={cn(
        'text-[11px] mt-0.5',
        delta < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-500',
      )}>
        {delta < 0 ? '↓' : delta > 0 ? '↑' : '='} {formatter(Math.abs(delta))}
      </p>
    </div>
  );
}
