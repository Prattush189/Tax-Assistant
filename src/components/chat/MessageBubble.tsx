import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { User, FileText } from 'lucide-react';
import { Message } from '../../types';
import { cn } from '../../lib/utils';
import { ChartRenderer } from './ChartRenderer';

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
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const { role, content, timestamp, attachment } = message;

  return (
    <div className={cn("flex gap-3", role === 'user' ? 'flex-row-reverse' : '')}>
      <div className={cn(
        "w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0",
        role === 'user'
          ? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white'
          : ''
      )}>
        {role === 'user' ? <User className="w-4 h-4" /> : <img src="/logoAI.png" alt="Assistant" className="w-5 h-5 object-contain" />}
      </div>
      <div className={cn(
        "max-w-[85%] p-4 rounded-2xl shadow-sm",
        role === 'user'
          ? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded-tr-none'
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
    </div>
  );
}
