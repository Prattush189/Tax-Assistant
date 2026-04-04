import { Send } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
}

export function ChatInput({ input, isLoading, onInputChange, onSend }: ChatInputProps) {
  return (
    <div className="p-4 lg:p-6 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
      <div className="max-w-4xl mx-auto relative">
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
          className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 pr-14 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none min-h-[56px] max-h-32 transition-all text-slate-800 dark:text-slate-100"
          rows={1}
        />
        <button
          onClick={onSend}
          disabled={isLoading || input.trim() === ''}
          className={cn(
            "absolute right-2 bottom-2 p-2 rounded-xl transition-all",
            isLoading || input.trim() === ''
              ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
              : 'text-white bg-orange-600 hover:bg-orange-700 shadow-lg shadow-orange-200 dark:shadow-none'
          )}
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
      <p className="text-[10px] text-center text-slate-400 dark:text-slate-500 mt-3">
        Tax Assistant can make mistakes. Always verify with a qualified tax professional.
      </p>
    </div>
  );
}
