import { useCallback, useEffect, useState } from 'react';
import { ItrWizardDraft } from '../lib/uiModel';
import { toCbdtJson, computeDerivedTotals } from '../lib/toCbdtJson';
import { Card, Field, RupeeInput, Toggle } from '../shared/Inputs';
import {
  validateItr,
  finalizeItr,
  ItrValidationResult,
  ItrFinalizeResult,
} from '../../../services/api';
import { ItrManager } from '../../../hooks/useItrManager';
import { AlertTriangle, CheckCircle, Download, FileText, RefreshCw, ExternalLink } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { renderItrPdf } from '../lib/pdfExport';

interface Props {
  draft: ItrWizardDraft;
  onChange: (patch: Partial<ItrWizardDraft> | ((p: ItrWizardDraft) => ItrWizardDraft)) => void;
  manager: ItrManager;
}

export function ReviewStep({ draft, onChange, manager }: Props) {
  const [result, setResult] = useState<ItrValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showHandoff, setShowHandoff] = useState(false);

  const materialized = computeDerivedTotals(draft);
  const cbdtEnvelope = toCbdtJson(materialized);

  const runValidate = useCallback(async () => {
    setValidating(true);
    try {
      const r = await validateItr({
        form_type: draft.formType,
        payload: cbdtEnvelope,
        draft_id: manager.currentDraftId ?? undefined,
      });
      setResult(r);
    } catch (e) {
      setResult({
        valid: false,
        schemaValid: false,
        schemaErrors: [{ path: '(root)', message: e instanceof Error ? e.message : 'Validation request failed' }],
        businessRules: [],
      });
    } finally {
      setValidating(false);
    }
  }, [draft.formType, JSON.stringify(cbdtEnvelope), manager.currentDraftId]);

  // Auto-validate on mount
  useEffect(() => {
    runValidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDownloadJson = async () => {
    setExporting(true);
    try {
      const r: ItrFinalizeResult = await finalizeItr({
        form_type: draft.formType,
        payload: cbdtEnvelope,
        draft_id: manager.currentDraftId ?? undefined,
      });
      if (!r.valid || !r.payload) {
        setResult(r);
        alert('Validation failed — see the errors list before exporting.');
        return;
      }
      const blob = new Blob([JSON.stringify(r.payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${draft.formType}_${draft.assessmentYear}_${draft.PersonalInfo?.PAN ?? 'draft'}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setShowHandoff(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const onDownloadPdf = async () => {
    try {
      await renderItrPdf(materialized);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'PDF generation failed');
    }
  };

  // Late-fee helper for belated returns
  const isBelated = draft.FilingStatus?.ReturnFileSec === 12;
  const totalIncome = materialized.ITR1_IncomeDeductions?.TotalIncome ?? 0;
  const expectedLateFee = totalIncome <= 500000 ? 1000 : 5000;
  const currentLateFee = materialized.ITR1_TaxComputation?.IntrstPay?.LateFilingFee234F ?? 0;
  const applyLateFee = () => {
    onChange((prev) => ({
      ...prev,
      ITR1_TaxComputation: {
        ...(prev.ITR1_TaxComputation ?? {}),
        IntrstPay: {
          ...(prev.ITR1_TaxComputation?.IntrstPay ?? {}),
          LateFilingFee234F: expectedLateFee,
        },
      },
    }));
  };

  const schemaErrorCount = result?.schemaErrors.length ?? 0;
  const brBlocking = (result?.businessRules ?? []).filter((v) => v.severity === 'error');

  return (
    <div className="space-y-4">
      {/* Validation status */}
      <Card
        title="Validation"
        action={
          <button
            onClick={runValidate}
            disabled={validating}
            className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', validating && 'animate-spin')} />
            Re-check
          </button>
        }
      >
        {!result ? (
          <p className="text-sm text-gray-400">Running checks…</p>
        ) : result.valid ? (
          <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/40">
            <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                All schema + business rule checks passed.
              </p>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">
                You can export the JSON now. Run the gov Common Utility for final business-rule validation before upload.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                  {schemaErrorCount + brBlocking.length} issue(s) — fix before export
                </p>
                <p className="text-[11px] text-red-700 dark:text-red-400 mt-0.5">
                  Schema errors: {schemaErrorCount} · Business-rule errors: {brBlocking.length}
                </p>
              </div>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-1 text-xs">
              {result.schemaErrors.slice(0, 20).map((err, i) => (
                <div
                  key={`schema-${i}`}
                  className="p-2 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800"
                >
                  <code className="text-[10px] text-gray-500 dark:text-gray-500">{err.path || '(root)'}</code>
                  <p className="text-xs text-gray-700 dark:text-gray-300">{err.message}</p>
                </div>
              ))}
              {result.schemaErrors.length > 20 && (
                <p className="text-[11px] text-gray-400 text-center">
                  … and {result.schemaErrors.length - 20} more schema errors
                </p>
              )}
              {brBlocking.map((v, i) => (
                <div
                  key={`br-${i}`}
                  className="p-2 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/40"
                >
                  <code className="text-[10px] text-amber-700 dark:text-amber-400">{v.ruleId} · {v.path}</code>
                  <p className="text-xs text-amber-800 dark:text-amber-300">{v.message}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Belated return fee warning */}
      {isBelated && (
        <Card title="Late filing fee (u/s 234F)">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                You selected 139(4) — belated return.
              </p>
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                Late fee applicable: <strong>₹{expectedLateFee.toLocaleString('en-IN')}</strong>
                {' '}(total income {totalIncome <= 500000 ? '≤' : '>'} ₹5,00,000).
                Current value in draft: ₹{currentLateFee.toLocaleString('en-IN')}.
              </p>
              {currentLateFee !== expectedLateFee && (
                <button
                  onClick={applyLateFee}
                  className="mt-2 text-xs font-semibold text-amber-800 dark:text-amber-300 underline"
                >
                  Auto-fill ₹{expectedLateFee.toLocaleString('en-IN')}
                </button>
              )}
            </div>
          </div>
          <Field label="Late filing fee (override)">
            <RupeeInput
              value={currentLateFee}
              onChange={(v) =>
                onChange((prev) => ({
                  ...prev,
                  ITR1_TaxComputation: {
                    ...(prev.ITR1_TaxComputation ?? {}),
                    IntrstPay: {
                      ...(prev.ITR1_TaxComputation?.IntrstPay ?? {}),
                      LateFilingFee234F: v,
                    },
                  },
                }))
              }
            />
          </Field>
        </Card>
      )}

      {/* Totals summary */}
      <Card title="Totals summary">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <SummaryRow label="Gross salary" value={materialized.ITR1_IncomeDeductions?.GrossSalary ?? 0} />
          <SummaryRow label="Income from salary" value={materialized.ITR1_IncomeDeductions?.IncomeFromSal ?? 0} />
          <SummaryRow label="House property" value={materialized.ITR1_IncomeDeductions?.TotalIncomeOfHP ?? 0} />
          <SummaryRow label="Other sources" value={materialized.ITR1_IncomeDeductions?.IncomeOthSrc ?? 0} />
          <SummaryRow label="Gross total income" value={materialized.ITR1_IncomeDeductions?.GrossTotIncome ?? 0} />
          <SummaryRow label="Chapter VI-A" value={materialized.ITR1_IncomeDeductions?.UsrDeductUndChapVIA?.TotalChapVIADeductions ?? 0} />
          <SummaryRow label="Taxable income" value={materialized.ITR1_IncomeDeductions?.TotalIncome ?? 0} highlight />
          <SummaryRow label="Total taxes paid" value={materialized.TaxPaid?.TaxesPaid?.TotalTaxesPaid ?? 0} />
          <SummaryRow label="LTCG 112A" value={materialized.LTCG112A?.LongCap112A ?? 0} />
        </div>
      </Card>

      {/* Export actions */}
      <Card title="Export">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onDownloadJson}
            disabled={exporting || !result?.valid}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all',
              result?.valid && !exporting
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed',
            )}
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting…' : 'Download JSON'}
          </button>
          <button
            onClick={onDownloadPdf}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-200 transition-colors"
          >
            <FileText className="w-4 h-4" />
            Download PDF preview
          </button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-500 leading-relaxed">
          The JSON uses a placeholder SWCreatedBy (<code>SW00000000</code>). You MUST import it into the
          government's offline Common Utility (ITDe-Filing) and re-export before uploading to
          incometax.gov.in — the utility rewrites the software ID and runs the final business-rule
          checks.
        </p>
      </Card>

      {/* Common Utility hand-off modal */}
      {showHandoff && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowHandoff(false)}
        >
          <div
            className="bg-white dark:bg-[#1a1714] rounded-2xl shadow-2xl p-6 max-w-lg w-full border border-gray-200 dark:border-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">JSON downloaded</h3>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Next steps to upload this return to the Income Tax portal:
            </p>
            <ol className="space-y-2 text-sm text-gray-700 dark:text-gray-300 mb-5">
              <li>
                <strong>1.</strong> Install the official{' '}
                <a
                  href="https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns"
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-600 hover:underline inline-flex items-center gap-0.5"
                >
                  Common Offline Utility
                  <ExternalLink className="w-3 h-3" />
                </a>
                {' '}(for AY 2025-26).
              </li>
              <li><strong>2.</strong> Open the utility → "Import Draft JSON" → pick the file you just downloaded.</li>
              <li><strong>3.</strong> Run "Validate" inside the utility — it applies CBDT's full business-rule check.</li>
              <li><strong>4.</strong> If clean, the utility re-exports a signed JSON you can upload at incometax.gov.in under your login.</li>
              <li><strong>5.</strong> Complete EVC / DSC verification.</li>
            </ol>
            <button
              onClick={() => setShowHandoff(false)}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2 rounded-xl transition-colors text-sm"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-col p-2 rounded-lg',
        highlight ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-gray-50 dark:bg-gray-900/40',
      )}
    >
      <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wider">
        {label}
      </p>
      <p className={cn('font-bold', highlight ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-900 dark:text-gray-100')}>
        ₹{value.toLocaleString('en-IN')}
      </p>
    </div>
  );
}
