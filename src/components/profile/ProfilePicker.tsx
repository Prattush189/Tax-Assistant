import { useState } from 'react';
import { User } from 'lucide-react';
import { ProfileManager } from '../../hooks/useProfileManager';

interface Props {
  manager: ProfileManager;
}

export function ProfilePicker({ manager }: Props) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onCreate = async () => {
    if (!name.trim()) {
      setErr('Profile name is required');
      return;
    }
    setErr(null);
    setCreating(true);
    try {
      await manager.createProfile(name.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create profile');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-4 md:p-6">
      <div className="max-w-2xl mx-auto w-full">
        <div className="text-center mb-8 mt-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 mb-4">
            <User className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Profiles</h1>
          <p className="text-sm text-gray-500 dark:text-gray-500 max-w-md mx-auto">
            Reusable identity + address + bank + per-AY data. Prefill the ITR wizard,
            the Notice drafter, and the Calculator from one place.
          </p>
        </div>

        <div className="bg-white dark:bg-[#1a1714] border border-gray-200 dark:border-gray-800 rounded-2xl p-6 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">New profile</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-500 mb-3">
              One profile per taxpayer (e.g. a client). Identity + address are stable;
              income and deductions are stored per Assessment Year.
            </p>
            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
              Profile name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ramesh Kumar"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100"
            />
          </div>
          {err && <p className="text-sm text-red-500">{err}</p>}
          <button
            onClick={onCreate}
            disabled={creating || !name.trim()}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-400 text-white font-medium py-2.5 rounded-xl transition-colors text-sm"
          >
            {creating ? 'Creating…' : 'Create profile'}
          </button>
        </div>

        {manager.profiles.length > 0 && (
          <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-500">
            Or pick an existing profile from the sidebar.
          </p>
        )}
      </div>
    </div>
  );
}
