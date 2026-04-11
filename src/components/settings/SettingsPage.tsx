import { useState } from 'react';
import { User, Mail, Lock, Trash2, AlertTriangle, Check, Sliders } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  updateAccountName,
  updateAccountEmail,
  updateAccountPassword,
  deleteAccount,
} from '../../services/api';
import { usePreferences } from '../../hooks/usePreferences';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';
import { TeamSection } from './TeamSection';

interface SectionProps {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  danger?: boolean;
}

function Section({ title, description, icon: Icon, children, danger }: SectionProps) {
  return (
    <div className={cn(
      'rounded-2xl border p-6',
      danger
        ? 'bg-red-50/50 dark:bg-red-950/10 border-red-200 dark:border-red-900/50'
        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800'
    )}>
      <div className="flex items-start gap-3 mb-4">
        <div className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
          danger
            ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
            : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
        )}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={cn(
            'text-base font-semibold',
            danger ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-white'
          )}>{title}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

const inputClass = "w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 text-gray-800 dark:text-gray-100 text-sm placeholder:text-gray-400";

const buttonPrimary = "px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const buttonDanger = "px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

/** Toggle switch — reusable */
function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
        enabled ? 'bg-emerald-600' : 'bg-gray-300 dark:bg-gray-600'
      )}
      aria-checked={enabled}
      role="switch"
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
          enabled ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </button>
  );
}

export function SettingsPage() {
  const { user, logout, refreshUser } = useAuth();
  const { prefs, updatePreference } = usePreferences();

  // Name
  const [name, setName] = useState(user?.name ?? '');
  const [savingName, setSavingName] = useState(false);

  // Email
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  // Password
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);

  // Delete
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deletePwd, setDeletePwd] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === user?.name) return;
    setSavingName(true);
    try {
      await updateAccountName(name.trim());
      await refreshUser();
      toast.success('Name updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update name');
    } finally {
      setSavingName(false);
    }
  };

  const handleChangeEmail = async () => {
    if (!newEmail.trim() || !emailPassword) return;
    setSavingEmail(true);
    try {
      const data = await updateAccountEmail(newEmail.trim(), emailPassword);
      // New tokens are returned — store them
      if (data.accessToken && data.refreshToken) {
        localStorage.setItem('tax_access_token', data.accessToken);
        localStorage.setItem('tax_refresh_token', data.refreshToken);
      }
      await refreshUser();
      setNewEmail('');
      setEmailPassword('');
      toast.success('Email updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update email');
    } finally {
      setSavingEmail(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPwd || !newPwd) return;
    if (newPwd !== confirmPwd) {
      toast.error('New passwords do not match');
      return;
    }
    if (newPwd.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setSavingPwd(true);
    try {
      await updateAccountPassword(currentPwd, newPwd);
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
      toast.success('Password changed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setSavingPwd(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE MY ACCOUNT') {
      toast.error('Please type the confirmation phrase exactly');
      return;
    }
    setDeleting(true);
    try {
      await deleteAccount(deletePwd || null, deleteConfirm);
      toast.success('Account deleted');
      // Log out — localStorage tokens are now invalid
      setTimeout(() => logout(), 500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete account');
      setDeleting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">Account Settings</h1>
          <p className="text-gray-500 dark:text-gray-400">Manage your profile and account security</p>
        </div>

        <div className="space-y-5">
          {/* Display Name */}
          <Section
            title="Display Name"
            description="This is how your name appears in the app"
            icon={User}
          >
            <div className="flex gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className={inputClass}
                maxLength={80}
              />
              <button
                onClick={handleSaveName}
                disabled={savingName || !name.trim() || name.trim() === user?.name}
                className={buttonPrimary}
              >
                {savingName ? 'Saving...' : 'Save'}
              </button>
            </div>
          </Section>

          {/* Preferences */}
          <Section
            title="Preferences"
            description="Customize how the app behaves"
            icon={Sliders}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Confirm before deleting chats</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Show a confirmation dialog when deleting a chat from the sidebar
                  </p>
                </div>
                <Toggle
                  enabled={prefs.confirmBeforeDeletingChats}
                  onChange={(v) => updatePreference('confirmBeforeDeletingChats', v)}
                />
              </div>
            </div>
          </Section>

          {/* Change Email */}
          <Section
            title="Change Email"
            description="Update the email address used to log in"
            icon={Mail}
          >
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Current Email</label>
                <input type="email" value={user?.email ?? ''} disabled className={cn(inputClass, 'opacity-60 cursor-not-allowed')} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">New Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Current Password</label>
                <input
                  type="password"
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                  placeholder="Required to confirm"
                  className={inputClass}
                />
              </div>
              <button
                onClick={handleChangeEmail}
                disabled={savingEmail || !newEmail.trim() || !emailPassword}
                className={buttonPrimary}
              >
                {savingEmail ? 'Updating...' : 'Update Email'}
              </button>
            </div>
          </Section>

          {/* Change Password */}
          <Section
            title="Change Password"
            description="Use a strong password with at least 8 characters"
            icon={Lock}
          >
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Current Password</label>
                <input
                  type="password"
                  value={currentPwd}
                  onChange={(e) => setCurrentPwd(e.target.value)}
                  placeholder="Leave blank if you signed up with Google"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">New Password</label>
                <input
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  placeholder="Re-enter new password"
                  className={inputClass}
                />
              </div>
              {newPwd && confirmPwd && newPwd === confirmPwd && (
                <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <Check className="w-3 h-3" /> Passwords match
                </p>
              )}
              <button
                onClick={handleChangePassword}
                disabled={savingPwd || !newPwd || !confirmPwd}
                className={buttonPrimary}
              >
                {savingPwd ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </Section>

          {/* Team — shows for all plans (with explainer on non-enterprise) */}
          <TeamSection />

          {/* Delete Account */}
          <Section
            title="Delete Account"
            description="Permanently delete your account and all associated data"
            icon={Trash2}
            danger
          >
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-red-100/50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 dark:text-red-300">
                  <strong>This cannot be undone.</strong> All your chats, notices, tax profiles, and saved data will be permanently deleted.
                </p>
              </div>
              {!showDeleteDialog ? (
                <button
                  onClick={() => setShowDeleteDialog(true)}
                  className={buttonDanger}
                >
                  Delete My Account
                </button>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-red-700 dark:text-red-400 mb-1">
                      Type <code className="px-1 py-0.5 bg-red-100 dark:bg-red-900/40 rounded">DELETE MY ACCOUNT</code> to confirm
                    </label>
                    <input
                      type="text"
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                      placeholder="DELETE MY ACCOUNT"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-red-700 dark:text-red-400 mb-1">Current Password (if set)</label>
                    <input
                      type="password"
                      value={deletePwd}
                      onChange={(e) => setDeletePwd(e.target.value)}
                      placeholder="Leave blank for Google-only accounts"
                      className={inputClass}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleDeleteAccount}
                      disabled={deleting || deleteConfirm !== 'DELETE MY ACCOUNT'}
                      className={buttonDanger}
                    >
                      {deleting ? 'Deleting...' : 'Permanently Delete Account'}
                    </button>
                    <button
                      onClick={() => {
                        setShowDeleteDialog(false);
                        setDeleteConfirm('');
                        setDeletePwd('');
                      }}
                      disabled={deleting}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium text-sm rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
