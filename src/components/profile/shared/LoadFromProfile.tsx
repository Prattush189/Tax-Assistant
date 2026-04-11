import { useEffect, useState, useRef } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { fetchGenericProfiles, GenericProfile } from '../../../services/api';

interface Props {
  onPick: (profile: GenericProfile) => void;
  label?: string;
  compact?: boolean;
}

/**
 * Compact dropdown that lazily fetches the current user's generic profiles
 * and invokes onPick when a user clicks one. Used by ITR wizard steps +
 * Notice form + Calculator to prefill form state from a saved profile.
 */
export function LoadFromProfile({ onPick, label = 'Load from profile', compact }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profiles, setProfiles] = useState<GenericProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const loadList = async () => {
    if (profiles !== null) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGenericProfiles();
      setProfiles(data.profiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profiles');
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    if (!open) void loadList();
    setOpen(!open);
  };

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', onClick);
      return () => document.removeEventListener('mousedown', onClick);
    }
  }, [open]);

  return (
    <div className="relative inline-block" ref={rootRef}>
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'flex items-center gap-1.5 font-medium rounded-lg transition-colors text-emerald-700 dark:text-emerald-300',
          'bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30',
          compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
        )}
      >
        <Download className={cn(compact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
        {label}
        <ChevronDown className={cn(compact ? 'w-3 h-3' : 'w-3.5 h-3.5', 'opacity-60')} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 max-h-80 overflow-y-auto z-30 bg-white dark:bg-[#1a1714] border border-gray-200 dark:border-gray-800 rounded-xl shadow-lg p-1">
          {loading && <p className="text-sm text-gray-400 px-3 py-3 text-center">Loading…</p>}
          {error && <p className="text-sm text-red-500 px-3 py-3 text-center">{error}</p>}
          {!loading && !error && profiles !== null && profiles.length === 0 && (
            <p className="text-sm text-gray-400 px-3 py-3 text-center">
              No profiles yet. Create one in the Profile tab.
            </p>
          )}
          {!loading &&
            !error &&
            profiles &&
            profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onPick(p);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
              >
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{p.name}</p>
                {(() => {
                  const id = p.identity as { pan?: string };
                  return id?.pan ? (
                    <p className="text-[11px] text-gray-400 dark:text-gray-500">{id.pan}</p>
                  ) : null;
                })()}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
