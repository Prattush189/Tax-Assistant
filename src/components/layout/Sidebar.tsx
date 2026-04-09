import { X, Plus, Moon, Sun, LogOut, Trash2, MessageSquare, MessageCircle, Calculator, LayoutDashboard, Shield, CreditCard, FileText } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ChatItem } from '../../services/api';
import { useState } from 'react';

type ActiveView = 'chat' | 'calculator' | 'dashboard' | 'admin' | 'plan' | 'notices';

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
  { id: 'notices', label: 'Notices', icon: FileText },
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

function planBadgeClass(plan?: string): string {
  if (plan === 'enterprise') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (plan === 'pro') return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
  return 'bg-gray-500/10 text-gray-500 dark:text-gray-400';
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
      "fixed inset-y-0 left-0 z-50 w-72 bg-white dark:bg-[#111827] border-r border-gray-200 dark:border-gray-800 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 flex flex-col",
      isOpen ? 'translate-x-0' : '-translate-x-full'
    )}>
      {/* Header */}
      <div className="p-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <img src="/logoAI.png" alt="Smart AI Logo" className="w-8 h-8 object-contain" />
            <h1 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">Smart AI</h1>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Navigation Tabs (mobile only — desktop uses Header nav) */}
        <div className="lg:hidden flex flex-wrap gap-0.5 mb-3 bg-gray-100 dark:bg-gray-800/60 p-1 rounded-xl">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={cn(
                  "flex-1 min-w-[50px] flex items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium rounded-lg transition-all",
                  isActive
                    ? "bg-white dark:bg-gray-700 text-emerald-600 dark:text-emerald-400 shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                )}
              >
                <Icon className={cn("w-3.5 h-3.5 shrink-0", isActive && "text-emerald-500")} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* New Chat Button */}
        {activeView === 'chat' && (
          <button
            onClick={() => { onNewChat(); onClose(); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl shadow-md shadow-emerald-600/15 transition-all text-sm"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        )}
      </div>

      {/* Chat History */}
      <div className="flex-1 overflow-y-auto p-2">
        {activeView === 'chat' ? (
          <>
            <h2 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 py-2">Recent</h2>
            {chatList.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 px-3 py-4 text-center">No chats yet. Start one!</p>
            ) : (
              <div className="space-y-0.5">
                {chatList.map((chat) => {
                  const isActive = currentChatId === chat.id;
                  return (
                    <button
                      key={chat.id}
                      onClick={() => { onSwitchChat(chat.id); onClose(); }}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all group relative",
                        isActive
                          ? "bg-emerald-50 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-300"
                          : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                      )}
                    >
                      <MessageSquare className={cn(
                        "w-4 h-4 shrink-0",
                        isActive ? "text-emerald-500" : "text-gray-300 dark:text-gray-600"
                      )} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{chat.title}</p>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500">{timeAgo(chat.updated_at)}</p>
                      </div>
                      <button
                        onClick={(e) => handleDelete(e, chat.id)}
                        disabled={deletingId === chat.id}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-all shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div className="px-3 py-8 text-center text-gray-400 dark:text-gray-500">
            <p className="text-sm">Switch to Chat to see history</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-100 dark:border-gray-800 space-y-1">
        <button
          onClick={onToggleTheme}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-xl transition-colors"
        >
          {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {isDarkMode ? 'Light Mode' : 'Dark Mode'}
        </button>

        {user && (
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
              {getInitials(user.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{user.name}</p>
              <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-md", planBadgeClass(user.plan))}>
                {planLabel(user.plan)}
              </span>
            </div>
            <button
              onClick={onLogout}
              className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
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
