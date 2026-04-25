import { useState } from 'react';
import { Sparkles, Download, AlertTriangle, Loader2 } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PartnershipDeedDraft } from '../lib/uiModel';
import { TEMPLATE_TITLES } from '../lib/uiModel';
import { templateById } from '../lib/templates';
import { validateDraft } from '../lib/validation';
import { renderPartnershipDeedPdf } from '../lib/pdfExport';
import { markPartnershipDeedExported } from '../../../services/api';
import { Card } from '../../itr/shared/Inputs';
import { cn } from '../../../lib/utils';

interface Props {
  draft: PartnershipDeedDraft;
  draftId: string;
  /** Streaming markdown body (live during generation, persisted after). */
  generatedContent: string;
  isGenerating: boolean;
  error: string | null;
  errorKind: 'quota' | 'generic' | null;
  usage: { used: number; limit: number };
  onGenerate: () => void;
  onUpgrade: () => void;
}

export function ReviewStep({
  draft,
  draftId,
  generatedContent,
  isGenerating,
  error,
  errorKind,
  usage,
  onGenerate,
  onUpgrade,
}: Props) {
  const [downloading, setDownloading] = useState(false);
  const validation = validateDraft(draft);
  const meta = templateById(draft.templateId);
  const used = usage.used;
  const limit = usage.limit;
  const remaining = Math.max(0, limit - used);

  const handleDownload = async () => {
    if (!generatedContent) return;
    setDownloading(true);
    try {
      await renderPartnershipDeedPdf(draft, generatedContent);
      // Best-effort — don't block the UX if the timestamp update fails.
      try {
        await markPartnershipDeedExported(draftId);
      } catch { /* ignore */ }
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card title="Generate the deed">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {TEMPLATE_TITLES[draft.templateId]}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-500">{meta.governingAct}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1">
              {used} of {limit} deeds used this month — {remaining} remaining.
            </p>
          </div>
          <button
            type="button"
            onClick={onGenerate}
            disabled={!validation.ok || isGenerating || remaining <= 0}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl transition-all',
              validation.ok && !isGenerating && remaining > 0
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed',
            )}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                {generatedContent ? 'Regenerate' : 'Generate deed'}
              </>
            )}
          </button>
        </div>

        {!validation.ok && (
          <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg">
            <div className="flex items-start gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Fix these before generating:
              </p>
            </div>
            <ul className="text-[12px] text-amber-700 dark:text-amber-300 list-disc pl-9 space-y-0.5">
              {validation.errors.slice(0, 8).map((err, i) => (
                <li key={i}>{err}</li>
              ))}
              {validation.errors.length > 8 && (
                <li>… and {validation.errors.length - 8} more</li>
              )}
            </ul>
          </div>
        )}

        {error && (
          <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            {errorKind === 'quota' && (
              <button
                type="button"
                onClick={onUpgrade}
                className="mt-2 text-sm font-medium text-red-700 dark:text-red-300 underline"
              >
                View upgrade options →
              </button>
            )}
          </div>
        )}
      </Card>

      {(generatedContent || isGenerating) && (
        <Card
          title="Preview"
          action={
            <button
              type="button"
              onClick={handleDownload}
              disabled={!generatedContent || downloading}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                generatedContent && !downloading
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed',
              )}
            >
              <Download className="w-3.5 h-3.5" />
              {downloading ? 'Preparing…' : 'Download PDF'}
            </button>
          }
        >
          <div className="max-h-[500px] overflow-y-auto px-1 prose prose-sm dark:prose-invert max-w-none prose-headings:text-gray-900 dark:prose-headings:text-gray-100 prose-p:text-gray-700 dark:prose-p:text-gray-300">
            {generatedContent ? (
              <Markdown remarkPlugins={[remarkGfm]}>{generatedContent}</Markdown>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
                Streaming…
              </p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
