import { ReactNode } from 'react';
import { FileText, Gavel, ScrollText } from 'lucide-react';
import { cn } from '../../lib/utils';

type LegalTab = 'notices' | 'board_resolutions' | 'partnership_deeds';

interface Props {
  activeView: LegalTab | string;
  onViewChange: (view: LegalTab) => void;
  children: ReactNode;
}

const TABS: { id: LegalTab; label: string; icon: typeof FileText; ai?: boolean }[] = [
  { id: 'notices', label: 'Notice Replies', icon: FileText, ai: true },
  { id: 'board_resolutions', label: 'Board Resolutions', icon: Gavel },
  { id: 'partnership_deeds', label: 'Partnership Deeds', icon: ScrollText, ai: true },
];

/**
 * Hub page that wraps the three legal-document features in a single shell
 * with a horizontal tab strip. The actual feature surfaces (NoticeDrafterPage,
 * BoardResolutionView, PartnershipDeedView) are passed in as `children` —
 * this component only owns the tab bar.
 */
export function LegalView({ activeView, onViewChange, children }: Props) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab strip */}
      <div className="px-4 lg:px-6 py-2 border-b border-gray-200/50 dark:border-gray-800/50 shrink-0 bg-white/30 dark:bg-gray-900/20">
        <nav className="flex gap-1 overflow-x-auto -mx-1 px-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeView === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onViewChange(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-all whitespace-nowrap shrink-0',
                  isActive
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50',
                )}
              >
                <Icon className={cn('w-4 h-4', isActive && 'text-emerald-500')} />
                {tab.label}
                {tab.ai && (
                  <span
                    className={cn(
                      'ml-0.5 text-[9px] font-bold tracking-wider px-1 py-0.5 rounded border leading-none',
                      isActive
                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300/60 dark:border-emerald-700/60'
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

      {/* Active feature pane */}
      <div className="flex-1 flex flex-col min-h-0">{children}</div>
    </div>
  );
}
