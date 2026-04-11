import { useState } from 'react';
import { BoardResolutionDraft } from '../lib/uiModel';
import { Card } from '../../itr/shared/Inputs';
import { TEMPLATES } from '../lib/resolutionTemplates';
import { renderBoardResolutionPdf } from '../lib/pdfExport';
import { AlertTriangle, Download } from 'lucide-react';

interface Props {
  draft: BoardResolutionDraft;
  onChange: (patch: Partial<BoardResolutionDraft> | ((p: BoardResolutionDraft) => BoardResolutionDraft)) => void;
}

export function ReviewStep({ draft }: Props) {
  const tpl = TEMPLATES[draft.templateId];
  const bodyParas = tpl.body(draft);
  const [exporting, setExporting] = useState(false);

  const onDownload = async () => {
    setExporting(true);
    try {
      await renderBoardResolutionPdf(draft);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'PDF generation failed');
    } finally {
      setExporting(false);
    }
  };

  const c = draft.company ?? {};
  const m = draft.meeting ?? {};
  const s = draft.signatories ?? {};

  return (
    <div className="space-y-4">
      {/* Disclaimer */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40">
        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            Template draft — review before filing
          </p>
          <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 leading-relaxed">
            This resolution is generated from a standard template. Please have it reviewed by a qualified
            Company Secretary before filing with the Registrar of Companies or sharing with third parties.
          </p>
        </div>
      </div>

      {/* Preview card */}
      <Card title={`Preview — ${tpl.title}`}>
        <div className="space-y-4 text-xs">
          {/* Header block */}
          <div className="text-center border-b border-gray-200 dark:border-gray-800 pb-3">
            <p className="text-base font-bold text-gray-900 dark:text-gray-100 uppercase">
              {c.name || 'Company Name'}
            </p>
            {c.cin && <p className="text-[11px] text-gray-500">CIN: {c.cin}</p>}
            {c.registeredOffice && (
              <p className="text-[11px] text-gray-500">Registered Office: {c.registeredOffice}</p>
            )}
          </div>

          {/* Certified true copy line */}
          <p className="font-semibold text-gray-700 dark:text-gray-300 leading-relaxed">
            CERTIFIED TRUE COPY OF THE RESOLUTION PASSED AT THE MEETING OF THE BOARD OF DIRECTORS OF{' '}
            <span className="uppercase">{c.name || 'THE COMPANY'}</span> HELD ON{' '}
            {m.date || '__________'}
            {m.time ? ` AT ${m.time}` : ''} AT {m.place || '__________'}
          </p>

          {/* Title */}
          <div>
            <p className="text-sm font-bold uppercase text-gray-900 dark:text-gray-100">{tpl.title}</p>
            <p className="text-[10px] italic text-gray-500 mt-0.5">
              Under the authority of: {tpl.governingSections.join(' · ')}
            </p>
          </div>

          {/* Body paragraphs */}
          <div className="space-y-3">
            {bodyParas.map((p, i) => (
              <p key={i} className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">
                {p}
              </p>
            ))}
          </div>

          {/* Signature block */}
          <div className="pt-4 border-t border-gray-200 dark:border-gray-800 space-y-1">
            <p className="text-gray-700 dark:text-gray-300">For {c.name || '__________'}</p>
            <div className="border-b border-gray-300 dark:border-gray-700 w-48 mt-6 mb-1" />
            <p className="font-semibold text-gray-900 dark:text-gray-100">{s.certifiedBy?.name || '__________'}</p>
            {s.certifiedBy?.designation && <p className="text-gray-600 dark:text-gray-400">{s.certifiedBy.designation}</p>}
            {s.certifiedBy?.din && <p className="text-gray-600 dark:text-gray-400">DIN: {s.certifiedBy.din}</p>}
            <p className="text-gray-600 dark:text-gray-400">Date: {m.date || '__________'}</p>
            <p className="text-gray-600 dark:text-gray-400">Place: {m.place || '__________'}</p>
          </div>
        </div>
      </Card>

      {/* Export */}
      <Card title="Export">
        <button
          onClick={onDownload}
          disabled={exporting}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-400 text-white shadow-md shadow-emerald-600/20 transition-all"
        >
          <Download className="w-4 h-4" />
          {exporting ? 'Generating…' : 'Download PDF'}
        </button>
      </Card>
    </div>
  );
}
