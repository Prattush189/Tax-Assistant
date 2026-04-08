import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { User, FileText, Copy, Check, Flag, ChevronRight } from 'lucide-react';
import { Message } from '../../types';
import { cn } from '../../lib/utils';
import { ChartRenderer } from './ChartRenderer';
import toast from 'react-hot-toast';

function renderContent(content: string, role: 'user' | 'model') {
  const parts = content.split(/```json-chart([\s\S]*?)```/);
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      return <ChartRenderer key={index} jsonString={part.trim()} />;
    }
    return (
      <div key={index} className={cn(
        "markdown-body prose max-w-none prose-sm sm:prose-base overflow-x-auto",
        role === 'user' ? 'prose-invert' : 'prose-gray dark:prose-invert'
      )}>
        <Markdown remarkPlugins={[remarkGfm]}>{part}</Markdown>
      </div>
    );
  });
}

interface MessageBubbleProps {
  message: Message;
  onContinue?: () => void;
}

export function MessageBubble({ message, onContinue }: MessageBubbleProps) {
  const { role, content, timestamp, attachment, truncated } = message;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReport = () => {
    toast('Response reported. Thank you for the feedback.', { icon: '🚩' });
  };

  return (
    <div className={cn("flex gap-3", role === 'user' ? 'flex-row-reverse' : '')}>
      {/* Avatar */}
      <div className={cn(
        "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-1",
        role === 'user'
          ? 'bg-emerald-600 text-white'
          : 'bg-gray-100 dark:bg-gray-800'
      )}>
        {role === 'user' ? <User className="w-4 h-4" /> : <img src="/logoAI.png" alt="" className="w-5 h-5 object-contain" />}
      </div>

      <div className="max-w-[85%] min-w-0">
        {/* Message body */}
        <div className={cn(
          "px-4 py-3 rounded-2xl",
          role === 'user'
            ? 'bg-emerald-600 text-white rounded-tr-sm'
            : 'bg-white dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700/50 text-gray-800 dark:text-gray-200 rounded-tl-sm'
        )}>
          {attachment && (
            <div className={cn(
              "flex items-center gap-1.5 mb-2 px-2 py-1 rounded-lg text-xs w-fit",
              role === 'user'
                ? "bg-white/15 text-white/90"
                : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
            )}>
              <FileText className="w-3 h-3" />
              <span className="truncate max-w-[200px]">{attachment.filename}</span>
            </div>
          )}
          {renderContent(content, role)}
          <div className={cn(
            "text-[10px] mt-2 opacity-0 hover:opacity-40 transition-opacity select-none",
            role === 'user' ? 'text-right text-white/60' : 'text-gray-400'
          )}>
            {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        {/* Action buttons */}
        {role === 'model' && content.length > 0 && (
          <div className="flex items-center gap-0.5 mt-1.5 ml-1">
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
              title="Copy response"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={handleReport}
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
              title="Report response"
            >
              <Flag className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Continue button */}
        {truncated && (
          <div className="mt-2 ml-1">
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1.5">
              Response was cut short due to message length limit.
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
