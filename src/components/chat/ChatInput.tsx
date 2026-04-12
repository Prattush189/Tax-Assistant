import { useState, useRef, useCallback } from 'react';
import { Send, Paperclip, FileText, X, BookUser, Lock, BarChart3 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { UploadPhase } from '../../hooks/useFileUpload';
import { DocumentContext } from '../../types';
import { LoadingAnimation } from '../ui/LoadingAnimation';
import toast from 'react-hot-toast';

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
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);

  const canAttachMore = activeDocuments.length < attachmentLimit;

  const handleFiles = useCallback((files: FileList | File[]) => {
    if (!onFileSelect) return;
    const fileArray = Array.from(files);
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

  return (
    <div className="shrink-0 p-4 lg:p-6 bg-white dark:bg-[#151210] border-t border-gray-200 dark:border-gray-800">
      <div className="max-w-4xl mx-auto">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          onChange={handleFileChange}
          multiple
          className="hidden"
        />

        {/* Unified bordered container — attachment bar + buttons + textarea all inside */}
        <div className="relative bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-2xl focus-within:ring-2 focus-within:ring-emerald-500/30 focus-within:border-emerald-500 transition-all">
          {/* Attachment badges — inside the container, above the input row */}
          {hasAttachments && (
            <div className="px-3 pt-2.5 pb-0 flex flex-wrap gap-1.5">
              {activeDocuments.map((doc, i) => (
                <div
                  key={`${doc.filename}-${i}`}
                  className="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 rounded-lg text-xs text-emerald-700 dark:text-emerald-400"
                >
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="truncate max-w-[120px]">{doc.filename}</span>
                  <button
                    onClick={() => onDetachDocument?.(i)}
                    className="p-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {isUploading && (
                <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 rounded-lg text-xs text-emerald-700 dark:text-emerald-400">
                  <LoadingAnimation size="xs" />
                  <span>{uploadPhase === 'uploading' ? 'Uploading...' : 'Analyzing...'}</span>
                </div>
              )}
              {referencedProfile && (
                <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 rounded-lg text-xs text-emerald-700 dark:text-emerald-400">
                  <BarChart3 className="w-3 h-3 shrink-0" />
                  <span className="truncate max-w-[150px]">Profile: {referencedProfile.name}</span>
                  <button
                    onClick={() => onClearReference?.()}
                    className="p-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Input row — buttons + textarea + send, all perfectly aligned */}
          <div className="flex items-end gap-1 px-2 py-1.5">
            {/* Attach button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || !canAttachMore}
              className={cn(
                "p-2 rounded-lg transition-all shrink-0",
                isUploading || !canAttachMore
                  ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
                  : "text-gray-400 hover:text-emerald-600 hover:bg-emerald-100/50 dark:hover:bg-emerald-900/20"
              )}
              title={canAttachMore ? 'Attach document' : `Max ${attachmentLimit} attachments`}
            >
              <Paperclip className="w-5 h-5" />
            </button>

            {/* Profile reference button */}
            <div className="relative shrink-0">
              <button
                onClick={() => {
                  if (!isPro) {
                    toast.error('Upgrade to Pro to reference tax profiles in chat.');
                    return;
                  }
                  setShowProfileDropdown(prev => !prev);
                }}
                className={cn(
                  "p-2 rounded-lg transition-all shrink-0",
                  !isPro
                    ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
                    : "text-gray-400 hover:text-emerald-600 hover:bg-emerald-100/50 dark:hover:bg-emerald-900/20"
                )}
                title={isPro ? 'Reference tax profile' : 'Upgrade to Pro to reference profiles'}
              >
                {isPro ? (
                  <BookUser className="w-5 h-5" />
                ) : (
                  <span className="relative">
                    <BookUser className="w-5 h-5" />
                    <Lock className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5" />
                  </span>
                )}
              </button>
              {showProfileDropdown && isPro && profiles && profiles.length > 0 && (
                <div className="absolute bottom-full mb-2 left-0 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-30 py-1 max-h-48 overflow-y-auto">
                  {profiles.map(p => (
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
                  ))}
                </div>
              )}
              {showProfileDropdown && isPro && (!profiles || profiles.length === 0) && (
                <div className="absolute bottom-full mb-2 left-0 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-30 p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">No profiles found. Create one in the Tax Calculator.</p>
                </div>
              )}
            </div>

            {/* Textarea */}
            <textarea
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend) onSend();
                }
              }}
              onPaste={handlePaste}
              placeholder={isUploading ? 'Wait for document to finish analyzing...' : 'Ask about income tax, GST, or tax saving...'}
              className="flex-1 bg-transparent border-0 outline-none px-2 py-2 resize-none min-h-[36px] max-h-32 text-gray-800 dark:text-gray-100 text-sm placeholder:text-gray-400"
              rows={1}
            />

            {/* Send button */}
            <button
              onClick={() => { if (canSend) onSend(); }}
              disabled={!canSend}
              className={cn(
                "p-2 rounded-lg transition-all shrink-0 self-end",
                !canSend
                  ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                  : 'text-white bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-600/15'
              )}
              title={isUploading ? 'Wait for document to finish analyzing' : 'Send message'}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
      <p className="text-[10px] text-center text-gray-400 dark:text-gray-500 mt-3">
        Smartbiz AI can make mistakes. Always verify with a qualified professional.
      </p>
    </div>
  );
}
