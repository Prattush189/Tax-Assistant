/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTheme } from './hooks/useTheme';
import { usePluginMode } from './hooks/usePluginMode';
import { useChatManager } from './hooks/useChatManager';
import { useAuth } from './contexts/AuthContext';
import { AuthGuard } from './components/auth/AuthGuard';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { ChatView } from './components/chat/ChatView';
import { CalculatorView } from './components/calculator/CalculatorView';
import { DashboardView } from './components/dashboard/DashboardView';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { PlanPage } from './components/plan/PlanPage';
import { NoticeDrafterPage } from './components/notices/NoticeDrafterPage';
import { TaxCalculatorProvider } from './contexts/TaxCalculatorContext';
import { cn } from './lib/utils';

type ActiveView = 'chat' | 'calculator' | 'dashboard' | 'admin' | 'plan' | 'notices';

function AppContent() {
  const { isDarkMode, toggleTheme, setIsDarkMode } = useTheme();
  const { isPluginMode } = usePluginMode(setIsDarkMode);
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { user, logout } = useAuth();

  const chatManager = useChatManager();

  return (
    <div className={cn(
      "flex h-screen bg-gray-50 dark:bg-[#0A0F14] font-sans text-gray-900 dark:text-gray-100 overflow-hidden transition-colors duration-300",
      isPluginMode && "rounded-2xl border border-gray-200 dark:border-gray-800"
    )}>
      {!isPluginMode && (
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          isDarkMode={isDarkMode}
          onToggleTheme={toggleTheme}
          chatList={chatManager.chatList}
          currentChatId={chatManager.currentChatId}
          onNewChat={chatManager.createNewChat}
          onSwitchChat={(chatId) => {
            chatManager.switchChat(chatId);
            setIsSidebarOpen(false);
          }}
          onDeleteChat={chatManager.deleteChatById}
          user={user}
          onLogout={logout}
          activeView={activeView}
          onViewChange={setActiveView}
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
            onViewChange={setActiveView}
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
              {activeView === 'calculator' && <CalculatorView />}
              {activeView === 'dashboard' && <DashboardView />}
              {activeView === 'admin' && user?.role === 'admin' && <AdminDashboard />}
              {activeView === 'plan' && <PlanPage />}
              {activeView === 'notices' && <NoticeDrafterPage />}
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

export default function App() {
  const { setIsDarkMode } = useTheme();
  const { isPluginMode } = usePluginMode(setIsDarkMode);

  if (isPluginMode) {
    return <AppContent />;
  }

  return (
    <AuthGuard>
      <AppContent />
    </AuthGuard>
  );
}
