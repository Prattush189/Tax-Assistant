import { useState } from 'react';
import { User, MapPin, Landmark, Briefcase, Shield, FileText, Building, Download } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ProfileManager, ProfileAy } from '../../hooks/useProfileManager';
import { ProfilePicker } from './ProfilePicker';
import { IdentityTab } from './tabs/IdentityTab';
import { AddressTab } from './tabs/AddressTab';
import { BanksTab } from './tabs/BanksTab';
import { SalaryIncomeTab } from './tabs/SalaryIncomeTab';
import { DeductionsTab } from './tabs/DeductionsTab';
import { NoticeDefaultsTab } from './tabs/NoticeDefaultsTab';
import { BusinessTab } from './tabs/BusinessTab';
import { PROFILE_AYS } from './lib/profileModel';
import { PortalImportDialog } from '../portal-import/PortalImportDialog';

type ProfileSubTab =
  | 'identity'
  | 'address'
  | 'banks'
  | 'salary'
  | 'deductions'
  | 'notice'
  | 'business';

const SUB_TABS: { id: ProfileSubTab; label: string; icon: typeof User; perAy: boolean }[] = [
  { id: 'identity', label: 'Identity', icon: User, perAy: false },
  { id: 'address', label: 'Address', icon: MapPin, perAy: false },
  { id: 'banks', label: 'Banks', icon: Landmark, perAy: false },
  { id: 'salary', label: 'Salary & Income', icon: Briefcase, perAy: true },
  { id: 'deductions', label: 'Deductions', icon: Shield, perAy: true },
  { id: 'notice', label: 'Notice defaults', icon: FileText, perAy: false },
  { id: 'business', label: 'Business', icon: Building, perAy: true },
];

interface Props {
  manager: ProfileManager;
}

export function ProfileView({ manager }: Props) {
  const [activeSubTab, setActiveSubTab] = useState<ProfileSubTab>('identity');
  const [showImport, setShowImport] = useState(false);

  if (!manager.currentProfile) {
    return <ProfilePicker manager={manager} />;
  }

  const currentSubTab = SUB_TABS.find((t) => t.id === activeSubTab);
  const showAyPicker = currentSubTab?.perAy ?? false;

  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-gray-50 dark:bg-[#0E0C0A]">
      {/* Inner sidebar */}
      <aside className="hidden md:flex w-64 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-[#151210] p-4 flex-col shrink-0">
        <div className="mb-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Profile</p>
          <input
            value={manager.currentProfile.name}
            onChange={(e) => manager.updateName(e.target.value)}
            className="w-full px-2 py-1.5 text-sm font-semibold bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-emerald-500 focus:outline-none focus:bg-white dark:focus:bg-gray-900 rounded-lg text-gray-900 dark:text-gray-100 transition-colors"
          />
        </div>
        <nav className="space-y-0.5 flex-1 overflow-y-auto">
          {SUB_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors text-sm',
                  isActive
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60',
                )}
              >
                <Icon
                  className={cn(
                    'w-4 h-4 shrink-0',
                    isActive ? 'text-emerald-500' : 'text-gray-300 dark:text-gray-600',
                  )}
                />
                <span className="flex-1 truncate">{tab.label}</span>
                {tab.perAy && (
                  <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-400">
                    per AY
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar with AY picker when relevant */}
        <div className="shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#151210] p-3 flex items-center justify-between gap-4">
          <div className="md:hidden">
            {/* Mobile sub-tab picker */}
            <select
              value={activeSubTab}
              onChange={(e) => setActiveSubTab(e.target.value as ProfileSubTab)}
              className="px-3 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none"
            >
              {SUB_TABS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <h2 className="hidden md:block text-base font-semibold text-gray-900 dark:text-gray-100">
            {currentSubTab?.label}
          </h2>
          <div className="flex items-center gap-2">
            {showAyPicker && (
              <>
                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">AY</span>
                <select
                  value={manager.selectedAy}
                  onChange={(e) => manager.setSelectedAy(e.target.value as ProfileAy)}
                  className="px-2.5 py-1 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                >
                  {PROFILE_AYS.map((ay) => (
                    <option key={ay} value={ay}>
                      {ay}
                    </option>
                  ))}
                </select>
              </>
            )}
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-900/40 rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Import from IT portal
            </button>
            <span className="text-[11px] text-gray-400 dark:text-gray-500">Auto-saved</span>
          </div>
        </div>

        <PortalImportDialog
          open={showImport}
          onClose={() => setShowImport(false)}
          existingProfileId={manager.currentProfile.id}
          onImported={async (result) => {
            // Re-fetch the profile list and the current profile so the tabs
            // reflect the imported data.
            await manager.refresh();
            await manager.loadProfile(result.profileId);
          }}
        />

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-3xl mx-auto w-full">
            {activeSubTab === 'identity' && <IdentityTab manager={manager} />}
            {activeSubTab === 'address' && <AddressTab manager={manager} />}
            {activeSubTab === 'banks' && <BanksTab manager={manager} />}
            {activeSubTab === 'salary' && <SalaryIncomeTab manager={manager} />}
            {activeSubTab === 'deductions' && <DeductionsTab manager={manager} />}
            {activeSubTab === 'notice' && <NoticeDefaultsTab manager={manager} />}
            {activeSubTab === 'business' && <BusinessTab manager={manager} />}
          </div>
        </div>
      </div>
    </div>
  );
}
