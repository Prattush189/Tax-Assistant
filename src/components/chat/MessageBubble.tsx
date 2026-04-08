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
        role === 'user' ? 'prose-invert' : 'prose-slate dark:prose-invert'
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
      <div className={cn(
        "w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0",
        role === 'user'
          ? 'bg-gradient-to-br from-[#D4A020] to-[#B8860B] text-white'
          : ''
      )}>
        {role === 'user' ? <User className="w-4 h-4" /> : <img src="/logoAI.png" alt="Assistant" className="w-5 h-5 object-contain" />}
      </div>
      <div className="max-w-[85%]">
        <div className={cn(
          "p-4 rounded-2xl shadow-sm",
          role === 'user'
            ? 'bg-gradient-to-br from-[#D4A020] to-[#B8860B] text-white rounded-tr-none'
            : 'bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm border border-slate-200/50 dark:border-slate-800/50 text-slate-800 dark:text-slate-200 rounded-tl-none'
        )}>
          {attachment && (
            <div className={cn(
              "flex items-center gap-1.5 mb-2 px-2 py-1 rounded-lg text-xs w-fit",
              role === 'user'
                ? "bg-white/20 text-white/90"
                : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
            )}>
              <FileText className="w-3 h-3" />
              <span className="truncate max-w-[200px]">{attachment.filename}</span>
            </div>
          )}
          {renderContent(content, role)}
          <div className={cn(
            "text-[10px] mt-2 opacity-0 hover:opacity-50 transition-opacity",
            role === 'user' ? 'text-right' : ''
          )}>
            {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        {/* Action buttons for model responses */}
        {role === 'model' && content.length > 0 && (
          <div className="flex items-center gap-1 mt-1 ml-1">
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
              title="Copy response"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={handleReport}
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
              title="Report response"
            >
              <Flag className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Truncated — continue button */}
        {truncated && (
          <div className="mt-2 ml-1">
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-1.5">
              Response was cut short due to message length limit.
            </p>
            <button
              onClick={onContinue}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#B8860B] dark:text-[#D4A020] bg-[#D4A020]/10 dark:bg-[#B8860B]/10 border border-[#D4A020]/20 dark:border-[#B8860B]/20 rounded-lg hover:bg-[#D4A020]/20 dark:hover:bg-[#B8860B]/20 transition-all"
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
