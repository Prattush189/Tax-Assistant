import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Eye, EyeOff, KeyRound, Mail, RefreshCw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { requestPasswordReset, resetPassword } from '../../services/api';
import { LoadingAnimation } from '../ui/LoadingAnimation';

interface ForgotPasswordPageProps {
  /** Optional starting email, e.g. prefilled from the LoginPage field. */
  initialEmail?: string;
  onBack: () => void;
  onDone: () => void;
}

const COOLDOWN_SECONDS = 60;

type Step = 'request' | 'verify';

/**
 * Two-step password reset flow.
 *
 * Step 1 "request" — user enters their email; we POST to
 * /api/auth/forgot-password and move to the next step regardless of whether
 * an account exists (the server returns 200 in both cases to avoid
 * enumeration). The user sees "If an account exists, a code has been sent".
 *
 * Step 2 "verify" — user enters the 6-digit code + a new password; we POST
 * to /api/auth/reset-password. On success the response contains JWT tokens,
 * which we hand to AuthContext.completeEmailVerification so the app routes
 * into the authenticated view.
 */
export function ForgotPasswordPage({ initialEmail = '', onBack, onDone }: ForgotPasswordPageProps) {
  const { completeEmailVerification } = useAuth();
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'verify') {
      setTimeout(() => codeInputRef.current?.focus(), 50);
    }
  }, [step]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!email.trim()) {
      setError('Enter your email');
      return;
    }
    setIsSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      setInfo('If an account exists for that email, a 6-digit code has been sent. It expires in 10 minutes.');
      setStep('verify');
      setCooldown(COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request password reset');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setError('');
    setInfo('');
    setIsSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      setCooldown(COOLDOWN_SECONDS);
      setInfo('New code sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend code');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    if (code.length !== 6) {
      setError('Enter the 6-digit code from your email');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await resetPassword(email.trim(), code, newPassword);
      completeEmailVerification(result.accessToken, result.refreshToken, result.user);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed');
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
            {step === 'request' ? (
              <Mail className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <KeyRound className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            )}
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
            {step === 'request' ? 'Forgot your password?' : 'Reset your password'}
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            {step === 'request'
              ? "Enter your email and we'll send you a 6-digit code to reset your password."
              : (
                <>
                  We sent a code to <strong className="text-gray-700 dark:text-gray-300">{email}</strong>.
                  Enter it below along with your new password.
                </>
              )}
          </p>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 p-3.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-600 dark:text-red-400"
          >
            {error}
          </motion.div>
        )}
        {info && !error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 p-3.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-sm text-emerald-700 dark:text-emerald-300"
          >
            {info}
          </motion.div>
        )}

        {step === 'request' ? (
          <form onSubmit={handleRequest} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className={inputClass}
                placeholder="you@example.com"
              />
            </div>
            <motion.button
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={isSubmitting || !email.trim()}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? <LoadingAnimation size="sm" /> : 'Send reset code'}
            </motion.button>
          </form>
        ) : (
          <form onSubmit={handleReset} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Reset code
              </label>
              <input
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="w-full px-4 py-3 text-center text-2xl tracking-[0.5em] font-mono bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 text-gray-900 dark:text-white transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">New password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  required
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Confirm new password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className={inputClass}
                placeholder="Re-enter new password"
              />
            </div>
            <motion.button
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={isSubmitting || code.length !== 6 || !newPassword}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? <LoadingAnimation size="sm" /> : 'Reset password & sign in'}
            </motion.button>
          </form>
        )}

        <div className="mt-6 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to login
          </button>
          {step === 'verify' && (
            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0 || isSubmitting}
              className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 disabled:text-gray-400 dark:disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
