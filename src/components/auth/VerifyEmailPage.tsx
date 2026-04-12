import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Mail, ArrowLeft, RefreshCw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { verifyEmailCode, resendVerificationCode } from '../../services/api';
import { LoadingAnimation } from '../ui/LoadingAnimation';

interface VerifyEmailPageProps {
  email: string;
  onBack: () => void;
  onVerified: () => void;
}

const COOLDOWN_SECONDS = 60;

/**
 * Six-digit OTP verification page shown after password-based signup (or
 * when login is blocked pending verification). Calls POST /api/auth/verify-email,
 * then hands the returned tokens to AuthContext.completeEmailVerification so
 * the app reroutes into the authenticated view.
 */
export function VerifyEmailPage({ email, onBack, onVerified }: VerifyEmailPageProps) {
  const { completeEmailVerification } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(COOLDOWN_SECONDS);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (code.length !== 6) {
      setError('Enter the 6-digit code from your email');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await verifyEmailCode(email, code);
      completeEmailVerification(result.accessToken, result.refreshToken, result.user);
      onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setError('');
    setResending(true);
    try {
      await resendVerificationCode(email);
      setCooldown(COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend code');
    } finally {
      setResending(false);
    }
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
          <img src="/logoAI.png" alt="Smartbiz AI" className="w-10 h-10 object-contain" />
          <span className="text-xl font-bold text-gray-800 dark:text-white">Smartbiz AI</span>
        </div>

        <div className="mb-8">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center mb-5">
            <Mail className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Check your email</h1>
          <p className="text-gray-500 dark:text-gray-400">
            We sent a 6-digit code to <strong className="text-gray-700 dark:text-gray-300">{email}</strong>. It expires in 10 minutes.
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

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Verification code
            </label>
            <input
              ref={inputRef}
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

          <motion.button
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={isSubmitting || code.length !== 6}
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSubmitting ? <LoadingAnimation size="sm" /> : 'Verify & Continue'}
          </motion.button>
        </form>

        <div className="mt-6 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0 || resending}
            className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 disabled:text-gray-400 dark:disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
          >
            {resending ? (
              <LoadingAnimation size="sm" />
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
