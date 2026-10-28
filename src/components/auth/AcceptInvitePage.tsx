import { useState } from 'react';
import { motion } from 'motion/react';
import { UserPlus, Eye, EyeOff, Users, LogIn } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { acceptInvitation, InviteAcceptError } from '../../services/api';
import { LoadingAnimation } from '../ui/LoadingAnimation';

interface AcceptInvitePageProps {
  token: string;
  onDone: () => void;
  /** The invite is for an existing account and nobody is signed in: hold
   *  the token, show the sign-in screen, and come back here afterwards. */
  onNeedSignIn: () => void;
}

/**
 * Shown when the URL carries `?invite=<token>` (or a held invite resumes
 * after sign-in).
 * - Signed in: one click joins THIS account to the team. The server only
 *   allows that when the signed-in account is the one invited.
 * - Signed out, new email: collects name + password and creates the account.
 * - Signed out, email already has an account: the server answers
 *   `login_required` and we send the user to sign in first.
 */
export function AcceptInvitePage({ token, onDone, onNeedSignIn }: AcceptInvitePageProps) {
  const { completeEmailVerification, isAuthenticated, user, refreshUser, logout } = useAuth();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState<string | undefined>();
  const [existingEmail, setExistingEmail] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fail = (err: unknown) => {
    if (err instanceof InviteAcceptError && err.code === 'login_required') {
      setExistingEmail(err.email ?? '');
      setError('');
      return;
    }
    setErrorCode(err instanceof InviteAcceptError ? err.code : undefined);
    setError(err instanceof Error ? err.message : 'Failed to accept invitation');
  };

  const joinAsCurrentUser = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      await acceptInvitation({ token });
      await refreshUser();
      toast.success('You joined the team');
      onDone();
    } catch (err) {
      fail(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password && password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await acceptInvitation({
        token,
        name: name.trim() || undefined,
        password: password || undefined,
      });
      if (result.accessToken && result.refreshToken) {
        completeEmailVerification(result.accessToken, result.refreshToken, result.user);
      }
      onDone();
    } catch (err) {
      fail(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 text-gray-900 dark:text-white transition-all placeholder:text-gray-400';
  const primaryBtn =
    'w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2';

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
            <Users className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Accept team invitation</h1>
          <p className="text-gray-500 dark:text-gray-400">
            {isAuthenticated
              ? `You're signed in as ${user?.email}. Joining links this account to the team, and its AI usage will draw on the team's shared credits.`
              : "You've been invited to join a Smartbiz AI team. Create your account below — or, if you already have one with this email, you'll be asked to sign in."}
          </p>
        </div>

        {error && (
          <motion.div
            role="alert"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-3.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-600 dark:text-red-400"
          >
            {error}
            {errorCode === 'wrong_account' && (
              <button type="button" onClick={() => { logout(); }} className="block mt-2 font-medium underline">
                Sign out and use the invited account
              </button>
            )}
          </motion.div>
        )}

        {isAuthenticated ? (
          <div className="space-y-3">
            <motion.button whileTap={{ scale: 0.98 }} type="button" onClick={() => void joinAsCurrentUser()} disabled={isSubmitting} className={primaryBtn}>
              {isSubmitting ? <LoadingAnimation size="sm" /> : (<><UserPlus className="w-5 h-5" />Join team</>)}
            </motion.button>
            <button type="button" onClick={onDone} className="w-full py-2.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
              Not now
            </button>
          </div>
        ) : existingEmail !== null ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300">
              An account with <span className="font-medium text-gray-900 dark:text-white">{existingEmail || 'this email'}</span> already exists.
              Sign in to it, and you'll come straight back here to join the team.
            </div>
            <motion.button whileTap={{ scale: 0.98 }} type="button" onClick={onNeedSignIn} className={primaryBtn}>
              <LogIn className="w-5 h-5" />
              Sign in to continue
            </motion.button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="invite-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Name</label>
              <input
                id="invite-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                placeholder="John Doe"
              />
            </div>
            <div>
              <label htmlFor="invite-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Password</label>
              <div className="relative">
                <input
                  id="invite-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  className={`${inputClass} pr-12`}
                  placeholder="Min. 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="invite-confirm" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Confirm password
              </label>
              <input
                id="invite-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputClass}
                placeholder="Confirm password"
              />
            </div>

            <motion.button whileTap={{ scale: 0.98 }} type="submit" disabled={isSubmitting} className={primaryBtn}>
              {isSubmitting ? (
                <LoadingAnimation size="sm" />
              ) : (
                <>
                  <UserPlus className="w-5 h-5" />
                  Accept Invitation
                </>
              )}
            </motion.button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
