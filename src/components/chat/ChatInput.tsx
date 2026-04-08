import { useRef } from 'react';
import { Send, Paperclip, FileText, X, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { UploadPhase } from '../../hooks/useFileUpload';

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  activeDocument?: { filename: string } | null;
  onFileSelect?: (file: File) => void;
  onDetachDocument?: () => void;
  uploadPhase?: UploadPhase;
}

export function ChatInput({
  input, isLoading, onInputChange, onSend,
  activeDocument, onFileSelect, onDetachDocument, uploadPhase,
}: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onFileSelect) onFileSelect(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const isUploading = uploadPhase === 'uploading' || uploadPhase === 'analyzing';

  return (
    <div className="shrink-0 p-4 lg:p-6 bg-white dark:bg-[#111827] border-t border-gray-200 dark:border-gray-800">
      <div className="max-w-4xl mx-auto">
        {/* Attachment badge */}
        {(activeDocument || isUploading) && (
          <div className={cn(
            "mx-12 mb-0 px-3 py-2 border border-b-0 rounded-t-xl flex items-center gap-2 text-xs",
            uploadPhase === 'error'
              ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400"
              : "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-400"
          )}>
            {isUploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span>{uploadPhase === 'uploading' ? 'Uploading document...' : 'Analyzing document...'}</span>
              </>
            ) : activeDocument ? (
              <>
                <FileText className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{activeDocument.filename} attached</span>
                <button
                  onClick={onDetachDocument}
                  className="ml-auto p-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : null}
          </div>
        )}

        <div className="relative flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className={cn(
              "p-2.5 rounded-xl transition-all shrink-0",
              isUploading
                ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
                : "text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/15"
            )}
            title="Attach document"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
            onChange={handleFileChange}
            className="hidden"
          />

          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder="Ask about income tax, GST, or tax saving..."
              className={cn(
                "w-full bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 px-4 py-3 pr-14 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 resize-none min-h-[52px] max-h-32 transition-all text-gray-800 dark:text-gray-100 text-sm placeholder:text-gray-400",
                activeDocument || isUploading ? "rounded-b-2xl rounded-t-none" : "rounded-2xl"
              )}
              rows={1}
            />
            <button
              onClick={onSend}
              disabled={isLoading || input.trim() === ''}
              className={cn(
                "absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all",
                isLoading || input.trim() === ''
                  ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                  : 'text-white bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-600/15'
              )}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
      <p className="text-[10px] text-center text-gray-400 dark:text-gray-500 mt-3">
        Smart AI can make mistakes. Always verify with a qualified professional.
      </p>
    </div>
  );
}
