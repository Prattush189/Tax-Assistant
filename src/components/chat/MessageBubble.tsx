import { useState, useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, Flag, ChevronRight, BarChart3, Download, Loader2 } from 'lucide-react';
import { Message } from '../../types';
import { cn } from '../../lib/utils';
import { ChartRenderer } from './ChartRenderer';
import { fileKind, fileKindLabel, FileKindIcon } from '../../lib/fileKind';
import toast from 'react-hot-toast';
import { reportChatMessage, type ChatReportReason } from '../../services/api';

const REPORT_REASONS: Array<{ value: ChatReportReason; label: string }> = [
  { value: 'wrong_info', label: 'Wrong or outdated information' },
  { value: 'not_answered', label: "Didn't answer my question" },
  { value: 'confusing', label: 'Too long or confusing' },
  { value: 'other', label: 'Something else' },
];

// Custom link component — shows confirmation dialog before opening external links
function ExternalLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  const [showDialog, setShowDialog] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (href) setShowDialog(true);
  };

  return (
    <>
      <a
        href={href}
        onClick={handleClick}
        className="text-emerald-600 dark:text-emerald-400 underline cursor-pointer"
      >
        {children}
      </a>
      {showDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowDialog(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-5 max-w-md w-full border border-gray-200 dark:border-gray-700" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">Open external link?</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 break-all mb-4 p-2 bg-gray-50 dark:bg-gray-900 rounded-lg">{href}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDialog(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { window.open(href, '_blank', 'noopener,noreferrer'); setShowDialog(false); }}
                className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                Open
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Hostname for a source line. Gemini grounding links are often
 *  vertexaisearch redirect URLs whose host tells the user nothing, so
 *  those return '' and only the title is shown. */
function hostOf(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (h.includes('vertexaisearch') || h.endsWith('google.com')) return '';
    return h;
  } catch {
    return '';
  }
}

const markdownComponents = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <ExternalLink href={href}>{children}</ExternalLink>
  ),
};

const PROSE = 'markdown-body prose max-w-none prose-sm sm:prose-base prose-gray dark:prose-invert overflow-x-auto';

// A downloadable document the assistant produced on request. The model
// wraps it in [[PDF:Title]] … [[/PDF]]; we show it inline (so the user sees
// it) plus a button that renders it to a branded PDF via the local skill.
const PDF_BLOCK = /\[\[PDF:([^\]\n]*)\]\]\n?([\s\S]*?)\n?\[\[\/PDF\]\]/g;

function PdfDocBlock({ title, body }: { title: string; body: string }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const { downloadChatPdf } = await import('../../lib/chatPdf');
      await downloadChatPdf(body, title || 'Document');
      toast.success('PDF downloaded');
    } catch {
      toast.error('Could not generate the PDF');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="my-3 rounded-xl border border-gray-200 dark:border-gray-700/70 bg-white dark:bg-gray-900 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2 min-w-0">
          <FileKindIcon kind="pdf" />
          <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{title || 'Document'}</span>
        </div>
        <button
          type="button"
          onClick={() => void download()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Download PDF
        </button>
      </div>
      <div className={cn(PROSE, 'px-4 py-3')}>
        <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{body}</Markdown>
      </div>
    </div>
  );
}

/** Render normal (non-PDF) content: chart-aware, with any stray PDF marker
 *  tokens stripped (e.g. a half-streamed `[[PDF:…` before its close). */
function renderPlain(content: string, baseKey: number) {
  const cleaned = content
    .replace(/\[\[PDF:[^\]\n]*\]\]/g, '')
    .replace(/\[\[\/PDF\]\]/g, '');
  const parts = cleaned.split(/```json-chart([\s\S]*?)```/);
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      return <ChartRenderer key={`${baseKey}-${index}`} jsonString={part.trim()} />;
    }
    if (!part) return null;
    return (
      <div key={`${baseKey}-${index}`} className={PROSE}>
        <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{part}</Markdown>
      </div>
    );
  });
}

function renderContent(content: string) {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  PDF_BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PDF_BLOCK.exec(content)) !== null) {
    if (m.index > last) nodes.push(...renderPlain(content.slice(last, m.index), key++));
    nodes.push(<PdfDocBlock key={`pdf-${key++}`} title={m[1].trim()} body={m[2].trim()} />);
    last = m.index + m[0].length;
  }
  nodes.push(...renderPlain(content.slice(last), key++));
  return nodes;
}

/** Fade-edge wrapper: soft gradient at bottom while streaming, fades away when done */
function StreamingWrapper({ children, isStreaming }: { children: React.ReactNode; isStreaming: boolean }) {
  const [showOverlay, setShowOverlay] = useState(false);

  useEffect(() => {
    if (isStreaming) {
      setShowOverlay(true);
    } else if (showOverlay) {
      // Fade out then remove
      const t = setTimeout(() => setShowOverlay(false), 600);
      return () => clearTimeout(t);
    }
  }, [isStreaming]);

  return (
    <div className="relative">
      {children}
      {showOverlay && (
        <div
          className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none bg-gradient-to-t from-gray-50 dark:from-[#0E0C0A] to-transparent"
          style={{
            opacity: isStreaming ? 1 : 0,
            transition: 'opacity 0.5s ease-out',
          }}
        />
      )}
    </div>
  );
}

interface MessageBubbleProps {
  message: Message;
  chatId?: string | null;
  onContinue?: () => void;
  isLastModel?: boolean;
  isLoading?: boolean;
}

export function MessageBubble({ message, chatId, onContinue, isLastModel, isLoading }: MessageBubbleProps) {
  const { role, content, timestamp, attachment, attachments, truncated, sources } = message;
  const [copied, setCopied] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const reportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!reportOpen) return;
    const close = (e: MouseEvent) => {
      if (reportRef.current && !reportRef.current.contains(e.target as Node)) setReportOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [reportOpen]);
  // Only the last model message while loading is considered "streaming"
  const isStreaming = !!(role === 'model' && isLastModel && isLoading && content.length > 0);

  const handleCopy = async () => {
    // Strip the internal [[PDF:…]] markers so copied text reads cleanly.
    const clean = content.replace(/\[\[PDF:[^\]\n]*\]\]/g, '').replace(/\[\[\/PDF\]\]/g, '');
    await navigator.clipboard.writeText(clean);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const submitReport = async (reason: ChatReportReason) => {
    setReportOpen(false);
    if (!chatId || !message.id) {
      toast.error("This answer can't be reported yet — reload the chat and try again.");
      return;
    }
    try {
      await reportChatMessage(chatId, message.id, reason);
      setReported(true);
      toast('Thanks — we review reported answers to improve them.', { icon: '🚩' });
    } catch {
      toast.error('Could not send the report. Please try again.');
    }
  };

  const atts = attachments ?? (attachment ? [attachment] : []);
  const time = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1.5 group/user animate-[fadeSlideIn_0.3s_ease-out]">
        {(atts.length > 0 || message.profileRef) && (
          <div className="flex flex-wrap justify-end gap-1.5 max-w-[85%]">
            {atts.map((att, i) => {
              const kind = fileKind(att.filename, att.mimeType);
              return (
                <div key={i} className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700/70 max-w-[16rem]">
                  <FileKindIcon kind={kind} className="w-8 h-8" />
                  <div className="min-w-0 leading-tight">
                    <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{att.filename}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">{fileKindLabel(kind)}</p>
                  </div>
                </div>
              );
            })}
            {message.profileRef && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700/70 text-xs text-gray-700 dark:text-gray-200">
                <BarChart3 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Profile: {message.profileRef}</span>
              </div>
            )}
          </div>
        )}
        <div className="max-w-[85%] min-w-0 px-4 py-2.5 rounded-[1.25rem] rounded-br-md bg-emerald-50 dark:bg-emerald-900/25 border border-emerald-100 dark:border-emerald-800/40 text-gray-900 dark:text-gray-100">
          {renderContent(content)}
        </div>
        <span className="text-[10px] text-gray-400 pr-1 opacity-0 group-hover/user:opacity-100 transition-opacity select-none">{time}</span>
      </div>
    );
  }

  return (
    <div className="flex gap-3 sm:gap-4 group/model animate-[fadeSlideIn_0.3s_ease-out]">
      {/* Assistant mark */}
      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700/70 shadow-sm">
        <img src="/logoAI.png" alt="" className="w-5 h-5 object-contain" />
      </div>

      <div className="flex-1 min-w-0 pt-0.5">
        {/* Answers sit directly on the page (no card) so long tables and
            computations get the full column width. */}
        <div className="text-gray-800 dark:text-gray-200">
          <StreamingWrapper isStreaming={isStreaming}>
            {renderContent(content)}
          </StreamingWrapper>
          {/* Grounding sources — the real citations behind the answer. */}
          {sources && sources.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Sources</p>
              <div className="flex flex-wrap gap-1.5">
                {sources.slice(0, 8).map((src, i) => {
                  const host = hostOf(src.url);
                  return (
                    <span key={src.url + i} className="inline-flex items-center gap-1.5 max-w-[18rem] px-2 py-1 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700/70 text-[11px] text-gray-600 dark:text-gray-300">
                      <span className="w-4 h-4 rounded bg-gray-100 dark:bg-gray-800 text-[9px] font-semibold flex items-center justify-center shrink-0 text-gray-500">{i + 1}</span>
                      <span className="truncate">
                        <ExternalLink href={src.url}>{src.title || host || src.url}</ExternalLink>
                      </span>
                      {host && src.title && <span className="text-gray-400 shrink-0 hidden sm:inline">· {host}</span>}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Action buttons — always shown on the latest answer, on hover for older ones */}
        {content.length > 0 && !isStreaming && (
          <div className={cn(
            'flex items-center gap-0.5 mt-2 -ml-1.5 transition-opacity',
            isLastModel || reportOpen ? 'opacity-100' : 'opacity-0 group-hover/model:opacity-100 focus-within:opacity-100',
          )}>
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
              title="Copy response"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <div className="relative" ref={reportRef}>
              <button
                onClick={() => setReportOpen(o => !o)}
                disabled={reported}
                className={cn(
                  "p-1.5 rounded-lg transition-all",
                  reported
                    ? 'text-red-500 cursor-default'
                    : 'text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20',
                )}
                title={reported ? 'Reported' : 'Report response'}
                aria-haspopup="menu"
                aria-expanded={reportOpen}
              >
                <Flag className="w-3.5 h-3.5" />
              </button>
              {reportOpen && (
                <div
                  role="menu"
                  className="absolute left-0 bottom-full mb-1 z-20 w-60 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg"
                >
                  <p className="px-3 pt-1.5 pb-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">What was wrong?</p>
                  {REPORT_REASONS.map(r => (
                    <button
                      key={r.value}
                      role="menuitem"
                      onClick={() => void submitReport(r.value)}
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="ml-1.5 text-[10px] text-gray-400 select-none">{time}</span>
          </div>
        )}

        {/* Continue button */}
        {truncated && (
          <div className="mt-2">
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1.5">
              This response was cut short before it finished.
            </p>
            <button
              onClick={onContinue}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/15 border border-emerald-200 dark:border-emerald-800/30 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/25 transition-all"
            >
              <ChevronRight className="w-3.5 h-3.5" />
              Continue response
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
