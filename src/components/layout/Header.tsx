import { Menu, Moon, Sun, LogOut, MessageCircle, Calculator, LayoutDashboard, CreditCard, FileText, FileSpreadsheet, Gavel, User, Users, Shield, Settings, X, Minus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { postToParent } from '../../lib/pluginProtocol';

type ActiveView = 'chat' | 'calculator' | 'dashboard' | 'admin' | 'plan' | 'notices' | 'settings' | 'itr' | 'profile' | 'board_resolutions' | 'clients';

interface HeaderProps {
  isPluginMode: boolean;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  onOpenSidebar: () => void;
  user: { id: string; email: string; name: string; role: string; itr_enabled?: boolean } | null;
  onLogout: () => void;
  activeView?: ActiveView;
  onViewChange?: (view: ActiveView) => void;
}

const navItems: { id: ActiveView; label: string; icon: typeof MessageCircle }[] = [
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'calculator', label: 'Calculator', icon: Calculator },
  { id: 'notices', label: 'Notices', icon: FileText },
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'dashboard', label: 'Stats', icon: LayoutDashboard },
  { id: 'plan', label: 'Plan', icon: CreditCard },
];

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
  activeView,
  onViewChange,
}: HeaderProps) {
  // ITR visible to admins OR users with the itr_enabled capability.
  const canAccessItr = user?.role === 'admin' || user?.itr_enabled === true;
  // Board Resolutions is admin-only for v1.
  const canAccessBoardResolutions = user?.role === 'admin';
  const allNavItems = [
    ...navItems,
    ...(canAccessItr ? [{ id: 'itr' as ActiveView, label: 'ITR', icon: FileSpreadsheet }] : []),
    ...(canAccessBoardResolutions
      ? [{ id: 'board_resolutions' as ActiveView, label: 'Resolutions', icon: Gavel }]
      : []),
    { id: 'clients' as ActiveView, label: 'Clients', icon: Users },
    ...(user?.role === 'admin' ? [{ id: 'admin' as ActiveView, label: 'Admin', icon: Shield }] : []),
  ];

  return (
    <header className={cn(
      "h-14 shrink-0 bg-white dark:bg-[#151210] border-b border-gray-200 dark:border-gray-800 flex items-center px-4 sticky top-0 z-10 gap-4",
      isPluginMode && "h-12"
    )}>
      {/* Left — menu (mobile) + logo */}
      <div className="flex items-center gap-2 shrink-0">
        {!isPluginMode && (
          <button
            onClick={onOpenSidebar}
            className="lg:hidden p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
          >
            <Menu className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        )}
        <img src="/logoAI.png" alt="Smartbiz AI Logo" className="w-6 h-6 object-contain" />
        <span className="font-semibold text-gray-800 dark:text-gray-200 text-sm">
          Smartbiz AI
        </span>
      </div>

      {/* Center — nav tabs (desktop only) */}
      {activeView && onViewChange && !isPluginMode && (
        <nav className="hidden lg:flex items-center gap-1 flex-1 justify-center">
          {allNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onViewChange(item.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-all",
                  isActive
                    ? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/15"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                )}
              >
                <Icon className={cn("w-4 h-4", isActive && "text-emerald-500")} />
                {item.label}
              </button>
            );
          })}
        </nav>
      )}

      {/* Spacer when no nav */}
      {(!activeView || isPluginMode) && <div className="flex-1" />}

      {/* Right — theme + user */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onToggleTheme}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
        >
          {isDarkMode ? <Sun className="w-4 h-4 text-gray-400" /> : <Moon className="w-4 h-4 text-gray-500" />}
        </button>
        {isPluginMode && (
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => postToParent({ type: 'MINIMIZE_PLUGIN' })}
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              title="Minimize"
            >
              <Minus className="w-3.5 h-3.5 text-gray-500" />
            </button>
            <button
              onClick={() => postToParent({ type: 'CLOSE_PLUGIN' })}
              className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              title="Close"
            >
              <X className="w-3.5 h-3.5 text-red-500" />
            </button>
          </div>
        )}
        {user && !isPluginMode && (
          <div className="hidden sm:flex items-center gap-1">
            <button
              onClick={() => onViewChange?.('settings')}
              className={cn(
                "w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-[11px] font-bold hover:opacity-90 transition-opacity",
                activeView === 'settings' && 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-white dark:ring-offset-gray-900'
              )}
              title="Account settings"
            >
              {getInitials(user.name)}
            </button>
            <button
              onClick={() => onViewChange?.('settings')}
              className={cn(
                "p-1.5 rounded-lg transition-colors",
                activeView === 'settings'
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400'
              )}
              title="Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
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
