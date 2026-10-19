import { motion } from 'motion/react';
import { Smartphone, LogOut } from 'lucide-react';
import { useAuth, PENDING_PHONE_KEY } from '../../contexts/AuthContext';
import { LoadingAnimation } from '../ui/LoadingAnimation';
import { PhoneVerifyForm } from './PhoneVerifyForm';

function pendingSignupPhone(): string {
  try { return sessionStorage.getItem(PENDING_PHONE_KEY) ?? ''; } catch { return ''; }
}

/**
 * Mandatory gate shown to every signed-in account without a verified
 * mobile (user.needs_phone). The server enforces the same rule —
 * phoneRequiredMiddleware answers 403 on every app API until this is done.
 */
export function VerifyPhonePage() {
  const { user, refreshUser, logout } = useAuth();

  const done = async () => {
    try { sessionStorage.removeItem(PENDING_PHONE_KEY); } catch { /* storage blocked */ }
    await refreshUser();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0E0C0A] p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="flex items-center gap-2 mb-8">
          <LoadingAnimation className="w-10 h-10" />
          <span className="text-xl font-bold text-gray-900 dark:text-white">Smartbiz AI</span>
        </div>

        <div className="mb-8">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center mb-5">
            <Smartphone className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Verify your mobile number</h1>
          <p className="text-gray-500 dark:text-gray-400">
            Every account now needs a verified mobile number. We'll send a one-time code on WhatsApp.
            You can also use this number to sign in and to receive login codes.
          </p>
        </div>

        <PhoneVerifyForm initialPhone={pendingSignupPhone()} onVerified={done} />

        <div className="mt-6 flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <span className="truncate">Signed in as {user?.email}</span>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1.5 hover:text-gray-700 dark:hover:text-gray-200 transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </motion.div>
    </div>
  );
}
