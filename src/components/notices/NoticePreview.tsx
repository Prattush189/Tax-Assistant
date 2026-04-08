import { useRef, useCallback } from 'react';
import { Download, Copy, Check, Trash2, Edit3 } from 'lucide-react';
import { useState } from 'react';

interface NoticePreviewProps {
  content: string;
  onContentChange: (content: string) => void;
  isGenerating: boolean;
  onClear: () => void;
}

export function NoticePreview({ content, onContentChange, isGenerating, onClear }: NoticePreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const handleDownloadPdf = useCallback(async () => {
    // Dynamic import to avoid bundle bloat
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    const margin = 20;
    const pageWidth = 210 - margin * 2;
    const lineHeight = 6;
    let y = margin;

    doc.setFont('times', 'normal');
    doc.setFontSize(12);

    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      // Bold for Subject, Ref, Enclosures headers
      if (/^(Subject:|Ref:|Enclosures:|Yours faithfully|Respected Sir\/Madam)/i.test(trimmed)) {
        doc.setFont('times', 'bold');
      } else {
        doc.setFont('times', 'normal');
      }

      // Wrap long lines
      const wrapped = doc.splitTextToSize(trimmed || ' ', pageWidth);
      for (const wLine of wrapped) {
        if (y > 280) {
          doc.addPage();
          y = margin;
        }
        doc.text(wLine, margin, y);
        y += lineHeight;
      }
    }

    doc.save('notice-reply.pdf');
  }, [content]);

  const handleEditBlur = useCallback(() => {
    if (previewRef.current) {
      onContentChange(previewRef.current.innerText);
    }
    setIsEditing(false);
  }, [onContentChange]);

  if (!content && !isGenerating) {
    return (
      <div className="flex-1 flex items-center justify-center text-center p-8">
        <div className="space-y-3">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
            <img src="/logoAI.png" alt="" className="w-10 h-10 object-contain" />
          </div>
          <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300">Notice Draft Preview</h3>
          <p className="text-sm text-slate-400 max-w-xs">
            Fill in the details and click "Generate Draft" to create a professional notice reply.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-700/50 shrink-0">
        <button
          onClick={() => setIsEditing(!isEditing)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            isEditing
              ? 'bg-[#059669]/10 text-[#047857] dark:text-[#059669]'
              : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Edit3 className="w-3.5 h-3.5" />
          {isEditing ? 'Editing' : 'Edit'}
        </button>
        <button
          onClick={handleCopy}
          disabled={!content}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          onClick={handleDownloadPdf}
          disabled={!content || isGenerating}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" />
          PDF
        </button>
        <div className="flex-1" />
        <button
          onClick={onClear}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear
        </button>
      </div>

      {/* PDF-style preview */}
      <div className="flex-1 overflow-y-auto p-4 lg:p-8 bg-slate-100 dark:bg-slate-900/50">
        <div className="max-w-[210mm] mx-auto bg-white dark:bg-slate-800 shadow-xl rounded-sm min-h-[297mm]">
          <div
            ref={previewRef}
            contentEditable={isEditing}
            suppressContentEditableWarning
            onBlur={handleEditBlur}
            className={`p-[20mm] font-serif text-[12px] leading-[1.8] text-slate-800 dark:text-slate-200 whitespace-pre-wrap outline-none min-h-[297mm] ${
              isEditing ? 'ring-2 ring-[#059669]/30 ring-inset' : ''
            }`}
            style={{ fontFamily: "'Times New Roman', 'Georgia', serif" }}
          >
            {content}
            {isGenerating && (
              <span className="inline-block w-0.5 h-4 bg-[#059669] animate-pulse ml-0.5 align-middle" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
