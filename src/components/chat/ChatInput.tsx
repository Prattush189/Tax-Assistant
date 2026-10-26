import { useState, useRef, useCallback, useLayoutEffect, useEffect } from 'react';
import { ArrowUp, Paperclip, X, BookUser, Lock, BarChart3, Brain, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';
import { getReasoningLevel, setReasoningLevel, type ReasoningLevel } from '../../lib/chatReasoning';
import { CHAT_ACCEPT, fileKind, fileKindLabel, FileKindIcon, unsupportedReason } from '../../lib/fileKind';
import { UploadPhase } from '../../hooks/useFileUpload';
import { DocumentContext } from '../../types';
import { LoadingAnimation } from '../ui/LoadingAnimation';
import toast from 'react-hot-toast';

/** Tallest the composer grows before it starts scrolling internally
 *  (~9 lines). Keeps a long question fully visible without letting the
 *  input box swallow the conversation. */
const MAX_COMPOSER_HEIGHT = 200;

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  activeDocuments: DocumentContext[];
  onFileSelect?: (file: File) => void;
  onDetachDocument?: (index: number) => void;
  uploadPhase?: UploadPhase;
  attachmentLimit: number;
  profiles?: { id: string; name: string; data: Record<string, unknown> }[];
  referencedProfile?: { id: string; name: string } | null;
  onReferenceProfile?: (profile: { id: string; name: string; data: Record<string, unknown> }) => void;
  onClearReference?: () => void;
  isPro?: boolean;
}

export function ChatInput({
  input, isLoading, onInputChange, onSend,
  activeDocuments, onFileSelect, onDetachDocument, uploadPhase, attachmentLimit,
  profiles, referencedProfile, onReferenceProfile, onClearReference, isPro,
}: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  // Reasoning level (Fast/Deep) — persisted; read by the send path.
  const [reasoning, setReasoning] = useState<ReasoningLevel>(() => getReasoningLevel());
  const pickReasoning = (next: ReasoningLevel) => {
    setReasoning(next);
    setReasoningLevel(next);
  };

  // Auto-grow the composer with the message: reset to natural height, then
  // size to content up to MAX_COMPOSER_HEIGHT, after which it scrolls.
  // Runs on every `input` change so it also shrinks back after a send
  // clears the field. useLayoutEffect avoids a one-frame flicker.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [input]);

  useEffect(() => {
    if (!showProfileDropdown) return;
    const close = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) setShowProfileDropdown(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showProfileDropdown]);

  const canAttachMore = activeDocuments.length < attachmentLimit;

  const handleFiles = useCallback((files: FileList | File[]) => {
    if (!onFileSelect) return;
    const fileArray = Array.from(files).filter(f => {
      const reason = unsupportedReason(f);
      if (reason) toast.error(reason);
      return !reason;
    });
    if (fileArray.length === 0) return;
    const remaining = attachmentLimit - activeDocuments.length;
    if (remaining <= 0) {
      toast.error(`Maximum ${attachmentLimit} attachment(s) allowed on your plan.`);
      return;
    }
    const toAdd = fileArray.slice(0, remaining);
    if (toAdd.length < fileArray.length) {
      toast.error(`Only ${remaining} more attachment(s) allowed. Some files were skipped.`);
    }
    toAdd.forEach(f => onFileSelect(f));
  }, [onFileSelect, activeDocuments.length, attachmentLimit]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Clipboard paste — detect images
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    if (imageItems.length === 0) return; // Let normal text paste proceed

    e.preventDefault();
    const files = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[];
    if (files.length > 0) handleFiles(files);
  }, [handleFiles]);

  const isUploading = uploadPhase === 'uploading' || uploadPhase === 'analyzing';
  const hasAttachments = activeDocuments.length > 0 || isUploading || !!referencedProfile;
  // Disable send while uploading/analyzing — message must wait for extraction
  const canSend = !isLoading && !isUploading && input.trim() !== '';

  const toolBtn = (enabled: boolean) => cn(
    'h-8 w-8 inline-flex items-center justify-center rounded-lg transition-colors shrink-0',
    enabled
      ? 'text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-700/60'
      : 'text-gray-300 dark:text-gray-600 cursor-not-allowed',
  );

  return (
    // No hard top border: the conversation fades into the composer, which
    // floats as a card.
    <div className="shrink-0 px-3 pb-3 pt-2 sm:px-6 sm:pb-4 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent dark:from-[#0E0C0A] dark:via-[#0E0C0A]">
      <div className="max-w-3xl mx-auto">
        <input
          ref={fileInputRef}
          type="file"
          accept={CHAT_ACCEPT}
          onChange={handleFileChange}
          multiple
          className="hidden"
        />

        <div className="relative bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700/70 rounded-[1.25rem] shadow-[0_2px_12px_-4px_rgba(40,30,20,0.12)] dark:shadow-none focus-within:border-emerald-500/70 focus-within:shadow-[0_4px_20px_-6px_rgba(13,150,104,0.25)] transition-all">
          {/* Attachment cards */}
          {hasAttachments && (
            <div className="px-3 pt-3 flex flex-wrap gap-2">
              {activeDocuments.map((doc, i) => {
                const kind = fileKind(doc.filename, doc.mimeType);
                return (
                  <div
                    key={`${doc.filename}-${i}`}
                    className="group/att flex items-center gap-2 pl-1.5 pr-1 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl max-w-[16rem]"
                  >
                    <FileKindIcon kind={kind} className="w-8 h-8" />
                    <div className="min-w-0 leading-tight">
                      <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate">{doc.filename}</p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">{fileKindLabel(kind)} · ready</p>
                    </div>
                    <button
                      onClick={() => onDetachDocument?.(i)}
                      className="ml-1 p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                      aria-label={`Remove ${doc.filename}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
              {isUploading && (
                <div className="flex items-center gap-2 px-2.5 py-1.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-xl text-xs text-emerald-700 dark:text-emerald-300">
                  <LoadingAnimation size="xs" />
                  <span>{uploadPhase === 'uploading' ? 'Uploading…' : 'Reading document…'}</span>
                </div>
              )}
              {referencedProfile && (
                <div className="flex items-center gap-2 pl-1.5 pr-1 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
                  <span className="w-8 h-8 rounded-md flex items-center justify-center bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                    <BarChart3 className="w-3.5 h-3.5" />
                  </span>
                  <div className="leading-tight">
                    <p className="text-xs font-medium text-gray-800 dark:text-gray-100 truncate max-w-[10rem]">{referencedProfile.name}</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">Tax profile</p>
                  </div>
                  <button
                    onClick={() => onClearReference?.()}
                    className="ml-1 p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                    aria-label="Remove profile reference"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Textarea — auto-grows with content (see useLayoutEffect),
              capped at MAX_COMPOSER_HEIGHT, then scrolls. */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
            onPaste={handlePaste}
            placeholder={isUploading ? 'Reading your document…' : 'Ask about income tax, GST, TDS or a notice…'}
            className="block w-full bg-transparent border-0 outline-none px-4 pt-3.5 pb-1 resize-none min-h-[52px] overflow-y-auto text-gray-800 dark:text-gray-100 text-[15px] leading-relaxed placeholder:text-gray-400"
            style={{ maxHeight: MAX_COMPOSER_HEIGHT }}
            rows={1}
          />

          {/* Toolbar */}
          <div className="flex items-center gap-1 px-2 pb-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || !canAttachMore}
              className={toolBtn(!isUploading && canAttachMore)}
              title={canAttachMore ? 'Attach PDF, Word or image' : `Max ${attachmentLimit} attachments`}
              aria-label="Attach file"
            >
              <Paperclip className="w-[18px] h-[18px]" />
            </button>

            <div className="relative shrink-0" ref={profileMenuRef}>
              <button
                onClick={() => {
                  if (!isPro) {
                    toast.error('Upgrade to Pro to reference tax profiles in chat.');
                    return;
                  }
                  setShowProfileDropdown(prev => !prev);
                }}
                className={toolBtn(!!isPro)}
                title={isPro ? 'Reference tax profile' : 'Upgrade to Pro to reference profiles'}
                aria-label="Reference tax profile"
              >
                <span className="relative">
                  <BookUser className="w-[18px] h-[18px]" />
                  {!isPro && <Lock className="w-2.5 h-2.5 absolute -bottom-0.5 -right-1" />}
                </span>
              </button>
              {showProfileDropdown && isPro && (
                <div className="absolute bottom-full mb-2 left-0 w-60 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-30 py-1 max-h-56 overflow-y-auto">
                  <p className="px-3 pt-1.5 pb-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">Reference a tax profile</p>
                  {profiles && profiles.length > 0 ? profiles.map(p => (
                    <button
                      key={p.id}
                      onClick={() => {
                        onReferenceProfile?.(p);
                        setShowProfileDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
                    >
                      <BarChart3 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span className="truncate">{p.name}</span>
                    </button>
                  )) : (
                    <p className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">No profiles found. Create one in the Tax Calculator.</p>
                  )}
                </div>
              )}
            </div>

            {/* Reasoning — segmented Fast / Deep. Deep raises the thinking
                budget for multi-step problems (a bit slower).
                Internal comment: never surface the model in the UI. */}
            <div role="radiogroup" aria-label="Answer depth" className="ml-1 inline-flex items-center p-0.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-xs font-medium">
              {([
                { level: 'low' as const, label: 'Fast', Icon: Zap, tip: 'Quick answers, about 1 credit per reply.' },
                { level: 'high' as const, label: 'Deep', Icon: Brain, tip: 'Thorough reasoning for notices and computations — slower, about 8 credits per reply.' },
              ]).map(({ level, label, Icon, tip }) => {
                const on = (reasoning === 'high') === (level === 'high');
                return (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => pickReasoning(level)}
                    title={tip}
                    className={cn(
                      'inline-flex items-center gap-1 h-7 px-2 rounded-md transition-colors',
                      on
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200',
                    )}
                  >
                    <Icon className={cn('w-3.5 h-3.5', on && (level === 'high' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'))} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>

            <span className="hidden md:inline ml-auto mr-2 text-[11px] text-gray-400 select-none">
              <kbd className="font-sans">Enter</kbd> to send · <kbd className="font-sans">Shift + Enter</kbd> for a new line
            </span>

            <button
              onClick={() => { if (canSend) onSend(); }}
              disabled={!canSend}
              className={cn(
                'ml-auto md:ml-0 h-9 w-9 inline-flex items-center justify-center rounded-full transition-all shrink-0',
                canSend
                  ? 'text-white bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-600/25'
                  : 'text-gray-400 bg-gray-100 dark:bg-gray-800 dark:text-gray-600 cursor-not-allowed',
              )}
              title={isUploading ? 'Wait for the document to finish reading' : 'Send message'}
              aria-label="Send message"
            >
              {isLoading ? <LoadingAnimation size="xs" /> : <ArrowUp className="w-[18px] h-[18px]" strokeWidth={2.5} />}
            </button>
          </div>
        </div>
        <p className="text-[11px] text-center text-gray-400 dark:text-gray-500 mt-2">
          Smartbiz AI can make mistakes. Always verify with a qualified professional.
        </p>
      </div>
    </div>
  );
}
