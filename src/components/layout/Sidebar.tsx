import { X, IndianRupee, Info, ExternalLink, Moon, Sun, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  onClearChat?: () => void;
}

const quickQueries = [
  "New vs Old Tax Regime FY 2024-25?",
  "How to save tax under 80C?",
  "GST rate for software services?",
  "Calculate tax for 15L income",
];

export function Sidebar({ isOpen, onClose, isDarkMode, onToggleTheme, onClearChat }: SidebarProps) {
  return (
    <aside className={cn(
      "fixed inset-y-0 left-0 z-50 w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0",
      isOpen ? 'translate-x-0' : '-translate-x-full'
    )}>
      <div className="flex flex-col h-full p-6">
        <div className="flex items-center gap-3 mb-8">
          <div className="flex items-center justify-center">
            <img src="/logoAI.png" alt="Tax Assistant Logo" className="w-8 h-8 object-contain rounded-lg" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100">Tax Assistant</h1>
          <button
            onClick={onClose}
            className="lg:hidden ml-auto p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="mb-6">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">Quick Guides</h2>
            <div className="space-y-1">
              {quickQueries.map((query, idx) => (
                <button
                  key={idx}
                  onClick={onClose}
                  className="w-full text-left px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 rounded-lg transition-colors flex items-center gap-2"
                >
                  <Info className="w-4 h-4 text-slate-400" />
                  {query}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">Resources</h2>
            <div className="space-y-1">
              <a
                href="https://www.incometax.gov.in/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full text-left px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg flex items-center gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                Income Tax Portal
              </a>
              <a
                href="https://www.gst.gov.in/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full text-left px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg flex items-center gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                GST Portal
              </a>
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-slate-100 dark:border-slate-800 space-y-2">
          <button
            onClick={onToggleTheme}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            {isDarkMode ? 'Light Mode' : 'Dark Mode'}
          </button>
          <button
            onClick={onClearChat}
            disabled={!onClearChat}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors",
              onClearChat ? "text-red-600 hover:bg-red-900/20" : "text-slate-400 cursor-not-allowed"
            )}
          >
            <Trash2 className="w-4 h-4" />
            Clear Conversation
          </button>
        </div>
      </div>
    </aside>
  );
}
