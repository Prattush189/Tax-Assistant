import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Upload, MessageCircle, Calculator, FileText, HelpCircle } from 'lucide-react';
import { useChatManager } from '../../hooks/useChatManager';
import { useFileUpload } from '../../hooks/useFileUpload';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { ThinkingIndicator } from './ThinkingIndicator';
import { cn } from '../../lib/utils';

const quickQueries = [
  { text: "New vs Old Tax Regime FY 2024-25?", icon: HelpCircle },
  { text: "How to save tax under 80C?", icon: Calculator },
  { text: "GST rate for software services?", icon: FileText },
  { text: "Calculate tax for 15L income", icon: MessageCircle },
];

interface ChatViewProps {
  isPluginMode: boolean;
  chatManager: ReturnType<typeof useChatManager>;
}

export function ChatView({ isPluginMode: _isPluginMode, chatManager }: ChatViewProps) {
  const { messages, input, setInput, isLoading, messagesEndRef, send, activeDocument, attachDocument, detachDocument, continueResponse } = chatManager;
  const fileUpload = useFileUpload();
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFileSelect = useCallback(async (file: File) => {
    const doc = await fileUpload.handleFile(file);
    if (doc) attachDocument(doc);
  }, [fileUpload, attachDocument]);

  const handleDetach = useCallback(() => {
    detachDocument();
    fileUpload.reset();
  }, [detachDocument, fileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  return (
    <div
      className="flex-1 flex flex-col relative min-h-0"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-20 bg-emerald-50/90 dark:bg-emerald-950/80 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 p-8 border-2 border-dashed border-emerald-400 dark:border-emerald-600 rounded-3xl">
            <Upload className="w-12 h-12 text-emerald-500" />
            <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">Drop your document here</p>
            <p className="text-sm text-emerald-500">PDF, JPEG, PNG, WebP, or HEIC</p>
          </div>
        </div>
      )}

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-6 scroll-smooth">
        {messages.length === 0 && !isLoading ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto space-y-8 py-12">
            <div className="w-20 h-20 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
              <img src="/logoAI.png" alt="Smart AI" className="w-14 h-14 object-contain" />
            </div>
            <div className="space-y-3">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
                Namaste! I'm Smart AI.
              </h2>
              <p className="text-gray-500 dark:text-gray-400 text-base sm:text-lg max-w-lg mx-auto">
                Ask me anything about Income Tax, GST, Deductions, or Financial Planning in India.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
              {quickQueries.map((q, i) => {
                const Icon = q.icon;
                return (
                  <button
                    key={i}
                    onClick={() => setInput(q.text)}
                    className="p-4 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/50 rounded-xl text-left hover:border-emerald-400 dark:hover:border-emerald-600 hover:shadow-md transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center shrink-0 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/30 transition-colors">
                        <Icon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors">{q.text}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-6">
            <AnimatePresence initial={false}>
              {messages.filter(msg => msg.role === 'user' || msg.content !== '').map((msg, idx) => (
                <motion.div
                  key={`${idx}-${msg.content.slice(0, 20)}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                >
                  <MessageBubble message={msg} onContinue={continueResponse} />
                </motion.div>
              ))}
            </AnimatePresence>

            {isLoading && messages.length > 0 && messages[messages.length - 1].content === '' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <ThinkingIndicator />
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <ChatInput
        input={input}
        isLoading={isLoading}
        onInputChange={setInput}
        onSend={send}
        activeDocument={activeDocument}
        onFileSelect={handleFileSelect}
        onDetachDocument={handleDetach}
        uploadPhase={fileUpload.uploadPhase}
      />
    </div>
  );
}
