import { useState } from 'react';
import { motion } from 'motion/react';
import { UserPlus, Eye, EyeOff, Users } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { acceptInvitation } from '../../services/api';
import { LoadingAnimation } from '../ui/LoadingAnimation';

interface AcceptInvitePageProps {
  token: string;
  onDone: () => void;
}

/**
 * Public page shown when the URL carries `?invite=<token>`. Collects
 * password + name, then calls POST /api/invitations/accept. On success,
 * the returned JWT is persisted and the router clears the query param.
 */
export function AcceptInvitePage({ token, onDone }: AcceptInvitePageProps) {
  const { completeEmailVerification } = useAuth();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password && password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setIsSubmitting(true);
    try {
      // Name + password are optional server-side when the invite matches an
      // existing user. Send them if the user filled them in.
      const result = await acceptInvitation({
        token,
        name: name.trim() || undefined,
        password: password || undefined,
      });
      completeEmailVerification(result.accessToken, result.refreshToken, result.user);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 text-gray-900 dark:text-white transition-all placeholder:text-gray-400';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0E0C0A] p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="flex items-center gap-2 mb-8">
          <img src="/logoAI.png" alt="Smartbiz AI" className="w-10 h-10 object-contain" />
          <span className="text-xl font-bold text-gray-800 dark:text-white">Smartbiz AI</span>
        </div>

        <div className="mb-8">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center mb-5">
            <Users className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Accept team invitation</h1>
          <p className="text-gray-500 dark:text-gray-400">
            You've been invited to join a Smartbiz AI team. If you already have an account with the
            same email, your existing account will be linked. Otherwise we'll create a new account
            for you below.
          </p>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-3.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-600 dark:text-red-400"
          >
            {error}
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Name <span className="text-xs text-gray-400">(for new accounts)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="John Doe"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Password <span className="text-xs text-gray-400">(for new accounts)</span>
            </label>
            <div className="relative">
              <input
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
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Confirm password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
              placeholder="Confirm password"
            />
          </div>

          <motion.button
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
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
      </motion.div>
    </div>
  );
}
