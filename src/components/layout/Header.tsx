import { Menu, Moon, Sun, LogOut } from 'lucide-react';
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
      "h-14 shrink-0 bg-white dark:bg-[#111827] border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 sticky top-0 z-10",
      isPluginMode && "h-12"
    )}>
      <div className="flex items-center w-20">
        {!isPluginMode && (
          <button
            onClick={onOpenSidebar}
            className="lg:hidden p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
          >
            <Menu className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <img src="/logoAI.png" alt="Smart AI Logo" className="w-6 h-6 object-contain" />
        <span className="font-semibold text-gray-800 dark:text-gray-200 text-sm sm:text-base">
          Smart AI
        </span>
      </div>

      <div className="flex items-center gap-1 w-20 justify-end">
        <button
          onClick={onToggleTheme}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
        >
          {isDarkMode ? <Sun className="w-4 h-4 text-gray-400" /> : <Moon className="w-4 h-4 text-gray-500" />}
        </button>
        {user && !isPluginMode && (
          <div className="hidden sm:flex items-center gap-1">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-[11px] font-bold">
              {getInitials(user.name)}
            </div>
            <button
              onClick={onLogout}
              className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
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
