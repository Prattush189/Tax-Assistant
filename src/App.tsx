/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTheme } from './hooks/useTheme';
import { usePluginMode, usePluginParentMessage } from './hooks/usePluginMode';
import { useChatManager } from './hooks/useChatManager';
import { useNoticeDrafter } from './hooks/useNoticeDrafter';
import { useItrManager } from './hooks/useItrManager';
import { useBoardResolutionManager } from './hooks/useBoardResolutionManager';
import { useProfileManager } from './hooks/useProfileManager';
import { useBankStatementManager } from './hooks/useBankStatementManager';
import { useAuth } from './contexts/AuthContext';
import { AuthGuard } from './components/auth/AuthGuard';
import { AcceptInvitePage } from './components/auth/AcceptInvitePage';
import { PluginAuthBridge } from './components/auth/PluginAuthBridge';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { ChatView } from './components/chat/ChatView';
import { CalculatorView, CalculatorTab } from './components/calculator/CalculatorView';
import { DashboardView } from './components/dashboard/DashboardView';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { PlanPage } from './components/plan/PlanPage';
import { TrialExpiredWall } from './components/plan/TrialExpiredWall';
import { SettingsPage } from './components/settings/SettingsPage';
import { NoticeDrafterPage } from './components/notices/NoticeDrafterPage';
import { ItrView } from './components/itr/ItrView';
import { BoardResolutionView } from './components/board-resolutions/BoardResolutionView';
import { BankStatementView } from './components/bank-statements/BankStatementView';
import { ProfileView } from './components/profile/ProfileView';
import { TaxCalculatorProvider } from './contexts/TaxCalculatorContext';
import type { ParentToIframeMessage } from './lib/pluginProtocol';
import { cn } from './lib/utils';

type ActiveView = 'chat' | 'calculator' | 'dashboard' | 'admin' | 'plan' | 'notices' | 'settings' | 'itr' | 'profile' | 'board_resolutions' | 'bank_statements';

/**
 * Dispatches SET_VIEW / SET_CALCULATOR_TAB / LOGOUT into local state.
 * SET_THEME and PLUGIN_SSO are handled elsewhere.
 */
function PluginMessageDispatcher({
  setActiveView,
  setCalculatorTab,
}: {
  setActiveView: (view: ActiveView) => void;
  setCalculatorTab: (tab: CalculatorTab) => void;
}) {
  const { logout } = useAuth();

  const handleParentMessage = useCallback(
    (msg: ParentToIframeMessage) => {
      switch (msg.type) {
        case 'SET_VIEW':
          setActiveView(msg.view);
          break;
        case 'SET_CALCULATOR_TAB':
          setCalculatorTab(msg.tab);
          setActiveView('calculator');
          break;
        case 'LOGOUT':
          logout();
          break;
        default:
          break;
      }
    },
    [setActiveView, setCalculatorTab, logout],
  );

  usePluginParentMessage(handleParentMessage);
  return null;
}

function AppContent() {
  const { isDarkMode, toggleTheme, setIsDarkMode } = useTheme();
  const { isPluginMode } = usePluginMode(setIsDarkMode);
  const [activeView, setActiveView] = useState<ActiveView>(() => {
    const saved = localStorage.getItem('activeView') as ActiveView | null;
    const valid: ActiveView[] = ['chat', 'calculator', 'dashboard', 'admin', 'plan', 'notices', 'settings', 'itr', 'profile', 'board_resolutions', 'bank_statements'];
    return saved && valid.includes(saved) ? saved : 'chat';
  });
  const [calculatorTab, setCalculatorTab] = useState<CalculatorTab>('income');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { user, logout } = useAuth();

  const navigateTo = useCallback((view: ActiveView) => {
    localStorage.setItem('activeView', view);
    setActiveView(view);
  }, []);

  const chatManager = useChatManager();
  const noticeDrafter = useNoticeDrafter();
  // ITR: admin-only OR explicit itr_enabled grant (not available to regular enterprise users yet).
  const isEnterprise = user?.plan === 'enterprise';
  const canAccessItr = user?.role === 'admin' || user?.itr_enabled === true;
  const itrManager = useItrManager(canAccessItr);
  // Board Resolutions: open to all authenticated users (plan limits enforced server-side).
  const canAccessBoardResolutions = !!user;
  const boardResolutionManager = useBoardResolutionManager(canAccessBoardResolutions);
  // Bank statement analyzer: open to all authenticated users.
  const bankStatementManager = useBankStatementManager(!!user);

  // Trial expiry: free-plan users are locked out after 30 days.
  const isTrialExpired =
    user?.role !== 'admin' &&
    user?.plan === 'free' &&
    !!user?.trial_ends_at &&
    new Date() > new Date(user.trial_ends_at);
  const profileManager = useProfileManager(!!user);

  return (
    <div className={cn(
      "flex h-screen bg-gray-50 dark:bg-[#0E0C0A] font-sans text-gray-900 dark:text-gray-100 overflow-hidden transition-colors duration-300",
      isPluginMode && "rounded-2xl border border-gray-200 dark:border-gray-800"
    )}>
      {!isPluginMode && (
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          chatList={chatManager.chatList}
          currentChatId={chatManager.currentChatId}
          onNewChat={chatManager.createNewChat}
          onSwitchChat={(chatId) => {
            chatManager.switchChat(chatId);
            setIsSidebarOpen(false);
          }}
          onDeleteChat={chatManager.deleteChatById}
          noticeList={noticeDrafter.notices}
          currentNoticeId={noticeDrafter.currentNoticeId}
          onNewNotice={noticeDrafter.clearDraft}
          onSwitchNotice={noticeDrafter.loadNotice}
          onDeleteNotice={noticeDrafter.removeNotice}
          itrDraftList={itrManager.drafts}
          currentItrDraftId={itrManager.currentDraftId}
          onNewItrDraft={itrManager.clearDraft}
          onSwitchItrDraft={itrManager.loadDraft}
          onDeleteItrDraft={itrManager.removeDraft}
          boardResolutionList={boardResolutionManager.drafts}
          currentBoardResolutionId={boardResolutionManager.currentDraftId}
          onNewBoardResolution={boardResolutionManager.clearDraft}
          onSwitchBoardResolution={boardResolutionManager.loadDraft}
          onDeleteBoardResolution={boardResolutionManager.removeDraft}
          profileList={profileManager.profiles}
          currentProfileId={profileManager.currentProfileId}
          onNewProfile={profileManager.clearCurrent}
          onSwitchProfile={profileManager.loadProfile}
          onDeleteProfile={profileManager.removeProfile}
          bankStatementList={bankStatementManager.statements}
          currentBankStatementId={bankStatementManager.currentId}
          onNewBankStatement={bankStatementManager.clear}
          onSwitchBankStatement={bankStatementManager.load}
          onDeleteBankStatement={bankStatementManager.remove}
          user={user}
          onLogout={logout}
          activeView={activeView}
          onViewChange={navigateTo}
          calculatorTab={calculatorTab}
          onCalculatorTabChange={setCalculatorTab}
        />
      )}
      {isPluginMode && (
        <PluginMessageDispatcher
          setActiveView={navigateTo}
          setCalculatorTab={setCalculatorTab}
        />
      )}
      <TaxCalculatorProvider>
        <main className="flex-1 flex flex-col relative min-w-0 min-h-0 h-screen">
          <Header
            isPluginMode={isPluginMode}
            isDarkMode={isDarkMode}
            onToggleTheme={toggleTheme}
            onOpenSidebar={() => setIsSidebarOpen(true)}
            user={user}
            onLogout={logout}
            activeView={activeView}
            onViewChange={navigateTo}
          />
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-1 flex flex-col min-h-0"
            >
              {activeView === 'chat' && <ChatView isPluginMode={isPluginMode} chatManager={chatManager} />}
              {activeView === 'calculator' && <CalculatorView activeTab={calculatorTab} />}
              {activeView === 'dashboard' && <DashboardView />}
              {activeView === 'admin' && user?.role === 'admin' && <AdminDashboard />}
              {activeView === 'plan' && <PlanPage />}
              {activeView === 'notices' && <NoticeDrafterPage drafter={noticeDrafter} />}
              {activeView === 'itr' && canAccessItr && <ItrView manager={itrManager} />}
              {activeView === 'board_resolutions' && canAccessBoardResolutions && (
                <BoardResolutionView manager={boardResolutionManager} />
              )}
              {activeView === 'bank_statements' && <BankStatementView manager={bankStatementManager} />}
              {isTrialExpired && <TrialExpiredWall />}
              {activeView === 'profile' && <ProfileView manager={profileManager} />}
              {activeView === 'settings' && <SettingsPage />}
            </motion.div>
          </AnimatePresence>
        </main>
      </TaxCalculatorProvider>
      {isSidebarOpen && !isPluginMode && (
        <div
          className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Reads `?invite=<token>` from the URL once on mount. We don't use a router;
 * instead App.tsx shows the AcceptInvitePage BEFORE the AuthGuard renders,
 * so an unauthenticated invitee can land directly on the accept flow. After
 * accepting, we clear the query string so refresh doesn't re-fire.
 */
function useInviteToken(): { token: string | null; clear: () => void } {
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('invite');
  });
  const clear = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', window.location.pathname);
    }
    setToken(null);
  }, []);
  return { token, clear };
}

export default function App() {
  const { setIsDarkMode } = useTheme();
  const { isPluginMode } = usePluginMode(setIsDarkMode);
  const invite = useInviteToken();

  // Invite accept flow supersedes both plugin auth AND the normal AuthGuard.
  // Anyone landing with `?invite=<token>` sees the accept page until they
  // consume the token.
  if (invite.token) {
    return <AcceptInvitePage token={invite.token} onDone={invite.clear} />;
  }

  if (isPluginMode) {
    return (
      <PluginAuthBridge>
        <AppContent />
      </PluginAuthBridge>
    );
  }

  return (
    <AuthGuard>
      <AppContent />
    </AuthGuard>
  );
}
