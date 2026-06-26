import { useState, useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Upload, FileText, Loader2, ExternalLink, Landmark, Scale, FileSignature, ScrollText, Calculator, Stamp, Sparkles, Brain } from 'lucide-react';
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
  /** Jump to another tool from the home-screen feature guide. */
  onNavigate?: (view: string) => void;
}

const ATTACHMENT_LIMITS: Record<string, number> = { free: 1, pro: 3, enterprise: 5 };

export function ChatView({ isPluginMode: _isPluginMode, chatManager, onNavigate }: ChatViewProps) {
  const { messages, input, setInput, isLoading, messagesEndRef, scrollAreaRef, lastUserMsgRef, send, activeDocuments, attachDocument, detachDocument, continueResponse, referencedProfile, setReferencedProfile, injectExchange } = chatManager;
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

  // Marquee scroll state. The ticker is a native overflow-x-auto
  // container; a requestAnimationFrame loop ticks `scrollLeft` forward
  // each frame to produce the auto-scroll, and pointer events let the
  // user grab and drag the strip manually. The list is duplicated in
  // the markup, so once `scrollLeft` crosses half the track width we
  // reset to 0 for a seamless loop.
  const marqueeRef = useRef<HTMLDivElement | null>(null);
  // Refs (not state) for live drag bookkeeping — re-rendering every
  // frame during a drag would tank performance.
  const dragStateRef = useRef<{ dragging: boolean; startX: number; startScroll: number; movedPx: number; }>({
    dragging: false, startX: 0, startScroll: 0, movedPx: 0,
  });
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (notifications.length === 0) return;
    let raf = 0;
    let last = performance.now();
    let accum = 0; // sub-pixel accumulator; flushed once it exceeds 1px
    const PX_PER_SEC = 50; // ~50px/s — visible idle drift; user can drag faster
    const tick = (now: number) => {
      const el = marqueeRef.current;
      if (el) {
        const dt = Math.min(100, now - last);
        last = now;
        const half = el.scrollWidth / 2;
        if (!dragStateRef.current.dragging && half > 0) {
          // scrollLeft is rounded to integer pixels in most browsers,
          // so a 50 px/s drift (~0.8 px/frame) would round to 0 and
          // never advance. Accumulate sub-pixel delta and flush whole
          // pixels into scrollLeft as they appear.
          accum += (PX_PER_SEC * dt) / 1000;
          const whole = Math.floor(accum);
          if (whole > 0) {
            accum -= whole;
            let next = el.scrollLeft + whole;
            if (next >= half) next -= half;
            el.scrollLeft = next;
          }
        }
      } else {
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [notifications.length]);

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
      // Single round-trip: the server creates a fresh chat, persists
      // the user→model exchange, and returns both the cached detail
      // and the new chatId. With pre-generated full_detail in the DB
      // this typically completes in 100-200ms — the user sees the
      // explanation effectively instantly. (Pre-Phase-2-fix this was
      // two round-trips plus a 10-20s grounded LLM call.)
      const res = await fetchNotificationDetail(n.id);
      const userText = `Explain: ${n.heading}`;
      // injectExchange with chatId switches the active chat and
      // refreshes the sidebar so the new thread appears. Follow-up
      // questions then go through normal `send` against this chat.
      injectExchange(userText, res.detail, res.chatId ?? undefined);
    } catch (err) {
      console.error('[notifications] detail fetch failed', err);
      // Fall back: drop the heading into the input so the user can
      // press Enter to ask the model directly via the normal send flow.
      setInput(`Tell me about: ${n.heading}`);
    } finally {
      setPendingNotificationId(null);
    }
  }, [injectExchange, pendingNotificationId, setInput]);

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
          /* Top-aligned layout: with the daily notifications list the
             welcome content (logo + heading + 10-20 cards) is taller
             than the viewport. The previous `h-full justify-center`
             centered everything vertically, which clipped the first
             two cards above the scrollable area's top edge with no
             way to scroll up to them. Flowing from the top + adding
             `min-h-full` keeps the empty / loading state balanced
             when content is short, but lets it grow naturally when
             there are many cards so all of them are scrollable. */
          <div className="min-h-full flex flex-col items-center py-12 space-y-8">
            <div className="flex flex-col items-center text-center max-w-2xl space-y-6">
              <div className="w-20 h-20 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                <img src="/logoAI.png" alt="Smartbiz AI" className="w-14 h-14 object-contain" />
              </div>
              <div className="space-y-3">
                <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
                  Welcome to Smartbiz AI
                </h2>
                <p className="text-gray-500 dark:text-gray-400 text-base sm:text-lg">
                  Latest GST, TDS, and Income Tax notifications — click any item for a detailed explanation.
                </p>
              </div>
            </div>
            {/* Notifications marquee — pinned to the TOP of the welcome
               column (order-first) so the live tax updates sit just below
               the nav tabs, above the welcome heading. Full chat-area width. */}
            <div className="w-full order-first">
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
                // Horizontally auto-scrolling marquee replacing the
                // 2-column grid. Uses native overflow-x scroll driven
                // by a requestAnimationFrame loop (see marqueeRef
                // useEffect above) so the same `scrollLeft` value
                // accepts both auto-scroll and pointer drag — no
                // double-source-of-truth between CSS transform and
                // user scroll. The item list is duplicated in the
                // markup; the rAF loop resets to 0 once scrollLeft
                // passes half the track width, giving an infinite
                // seamless loop. Hovering pauses auto-scroll; clicking
                // and dragging temporarily takes over.
                <div
                  className="relative w-full overflow-hidden"
                  style={{
                    maskImage: 'linear-gradient(to right, transparent, black 4%, black 96%, transparent)',
                    WebkitMaskImage: 'linear-gradient(to right, transparent, black 4%, black 96%, transparent)',
                  }}
                >
                  <div
                    ref={marqueeRef}
                    className="flex gap-3 overflow-x-auto scrollbar-hide select-none cursor-grab active:cursor-grabbing"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', scrollBehavior: 'auto' }}
                    onPointerDown={e => {
                      const el = marqueeRef.current;
                      if (!el) return;
                      // Track the gesture but do NOT call setPointerCapture
                      // here. Capturing on pointerdown reroutes the
                      // subsequent click event to the marquee container,
                      // which prevents the inner <button>'s onClick from
                      // firing on a plain tap. We only need pointer
                      // capture once a real drag is in progress —
                      // upgrade to capture inside pointermove once
                      // movedPx crosses the click-vs-drag threshold.
                      dragStateRef.current.dragging = false;
                      dragStateRef.current.startX = e.clientX;
                      dragStateRef.current.startScroll = el.scrollLeft;
                      dragStateRef.current.movedPx = 0;
                    }}
                    onPointerMove={e => {
                      const el = marqueeRef.current;
                      if (!el) return;
                      // Were we tracking a pointerdown? startX is stored
                      // regardless of dragging flag.
                      if (dragStateRef.current.startX === 0 && dragStateRef.current.movedPx === 0 && !dragStateRef.current.dragging) {
                        // No active gesture (pointer outside).
                        return;
                      }
                      const dx = e.clientX - dragStateRef.current.startX;
                      dragStateRef.current.movedPx = Math.max(dragStateRef.current.movedPx, Math.abs(dx));
                      // Cross 5px → promote to actual drag, capture
                      // pointer, start consuming the move.
                      if (!dragStateRef.current.dragging && dragStateRef.current.movedPx > 5) {
                        dragStateRef.current.dragging = true;
                        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
                      }
                      if (!dragStateRef.current.dragging) return;
                      el.scrollLeft = dragStateRef.current.startScroll - dx;
                      const half = el.scrollWidth / 2;
                      if (half > 0) {
                        if (el.scrollLeft < 0) el.scrollLeft += half;
                        else if (el.scrollLeft >= half) el.scrollLeft -= half;
                      }
                    }}
                    onPointerUp={e => {
                      const wasDragging = dragStateRef.current.dragging;
                      dragStateRef.current.dragging = false;
                      dragStateRef.current.startX = 0;
                      // Only suppress the synthetic click when we
                      // genuinely promoted to a drag gesture.
                      suppressClickRef.current = wasDragging && dragStateRef.current.movedPx > 5;
                      if (wasDragging) {
                        try { marqueeRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
                      }
                      dragStateRef.current.movedPx = 0;
                    }}
                    onPointerCancel={() => {
                      dragStateRef.current.dragging = false;
                      dragStateRef.current.startX = 0;
                      dragStateRef.current.movedPx = 0;
                    }}
                  >
                  {[...notifications, ...notifications].map((n, idx) => {
                    const isPending = pendingNotificationId === n.id;
                    return (
                      <button
                        key={`${n.id}-${idx}`}
                        onClick={() => {
                          if (suppressClickRef.current) {
                            suppressClickRef.current = false;
                            return;
                          }
                          handleNotificationClick(n);
                        }}
                        disabled={pendingNotificationId !== null}
                        className="shrink-0 w-[26rem] px-4 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/50 rounded-lg text-left hover:border-emerald-400 dark:hover:border-emerald-600 hover:shadow-md transition-all group disabled:opacity-50 disabled:cursor-wait"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-md bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center shrink-0 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/30 transition-colors">
                            {isPending ? (
                              <Loader2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 animate-spin" />
                            ) : (
                              <FileText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={cn(
                                'text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded',
                                CATEGORY_BADGE[n.category],
                              )}>
                                {CATEGORY_LABEL[n.category]}
                              </span>
                              {n.notificationDate && (
                                <span className="text-[10px] text-gray-500 dark:text-gray-500 whitespace-nowrap">
                                  {formatNotificationDate(n.notificationDate)}
                                </span>
                              )}
                              {n.hasDetail && (
                                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 whitespace-nowrap" title="Detailed explanation already cached — click for instant answer">
                                  ✓ ready
                                </span>
                              )}
                            </div>
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors truncate">{n.heading}</p>
                          </div>
                          {n.sourceUrl && (
                            <a
                              href={n.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 shrink-0"
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
                </div>
              )}
            </div>

            {/* What's new — recent upgrades, below the live notifications. */}
            <div className="w-full max-w-2xl rounded-xl border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/60 dark:bg-emerald-900/15 px-4 py-3 text-left">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">What's new</span>
              </div>
              <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
                <li className="flex items-start gap-2">
                  <Brain className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                  <span>
                    <span className="font-medium text-gray-800 dark:text-gray-100">Smarter answers.</span> Upgraded to a stronger reasoning model with live tax-law search. Use the <span className="font-medium">Fast / Deep</span> toggle in the box below — pick Deep for notices, computations, and complex cases.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <FileText className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                  <span>
                    <span className="font-medium text-gray-800 dark:text-gray-100">PDF export.</span> Just ask — e.g. “give me this as a PDF” — and download a clean, branded document.
                  </span>
                </li>
              </ul>
            </div>
            <FeaturesGuide onNavigate={onNavigate} />
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

/** Home-screen guide: a short, clickable tour of the main tools.
 *  Deliberately omits ITR, TB→Statement and CMA per product scoping. */
const GUIDE_FEATURES: Array<{
  view: string;
  title: string;
  desc: string;
  icon: typeof Landmark;
}> = [
  { view: 'bank_statements', icon: Landmark, title: 'Bank Statement Analyzer',
    desc: 'Upload PDF / Excel / CSV statements — auto-categorised transactions, party-wise ledgers (PDF or Word), and anomaly flags.' },
  { view: 'ledger_scrutiny', icon: Scale, title: 'Ledger Scrutiny & Compare',
    desc: 'AI audit of Tally / Busy / Marg ledgers, and reconcile two parties’ books bill-by-bill side by side.' },
  { view: 'notices', icon: FileSignature, title: 'Notice Reply Drafting',
    desc: 'Draft replies to Income-Tax / GST notices with correct, verified section citations.' },
  { view: 'partnership_deeds', icon: ScrollText, title: 'Deeds & Agreements',
    desc: 'Generate partnership deeds, LLP & rent agreements — download as PDF or editable Word.' },
  { view: 'board_resolutions', icon: Stamp, title: 'Board Resolutions',
    desc: 'Ready-to-sign company board resolutions for common corporate actions.' },
  { view: 'calculator', icon: Calculator, title: 'Calculators & Slips',
    desc: 'Income-tax computation, Challan 280, salary slips and rent receipts.' },
];

function FeaturesGuide({ onNavigate }: { onNavigate?: (view: string) => void }) {
  return (
    <div className="w-full max-w-4xl px-2">
      <div className="text-center mb-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">What you can do here</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          A quick tour of the tools — or just ask the assistant a question below.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {GUIDE_FEATURES.map((f) => {
          const Icon = f.icon;
          const interactive = !!onNavigate;
          return (
            <button
              key={f.view}
              type="button"
              onClick={() => onNavigate?.(f.view)}
              disabled={!interactive}
              className={cn(
                'text-left p-3.5 rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800/40 transition-all',
                interactive ? 'hover:border-emerald-400 dark:hover:border-emerald-600 hover:shadow-md cursor-pointer' : 'cursor-default',
              )}
            >
              <div className="flex items-center gap-2.5 mb-1.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{f.title}</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{f.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
