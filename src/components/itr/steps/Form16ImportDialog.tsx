import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, FileUp, Loader2, Upload, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { importForm16, Form16ExtractedData } from '../../../services/api';

type Phase = 'form' | 'uploading' | 'success' | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported?: (data: Form16ExtractedData) => void;
}

function formatRupee(v: number | null): string {
  if (v == null) return '--';
  return '\u20B9' + v.toLocaleString('en-IN');
}

export function Form16ImportDialog({ open, onClose, onImported }: Props) {
  const [phase, setPhase] = useState<Phase>('form');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Form16ExtractedData | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPhase('form');
      setFile(null);
      setError(null);
      setResult(null);
      setDragOver(false);
    }
  }, [open]);

  const handleFile = useCallback((f: File) => {
    if (f.type !== 'application/pdf') {
      setError('Please select a PDF file.');
      return;
    }
    if (f.size > 500 * 1024) {
      setError('File exceeds the 500 KB limit.');
      return;
    }
    setError(null);
    setFile(f);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const handleSubmit = async () => {
    if (!file) return;
    setError(null);
    setPhase('uploading');
    try {
      const res = await importForm16(file);
      setResult(res.extractedData);
      setPhase('success');
      onImported?.(res.extractedData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
      setPhase('error');
    }
  };

  if (!open) return null;

  const canSubmit = file !== null && phase === 'form';

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={phase !== 'uploading' ? onClose : undefined}
    >
      <div
        className="bg-white dark:bg-[#1a1714] rounded-2xl shadow-2xl max-w-lg w-full border border-gray-200 dark:border-gray-800 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <FileUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Import from Form 16
              </h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-500">
                Upload PDF to auto-fill salary and deductions
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={phase === 'uploading'}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-30"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {phase === 'form' && (
            <>
              {/* Drop zone */}
              <div
                className={cn(
                  'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
                  dragOver
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                    : file
                      ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10'
                      : 'border-gray-300 dark:border-gray-700 hover:border-emerald-400 dark:hover:border-emerald-600',
                )}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
                <Upload className="w-8 h-8 text-gray-400 dark:text-gray-500 mx-auto mb-2" />
                {file ? (
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                    {file.name}
                    <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">
                      ({(file.size / 1024).toFixed(0)} KB)
                    </span>
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      Drop your Form 16 PDF here, or <span className="text-emerald-600 dark:text-emerald-400 font-medium">browse</span>
                    </p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                      PDF only, max 500 KB
                    </p>
                  </>
                )}
              </div>

              {error && (
                <p className="text-[11px] text-red-500">{error}</p>
              )}

              <p className="text-[11px] text-gray-500 dark:text-gray-500 leading-relaxed">
                We will use AI to extract salary details, deductions under Chapter VI-A, and TDS
                from your Form 16 and auto-fill the income fields. You can review and edit before saving.
              </p>
            </>
          )}

          {phase === 'uploading' && (
            <div className="py-6 flex flex-col items-center text-center">
              <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mb-3" />
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Extracting data from Form 16...
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1 max-w-[280px]">
                Parsing PDF and extracting salary, deductions, and TDS information. This may take 5-15 seconds.
              </p>
            </div>
          )}

          {phase === 'success' && result && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/40">
                <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                    Extraction successful
                  </p>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                    Fields have been auto-filled. Review the values below.
                  </p>
                </div>
              </div>

              <dl className="text-xs space-y-1.5 bg-gray-50 dark:bg-gray-900/40 rounded-xl p-3">
                {result.employerName && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-500">Employer</dt>
                    <dd className="text-gray-900 dark:text-gray-100 font-medium text-right max-w-[60%] truncate">{result.employerName}</dd>
                  </div>
                )}
                {result.employeeName && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-500">Employee</dt>
                    <dd className="text-gray-900 dark:text-gray-100 font-medium">{result.employeeName}</dd>
                  </div>
                )}
                {result.pan && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-500">PAN</dt>
                    <dd className="text-gray-900 dark:text-gray-100 font-mono">{result.pan}</dd>
                  </div>
                )}
                {result.assessmentYear && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-500">Assessment Year</dt>
                    <dd className="text-gray-900 dark:text-gray-100 font-medium">{result.assessmentYear}</dd>
                  </div>
                )}
                <div className="border-t border-gray-200 dark:border-gray-800 my-1.5" />
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-500">Gross Salary</dt>
                  <dd className="text-gray-900 dark:text-gray-100 font-medium">{formatRupee(result.grossSalary)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-500">Standard Deduction</dt>
                  <dd className="text-gray-900 dark:text-gray-100 font-medium">{formatRupee(result.standardDeduction16ia)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-500">Professional Tax</dt>
                  <dd className="text-gray-900 dark:text-gray-100 font-medium">{formatRupee(result.professionalTax16iii)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-500">TDS on Salary</dt>
                  <dd className="text-gray-900 dark:text-gray-100 font-medium">{formatRupee(result.tdsOnSalary)}</dd>
                </div>
                {(result.section80C || result.section80D || result.section80CCD1B || result.section80E || result.section80G || result.section80TTA) && (
                  <>
                    <div className="border-t border-gray-200 dark:border-gray-800 my-1.5" />
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Deductions (Ch VI-A)</p>
                    {result.section80C != null && result.section80C > 0 && (
                      <div className="flex justify-between">
                        <dt className="text-gray-500 dark:text-gray-500">80C</dt>
                        <dd className="text-gray-900 dark:text-gray-100 font-medium">{formatRupee(result.section80C)}</dd>
                      </div>
                    )}
                    {result.section80D != null && result.section80D > 0 && (
                      <div className="flex justify-between">
                        <dt className="text-gray-500 dark:text-gray-500">80D</dt>
                        <dd className="text-gray-900 dark:text-gray-100 font-medium">{formatRupee(result.section80D)}</dd>
                      </div>
                    )}
                    {result.section80CCD1B != null && result.section80CCD1B > 0 && (
                      <div className="flex justify-between">
                        <dt className="text-gray-500 dark:text-gray-500">80CCD(1B)</dt>
                        <dd className="text-gray-900 dark:text-gray-100 font-medium">{formatRupee(result.section80CCD1B)}</dd>
                      </div>
                    )}
                    {result.section80E != null && result.section80E > 0 && (
                      <div className="flex justify-between">
                        <dt className="text-gray-500 dark:text-gray-500">80E</dt>
                        <dd className="text-gray-900 dark:text-gray-100 font-medium">{formatRupee(result.section80E)}</dd>
                      </div>
                    )}
                    {result.section80G != null && result.section80G > 0 && (
                      <div className="flex justify-between">
                        <dt className="text-gray-500 dark:text-gray-500">80G</dt>
                        <dd className="text-gray-900 dark:text-gray-100 font-medium">{formatRupee(result.section80G)}</dd>
                      </div>
                    )}
                    {result.section80TTA != null && result.section80TTA > 0 && (
                      <div className="flex justify-between">
                        <dt className="text-gray-500 dark:text-gray-500">80TTA</dt>
                        <dd className="text-gray-900 dark:text-gray-100 font-medium">{formatRupee(result.section80TTA)}</dd>
                      </div>
                    )}
                  </>
                )}
              </dl>
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                    Extraction failed
                  </p>
                  <p className="text-[11px] text-red-700 dark:text-red-400 mt-0.5 break-words">
                    {error ?? 'Unknown error'}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-500 leading-relaxed">
                Ensure the file is a valid Form 16 PDF (not password-protected or scanned at very low resolution).
                If the error persists, try entering the details manually.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end p-5 pt-0">
          {phase === 'form' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={cn(
                  'px-4 py-2 text-sm font-semibold rounded-lg transition-all',
                  canSubmit
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/20'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed',
                )}
              >
                Extract &amp; Import
              </button>
            </>
          )}
          {phase === 'success' && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            >
              Done
            </button>
          )}
          {phase === 'error' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => { setPhase('form'); setError(null); }}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
              >
                Try again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
