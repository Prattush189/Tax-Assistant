import { useState, useRef, useEffect } from 'react';
import { useTaxCalculator } from '../../contexts/TaxCalculatorContext';
import { useAuth } from '../../contexts/AuthContext';
import { Save, Plus, Trash2, ChevronDown, User } from 'lucide-react';
import type { TaxProfileData } from '../../services/api';

export function ProfileSelector() {
  const {
    currentProfileId,
    currentProfileName,
    profiles,
    profileLimit,
    saveProfile,
    loadProfile,
    deleteCurrentProfile,
    clearProfile,
  } = useTaxCalculator();

  const { user, isAuthenticated } = useAuth();

  const [showDropdown, setShowDropdown] = useState(false);
  const [showNameInput, setShowNameInput] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [saving, setSaving] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus input when shown
  useEffect(() => {
    if (showNameInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showNameInput]);

  if (!isAuthenticated) return null;

  const plan = user?.plan ?? 'free';
  const atLimit = profiles.length >= profileLimit && plan === 'free';

  const handleSave = async () => {
    if (currentProfileId) {
      // Update existing profile
      setSaving(true);
      try {
        await saveProfile(currentProfileName);
      } finally {
        setSaving(false);
      }
    } else {
      // Need a name for new profile
      setShowNameInput(true);
      setNameValue('');
    }
  };

  const handleSaveNew = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await saveProfile(trimmed);
      setShowNameInput(false);
      setNameValue('');
    } finally {
      setSaving(false);
    }
  };

  const handleNew = () => {
    clearProfile();
    setShowNameInput(true);
    setNameValue('');
  };

  const handleDelete = async () => {
    if (!currentProfileId) return;
    if (!window.confirm('Delete this profile? This cannot be undone.')) return;
    await deleteCurrentProfile();
  };

  const handleSelectProfile = (profile: TaxProfileData) => {
    loadProfile(profile);
    setShowDropdown(false);
    setShowNameInput(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4 p-2 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/50 rounded-2xl shadow-sm">
      {/* Profile icon + dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-xl transition-colors"
        >
          <User className="w-3.5 h-3.5" />
          <span className="max-w-[160px] truncate">
            {currentProfileName || 'Unsaved Profile'}
          </span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>

        {showDropdown && (
          <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-50 py-1 max-h-60 overflow-y-auto">
            {profiles.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
                No saved profiles
              </div>
            ) : (
              profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelectProfile(p)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-700/50 ${
                    p.id === currentProfileId
                      ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <div className="truncate">{p.name}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">
                    FY {p.fy}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Inline name input */}
      {showNameInput && (
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveNew();
              if (e.key === 'Escape') setShowNameInput(false);
            }}
            placeholder="Profile name..."
            className="w-36 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-400"
          />
          <button
            onClick={handleSaveNew}
            disabled={saving || !nameValue.trim()}
            className="px-2 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg transition-colors"
          >
            {saving ? '...' : 'OK'}
          </button>
        </div>
      )}

      {/* Save button */}
      {!showNameInput && (
        <button
          onClick={handleSave}
          disabled={saving}
          title="Save profile"
          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-xl transition-colors disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" />
          Save
        </button>
      )}

      {/* New button */}
      <button
        onClick={handleNew}
        disabled={atLimit}
        title={atLimit ? 'Upgrade to create more profiles' : 'New profile'}
        className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-xl transition-colors disabled:opacity-50"
      >
        <Plus className="w-3.5 h-3.5" />
        New
      </button>

      {/* Delete button (only when a profile is loaded) */}
      {currentProfileId && (
        <button
          onClick={handleDelete}
          title="Delete profile"
          className="flex items-center gap-1 px-2 py-1.5 text-sm text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded-xl transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Upgrade badge */}
      {atLimit && (
        <span className="ml-auto px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 rounded-full">
          Upgrade for more profiles
        </span>
      )}
    </div>
  );
}
