/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { useTheme } from './hooks/useTheme';
import { usePluginMode } from './hooks/usePluginMode';
import { useChat } from './hooks/useChat';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { ChatView } from './components/chat/ChatView';
import { CalculatorView } from './components/calculator/CalculatorView';
import { DashboardView } from './components/dashboard/DashboardView';
import { DocumentsView } from './components/documents/DocumentsView';
import { TaxCalculatorProvider } from './contexts/TaxCalculatorContext';
import { cn } from './lib/utils';

type ActiveView = 'chat' | 'calculator' | 'dashboard' | 'documents';

export default function App() {
  const { isDarkMode, toggleTheme } = useTheme();
  const { isPluginMode } = usePluginMode();
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Single useChat instance lifted to App — shared between ChatView and DocumentsView
  // so that document context attached in DocumentsView flows correctly into chat send calls
  const chatHook = useChat();

  return (
    <div className={cn(
      "flex h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 overflow-hidden transition-colors duration-300",
      isPluginMode && "rounded-2xl border border-slate-200 dark:border-slate-800"
    )}>
      {!isPluginMode && (
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          isDarkMode={isDarkMode}
          onToggleTheme={toggleTheme}
        />
      )}
      <TaxCalculatorProvider>
        <main className="flex-1 flex flex-col relative min-w-0">
          <Header
            isPluginMode={isPluginMode}
            isDarkMode={isDarkMode}
            onToggleTheme={toggleTheme}
            activeView={activeView}
            onViewChange={setActiveView}
            onOpenSidebar={() => setIsSidebarOpen(true)}
          />
          {activeView === 'chat' && <ChatView isPluginMode={isPluginMode} chatHook={chatHook} />}
          {activeView === 'calculator' && <CalculatorView />}
          {activeView === 'dashboard' && <DashboardView />}
          {activeView === 'documents' && (
            <DocumentsView
              activeDocument={chatHook.activeDocument}
              onDocumentAttach={chatHook.attachDocument}
              onDocumentDetach={chatHook.detachDocument}
            />
          )}
        </main>
      </TaxCalculatorProvider>
      {isSidebarOpen && !isPluginMode && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  );
}
