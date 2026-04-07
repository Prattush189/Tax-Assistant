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
    <div className="p-4 lg:p-6 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-t border-slate-200/50 dark:border-slate-800/50">
      <div className="max-w-4xl mx-auto">
        {/* Document attachment badge */}
        {(activeDocument || isUploading) && (
          <div className={cn(
            "px-3 py-2 border border-b-0 rounded-t-xl flex items-center gap-2 text-xs",
            uploadPhase === 'error'
              ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400"
              : "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"
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
                  className="ml-auto p-0.5 hover:bg-green-100 dark:hover:bg-green-900/30 rounded transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : null}
          </div>
        )}

        <div className="relative flex items-end gap-2">
          {/* Paperclip button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className={cn(
              "p-2.5 rounded-xl transition-all shrink-0 mb-0.5",
              isUploading
                ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                : "text-slate-400 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20"
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
                "w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-3 pr-14 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none min-h-[52px] max-h-32 transition-all text-slate-800 dark:text-slate-100 text-sm",
                activeDocument || isUploading ? "rounded-b-2xl rounded-t-none" : "rounded-2xl"
              )}
              rows={1}
            />
            <button
              onClick={onSend}
              disabled={isLoading || input.trim() === ''}
              className={cn(
                "absolute right-2 bottom-2 p-2 rounded-xl transition-all",
                isLoading || input.trim() === ''
                  ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                  : 'text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-lg shadow-orange-200/50 dark:shadow-none'
              )}
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
      <p className="text-[10px] text-center text-slate-400 dark:text-slate-500 mt-3">
        Tax Assistant can make mistakes. Always verify with a qualified tax professional.
      </p>
    </div>
  );
}
