import { X, Plus, Moon, Sun, LogOut, Trash2, MessageSquare, MessageCircle, Calculator, LayoutDashboard, Shield, CreditCard } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ChatItem } from '../../services/api';
import { useState } from 'react';

type ActiveView = 'chat' | 'calculator' | 'dashboard' | 'admin' | 'plan';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  chatList: ChatItem[];
  currentChatId: string | null;
  onNewChat: () => void;
  onSwitchChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  user: { id: string; email: string; name: string; role: string; plan?: string } | null;
  onLogout: () => void;
  activeView: ActiveView;
  onViewChange: (view: ActiveView) => void;
}

const baseNavItems: { id: ActiveView; label: string; icon: typeof MessageCircle }[] = [
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'calculator', label: 'Calc', icon: Calculator },
  { id: 'dashboard', label: 'Stats', icon: LayoutDashboard },
  { id: 'plan', label: 'Plan', icon: CreditCard },
];

const adminNavItem = { id: 'admin' as ActiveView, label: 'Admin', icon: Shield };

function timeAgo(dateStr: string): string {
  const istNow = Date.now() + (5.5 * 60 * 60 * 1000) + (new Date().getTimezoneOffset() * 60 * 1000);
  const then = new Date(dateStr).getTime();
  const diff = istNow - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function planLabel(plan?: string): string {
  if (plan === 'pro') return 'Pro';
  if (plan === 'enterprise') return 'Enterprise';
  return 'Free';
}

export function Sidebar({
  isOpen, onClose, isDarkMode, onToggleTheme,
  chatList, currentChatId, onNewChat, onSwitchChat, onDeleteChat,
  user, onLogout, activeView, onViewChange,
}: SidebarProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    setDeletingId(chatId);
    try {
      await onDeleteChat(chatId);
    } finally {
      setDeletingId(null);
    }
  };

  const handleNavClick = (view: ActiveView) => {
    onViewChange(view);
    onClose();
  };

  const navItems = [...baseNavItems, ...(user?.role === 'admin' ? [adminNavItem] : [])];

  return (
    <aside className={cn(
      "fixed inset-y-0 left-0 z-50 w-72 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-r border-slate-200/50 dark:border-slate-800/50 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 flex flex-col",
      isOpen ? 'translate-x-0' : '-translate-x-full'
    )}>
      {/* Header */}
      <div className="p-4 border-b border-slate-200/50 dark:border-slate-800/50">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <img src="/logoAI.png" alt="Smart AI Logo" className="w-7 h-7 object-contain" />
            <h1 className="text-lg font-bold tracking-tight text-slate-800 dark:text-slate-100">Smart AI</h1>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-0.5 mb-3 bg-slate-100 dark:bg-slate-800/50 p-1 rounded-xl">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={cn(
                  "flex-1 min-w-[50px] flex items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium rounded-lg transition-all",
                  activeView === item.id
                    ? "bg-white dark:bg-slate-700 text-[#B8860B] dark:text-[#D4A020] shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                )}
              >
                <Icon className="w-3 h-3 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* New Chat Button */}
        {activeView === 'chat' && (
          <button
            onClick={() => { onNewChat(); onClose(); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[#D4A020] to-[#B8860B] hover:from-[#B8860B] hover:to-[#9A7209] text-white font-medium rounded-xl shadow-lg shadow-[#D4A020]/20 dark:shadow-[#B8860B]/20 transition-all text-sm"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        )}
      </div>

      {/* Chat History (only visible when on chat view) */}
      <div className="flex-1 overflow-y-auto p-2">
        {activeView === 'chat' ? (
          <>
            <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-2 py-2">Chat History</h2>
            {chatList.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500 px-3 py-4 text-center">No chats yet. Start one!</p>
            ) : (
              <div className="space-y-0.5">
                {chatList.map((chat) => (
                  <button
                    key={chat.id}
                    onClick={() => { onSwitchChat(chat.id); onClose(); }}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all group relative",
                      currentChatId === chat.id
                        ? "bg-[#D4A020]/10 dark:bg-[#B8860B]/15 text-[#B8860B] dark:text-[#D4A020]"
                        : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                    )}
                  >
                    <MessageSquare className={cn(
                      "w-4 h-4 shrink-0",
                      currentChatId === chat.id ? "text-[#D4A020]" : "text-slate-400"
                    )} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{chat.title}</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">{timeAgo(chat.updated_at)}</p>
                    </div>
                    <button
                      onClick={(e) => handleDelete(e, chat.id)}
                      disabled={deletingId === chat.id}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-all shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    </button>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="px-3 py-8 text-center text-slate-400 dark:text-slate-500">
            <p className="text-sm">Switch to Chat to see history</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-slate-200/50 dark:border-slate-800/50 space-y-1">
        <button
          onClick={onToggleTheme}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
        >
          {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {isDarkMode ? 'Light Mode' : 'Dark Mode'}
        </button>

        {user && (
          <div className="flex items-center gap-2 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#D4A020] to-[#B8860B] flex items-center justify-center text-white text-xs font-bold shrink-0">
              {getInitials(user.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{user.name}</p>
              <p className="text-[11px] text-slate-400 truncate">{planLabel(user.plan)} plan</p>
            </div>
            <button
              onClick={onLogout}
              className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4 text-red-500" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
