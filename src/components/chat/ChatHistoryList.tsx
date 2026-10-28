import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Pencil, Trash2, Check, Loader2, MessageSquareText, Pin, PinOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import { ChatItem, ChatSearchResult, searchChats } from '../../services/api';

interface ChatHistoryListProps {
  chatList: ChatItem[];
  currentChatId: string | null;
  deletingId: string | null;
  onSwitch: (chatId: string) => void;
  onDelete: (e: React.MouseEvent, chatId: string) => void;
  onRename?: (chatId: string, title: string) => Promise<void>;
  onTogglePin?: (chatId: string) => Promise<void>;
}

/** Chat timestamps are stored as IST wall-clock strings ("YYYY-MM-DD HH:MM:SS",
 *  no zone), so compare calendar days against today's IST date. */
function istDayDiff(stamp: string): number {
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const day = stamp.slice(0, 10);
  const diff = (Date.parse(today) - Date.parse(day)) / 86_400_000;
  return Number.isFinite(diff) ? Math.round(diff) : 999;
}

function groupLabel(stamp: string): string {
  const d = istDayDiff(stamp);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 7) return 'Previous 7 days';
  if (d < 30) return 'Previous 30 days';
  return 'Older';
}

/** Wraps each case-insensitive occurrence of `q` in a <mark>. */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, i)) {
    if (at > i) out.push(text.slice(i, at));
    out.push(
      <mark key={at} className="bg-amber-200/70 dark:bg-amber-500/30 text-inherit rounded-sm px-px">
        {text.slice(at, at + q.length)}
      </mark>,
    );
    i = at + q.length;
  }
  out.push(text.slice(i));
  return <>{out}</>;
}

export function ChatHistoryList({ chatList, currentChatId, deletingId, onSwitch, onDelete, onRename, onTogglePin }: ChatHistoryListProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const q = query.trim();

  // Debounced server search over titles + message bodies. Titles are also
  // filtered locally so the list reacts on the first keystroke.
  useEffect(() => {
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    const t = setTimeout(() => {
      searchChats(q, ctrl.signal)
        .then(setResults)
        .catch(err => { if ((err as Error).name !== 'AbortError') setResults([]); })
        .finally(() => { if (!ctrl.signal.aborted) setSearching(false); });
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  // Ctrl/Cmd+K focuses the search box from anywhere in the chat view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shown: ChatSearchResult[] = useMemo(() => {
    if (!q) return chatList.map(c => ({ ...c, snippet: null }));
    const local = chatList
      .filter(c => c.title.toLowerCase().includes(q.toLowerCase()))
      .map(c => ({ ...c, snippet: null }));
    if (!results) return local;
    // Server results win (they carry snippets); keep local title hits the
    // server hasn't returned yet, and reflect any rename or pin made meanwhile.
    const live = new Map(chatList.map(c => [c.id, c]));
    const seen = new Set(results.map(r => r.id));
    return [
      ...results.map(r => {
        const c = live.get(r.id);
        return c ? { ...r, title: c.title, pinned_at: c.pinned_at } : r;
      }),
      ...local.filter(c => !seen.has(c.id)),
    ];
  }, [q, chatList, results]);

  const groups = useMemo(() => {
    if (q) return [{ label: `${shown.length} result${shown.length === 1 ? '' : 's'}`, items: shown }];
    const out: { label: string; items: ChatSearchResult[] }[] = [];
    const pinned = shown.filter(c => c.pinned_at);
    if (pinned.length > 0) out.push({ label: 'Pinned', items: pinned });
    for (const c of shown) {
      if (c.pinned_at) continue;
      const label = groupLabel(c.updated_at);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(c);
      else out.push({ label, items: [c] });
    }
    return out;
  }, [q, shown]);

  const startRename = (e: React.MouseEvent, chat: ChatItem) => {
    e.stopPropagation();
    setEditingId(chat.id);
    setDraftTitle(chat.title);
  };

  const commitRename = async () => {
    const id = editingId;
    if (!id) return;
    setEditingId(null);
    const original = chatList.find(c => c.id === id)?.title;
    const next = draftTitle.trim();
    if (!next || next === original || !onRename) return;
    try {
      await onRename(id, next);
    } catch {
      toast.error('Could not rename the chat.');
    }
  };

  return (
    <div className="flex flex-col min-h-0">
      {/* Search */}
      <div className="px-1 pb-2 pt-1 sticky -top-2 z-10 bg-white dark:bg-[#151210]">
        <div className="relative group/search">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); searchRef.current?.blur(); } }}
            placeholder="Search chats"
            aria-label="Search chats"
            className="w-full h-8 pl-8 pr-14 text-[13px] rounded-lg bg-gray-100/80 dark:bg-gray-800/70 border border-transparent focus:border-emerald-500/60 focus:bg-white dark:focus:bg-gray-900 outline-none text-gray-800 dark:text-gray-100 placeholder:text-gray-400 transition-colors"
          />
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {searching && <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin" />}
            {query ? (
              <button
                type="button"
                onClick={() => { setQuery(''); searchRef.current?.focus(); }}
                className="p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <kbd className="hidden md:inline text-[10px] font-sans text-gray-400 border border-gray-200 dark:border-gray-700 rounded px-1 leading-4">Ctrl K</kbd>
            )}
          </div>
        </div>
      </div>

      {chatList.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
          <MessageSquareText className="w-6 h-6 text-gray-300 dark:text-gray-600" />
          <p className="text-sm text-gray-400 dark:text-gray-500">No chats yet. Ask your first question!</p>
        </div>
      ) : q && shown.length === 0 && !searching ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 px-3 py-6 text-center">
          No chats match “{q}”.
        </p>
      ) : (
        groups.map(group => (
          <div key={group.label} className="mb-2">
            <h2 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2.5 pt-2 pb-1">
              {group.label}
            </h2>
            <div className="space-y-px">
              {group.items.map(chat => {
                const isActive = currentChatId === chat.id;
                const isEditing = editingId === chat.id;
                if (isEditing) {
                  return (
                    <div key={chat.id} className="flex items-center gap-1 px-1.5 py-1 rounded-lg bg-white dark:bg-gray-900 ring-1 ring-emerald-500/60">
                      <input
                        autoFocus
                        value={draftTitle}
                        maxLength={120}
                        onChange={e => setDraftTitle(e.target.value)}
                        onFocus={e => e.currentTarget.select()}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        onBlur={() => void commitRename()}
                        aria-label="Chat name"
                        className="flex-1 min-w-0 bg-transparent outline-none text-sm px-1 py-0.5 text-gray-800 dark:text-gray-100"
                      />
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => void commitRename()}
                        className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                        aria-label="Save name"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                }
                return (
                  <div key={chat.id} className="relative group">
                    <button
                      onClick={() => onSwitch(chat.id)}
                      onDoubleClick={e => onRename && startRename(e, chat)}
                      title={chat.title}
                      className={cn(
                        'w-full text-left px-2.5 py-2 rounded-lg transition-colors pr-20',
                        isActive
                          ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-800/60',
                      )}
                    >
                      <p className={cn('text-[13px] truncate', isActive ? 'font-semibold' : 'font-medium')}>
                        {/* Search results aren't grouped, so mark pinned ones inline. */}
                        {q && chat.pinned_at && <Pin className="inline w-3 h-3 mr-1 -mt-0.5 text-emerald-600 dark:text-emerald-400" aria-label="Pinned" />}
                        <Highlight text={chat.title} q={q} />
                      </p>
                      {chat.snippet && (
                        <p className="text-[11px] leading-snug text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">
                          <Highlight text={chat.snippet} q={q} />
                        </p>
                      )}
                    </button>
                    {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-emerald-500" />}
                    <div className={cn(
                      'absolute right-1.5 top-1.5 flex items-center gap-0.5 transition-opacity',
                      // Touch screens have no hover — keep actions visible there.
                      'opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100',
                    )}>
                      {onTogglePin && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            onTogglePin(chat.id).catch(() => toast.error(chat.pinned_at ? 'Could not unpin the chat.' : 'Could not pin the chat.'));
                          }}
                          className={cn(
                            'p-1 rounded-md hover:bg-white dark:hover:bg-gray-700',
                            chat.pinned_at
                              ? 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700'
                              : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
                          )}
                          title={chat.pinned_at ? 'Unpin' : 'Pin to top'}
                          aria-label={`${chat.pinned_at ? 'Unpin' : 'Pin'} ${chat.title}`}
                          aria-pressed={!!chat.pinned_at}
                        >
                          {chat.pinned_at ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                        </button>
                      )}
                      {onRename && (
                        <button
                          onClick={e => startRename(e, chat)}
                          className="p-1 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-white dark:hover:bg-gray-700"
                          title="Rename"
                          aria-label={`Rename ${chat.title}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={e => onDelete(e, chat.id)}
                        disabled={deletingId === chat.id}
                        className="p-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                        title="Delete"
                        aria-label={`Delete ${chat.title}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
