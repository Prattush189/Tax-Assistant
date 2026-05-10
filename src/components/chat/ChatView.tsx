import { useState, useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Upload, FileText, Loader2, ExternalLink } from 'lucide-react';
import { useChatManager } from '../../hooks/useChatManager';
import { useFileUpload } from '../../hooks/useFileUpload';
import { useAuth } from '../../contexts/AuthContext';
import { fetchProfiles, TaxProfileData, fetchLatestNotifications, fetchNotificationDetail, TaxNotificationListItem } from '../../services/api';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { ThinkingIndicator } from './ThinkingIndicator';
import { cn } from '../../lib/utils';

// Daily-refreshed list of GST/TDS/Income Tax notifications replaces the
// old static prompt cards. Server fetches via Gemini 3.1 Flash-Lite +
// Google Search grounding once a day; click → /api/notifications/:id/detail
// returns the cached or freshly-generated long-form explanation.

const CATEGORY_LABEL: Record<TaxNotificationListItem['category'], string> = {
  GST: 'GST',
  TDS: 'TDS',
  INCOME_TAX: 'Income Tax',
  OTHER: 'Other',
};

const CATEGORY_BADGE: Record<TaxNotificationListItem['category'], string> = {
  GST: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  TDS: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  INCOME_TAX: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
  OTHER: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
};

function formatNotificationDate(iso: string | null): string {
  if (!iso) return '';
  // YYYY-MM-DD → "30 Apr 2026"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${parseInt(m[3], 10)} ${months[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

interface ChatViewProps {
  isPluginMode: boolean;
  chatManager: ReturnType<typeof useChatManager>;
}

const ATTACHMENT_LIMITS: Record<string, number> = { free: 1, pro: 3, enterprise: 5 };

export function ChatView({ isPluginMode: _isPluginMode, chatManager }: ChatViewProps) {
  const { messages, input, setInput, isLoading, messagesEndRef, scrollAreaRef, lastUserMsgRef, send, activeDocuments, attachDocument, detachDocument, continueResponse, referencedProfile, setReferencedProfile, injectExchange, createNewChat } = chatManager;
  const { user } = useAuth();
  const fileUpload = useFileUpload();
  const [isDragOver, setIsDragOver] = useState(false);
  const [profiles, setProfiles] = useState<{ id: string; name: string; data: Record<string, unknown> }[]>([]);
  const attachmentLimit = ATTACHMENT_LIMITS[user?.plan ?? 'free'] ?? 1;
  const isPro = user?.plan === 'pro' || user?.plan === 'enterprise';

  // Daily-refreshed notification list. Loads once on mount; if the
  // server has never run the fetch (fresh install) the list is empty
  // and the welcome screen falls back to a small "loading" or
  // "nothing to show" message rather than the old static cards.
  const [notifications, setNotifications] = useState<TaxNotificationListItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [pendingNotificationId, setPendingNotificationId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLatestNotifications()
      .then(res => { if (!cancelled) setNotifications(res.items); })
      .catch(() => { /* leave empty — UI handles the fallback */ })
      .finally(() => { if (!cancelled) setNotificationsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleNotificationClick = useCallback(async (n: TaxNotificationListItem) => {
    if (pendingNotificationId) return;
    setPendingNotificationId(n.id);
    try {
      // Create a brand-new chat first so the exchange is durable,
      // shows up in the sidebar, and the user can keep asking
      // follow-ups in the same thread. Without this, the synthetic
      // exchange only lives in component state — refresh, navigate
      // away, or click a different chat and it's gone.
      const newChatId = await createNewChat();
      const res = await fetchNotificationDetail(n.id, newChatId);
      // Render the heading as the user message and the detail as the
      // model's answer. Server already persisted both; we mirror them
      // into local state so they appear immediately without a refetch.
      const userText = `Explain: ${n.heading}`;
      injectExchange(userText, res.detail);
    } catch (err) {
      console.error('[notifications] detail fetch failed', err);
      // Fall back: drop the heading into the input so the user can
      // press Enter to ask the model directly via the normal send flow.
      setInput(`Tell me about: ${n.heading}`);
    } finally {
      setPendingNotificationId(null);
    }
  }, [createNewChat, injectExchange, pendingNotificationId, setInput]);

  useEffect(() => {
    if (!isPro) return;
    fetchProfiles()
      .then(res => {
        setProfiles(res.profiles.map((p: TaxProfileData) => ({
          id: p.id,
          name: p.name,
          data: {
            fy: p.fy,
            gross_salary: p.gross_salary,
            other_income: p.other_income,
            age_category: p.age_category,
            deductions_data: p.deductions_data,
            hra_data: p.hra_data,
          },
        })));
      })
      .catch(() => { /* ignore */ });
  }, [isPro]);

  const handleFileSelect = useCallback(async (file: File) => {
    const doc = await fileUpload.handleFile(file);
    if (doc) attachDocument(doc);
  }, [fileUpload, attachDocument]);

  const handleDetach = useCallback((index: number) => {
    detachDocument(index);
    if (activeDocuments.length <= 1) fileUpload.reset();
  }, [detachDocument, activeDocuments.length, fileUpload]);

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
    const files = Array.from(e.dataTransfer.files);
    files.forEach(f => handleFileSelect(f));
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
      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-6 scroll-smooth">
        {messages.length === 0 && !isLoading ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto space-y-8 py-12">
            <div className="w-20 h-20 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
              <img src="/logoAI.png" alt="Smartbiz AI" className="w-14 h-14 object-contain" />
            </div>
            <div className="space-y-3">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
                Welcome to Smartbiz AI
              </h2>
              <p className="text-gray-500 dark:text-gray-400 text-base sm:text-lg max-w-lg mx-auto">
                Latest GST, TDS, and Income Tax notifications — click any item for a detailed explanation.
              </p>
            </div>
            <div className="w-full">
              {notificationsLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500 dark:text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading latest notifications…
                </div>
              ) : notifications.length === 0 ? (
                <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
                  No notifications cached yet. The daily refresh runs on the server — try again in a few minutes,
                  or ask any question about Income Tax, GST, Deductions, or Financial Planning below.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left">
                  {notifications.map(n => {
                    const isPending = pendingNotificationId === n.id;
                    return (
                      <button
                        key={n.id}
                        onClick={() => handleNotificationClick(n)}
                        disabled={pendingNotificationId !== null}
                        className="p-4 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/50 rounded-xl text-left hover:border-emerald-400 dark:hover:border-emerald-600 hover:shadow-md transition-all group disabled:opacity-50 disabled:cursor-wait"
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center shrink-0 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/30 transition-colors">
                            {isPending ? (
                              <Loader2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 animate-spin" />
                            ) : (
                              <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded',
                                CATEGORY_BADGE[n.category],
                              )}>
                                {CATEGORY_LABEL[n.category]}
                              </span>
                              {n.notificationDate && (
                                <span className="text-[11px] text-gray-500 dark:text-gray-500">
                                  {formatNotificationDate(n.notificationDate)}
                                </span>
                              )}
                              {n.hasDetail && (
                                <span className="text-[10px] text-emerald-600 dark:text-emerald-400" title="Detailed explanation already cached — click for instant answer">
                                  ✓ ready
                                </span>
                              )}
                            </div>
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors line-clamp-2">{n.heading}</p>
                            {n.summary && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{n.summary}</p>
                            )}
                          </div>
                          {n.sourceUrl && (
                            <a
                              href={n.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 mt-0.5"
                              title="Open source notification"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-6">
            <AnimatePresence initial={false}>
              {messages.filter(msg => msg.role === 'user' || msg.content !== '').map((msg, idx, filtered) => {
                const isLastUser = msg.role === 'user' &&
                  filtered.slice(idx + 1).every(m => m.role !== 'user');
                const isLastModel = msg.role === 'model' && idx === filtered.length - 1;
                return (
                  <motion.div
                    key={`${idx}-${msg.content.slice(0, 20)}`}
                    ref={isLastUser ? lastUserMsgRef : undefined}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  >
                    <MessageBubble
                      message={msg}
                      onContinue={continueResponse}
                      isLastModel={isLastModel}
                      isLoading={isLoading}
                    />
                  </motion.div>
                );
              })}
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
        activeDocuments={activeDocuments}
        onFileSelect={handleFileSelect}
        onDetachDocument={handleDetach}
        uploadPhase={fileUpload.uploadPhase}
        attachmentLimit={attachmentLimit}
        profiles={profiles}
        referencedProfile={referencedProfile}
        onReferenceProfile={setReferencedProfile}
        onClearReference={() => setReferencedProfile(null)}
        isPro={isPro}
      />
    </div>
  );
}
