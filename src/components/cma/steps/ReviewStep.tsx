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
import { Download, AlertTriangle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../../itr/shared/Inputs';
import { cn, formatINR } from '../../../lib/utils';
import { markCmaExported } from '../../../services/api';
import { resolveHistorical } from '../lib/resolveHistorical';
import { runProjection } from '../lib/projectionEngine';
import { computeMpbf } from '../lib/mpbf';
import { computeRatios, gradeRatio } from '../lib/ratios';
import { applyStressTest } from '../lib/stressTest';
import { buildCmaWorkbook } from '../lib/excelExport';
import type { CmaDraft } from '../lib/uiModel';

interface Props {
  draft: CmaDraft;
  draftId: string | null;
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

export function ReviewStep({ draft, draftId }: Props) {
  const [downloading, setDownloading] = useState(false);
  const issues = useMemo(() => validate(draft), [draft]);
  const hasErrors = issues.some((i) => i.level === 'error');

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
