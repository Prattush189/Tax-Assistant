import { X, Plus, LogOut, Trash2, MessageSquare, MessageCircle, Calculator, LayoutDashboard, Shield, CreditCard, FileText, FileSpreadsheet, Gavel, Landmark, User, Users, Settings, AlertTriangle, Lock } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ChatItem, NoticeItem, ItrDraft, BoardResolutionDraft, GenericProfile, BankStatementSummary } from '../../services/api';
import { TEMPLATE_TITLES } from '../board-resolutions/lib/uiModel';
import { useState } from 'react';
import { usePreferences } from '../../hooks/usePreferences';
import { useAuth } from '../../contexts/AuthContext';
import { CalculatorTab, CALCULATOR_TABS } from '../calculator/CalculatorView';

type ActiveView = 'chat' | 'calculator' | 'dashboard' | 'admin' | 'plan' | 'notices' | 'settings' | 'itr' | 'profile' | 'board_resolutions' | 'bank_statements';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  chatList: ChatItem[];
  currentChatId: string | null;
  onNewChat: () => void;
  onSwitchChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  noticeList: NoticeItem[];
  currentNoticeId: string | null;
  onNewNotice: () => void;
  onSwitchNotice: (noticeId: string) => void;
  onDeleteNotice: (noticeId: string) => void;
  itrDraftList: ItrDraft[];
  currentItrDraftId: string | null;
  onNewItrDraft: () => void;
  onSwitchItrDraft: (draftId: string) => void;
  onDeleteItrDraft: (draftId: string) => void;
  boardResolutionList: BoardResolutionDraft[];
  currentBoardResolutionId: string | null;
  onNewBoardResolution: () => void;
  onSwitchBoardResolution: (draftId: string) => void;
  onDeleteBoardResolution: (draftId: string) => void;
  profileList: GenericProfile[];
  currentProfileId: string | null;
  onNewProfile: () => void;
  onSwitchProfile: (profileId: string) => void;
  onDeleteProfile: (profileId: string) => void;
  bankStatementList: BankStatementSummary[];
  currentBankStatementId: string | null;
  onNewBankStatement: () => void;
  onSwitchBankStatement: (statementId: string) => void;
  onDeleteBankStatement: (statementId: string) => void;
  user: { id: string; email: string; name: string; role: string; plan?: string; itr_enabled?: boolean } | null;
  onLogout: () => void;
  activeView: ActiveView;
  onViewChange: (view: ActiveView) => void;
  calculatorTab: CalculatorTab;
  onCalculatorTabChange: (tab: CalculatorTab) => void;
}

const PLAN_RANK: Record<string, number> = { free: 0, pro: 1, enterprise: 2 };

type NavItem = { id: ActiveView; label: string; icon: typeof MessageCircle; ai?: boolean };

// `ai: true` tabs surface an [AI] badge beside the label so users can see at a
// glance which features call an AI model behind the scenes.
const baseNavItems: NavItem[] = [
  { id: 'chat', label: 'Chat', icon: MessageCircle, ai: true },
  { id: 'calculator', label: 'Calc', icon: Calculator },
  { id: 'notices', label: 'Notices', icon: FileText, ai: true },
  { id: 'dashboard', label: 'Stats', icon: LayoutDashboard },
];

const adminNavItem: NavItem = { id: 'admin' as ActiveView, label: 'Admin', icon: Shield };
const itrNavItem: NavItem = { id: 'itr' as ActiveView, label: 'ITR', icon: FileSpreadsheet };
const boardResolutionsNavItem: NavItem = { id: 'board_resolutions' as ActiveView, label: 'Resolutions', icon: Gavel };
const bankStatementsNavItem: NavItem = { id: 'bank_statements' as ActiveView, label: 'Statements', icon: Landmark, ai: true };
const profileNavItem: NavItem = { id: 'profile' as ActiveView, label: 'Profile', icon: User };

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
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
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
  isOpen, onClose,
  chatList, currentChatId, onNewChat, onSwitchChat, onDeleteChat,
  noticeList, currentNoticeId, onNewNotice, onSwitchNotice, onDeleteNotice,
  itrDraftList, currentItrDraftId, onNewItrDraft, onSwitchItrDraft, onDeleteItrDraft,
  boardResolutionList, currentBoardResolutionId, onNewBoardResolution, onSwitchBoardResolution, onDeleteBoardResolution,
  profileList, currentProfileId, onNewProfile, onSwitchProfile, onDeleteProfile,
  bankStatementList, currentBankStatementId, onNewBankStatement, onSwitchBankStatement, onDeleteBankStatement,
  user, onLogout, activeView, onViewChange,
  calculatorTab, onCalculatorTabChange,
}: SidebarProps) {
  const { user: authUser } = useAuth();
  const userRank = PLAN_RANK[authUser?.plan ?? user?.plan ?? 'free'] ?? 0;
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteChat, setPendingDeleteChat] = useState<{ id: string; title: string } | null>(null);
  const [pendingDeleteNotice, setPendingDeleteNotice] = useState<{ id: string; title: string } | null>(null);
  const [pendingDeleteItr, setPendingDeleteItr] = useState<{ id: string; title: string } | null>(null);
  const [pendingDeleteBoardResolution, setPendingDeleteBoardResolution] = useState<{ id: string; title: string } | null>(null);
  const [pendingDeleteProfile, setPendingDeleteProfile] = useState<{ id: string; title: string } | null>(null);
  const [pendingDeleteBankStatement, setPendingDeleteBankStatement] = useState<{ id: string; title: string } | null>(null);
  const [pendingDeleteAll, setPendingDeleteAll] = useState<{ label: string; count: number } | null>(null);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const { prefs } = usePreferences();

  const handleDelete = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    if (prefs.confirmBeforeDeletingChats) {
      const chat = chatList.find(c => c.id === chatId);
      setPendingDeleteChat({ id: chatId, title: chat?.title || 'this chat' });
      return;
    }
    await performDelete(chatId);
  };

  const performDelete = async (chatId: string) => {
    setDeletingId(chatId);
    try {
      await onDeleteChat(chatId);
    } finally {
      setDeletingId(null);
      setPendingDeleteChat(null);
    }
  };

  const handleDeleteNotice = (e: React.MouseEvent, noticeId: string) => {
    e.stopPropagation();
    if (prefs.confirmBeforeDeletingChats) {
      const notice = noticeList.find(n => n.id === noticeId);
      setPendingDeleteNotice({ id: noticeId, title: notice?.title || 'this draft' });
      return;
    }
    performDeleteNotice(noticeId);
  };

  const performDeleteNotice = async (noticeId: string) => {
    setDeletingId(noticeId);
    try {
      await onDeleteNotice(noticeId);
    } finally {
      setDeletingId(null);
      setPendingDeleteNotice(null);
    }
  };

  const handleNavClick = (view: ActiveView) => {
    onViewChange(view);
    onClose();
  };

  const handleDeleteItr = (e: React.MouseEvent, draftId: string) => {
    e.stopPropagation();
    if (prefs.confirmBeforeDeletingChats) {
      const draft = itrDraftList.find((d) => d.id === draftId);
      setPendingDeleteItr({ id: draftId, title: draft?.name || 'this draft' });
      return;
    }
    performDeleteItr(draftId);
  };

  const performDeleteItr = async (draftId: string) => {
    setDeletingId(draftId);
    try {
      await onDeleteItrDraft(draftId);
    } finally {
      setDeletingId(null);
      setPendingDeleteItr(null);
    }
  };

  const handleDeleteBoardResolution = (e: React.MouseEvent, draftId: string) => {
    e.stopPropagation();
    if (prefs.confirmBeforeDeletingChats) {
      const draft = boardResolutionList.find((d) => d.id === draftId);
      setPendingDeleteBoardResolution({ id: draftId, title: draft?.name || 'this draft' });
      return;
    }
    performDeleteBoardResolution(draftId);
  };

  const performDeleteBoardResolution = async (draftId: string) => {
    setDeletingId(draftId);
    try {
      await onDeleteBoardResolution(draftId);
    } finally {
      setDeletingId(null);
      setPendingDeleteBoardResolution(null);
    }
  };

  const handleDeleteProfile = (e: React.MouseEvent, profileId: string) => {
    e.stopPropagation();
    if (prefs.confirmBeforeDeletingChats) {
      const profile = profileList.find((p) => p.id === profileId);
      setPendingDeleteProfile({ id: profileId, title: profile?.name || 'this profile' });
      return;
    }
    performDeleteProfile(profileId);
  };

  const performDeleteProfile = async (profileId: string) => {
    setDeletingId(profileId);
    try {
      await onDeleteProfile(profileId);
    } finally {
      setDeletingId(null);
      setPendingDeleteProfile(null);
    }
  };

  const handleDeleteBankStatement = (e: React.MouseEvent, statementId: string) => {
    e.stopPropagation();
    if (prefs.confirmBeforeDeletingChats) {
      const stmt = bankStatementList.find((s) => s.id === statementId);
      setPendingDeleteBankStatement({ id: statementId, title: stmt?.name || 'this statement' });
      return;
    }
    performDeleteBankStatement(statementId);
  };

  const performDeleteBankStatement = async (statementId: string) => {
    setDeletingId(statementId);
    try {
      await onDeleteBankStatement(statementId);
    } finally {
      setDeletingId(null);
      setPendingDeleteBankStatement(null);
    }
  };

  // Maps the active list view to its plural label, current items, and per-item
  // delete handler. Anything not listed (calc, dashboard, admin, plan,
  // settings) returns null — the Delete All button hides for those views.
  const deleteAllTarget = (() => {
    switch (activeView) {
      case 'chat':
        return { label: 'chats', items: chatList.map(c => c.id), del: onDeleteChat };
      case 'notices':
        return { label: 'notice drafts', items: noticeList.map(n => n.id), del: onDeleteNotice };
      case 'itr':
        return { label: 'ITR drafts', items: itrDraftList.map(d => d.id), del: onDeleteItrDraft };
      case 'board_resolutions':
        return { label: 'resolution drafts', items: boardResolutionList.map(d => d.id), del: onDeleteBoardResolution };
      case 'profile':
        return { label: 'profiles', items: profileList.map(p => p.id), del: onDeleteProfile };
      case 'bank_statements':
        return { label: 'statements', items: bankStatementList.map(s => s.id), del: onDeleteBankStatement };
      default:
        return null;
    }
  })();

  const performDeleteAll = async () => {
    if (!deleteAllTarget) return;
    setIsDeletingAll(true);
    try {
      // Parallel deletes via the existing per-item handlers — N round-trips
      // but they fire concurrently. allSettled so a single failure doesn't
      // strand the rest. Per-item handlers update local list state, so the
      // sidebar empties as the requests resolve.
      await Promise.allSettled(deleteAllTarget.items.map(id => deleteAllTarget.del(id)));
    } finally {
      setIsDeletingAll(false);
      setPendingDeleteAll(null);
    }
  };

  // ITR: admin-only OR explicit itr_enabled grant (not available to regular enterprise users yet).
  // Board Resolutions: open to all authenticated users (limits enforced server-side).
  // Plan tab always last (rightmost).
  const isEnterprise = user?.plan === 'enterprise';
  const canAccessItr = user?.role === 'admin' || user?.itr_enabled === true;
  const canAccessBoardResolutions = !!user;
  const navItems = [
    ...baseNavItems,
    profileNavItem,
    ...(canAccessItr ? [itrNavItem] : []),
    ...(canAccessBoardResolutions ? [boardResolutionsNavItem] : []),
    ...(user ? [bankStatementsNavItem] : []),
    ...(user?.role === 'admin' ? [adminNavItem] : []),
    { id: 'plan' as ActiveView, label: 'Plan', icon: CreditCard },
  ];

  return (
    <aside className={cn(
      "fixed inset-y-0 left-0 z-50 w-72 bg-white dark:bg-[#151210] border-r border-gray-200 dark:border-gray-800 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 flex flex-col",
      isOpen ? 'translate-x-0' : '-translate-x-full'
    )}>
      {/* Header */}
      <div className="p-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <img src="/logoAI.png" alt="Smartbiz AI Logo" className="w-8 h-8 object-contain" />
            <h1 className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">Smartbiz AI</h1>
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
                {item.ai && (
                  <span
                    className={cn(
                      'text-[8px] font-bold tracking-wider px-0.5 rounded leading-none',
                      isActive
                        ? 'text-emerald-600 dark:text-emerald-300'
                        : 'text-purple-500 dark:text-purple-300',
                    )}
                    title="Uses AI"
                  >[AI]</span>
                )}
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

        {/* New Notice Button */}
        {activeView === 'notices' && (
          <button
            onClick={() => { onNewNotice(); onClose(); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl shadow-md shadow-emerald-600/15 transition-all text-sm"
          >
            <Plus className="w-4 h-4" />
            New Notice
          </button>
        )}

        {/* New ITR Draft Button */}
        {activeView === 'itr' && (
          <button
            onClick={() => { onNewItrDraft(); onClose(); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl shadow-md shadow-emerald-600/15 transition-all text-sm"
          >
            <Plus className="w-4 h-4" />
            New ITR Draft
          </button>
        )}

        {/* New Board Resolution Button */}
        {activeView === 'board_resolutions' && (
          <button
            onClick={() => { onNewBoardResolution(); onClose(); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl shadow-md shadow-emerald-600/15 transition-all text-sm"
          >
            <Plus className="w-4 h-4" />
            New Resolution
          </button>
        )}

        {/* New Profile Button */}
        {activeView === 'profile' && (
          <button
            onClick={() => { onNewProfile(); onClose(); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl shadow-md shadow-emerald-600/15 transition-all text-sm"
          >
            <Plus className="w-4 h-4" />
            New Profile
          </button>
        )}

        {/* New Bank Statement Button */}
        {activeView === 'bank_statements' && (
          <button
            onClick={() => { onNewBankStatement(); onClose(); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl shadow-md shadow-emerald-600/15 transition-all text-sm"
          >
            <Plus className="w-4 h-4" />
            Upload Statement
          </button>
        )}
      </div>

      {/* History */}
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
                    <div key={chat.id} className="relative group">
                      <button
                        onClick={() => { onSwitchChat(chat.id); onClose(); }}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all pr-8",
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
                      </button>
                      <button
                        onClick={(e) => handleDelete(e, chat.id)}
                        disabled={deletingId === chat.id}
                        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : activeView === 'notices' ? (
          <>
            <h2 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 py-2">Saved Drafts</h2>
            {noticeList.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 px-3 py-4 text-center">No drafts yet. Generate one!</p>
            ) : (
              <div className="space-y-0.5">
                {noticeList.map((notice) => {
                  const isActive = currentNoticeId === notice.id;
                  return (
                    <div key={notice.id} className="relative group">
                      <button
                        onClick={() => { onSwitchNotice(notice.id); onClose(); }}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all pr-8",
                          isActive
                            ? "bg-emerald-50 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-300"
                            : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                        )}
                      >
                        <FileText className={cn(
                          "w-4 h-4 shrink-0",
                          isActive ? "text-emerald-500" : "text-gray-300 dark:text-gray-600"
                        )} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{notice.title || 'Untitled'}</p>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-medium uppercase text-emerald-600/70 dark:text-emerald-400/70">
                              {notice.notice_type}
                            </span>
                            <span className="text-[11px] text-gray-400 dark:text-gray-500">·</span>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500">{timeAgo(notice.updated_at)}</p>
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={(e) => handleDeleteNotice(e, notice.id)}
                        disabled={deletingId === notice.id}
                        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : activeView === 'profile' ? (
          <>
            <h2 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 py-2">Profiles</h2>
            {profileList.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 px-3 py-4 text-center">No profiles yet. Create one!</p>
            ) : (
              <div className="space-y-0.5">
                {profileList.map((profile) => {
                  const isActive = currentProfileId === profile.id;
                  return (
                    <div key={profile.id} className="relative group">
                      <button
                        onClick={() => { onSwitchProfile(profile.id); onClose(); }}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all pr-8",
                          isActive
                            ? "bg-emerald-50 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-300"
                            : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                        )}
                      >
                        <User className={cn(
                          "w-4 h-4 shrink-0",
                          isActive ? "text-emerald-500" : "text-gray-300 dark:text-gray-600"
                        )} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{profile.name}</p>
                          <p className="text-[11px] text-gray-400 dark:text-gray-500">{timeAgo(profile.updated_at)}</p>
                        </div>
                      </button>
                      <button
                        onClick={(e) => handleDeleteProfile(e, profile.id)}
                        disabled={deletingId === profile.id}
                        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : activeView === 'itr' ? (
          <>
            <h2 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 py-2">ITR Drafts</h2>
            {itrDraftList.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 px-3 py-4 text-center">No drafts yet. Start one!</p>
            ) : (
              <div className="space-y-0.5">
                {itrDraftList.map((draft) => {
                  const isActive = currentItrDraftId === draft.id;
                  return (
                    <div key={draft.id} className="relative group">
                      <button
                        onClick={() => { onSwitchItrDraft(draft.id); onClose(); }}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all pr-8",
                          isActive
                            ? "bg-emerald-50 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-300"
                            : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                        )}
                      >
                        <FileSpreadsheet className={cn(
                          "w-4 h-4 shrink-0",
                          isActive ? "text-emerald-500" : "text-gray-300 dark:text-gray-600"
                        )} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{draft.name}</p>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-medium uppercase text-emerald-600/70 dark:text-emerald-400/70">
                              {draft.form_type} · AY {draft.assessment_year}
                            </span>
                            <span className="text-[11px] text-gray-400 dark:text-gray-500">·</span>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500">{timeAgo(draft.updated_at)}</p>
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={(e) => handleDeleteItr(e, draft.id)}
                        disabled={deletingId === draft.id}
                        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : activeView === 'board_resolutions' ? (
          <>
            <h2 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 py-2">Board Resolutions</h2>
            {boardResolutionList.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 px-3 py-4 text-center">No drafts yet. Start one!</p>
            ) : (
              <div className="space-y-0.5">
                {boardResolutionList.map((draft) => {
                  const isActive = currentBoardResolutionId === draft.id;
                  return (
                    <div key={draft.id} className="relative group">
                      <button
                        onClick={() => { onSwitchBoardResolution(draft.id); onClose(); }}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all pr-8",
                          isActive
                            ? "bg-emerald-50 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-300"
                            : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                        )}
                      >
                        <Gavel className={cn(
                          "w-4 h-4 shrink-0",
                          isActive ? "text-emerald-500" : "text-gray-300 dark:text-gray-600"
                        )} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{draft.name}</p>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-medium uppercase text-emerald-600/70 dark:text-emerald-400/70 truncate">
                              {TEMPLATE_TITLES[draft.template_id]}
                            </span>
                            <span className="text-[11px] text-gray-400 dark:text-gray-500">·</span>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500">{timeAgo(draft.updated_at)}</p>
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={(e) => handleDeleteBoardResolution(e, draft.id)}
                        disabled={deletingId === draft.id}
                        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : activeView === 'bank_statements' ? (
          <>
            <h2 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 py-2">Statements</h2>
            {bankStatementList.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 px-3 py-4 text-center">No statements yet. Upload one!</p>
            ) : (
              <div className="space-y-0.5">
                {bankStatementList.map((stmt) => {
                  const isActive = currentBankStatementId === stmt.id;
                  return (
                    <div key={stmt.id} className="relative group">
                      <button
                        onClick={() => { onSwitchBankStatement(stmt.id); onClose(); }}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all pr-8",
                          isActive
                            ? "bg-emerald-50 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-300"
                            : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                        )}
                      >
                        <Landmark className={cn(
                          "w-4 h-4 shrink-0",
                          isActive ? "text-emerald-500" : "text-gray-300 dark:text-gray-600"
                        )} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{stmt.name}</p>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-medium uppercase text-emerald-600/70 dark:text-emerald-400/70 truncate">
                              {stmt.txCount} txns
                            </span>
                            <span className="text-[11px] text-gray-400 dark:text-gray-500">·</span>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500">{timeAgo(stmt.updatedAt)}</p>
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={(e) => handleDeleteBankStatement(e, stmt.id)}
                        disabled={deletingId === stmt.id}
                        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : activeView === 'calculator' ? (
          <>
            <h2 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 py-2">Calculators</h2>
            <div className="space-y-0.5">
              {CALCULATOR_TABS.map((tab) => {
                const isActive = calculatorTab === tab.id;
                const isLocked = tab.pro && userRank < 1;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => { onCalculatorTabChange(tab.id); onClose(); }}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all",
                      isActive
                        ? "bg-emerald-50 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-300"
                        : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                    )}
                  >
                    <Icon className={cn(
                      "w-4 h-4 shrink-0",
                      isActive ? "text-emerald-500" : "text-gray-300 dark:text-gray-600"
                    )} />
                    <span className="flex-1 text-sm font-medium truncate">{tab.label}</span>
                    {tab.ai && (
                      <span
                        className={cn(
                          'text-[9px] font-bold tracking-wider px-1 py-0.5 rounded border leading-none shrink-0',
                          isActive
                            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300/60 dark:border-emerald-700/60'
                            : 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-300 border-purple-200 dark:border-purple-800/60',
                        )}
                        title="Uses AI"
                      >AI</span>
                    )}
                    {isLocked && <Lock className="w-3 h-3 text-gray-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="px-3 py-8 text-center text-gray-400 dark:text-gray-500">
            <p className="text-sm">Switch to Chat or Notices to see history</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-100 dark:border-gray-800 space-y-1">
        {/* Profile + Stats shortcuts — sky tone separates them from the
            emerald used by Settings, so users can scan the footer and tell
            "navigate-to" rows from the active-section row. */}
        <button
          onClick={() => onViewChange('profile')}
          className={cn(
            'w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-xl transition-colors',
            activeView === 'profile'
              ? 'bg-sky-50 dark:bg-sky-900/25 text-sky-700 dark:text-sky-300'
              : 'text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/15',
          )}
        >
          <User className="w-4 h-4" />
          Profile
        </button>
        <button
          onClick={() => onViewChange('dashboard')}
          className={cn(
            'w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-xl transition-colors',
            activeView === 'dashboard'
              ? 'bg-sky-50 dark:bg-sky-900/25 text-sky-700 dark:text-sky-300'
              : 'text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/15',
          )}
        >
          <LayoutDashboard className="w-4 h-4" />
          Stats
        </button>

        {/* Delete-all — only meaningful when the current section is a list view
            with items. Hidden otherwise so we don't flash a useless button. */}
        {deleteAllTarget && deleteAllTarget.items.length > 0 && (
          <button
            onClick={() => setPendingDeleteAll({ label: deleteAllTarget.label, count: deleteAllTarget.items.length })}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete all {deleteAllTarget.label}
          </button>
        )}

        <button
          onClick={() => onViewChange('settings')}
          className={cn(
            "w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-xl transition-colors",
            activeView === 'settings'
              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
          )}
        >
          <Settings className="w-4 h-4" />
          Settings
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
              onClick={() => onViewChange('settings')}
              className={cn(
                'p-1.5 rounded-lg transition-colors',
                activeView === 'settings'
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400',
              )}
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
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

      {/* Delete notice confirmation dialog */}
      {pendingDeleteNotice && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setPendingDeleteNotice(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Delete draft?</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 break-words">
                  "{pendingDeleteNotice.title}" will be permanently deleted.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingDeleteNotice(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => performDeleteNotice(pendingDeleteNotice.id)}
                disabled={deletingId === pendingDeleteNotice.id}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {deletingId === pendingDeleteNotice.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete profile confirmation dialog */}
      {pendingDeleteProfile && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setPendingDeleteProfile(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Delete profile?</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 break-words">
                  "{pendingDeleteProfile.title}" and all its per-AY data will be permanently deleted.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingDeleteProfile(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => performDeleteProfile(pendingDeleteProfile.id)}
                disabled={deletingId === pendingDeleteProfile.id}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {deletingId === pendingDeleteProfile.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete ITR draft confirmation dialog */}
      {pendingDeleteItr && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setPendingDeleteItr(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Delete ITR draft?</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 break-words">
                  "{pendingDeleteItr.title}" will be permanently deleted.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingDeleteItr(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => performDeleteItr(pendingDeleteItr.id)}
                disabled={deletingId === pendingDeleteItr.id}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {deletingId === pendingDeleteItr.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete board resolution confirmation dialog */}
      {pendingDeleteBoardResolution && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setPendingDeleteBoardResolution(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Delete resolution draft?</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 break-words">
                  "{pendingDeleteBoardResolution.title}" will be permanently deleted.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingDeleteBoardResolution(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => performDeleteBoardResolution(pendingDeleteBoardResolution.id)}
                disabled={deletingId === pendingDeleteBoardResolution.id}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {deletingId === pendingDeleteBoardResolution.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete bank statement confirmation dialog */}
      {pendingDeleteBankStatement && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setPendingDeleteBankStatement(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Delete statement?</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 break-words">
                  "{pendingDeleteBankStatement.title}" and all its transactions will be permanently deleted.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingDeleteBankStatement(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => performDeleteBankStatement(pendingDeleteBankStatement.id)}
                disabled={deletingId === pendingDeleteBankStatement.id}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {deletingId === pendingDeleteBankStatement.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete-all confirmation dialog */}
      {pendingDeleteAll && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => !isDeletingAll && setPendingDeleteAll(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
                  Delete all {pendingDeleteAll.label}?
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 break-words">
                  All {pendingDeleteAll.count} {pendingDeleteAll.label} will be permanently deleted. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingDeleteAll(null)}
                disabled={isDeletingAll}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void performDeleteAll()}
                disabled={isDeletingAll}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {isDeletingAll ? 'Deleting…' : `Delete all ${pendingDeleteAll.count}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete chat confirmation dialog */}
      {pendingDeleteChat && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setPendingDeleteChat(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Delete chat?</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 break-words">
                  "{pendingDeleteChat.title}" and all its messages will be permanently deleted.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingDeleteChat(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => performDelete(pendingDeleteChat.id)}
                disabled={deletingId === pendingDeleteChat.id}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {deletingId === pendingDeleteChat.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
