import { Menu, Calculator, Moon, Sun, LogOut } from 'lucide-react';
import { cn } from '../../lib/utils';

type ActiveView = 'chat' | 'calculator' | 'dashboard';

interface HeaderProps {
  isPluginMode: boolean;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  activeView: ActiveView;
  onViewChange: (view: ActiveView) => void;
  onOpenSidebar: () => void;
  user: { id: string; email: string; name: string } | null;
  onLogout: () => void;
}

const tabs: { id: ActiveView; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'calculator', label: 'Calculator' },
  { id: 'dashboard', label: 'Dashboard' },
];

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export function Header({
  isPluginMode,
  isDarkMode,
  onToggleTheme,
  activeView,
  onViewChange,
  onOpenSidebar,
  user,
  onLogout,
}: HeaderProps) {
  return (
    <header className={cn(
      "h-14 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-800/50 flex items-center justify-between px-4 lg:px-8 sticky top-0 z-10",
      isPluginMode && "h-12 px-4"
    )}>
      <div className="flex items-center gap-3">
        {!isPluginMode && (
          <button
            onClick={onOpenSidebar}
            className="lg:hidden p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >
            <Menu className="w-5 h-5 text-slate-600 dark:text-slate-400" />
          </button>
        )}
        <div className="flex items-center gap-2">
          <img src="/logoAI.png" alt="Tax Assistant Logo" className="w-6 h-6 object-contain rounded-md" />
          <span className="font-semibold text-slate-700 dark:text-slate-200 text-sm sm:text-base">
            {isPluginMode ? 'Tax Assistant' : 'Indian Tax Assistant'}
          </span>
        </div>
      </div>

      {/* Tab Navigation */}
      {!isPluginMode && (
        <nav className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/50 p-1 rounded-xl">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onViewChange(tab.id)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-lg transition-all",
                activeView === tab.id
                  ? "bg-white dark:bg-slate-700 text-orange-600 dark:text-orange-400 shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={onToggleTheme}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
        >
          {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        <div className="hidden sm:flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <Calculator className="w-3 h-3" />
            AY 2025-26
          </span>
        </div>
        {user && !isPluginMode && (
          <div className="hidden sm:flex items-center gap-2 ml-2 pl-2 border-l border-slate-200 dark:border-slate-700">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-[11px] font-bold">
              {getInitials(user.name)}
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
    </header>
  );
}
