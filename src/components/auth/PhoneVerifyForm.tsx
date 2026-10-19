import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { sendPhoneCode, verifyPhoneCode } from '../../services/api';
import { LoadingAnimation } from '../ui/LoadingAnimation';

const COOLDOWN_SECONDS = 60;

interface PhoneVerifyFormProps {
  initialPhone?: string;
  /** Called after the server saved the number; parent refreshes the user. */
  onVerified: () => void | Promise<void>;
  /** Smaller inputs for the Settings card. */
  compact?: boolean;
}

/**
 * Two-step mobile verification: enter a 10-digit Indian mobile, get a
 * 6-digit code on WhatsApp, enter it. Shared by VerifyPhonePage (the
 * mandatory gate) and the Mobile number section in Settings.
 */
export function PhoneVerifyForm({ initialPhone = '', onVerified, compact = false }: PhoneVerifyFormProps) {
  const [phone, setPhone] = useState(initialPhone.replace(/\D/g, '').slice(-10));
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phoneMasked, setPhoneMasked] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  const validPhone = /^[6-9]\d{9}$/.test(phone);

  const send = async () => {
    setError('');
    if (!validPhone) {
      setError('Enter a valid 10-digit Indian mobile number');
      return;
    }
    setBusy(true);
    try {
      const res = await sendPhoneCode(phone);
      setPhoneMasked(res.phoneMasked);
      setCode('');
      setStep('code');
      setCooldown(COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (code.length !== 6) {
      setError('Enter the 6-digit code from WhatsApp');
      return;
    }
    setBusy(true);
    try {
      await verifyPhoneCode(code);
      await onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  };

  const pad = compact ? 'py-2.5' : 'py-3';
  const inputBase = `w-full px-4 ${pad} bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 text-gray-900 dark:text-white transition-all placeholder:text-gray-400`;
  const buttonBase = `w-full ${compact ? 'py-2.5' : 'py-3.5'} bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`;

  return (
    <div className="space-y-4">
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </motion.div>
      )}

      {step === 'phone' ? (
        <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Mobile number (WhatsApp)</label>
            <div className="flex gap-2">
              <span className={`px-3 ${pad} bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-600 dark:text-gray-300 font-medium`}>+91</span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="98765 43210"
                className={inputBase}
              />
            </div>
          </div>
          <motion.button whileTap={{ scale: 0.98 }} type="submit" disabled={busy || !validPhone} className={buttonBase}>
            {busy ? <LoadingAnimation size="sm" /> : 'Send code on WhatsApp'}
          </motion.button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            We sent a 6-digit code on WhatsApp to <strong className="text-gray-700 dark:text-gray-300">{phoneMasked}</strong>. It expires in 10 minutes.
          </p>
          <input
            ref={codeRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            className={`${inputBase} text-center ${compact ? 'text-xl' : 'text-2xl'} tracking-[0.5em] font-mono`}
          />
          <motion.button whileTap={{ scale: 0.98 }} type="submit" disabled={busy || code.length !== 6} className={buttonBase}>
            {busy ? <LoadingAnimation size="sm" /> : 'Verify mobile'}
          </motion.button>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => { setStep('phone'); setError(''); }}
              className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Change number
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={cooldown > 0 || busy}
              className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 disabled:text-gray-400 dark:disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
