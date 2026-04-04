import { AnimatePresence, motion } from 'motion/react';
import { Bot } from 'lucide-react';
import { useChat } from '../../hooks/useChat';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';

const quickQueries = [
  "New vs Old Tax Regime FY 2024-25?",
  "How to save tax under 80C?",
  "GST rate for software services?",
  "Calculate tax for 15L income",
];

interface ChatViewProps {
  isPluginMode: boolean;
}

export function ChatView({ isPluginMode: _isPluginMode }: ChatViewProps) {
  const { messages, input, setInput, isLoading, messagesEndRef, send } = useChat();

  return (
    <>
      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-6 scroll-smooth">
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
                >
                  <MessageBubble message={msg} />
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
      <ChatInput
        input={input}
        isLoading={isLoading}
        onInputChange={setInput}
        onSend={send}
      />
    </>
  );
}
