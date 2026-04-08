import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Upload } from 'lucide-react';
import { useChatManager } from '../../hooks/useChatManager';
import { useFileUpload } from '../../hooks/useFileUpload';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { ThinkingIndicator } from './ThinkingIndicator';
import { cn } from '../../lib/utils';

const quickQueries = [
  "New vs Old Tax Regime FY 2024-25?",
  "How to save tax under 80C?",
  "GST rate for software services?",
  "Calculate tax for 15L income",
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
        <div className="absolute inset-0 z-20 bg-[#FDF6E3]/90 dark:bg-[#5C4505]/90 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 p-8 border-2 border-dashed border-[#D4A020] dark:border-[#B8860B] rounded-3xl">
            <Upload className="w-12 h-12 text-[#D4A020]" />
            <p className="text-lg font-semibold text-[#B8860B] dark:text-[#D4A020]">Drop your document here</p>
            <p className="text-sm text-[#D4A020]">PDF, JPEG, PNG, WebP, or HEIC</p>
          </div>
        </div>
      )}

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-6 scroll-smooth">
        {messages.length === 0 && !isLoading ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto space-y-8 py-12">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center">
              <img src="/logoAI.png" alt="Smart AI" className="w-16 h-16 object-contain" />
            </div>
            <div className="space-y-4">
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-slate-100">Namaste! I'm Smart AI.</h2>
              <p className="text-slate-600 dark:text-slate-400 text-base sm:text-lg">
                Ask me anything about Income Tax, GST, Deductions, or Financial Planning in India.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
              {quickQueries.map((q, i) => (
                <button
                  key={i}
                  onClick={() => setInput(q)}
                  className="p-4 bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm border border-slate-200/50 dark:border-slate-800/50 rounded-2xl text-left hover:border-[#D4A020] dark:hover:border-[#B8860B] hover:shadow-lg transition-all group"
                >
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300 group-hover:text-[#B8860B] dark:group-hover:text-[#D4A020]">{q}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-6">
            <AnimatePresence initial={false}>
              {messages.map((msg, idx) => (
                <motion.div
                  key={`${idx}-${msg.content.slice(0, 20)}`}
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                >
                  <MessageBubble message={msg} onContinue={continueResponse} />
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Thinking indicator — shows animated logo while waiting */}
            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <ThinkingIndicator />
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
        activeDocument={activeDocument}
        onFileSelect={handleFileSelect}
        onDetachDocument={handleDetach}
        uploadPhase={fileUpload.uploadPhase}
      />
    </div>
  );
}
