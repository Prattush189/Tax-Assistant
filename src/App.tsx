/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, 
  Bot, 
  User, 
  Calculator, 
  Info, 
  Trash2, 
  IndianRupee,
  ShieldCheck,
  ExternalLink,
  Menu,
  X,
  Moon,
  Sun,
  BarChart3,
  PieChart as PieChartIcon
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  Legend 
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for Tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Message {
  role: 'user' | 'model';
  content: string;
  timestamp: Date;
}

const COLORS = ['#f97316', '#6366f1', '#10b981', '#f43f5e', '#8b5cf6', '#eab308'];

function ChartRenderer({ jsonString }: { jsonString: string }) {
  try {
    const chartData = JSON.parse(jsonString);
    const { type, data, title } = chartData;

    return (
      <div className="my-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
        {title && <h4 className="text-sm font-semibold mb-4 text-slate-700 dark:text-slate-300">{title}</h4>}
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {type === 'bar' ? (
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
                <XAxis dataKey="name" fontSize={12} stroke="#94a3b8" />
                <YAxis fontSize={12} stroke="#94a3b8" />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Bar dataKey="value" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            ) : (
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {data.map((_: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Legend />
              </PieChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    );
  } catch (e) {
    return null;
  }
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark' || 
        (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });

  const isPluginMode = useMemo(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('plugin') === 'true';
    }
    return false;
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    // Build conversation history before adding the new user message
    const conversationHistory = messages.map(m => ({
      role: m.role,
      parts: [{ text: m.content }],
    }));

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Add a placeholder model message that will be filled by streamed chunks
    setMessages(prev => [...prev, {
      role: 'model',
      content: '',
      timestamp: new Date(),
    }]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          history: conversationHistory,
        }),
      });

      if (!response.ok || !response.body) {
        // Handle rate limit (429) and other HTTP errors
        let errorMessage = "I encountered an error while processing your request. Please try again.";
        try {
          const errData = await response.json();
          if (errData.error) errorMessage = errData.error;
        } catch {
          // ignore parse errors
        }
        setMessages(prev => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === 'model') {
            updated[updated.length - 1] = { ...lastMsg, content: errorMessage };
          }
          return updated;
        });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';  // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;

          try {
            const parsed = JSON.parse(payload);
            if (parsed.error) {
              // Server-side Gemini error — show friendly message
              setMessages(prev => {
                const updated = [...prev];
                const lastMsg = updated[updated.length - 1];
                if (lastMsg && lastMsg.role === 'model') {
                  updated[updated.length - 1] = {
                    ...lastMsg,
                    content: parsed.message ?? "I'm having trouble connecting. Please try again in a moment.",
                  };
                }
                return updated;
              });
              return;
            }
            if (parsed.text) {
              // Append streamed text chunk to the last (model) message
              setMessages(prev => {
                const updated = [...prev];
                const lastMsg = updated[updated.length - 1];
                if (lastMsg && lastMsg.role === 'model') {
                  updated[updated.length - 1] = {
                    ...lastMsg,
                    content: lastMsg.content + parsed.text,
                  };
                }
                return updated;
              });
            }
          } catch {
            // Malformed JSON chunk — skip
          }
        }
      }
    } catch (error) {
      console.error("Chat Error:", error);
      setMessages(prev => {
        const updated = [...prev];
        const lastMsg = updated[updated.length - 1];
        if (lastMsg && lastMsg.role === 'model') {
          updated[updated.length - 1] = {
            ...lastMsg,
            content: "I encountered an error while processing your request. Please try again.",
          };
        }
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    if (window.confirm("Are you sure you want to clear the conversation?")) {
      setMessages([]);
    }
  };

  const quickQueries = [
    "New vs Old Tax Regime FY 2024-25?",
    "How to save tax under 80C?",
    "GST rate for software services?",
    "Calculate tax for 15L income",
  ];

  const renderContent = (content: string) => {
    const parts = content.split(/```json-chart([\s\S]*?)```/);
    return parts.map((part, index) => {
      if (index % 2 === 1) {
        return <ChartRenderer key={index} jsonString={part.trim()} />;
      }
      return (
        <div key={index} className="markdown-body prose prose-slate dark:prose-invert max-w-none prose-sm sm:prose-base overflow-x-auto">
          <Markdown remarkPlugins={[remarkGfm]}>{part}</Markdown>
        </div>
      );
    });
  };

  return (
    <div className={cn(
      "flex h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 overflow-hidden transition-colors duration-300",
      isPluginMode && "rounded-2xl border border-slate-200 dark:border-slate-800"
    )}>
      {/* Sidebar for Desktop */}
      {!isPluginMode && (
        <aside className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0",
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}>
          <div className="flex flex-col h-full p-6">
            <div className="flex items-center gap-3 mb-8">
              <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-xl">
                <IndianRupee className="w-6 h-6 text-orange-600 dark:text-orange-400" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100">Tax Assistant</h1>
              <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden ml-auto p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="mb-6">
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">Quick Guides</h2>
                <div className="space-y-1">
                  {quickQueries.map((query, idx) => (
                    <button
                      key={idx}
                      onClick={() => { setInput(query); setIsSidebarOpen(false); }}
                      className="w-full text-left px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 rounded-lg transition-colors flex items-center gap-2"
                    >
                      <Info className="w-4 h-4 text-slate-400" />
                      {query}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-6">
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">Resources</h2>
                <div className="space-y-1">
                  <a href="https://www.incometax.gov.in/" target="_blank" rel="noopener noreferrer" className="w-full text-left px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg flex items-center gap-2">
                    <ExternalLink className="w-4 h-4" />
                    Income Tax Portal
                  </a>
                  <a href="https://www.gst.gov.in/" target="_blank" rel="noopener noreferrer" className="w-full text-left px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg flex items-center gap-2">
                    <ExternalLink className="w-4 h-4" />
                    GST Portal
                  </a>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                {isDarkMode ? 'Light Mode' : 'Dark Mode'}
              </button>
              <button 
                onClick={clearChat}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-900/20 rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Clear Conversation
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative min-w-0">
        {/* Header */}
        <header className={cn(
          "h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 lg:px-8 sticky top-0 z-10",
          isPluginMode && "h-12 px-4"
        )}>
          <div className="flex items-center gap-3">
            {!isPluginMode && (
              <button 
                onClick={() => setIsSidebarOpen(true)}
                className="lg:hidden p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              >
                <Menu className="w-6 h-6 text-slate-600 dark:text-slate-400" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-green-600 dark:text-green-400" />
              <span className="font-semibold text-slate-700 dark:text-slate-200 text-sm sm:text-base">
                {isPluginMode ? 'Tax Assistant' : 'Indian Tax Assistant'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            {isPluginMode && (
              <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              >
                {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            )}
            <div className="hidden sm:flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1">
                <Calculator className="w-3 h-3" />
                AY 2025-26 Ready
              </span>
            </div>
          </div>
        </header>

        {/* Chat Area */}
        <div 
          ref={chatContainerRef}
          className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-6 scroll-smooth"
        >
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto space-y-8 py-12">
              <div className="w-20 h-20 bg-orange-100 dark:bg-orange-900/30 rounded-3xl flex items-center justify-center animate-bounce">
                <Bot className="w-10 h-10 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="space-y-4">
                <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-slate-100">Namaste! I'm your Tax Assistant.</h2>
                <p className="text-slate-600 dark:text-slate-400 text-base sm:text-lg">
                  Ask me anything about Income Tax, GST, Deductions, or Financial Planning in India.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                {quickQueries.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(q)}
                    className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-left hover:border-orange-400 dark:hover:border-orange-600 hover:shadow-md transition-all group"
                  >
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300 group-hover:text-orange-600 dark:group-hover:text-orange-400">{q}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-6">
              <AnimatePresence initial={false}>
                {messages.map((msg, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn("flex gap-4", msg.role === 'user' ? 'flex-row-reverse' : '')}
                  >
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                      msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
                    )}>
                      {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                    </div>
                    <div className={cn(
                      "max-w-[85%] p-4 rounded-2xl shadow-sm",
                      msg.role === 'user' 
                        ? 'bg-indigo-600 text-white rounded-tr-none' 
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-none'
                    )}>
                      {renderContent(msg.content)}
                      <div className={cn("text-[10px] mt-2 opacity-50", msg.role === 'user' ? 'text-right' : '')}>
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {isLoading && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex gap-4"
                >
                  <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 flex items-center justify-center">
                    <Bot className="w-5 h-5" />
                  </div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl rounded-tl-none shadow-sm">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-slate-300 dark:bg-slate-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                      <span className="w-2 h-2 bg-slate-300 dark:bg-slate-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                      <span className="w-2 h-2 bg-slate-300 dark:bg-slate-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                    </div>
                  </div>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 lg:p-6 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
          <div className="max-w-4xl mx-auto relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask about income tax, GST, or tax saving..."
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 pr-14 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none min-h-[56px] max-h-32 transition-all text-slate-800 dark:text-slate-100"
              rows={1}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className={cn(
                "absolute right-2 bottom-2 p-2 rounded-xl transition-all",
                !input.trim() || isLoading 
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
      </main>

      {/* Mobile Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  );
}
