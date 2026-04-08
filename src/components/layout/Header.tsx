import { Menu, Moon, Sun, LogOut, User } from 'lucide-react';
import { cn } from '../../lib/utils';

interface HeaderProps {
  isPluginMode: boolean;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  onOpenSidebar: () => void;
  user: { id: string; email: string; name: string; role: string } | null;
  onLogout: () => void;
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export function Header({
  isPluginMode,
  isDarkMode,
  onToggleTheme,
  onOpenSidebar,
  user,
  onLogout,
}: HeaderProps) {
  return (
    <header className={cn(
      "h-14 shrink-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-800/50 flex items-center justify-between px-4 sticky top-0 z-10",
      isPluginMode && "h-12"
    )}>
      {/* Left — menu button */}
      <div className="flex items-center w-20">
        {!isPluginMode && (
          <button
            onClick={onOpenSidebar}
            className="lg:hidden p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >
            <Menu className="w-5 h-5 text-slate-600 dark:text-slate-400" />
          </button>
        )}
      </div>

      {/* Center — logo */}
      <div className="flex items-center gap-2">
        <img src="/logoAI.png" alt="Smart AI Logo" className="w-6 h-6 object-contain" />
        <span className="font-semibold text-slate-700 dark:text-slate-200 text-sm sm:text-base">
          Smart AI
        </span>
      </div>

      {/* Right — theme + user */}
      <div className="flex items-center gap-1 w-20 justify-end">
        <button
          onClick={onToggleTheme}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
        >
          {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        {user && !isPluginMode && (
          <div className="hidden sm:flex items-center gap-1">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-[11px] font-bold">
              {getInitials(user.name)}
            </div>
            <button
              onClick={onLogout}
              className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
              title="Logout"
            >
              <LogOut className="w-3.5 h-3.5 text-red-500" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
