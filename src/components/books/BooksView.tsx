import { ReactNode } from 'react';
import { Landmark, BookOpenCheck, LineChart, FileSpreadsheet } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';

type BooksTab = 'bank_statements' | 'ledger_scrutiny' | 'cma' | 'tb_bs';

interface Props {
  activeView: BooksTab | string;
  onViewChange: (view: BooksTab) => void;
  children: ReactNode;
}

interface BooksTabDef {
  id: BooksTab;
  label: string;
  icon: typeof Landmark;
  ai?: boolean;
  /** When true, only users with admin role OR books_paid_enabled
   *  see this tab. Server-side routes enforce the same gate so a
   *  direct API call can't bypass it. */
  booksPaidOnly?: boolean;
}

const ALL_TABS: BooksTabDef[] = [
  { id: 'bank_statements', label: 'Bank Statements', icon: Landmark, ai: true },
  { id: 'ledger_scrutiny', label: 'Ledger Scrutiny', icon: BookOpenCheck, ai: true },
  // TB → BS and CMA — opt-in AI mapping (the "AI-suggest" button on
  // the mapping step calls Gemini to classify uploaded rows). The
  // rest of each module is pure computation. Off by default for
  // every user including pro / enterprise — flipped per-user via
  // server/scripts/grant-books.ts. Admins always see them.
  { id: 'tb_bs', label: 'TB → Statements', icon: FileSpreadsheet, ai: true, booksPaidOnly: true },
  { id: 'cma', label: 'CMA Report', icon: LineChart, ai: true, booksPaidOnly: true },
];

/**
 * Hub page for book-keeping AI features. Hosts Bank Statements and the new
 * Ledger Scrutiny surface behind a tab strip — same pattern as LegalView.
 */
export function BooksView({ activeView, onViewChange, children }: Props) {
  const { user } = useAuth();
  const canAccessPaidBooks = user?.role === 'admin' || user?.books_paid_enabled === true;
  const tabs = ALL_TABS.filter(t => !t.booksPaidOnly || canAccessPaidBooks);
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 lg:px-6 py-2 border-b border-gray-200/50 dark:border-gray-800/50 shrink-0 bg-white/30 dark:bg-gray-900/20">
        <nav className="flex gap-1 overflow-x-auto -mx-1 px-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeView === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onViewChange(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-all whitespace-nowrap shrink-0',
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/30'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50',
                )}
              >
                <Icon className={cn('w-4 h-4', isActive && 'text-blue-500')} />
                {tab.label}
                {tab.ai && (
                  <span
                    className={cn(
                      'ml-0.5 text-[9px] font-bold tracking-wider px-1 py-0.5 rounded border leading-none',
                      isActive
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-300/60 dark:border-blue-700/60'
                        : 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-300 border-purple-200 dark:border-purple-800/60',
                    )}
                    title="Uses AI"
                  >AI</span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex-1 flex flex-col min-h-0">{children}</div>
    </div>
  );
}
