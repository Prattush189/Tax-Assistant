import { Menu, ShieldCheck, Calculator, Moon, Sun } from 'lucide-react';
import { cn } from '../../lib/utils';

type ActiveView = 'chat' | 'calculator' | 'dashboard' | 'documents';

interface HeaderProps {
  isPluginMode: boolean;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  activeView: ActiveView;
  onViewChange: (view: ActiveView) => void;
  onOpenSidebar: () => void;
}

const tabs: { id: ActiveView; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'calculator', label: 'Calculator' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'documents', label: 'Documents' },
];

export function Header({
  isPluginMode,
  isDarkMode,
  onToggleTheme,
  activeView,
  onViewChange,
  onOpenSidebar,
}: HeaderProps) {
  return (
    <header className={cn(
      "h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 lg:px-8 sticky top-0 z-10",
      isPluginMode && "h-12 px-4"
    )}>
      <div className="flex items-center gap-3">
        {!isPluginMode && (
          <button
            onClick={onOpenSidebar}
            className="lg:hidden p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
          >
            <Menu className="w-6 h-6 text-slate-600 dark:text-slate-400" />
          </button>
        )}
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-green-600 dark:text-green-400" />
          <span className="font-semibold text-slate-700 dark:text-slate-200 text-sm sm:text-base">
            {isPluginMode ? 'Tax Assistant' : 'Indian Tax Assistant'}
          </span>
        </div>
      </div>

      {/* Tab Navigation */}
      {!isPluginMode && (
        <nav className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onViewChange(tab.id)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-lg transition-colors",
                activeView === tab.id
                  ? "border-b-2 border-orange-500 text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      )}

      <div className="flex items-center gap-2 sm:gap-4">
        <button
          onClick={onToggleTheme}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
        >
          {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        <div className="hidden sm:flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <Calculator className="w-3 h-3" />
            AY 2025-26 Ready
          </span>
        </div>
      </div>
    </header>
  );
}
