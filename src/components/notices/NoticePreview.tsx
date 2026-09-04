import { useRef, useCallback, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Download, Copy, Check, Trash2, Edit3, AlertTriangle, Sparkles, X, CornerDownLeft } from 'lucide-react';
import { LetterheadConfig } from '../../hooks/useNoticeDrafter';
import { LoadingAnimation } from '../ui/LoadingAnimation';
import { renderMarkdownToPdf } from '../../lib/markdownPdf';
import { downloadAsWord } from '../../lib/markdownDoc';

interface NoticePreviewProps {
  content: string;
  onContentChange: (content: string) => void;
  isGenerating: boolean;
  onClear: () => void;
  letterhead: LetterheadConfig;
  /** Refine the saved draft from a plain-language instruction.
   *  Omitted (with canEnhance false) until a draft has been saved. */
  onEnhance?: (instruction: string) => void | Promise<unknown>;
  isEnhancing?: boolean;
  canEnhance?: boolean;
}

/** Load an image data URL and return dimensions + format for jsPDF */
function loadImage(dataUrl: string): Promise<{ img: HTMLImageElement; format: 'PNG' | 'JPEG' }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const format: 'PNG' | 'JPEG' = dataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
      resolve({ img, format });
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export function NoticePreview({ content, onContentChange, isGenerating, onClear, letterhead, onEnhance, isEnhancing = false, canEnhance = false }: NoticePreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const [enhanceText, setEnhanceText] = useState('');

  // Any AI run in flight — generation or enhancement. Both must lock the
  // toolbar, otherwise the user can edit or re-enhance text that is
  // still being streamed over.
  const busy = isGenerating || isEnhancing;

  const submitEnhance = useCallback(async () => {
    const instruction = enhanceText.trim();
    if (!instruction || !onEnhance) return;
    // Leave edit mode first — the textarea would otherwise sit on stale
    // text while the stream replaces the draft underneath it.
    setIsEditing(false);
    await onEnhance(instruction);
    setEnhanceText('');
    setEnhanceOpen(false);
  }, [enhanceText, onEnhance]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const handleDownloadPdf = useCallback(async () => {
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    const margin = 20;
    const pageWidthMm = 210;
    const pageHeightMm = 297;
    const usableWidth = pageWidthMm - margin * 2;

    // --- Watermark painter (called per page) ---
    const paintWatermark = async () => {
      if (!letterhead.watermark.enabled) return;
      const opacity = Math.max(0.05, Math.min(0.5, letterhead.watermark.opacity / 100));
      const gs: Record<string, unknown> = (doc as unknown as { setGState?: (gs: unknown) => void; GState?: new (opts: unknown) => unknown });
      try {
        if (gs.GState && gs.setGState) {
          const GState = gs.GState as unknown as new (opts: unknown) => unknown;
          (gs.setGState as (gs: unknown) => void)(new GState({ opacity }));
        }
      } catch { /* GState not available in some jsPDF versions */ }

      if (letterhead.watermark.type === 'text' && letterhead.watermark.text.trim()) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(72);
        doc.setTextColor(120, 120, 120);
        doc.text(letterhead.watermark.text, pageWidthMm / 2, pageHeightMm / 2, {
          align: 'center',
          angle: 45,
        });
        doc.setTextColor(0, 0, 0);
      } else if (letterhead.watermark.type === 'image' && letterhead.watermark.imageDataUrl) {
        try {
          const { img, format } = await loadImage(letterhead.watermark.imageDataUrl);
          const maxW = 120;
          const scale = Math.min(maxW / img.width, maxW / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          doc.addImage(
            letterhead.watermark.imageDataUrl,
            format,
            (pageWidthMm - w) / 2,
            (pageHeightMm - h) / 2,
            w,
            h,
          );
        } catch { /* image load failed — skip */ }
      }

      try {
        if (gs.GState && gs.setGState) {
          const GState = gs.GState as unknown as new (opts: unknown) => unknown;
          (gs.setGState as (gs: unknown) => void)(new GState({ opacity: 1 }));
        }
      } catch { /* ignore */ }
    };

    // --- Header painter (called on first page + after page breaks) ---
    const paintHeader = async () => {
      if (!letterhead.header.enabled) return 0;
      let bottomY = margin;

      if (letterhead.header.type === 'text' && letterhead.header.text.trim()) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        const lines = letterhead.header.text.split('\n');
        let ty = margin;
        const align = letterhead.header.align;
        const xPos = align === 'left' ? margin : align === 'right' ? pageWidthMm - margin : pageWidthMm / 2;
        for (const line of lines) {
          doc.text(line, xPos, ty, { align });
          ty += 6;
        }
        doc.setDrawColor(180, 180, 180);
        doc.line(margin, ty + 1, pageWidthMm - margin, ty + 1);
        bottomY = ty + 6;
      } else if (letterhead.header.type === 'image' && letterhead.header.imageDataUrl) {
        try {
          const { img, format } = await loadImage(letterhead.header.imageDataUrl);
          const maxH = 20;
          const maxW = usableWidth;
          const scale = Math.min(maxW / img.width, maxH / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          const align = letterhead.header.align;
          const x = align === 'left' ? margin : align === 'right' ? pageWidthMm - margin - w : (pageWidthMm - w) / 2;
          doc.addImage(letterhead.header.imageDataUrl, format, x, margin, w, h);
          doc.setDrawColor(180, 180, 180);
          doc.line(margin, margin + h + 2, pageWidthMm - margin, margin + h + 2);
          bottomY = margin + h + 6;
        } catch { /* ignore */ }
      }
      return bottomY - margin;
    };

    await paintWatermark();
    const headerHeightMm = await paintHeader();

    await renderMarkdownToPdf(doc, content, {
      margin,
      pageWidthMm,
      pageHeightMm,
      startY: margin + headerHeightMm,
      onPageBreak: async () => {
        await paintWatermark();
        const hh = await paintHeader();
        return margin + hh;
      },
    });

    doc.save('notice-reply.pdf');
  }, [content, letterhead]);

  if (!content && !isGenerating) {
    return (
      <div className="flex-1 flex items-center justify-center text-center p-8">
        <div className="space-y-3">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <img src="/logoAI.png" alt="" className="w-10 h-10 object-contain" />
          </div>
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Notice Draft Preview</h3>
          <p className="text-sm text-gray-400 max-w-xs">
            Fill in the details and click "Generate Draft" to create a professional notice reply.
          </p>
        </div>
      </div>
    );
  }

  const headerAlignClass =
    letterhead.header.align === 'left' ? 'text-left'
    : letterhead.header.align === 'right' ? 'text-right'
    : 'text-center';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* AI verification banner — shown whenever there is content,
          so it's visible on freshly-generated drafts AND on reopened
          historical drafts. Wording lists the specific failure modes
          the post-flight pass can't catch (statutory text, procedural
          vehicle, eligibility / operative-form questions, arithmetic)
          so reviewers know exactly what to double-check. */}
      {content && !isGenerating && (
        <div className="flex items-start gap-2.5 px-4 py-2.5 border-b border-amber-200 dark:border-amber-900/50 bg-amber-50/80 dark:bg-amber-950/30 shrink-0">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-[12px] leading-snug text-amber-900 dark:text-amber-100">
            <span className="font-semibold">AI-generated draft — verify before filing.</span>{' '}
            Confirm every statutory quotation against the bare Act, every case-law citation against the linked source, the correct procedural vehicle (rectification u/s 154 vs appeal u/s 246A vs stay u/s 220(6)), eligibility for any tax option invoked, and the corresponding operative form (Form 10-IC / 10-ID / 10-IEA / 10) was filed in time. AI output is a starting point, not advice.
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700/50 shrink-0">
        <button
          // preventDefault stops the button stealing focus, which would
          // blur the textarea and run its onBlur -> setIsEditing(false)
          // BEFORE this click handler read the state. The handler then
          // saw isEditing === false and toggled straight back to true,
          // so clicking "Editing" never exited edit mode.
          onMouseDown={(e) => { if (isEditing) e.preventDefault(); }}
          onClick={() => setIsEditing(v => !v)}
          disabled={busy}
          title={isEditing ? 'Finish editing' : 'Edit the draft text directly'}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
            isEditing
              ? 'bg-[#059669]/10 text-[#047857] dark:text-[#059669]'
              : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          {isEditing ? <Check className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
          {isEditing ? 'Done' : 'Edit'}
        </button>
        {onEnhance && (
          <button
            onMouseDown={(e) => { if (isEditing) e.preventDefault(); }}
            onClick={() => { setIsEditing(false); setEnhanceOpen(o => !o); }}
            disabled={busy || !canEnhance || !content}
            title={canEnhance
              ? 'Ask AI to change or add something to this draft'
              : 'Generate a draft first, then you can refine it'}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
              enhanceOpen
                ? 'bg-[#059669]/10 text-[#047857] dark:text-[#059669]'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Enhance
          </button>
        )}
        <button
          onClick={handleCopy}
          disabled={!content || busy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          onClick={handleDownloadPdf}
          disabled={!content || busy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" />
          PDF
        </button>
        <button
          onClick={() => downloadAsWord(content)}
          disabled={!content || busy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
          title="Download as editable Word document (.doc)"
        >
          <Download className="w-3.5 h-3.5" />
          Word
        </button>
        {(isGenerating || isEnhancing) && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#059669] bg-[#059669]/10 rounded-lg">
            <LoadingAnimation size="xs" />
            <span>{isEnhancing ? 'Enhancing draft…' : 'Generating draft…'}</span>
          </div>
        )}
        <div className="flex-1" />
        <button
          onClick={onClear}
          disabled={isGenerating}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear
        </button>
      </div>

      {/* Enhance bar — plain-language instruction, applied to the saved draft */}
      {enhanceOpen && onEnhance && (
        <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700/50 bg-[#059669]/[0.04] shrink-0">
          <div className="flex items-start gap-2">
            <Sparkles className="w-3.5 h-3.5 text-[#059669] mt-2 shrink-0" />
            <textarea
              value={enhanceText}
              onChange={(e) => setEnhanceText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setEnhanceOpen(false); return; }
                // Enter submits; Shift+Enter makes a new line.
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitEnhance(); }
              }}
              disabled={isEnhancing}
              autoFocus
              rows={2}
              placeholder="What should change? e.g. “add that the tax was paid on 12 May 2025 vide challan 00123” or “make paragraph 3 firmer and cite s.144B(6)”"
              className="flex-1 resize-none px-2.5 py-1.5 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#059669]/30 text-gray-900 dark:text-gray-100 disabled:opacity-60"
            />
            <div className="flex flex-col gap-1 shrink-0">
              <button
                onClick={() => void submitEnhance()}
                disabled={isEnhancing || !enhanceText.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#059669] text-white hover:bg-[#047857] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isEnhancing ? <LoadingAnimation size="xs" /> : <CornerDownLeft className="w-3.5 h-3.5" />}
                {isEnhancing ? 'Working…' : 'Apply'}
              </button>
              <button
                onClick={() => { setEnhanceOpen(false); setEnhanceText(''); }}
                disabled={isEnhancing}
                className="flex items-center justify-center gap-1 px-3 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-40"
              >
                <X className="w-3 h-3" />
                Cancel
              </button>
            </div>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5 ml-6">
            Rewrites the whole letter with your change applied — everything else is preserved. Enter to apply, Shift+Enter for a new line.
          </p>
        </div>
      )}

      {/* PDF-style preview */}
      <div className="flex-1 overflow-y-auto p-4 lg:p-8 bg-gray-100 dark:bg-gray-900/50">
        <div
          ref={previewRef}
          className="max-w-[210mm] mx-auto bg-white dark:bg-gray-800 shadow-xl rounded-sm min-h-[297mm] relative overflow-hidden"
        >
          {/* Watermark overlay */}
          {letterhead.watermark.enabled && (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              style={{ opacity: letterhead.watermark.opacity / 100 }}
            >
              {letterhead.watermark.type === 'text' && letterhead.watermark.text.trim() && (
                <span
                  className="text-gray-400 dark:text-gray-300 font-bold select-none"
                  style={{ fontSize: '72px', transform: 'rotate(-45deg)', whiteSpace: 'nowrap' }}
                >
                  {letterhead.watermark.text}
                </span>
              )}
              {letterhead.watermark.type === 'image' && letterhead.watermark.imageDataUrl && (
                <img
                  src={letterhead.watermark.imageDataUrl}
                  alt=""
                  className="max-w-[60%] max-h-[60%] object-contain"
                />
              )}
            </div>
          )}

          {/* Content with optional header */}
          <div className="relative p-[20mm]">
            {/* Header / Letterhead */}
            {letterhead.header.enabled && (
              <div className={`mb-6 pb-3 border-b border-gray-300 dark:border-gray-600 ${headerAlignClass}`}>
                {letterhead.header.type === 'text' && letterhead.header.text.trim() && (
                  <div className="font-bold text-gray-800 dark:text-gray-200 whitespace-pre-line text-[14px] leading-tight">
                    {letterhead.header.text}
                  </div>
                )}
                {letterhead.header.type === 'image' && letterhead.header.imageDataUrl && (
                  <img
                    src={letterhead.header.imageDataUrl}
                    alt="Header"
                    className={`max-h-16 object-contain ${
                      letterhead.header.align === 'center' ? 'mx-auto'
                      : letterhead.header.align === 'right' ? 'ml-auto'
                      : ''
                    }`}
                  />
                )}
              </div>
            )}

            {/* Body — editable raw markdown textarea vs. rendered markdown */}
            {isEditing ? (
              <textarea
                value={content}
                onChange={(e) => onContentChange(e.target.value)}
                // No onBlur exit: it raced the Edit button (see above) and
                // also dropped the user out of edit mode whenever they
                // clicked Copy/PDF. "Done" and Esc are the explicit exits.
                onKeyDown={(e) => { if (e.key === 'Escape') setIsEditing(false); }}
                autoFocus
                className="w-full min-h-[200mm] font-serif text-[12px] leading-[1.8] text-gray-800 dark:text-gray-200 bg-transparent outline-none resize-none ring-2 ring-[#059669]/30 ring-inset rounded-sm p-2"
                style={{ fontFamily: "'Times New Roman', 'Georgia', serif" }}
              />
            ) : (
              <div
                className="notice-body prose prose-sm max-w-none text-gray-800 dark:text-gray-200 dark:prose-invert prose-headings:font-bold prose-headings:text-[#1e3a8a] prose-h2:text-[13px] prose-h2:uppercase prose-h2:tracking-wide prose-h2:border-b prose-h2:border-gray-300 prose-h2:pb-1 prose-h3:text-[12px] prose-h3:text-gray-900 dark:prose-h3:text-gray-100 prose-p:leading-[1.7] prose-blockquote:border-l-4 prose-blockquote:border-[#1e3a8a]/30 prose-blockquote:bg-blue-50/40 dark:prose-blockquote:bg-blue-900/10 prose-blockquote:py-1 prose-blockquote:not-italic prose-table:text-[11px] prose-th:bg-[#1e3a8a] prose-th:text-white prose-th:py-1.5 prose-th:px-2 prose-td:border prose-td:border-gray-300 prose-td:py-1 prose-td:px-2"
                style={{ fontFamily: "'Times New Roman', 'Georgia', serif", fontSize: '12px', lineHeight: 1.7 }}
              >
                <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
                {isGenerating && (
                  <span className="inline-block w-0.5 h-4 bg-[#059669] animate-pulse ml-0.5 align-middle" />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
