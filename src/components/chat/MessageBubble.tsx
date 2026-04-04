import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, User } from 'lucide-react';
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
  const { role, content, timestamp } = message;

  return (
    <div className={cn("flex gap-4", role === 'user' ? 'flex-row-reverse' : '')}>
      <div className={cn(
        "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
        role === 'user'
          ? 'bg-indigo-600 text-white'
          : 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
      )}>
        {role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
      </div>
      <div className={cn(
        "max-w-[85%] p-4 rounded-2xl shadow-sm",
        role === 'user'
          ? 'bg-indigo-600 text-white rounded-tr-none'
          : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-none'
      )}>
        {renderContent(content, role)}
        <div className={cn("text-[10px] mt-2 opacity-50", role === 'user' ? 'text-right' : '')}>
          {timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}
