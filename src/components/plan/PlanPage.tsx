import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  fetchUserUsage,
  fetchPaymentHistory,
  PaymentHistoryResponse,
  UserUsageResponse,
  createSubscription,
  verifySubscriptionPayment,
  cancelSubscription,
} from '../../services/api';
import {
  Check,
  Crown,
  Building2,
  Sparkles,
  MessageSquare,
  Paperclip,
  Lightbulb,
  FileText,
  User,
  TrendingUp,
  Shield,
  Loader2,
  AlertCircle,
  Clock,
  BadgeCheck,
  FileSignature,
} from 'lucide-react';
import { cn } from '../../lib/utils';

// ── Pricing ──────────────────────────────────────────────────────────────────

const PRICES = {
  pro:        { monthly: 400,  yearly: 3600  },
  enterprise: { monthly: 700,  yearly: 6000  },
} as const;

function yearlySaving(plan: 'pro' | 'enterprise'): number {
  return PRICES[plan].monthly * 12 - PRICES[plan].yearly;
}

function yearlyDiscountPct(plan: 'pro' | 'enterprise'): number {
  return Math.round((yearlySaving(plan) / (PRICES[plan].monthly * 12)) * 100);
}

// ── Plan definitions ──────────────────────────────────────────────────────────

const plans = [
  {
    id: 'free' as const,
    name: 'Free',
    description: '30-day trial — every feature included',
    icon: Sparkles,
    features: [
      '50 chat messages (trial)',
      '5 document uploads',
      'All AI features included',
      'All tax calculators (Income Tax, CG, GST, TDS)',
      'Rent receipt & Challan 280 generator',
      '20 AI suggestions',
      'Income Tax Acts 1961 & 2025 references',
      '1 saved profile',
      '3 notice drafts',
      '3 board resolutions',
      'Valid for 30 days from signup',
    ],
    gradient: 'from-gray-500 to-gray-600',
    shadow: 'shadow-gray-500/20',
    ring: 'ring-gray-300 dark:ring-gray-600',
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    description: 'For professionals who need more power',
    icon: Crown,
    features: [
      '1,500 chat messages/month',
      '30 document uploads/month',
      'Everything in Free, plus:',
      'Salary Structure Optimizer',
      'Tax Planning PDF report',
      'PDF export of computations',
      '100 AI suggestions/month',
      '5 saved profiles',
      '15 notice drafts/month',
      '15 board resolutions/month',
      'Writing style customization',
      'Priority support',
    ],
    gradient: 'from-[#0D9668] to-[#0A7B55]',
    shadow: 'shadow-[#0D9668]/20',
    ring: 'ring-[#0D9668] dark:ring-[#0A7B55]',
    popular: true,
  },
  {
    id: 'enterprise' as const,
    name: 'Enterprise',
    description: 'For CA firms and businesses',
    icon: Building2,
    features: [
      '3,000 chat messages/month',
      '200 document uploads/month',
      'Everything in Pro, plus:',
      'Board resolution generator',
      'IT portal profile import',
      '500 AI suggestions/month',
      '25 saved profiles',
      '50 notice drafts/month',
      '50 board resolutions/month',
      'Multi-user team accounts (10 seats)',
      'Year-over-year trends dashboard',
      'Priority support & SLA',
    ],
    gradient: 'from-indigo-500 to-purple-600',
    shadow: 'shadow-indigo-500/20',
    ring: 'ring-indigo-400 dark:ring-indigo-500',
  },
];

// ── Razorpay loader ───────────────────────────────────────────────────────────

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if ((window as unknown as Record<string, unknown>).Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

// ── UsageBar ─────────────────────────────────────────────────────────────────

interface UsageBarProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  used: number;
  limit: number;
  period?: 'day' | 'month' | 'total';
}

function UsageBar({ icon: Icon, label, used, limit, period }: UsageBarProps) {
  const percentage = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  const getColor = (pct: number) => {
    if (pct >= 90) return 'bg-red-500';
    if (pct >= 75) return 'bg-amber-500';
    if (pct >= 50) return 'bg-yellow-500';
    return 'bg-[#0D9668] dark:bg-[#2DD4A0]';
  };

  // Period label intentionally omitted — context shown in section header instead
  const periodLabel = period === 'day' ? '/day' : '';

  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-[#0D9668]/10 dark:bg-[#0D9668]/20 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-[#0D9668] dark:text-[#2DD4A0]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate">{label}</p>
          <p className="text-sm font-bold text-gray-800 dark:text-white">
            {used.toLocaleString('en-IN')} / {limit.toLocaleString('en-IN')}
            <span className="text-xs font-normal text-gray-400 ml-1">{periodLabel}</span>
          </p>
        </div>
        <span className={cn(
          'text-xs font-bold shrink-0',
          percentage >= 90 ? 'text-red-600 dark:text-red-400' :
          percentage >= 75 ? 'text-amber-600 dark:text-amber-400' :
          'text-gray-500 dark:text-gray-400'
        )}>
          {percentage.toFixed(0)}%
        </span>
      </div>
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500 ease-out', getColor(percentage))}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

// ── TrialBanner ───────────────────────────────────────────────────────────────

function TrialBanner({ daysLeft, onUpgrade }: { daysLeft: number; onUpgrade: () => void }) {
  const urgent = daysLeft <= 5;
  return (
    <div className={cn(
      'flex items-center gap-3 rounded-2xl px-5 py-4 mb-6 border',
      urgent
        ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
        : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
    )}>
      <Clock className={cn('w-5 h-5 shrink-0', urgent ? 'text-red-500' : 'text-amber-500')} />
      <p className={cn('text-sm font-medium flex-1', urgent ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300')}>
        {daysLeft === 0
          ? 'Your free trial has expired.'
          : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your free trial.`}
        {' '}Upgrade to keep access to all features.
      </p>
      <button
        onClick={onUpgrade}
        className={cn(
          'text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0',
          urgent
            ? 'bg-red-500 text-white hover:bg-red-600'
            : 'bg-amber-500 text-white hover:bg-amber-600'
        )}
      >
        Upgrade Now
      </button>
    </div>
  );
}

// ── Main PlanPage ─────────────────────────────────────────────────────────────

export function PlanPage() {
  const { user, refreshUser } = useAuth();
  const currentPlan = user?.plan || 'free';
  const [usage, setUsage] = useState<UserUsageResponse | null>(null);
  const [history, setHistory] = useState<PaymentHistoryResponse | null>(null);
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [paying, setPaying] = useState<string | null>(null); // 'pro' | 'enterprise'
  const [payError, setPayError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelMsg, setCancelMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchUserUsage()
      .then(setUsage)
      .catch((err) => console.error('Failed to fetch usage:', err));
    fetchPaymentHistory()
      .then(setHistory)
      .catch((err) => console.error('Failed to fetch payment history:', err));
  }, []);

  const scrollToPlans = () => {
    document.getElementById('plan-cards')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handlePay = useCallback(async (planId: 'pro' | 'enterprise') => {
    setPayError(null);
    setPaying(planId);

    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        setPayError('Could not load payment gateway. Please check your connection and try again.');
        setPaying(null);
        return;
      }

      const sub = await createSubscription(planId, billing);

      const options = {
        key: sub.keyId,
        subscription_id: sub.subscriptionId,
        name: 'Smartbiz AI',
        description: `${planId === 'pro' ? 'Pro' : 'Enterprise'} · ₹${PRICES[planId][billing].toLocaleString('en-IN')}/${billing === 'monthly' ? 'month' : 'year'} · Auto-renews · Cancel any time`,
        prefill: {
          name: user?.name ?? '',
          email: user?.email ?? '',
        },
        theme: { color: '#0D9668' },
        modal: {
          ondismiss: () => setPaying(null),
        },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_subscription_id: string;
          razorpay_signature: string;
        }) => {
          try {
            await verifySubscriptionPayment({
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_subscription_id: response.razorpay_subscription_id,
              razorpay_signature: response.razorpay_signature,
              plan: planId,
              billing,
            });
            await refreshUser();
            const [freshUsage, freshHistory] = await Promise.all([fetchUserUsage(), fetchPaymentHistory()]);
            setUsage(freshUsage);
            setHistory(freshHistory);
          } catch {
            setPayError('Payment was received but activation failed. Please contact support.');
          } finally {
            setPaying(null);
          }
        },
      };

      const rzp = new (window as unknown as { Razorpay: new (opts: unknown) => { open(): void } }).Razorpay(options);
      rzp.open();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Payment failed';
      setPayError(msg);
      setPaying(null);
    }
  }, [billing, user, refreshUser]);

  const handleCancel = useCallback(async () => {
    if (!window.confirm('Cancel your subscription? Your plan stays active until the current billing period ends, then downgrades to Free.')) return;
    setCancelling(true);
    setCancelMsg(null);
    try {
      const result = await cancelSubscription();
      setCancelMsg(result.message);
      await refreshUser();
      const freshHistory = await fetchPaymentHistory();
      setHistory(freshHistory);
    } catch (err) {
      setCancelMsg(err instanceof Error ? err.message : 'Could not cancel. Please try again.');
    } finally {
      setCancelling(false);
    }
  }, [refreshUser]);

  const trialDaysLeft = usage?.trialDaysLeft ?? null;
  const showTrialBanner = currentPlan === 'free' && trialDaysLeft !== null && trialDaysLeft <= 10;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">Choose Your Plan</h1>
          <p className="text-gray-500 dark:text-gray-400 text-lg">
            Simple, transparent pricing — upgrade or cancel any time
          </p>
        </div>

        {/* Trial Banner */}
        {showTrialBanner && (
          <TrialBanner daysLeft={trialDaysLeft!} onUpgrade={scrollToPlans} />
        )}

        {/* Billing Toggle */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <button
            onClick={() => setBilling('monthly')}
            className={cn(
              'px-5 py-2 rounded-xl text-sm font-semibold transition-all',
              billing === 'monthly'
                ? 'bg-[#0D9668] text-white shadow-md'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            )}
          >
            Monthly
          </button>
          <button
            onClick={() => setBilling('yearly')}
            className={cn(
              'px-5 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2',
              billing === 'yearly'
                ? 'bg-[#0D9668] text-white shadow-md'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            )}
          >
            Yearly
            <span className={cn(
              'text-xs px-2 py-0.5 rounded-full font-bold',
              billing === 'yearly'
                ? 'bg-white/20 text-white'
                : 'bg-[#0D9668]/10 text-[#0D9668] dark:bg-[#0D9668]/20 dark:text-[#2DD4A0]'
            )}>
              Save up to 29%
            </span>
          </button>
        </div>

        {/* Payment Error */}
        {payError && (
          <div className="flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl px-5 py-4 mb-6">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-300">{payError}</p>
            <button onClick={() => setPayError(null)} className="ml-auto text-red-400 hover:text-red-600 text-xs">Dismiss</button>
          </div>
        )}

        {/* Plan Cards */}
        <div id="plan-cards" className="grid md:grid-cols-3 gap-6 mb-10">
          {plans.map((plan) => {
            const isCurrent = currentPlan === plan.id;
            const isPaid = plan.id === 'pro' || plan.id === 'enterprise';
            const isPaying = paying === plan.id;
            const Icon = plan.icon;

            const monthlyPrice = isPaid ? PRICES[plan.id as 'pro' | 'enterprise'].monthly : 0;
            const yearlyPrice  = isPaid ? PRICES[plan.id as 'pro' | 'enterprise'].yearly  : 0;
            const saving = isPaid ? yearlySaving(plan.id as 'pro' | 'enterprise') : 0;
            const discountPct = isPaid ? yearlyDiscountPct(plan.id as 'pro' | 'enterprise') : 0;

            return (
              <div
                key={plan.id}
                className={cn(
                  'relative bg-white dark:bg-gray-900 rounded-2xl border-2 p-6 transition-all flex flex-col',
                  isCurrent
                    ? `${plan.ring} ring-2`
                    : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700',
                  plan.popular && !isCurrent && 'border-[#0D9668]/50 dark:border-[#0A7B55]/50'
                )}
              >
                {/* Popular badge */}
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-gradient-to-r from-[#0D9668] to-[#0A7B55] text-white text-xs font-bold rounded-full whitespace-nowrap">
                    MOST POPULAR
                  </div>
                )}

                {/* Icon */}
                <div className={cn(
                  'w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center mb-4',
                  plan.gradient
                )}>
                  <Icon className="w-6 h-6 text-white" />
                </div>

                {/* Name & Description */}
                <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-1">{plan.name}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{plan.description}</p>

                {/* Pricing */}
                {isPaid ? (
                  <div className="mb-4">
                    {billing === 'monthly' ? (
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-bold text-gray-800 dark:text-white">
                          ₹{monthlyPrice.toLocaleString('en-IN')}
                        </span>
                        <span className="text-sm text-gray-500 dark:text-gray-400">/month</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-bold text-gray-800 dark:text-white">
                            ₹{yearlyPrice.toLocaleString('en-IN')}
                          </span>
                          <span className="text-sm text-gray-500 dark:text-gray-400">/year</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-gray-400 dark:text-gray-500 line-through">
                            ₹{(monthlyPrice * 12).toLocaleString('en-IN')}/year
                          </span>
                          <span className="text-xs font-bold text-[#0D9668] dark:text-[#2DD4A0] bg-[#0D9668]/10 dark:bg-[#0D9668]/20 px-2 py-0.5 rounded-full">
                            Save ₹{saving.toLocaleString('en-IN')} ({discountPct}% off)
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="mb-4">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-gray-800 dark:text-white">Free</span>
                    </div>
                    <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-1">
                      30-day trial · No card required
                    </p>
                  </div>
                )}

                {/* Features */}
                <ul className="space-y-2.5 mb-6 flex-1">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <Check className={cn(
                        'w-4 h-4 shrink-0 mt-0.5',
                        isCurrent ? 'text-[#0D9668]' : 'text-gray-400'
                      )} />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA Button */}
                {isCurrent ? (
                  <div className="w-full py-3 text-center text-sm font-semibold text-[#0A7B55] dark:text-[#2DD4A0] bg-[#0D9668]/10 dark:bg-[#0A7B55]/10 rounded-xl flex items-center justify-center gap-2">
                    <BadgeCheck className="w-4 h-4" />
                    Current Plan
                  </div>
                ) : isPaid ? (
                  <button
                    onClick={() => handlePay(plan.id as 'pro' | 'enterprise')}
                    disabled={!!paying}
                    className={cn(
                      'w-full py-3 text-center text-sm font-semibold text-white rounded-xl transition-all flex items-center justify-center gap-2',
                      `bg-gradient-to-r ${plan.gradient} hover:opacity-90 ${plan.shadow} shadow-lg`,
                      paying && 'opacity-60 cursor-not-allowed'
                    )}
                  >
                    {isPaying ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Opening Payment…
                      </>
                    ) : (
                      <>
                        <Shield className="w-4 h-4" />
                        Upgrade to {plan.name}
                      </>
                    )}
                  </button>
                ) : (
                  <div className="w-full py-3 text-center text-sm font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-xl">
                    Current Trial Plan
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Security note */}
        <div className="flex items-center justify-center gap-2 text-xs text-gray-400 dark:text-gray-500 mb-10">
          <Shield className="w-3.5 h-3.5" />
          <span>Payments secured by Razorpay · 256-bit SSL encryption · Auto-renews · Cancel any time</span>
        </div>

        {/* Current Usage */}
        {usage && (
          <div className="mb-10 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-bold text-gray-800 dark:text-white">Your Usage</h2>
                  {usage.plan === 'free' && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                      <Clock className="w-3 h-3" />
                      30-day trial
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Current plan: <span className="font-semibold text-[#0D9668] dark:text-[#2DD4A0] capitalize">{usage.plan}</span>
                  {usage.planExpiresAt && (
                    <span className="ml-2 text-gray-400">
                      · Renews {new Date(usage.planExpiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  )}
                </p>
              </div>
              <TrendingUp className="w-5 h-5 text-gray-400" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <UsageBar
                icon={MessageSquare}
                label={usage.usage.messages.label}
                used={usage.usage.messages.used}
                limit={usage.usage.messages.limit}
                period={usage.usage.messages.period}
              />
              <UsageBar
                icon={Paperclip}
                label={usage.usage.attachments.label}
                used={usage.usage.attachments.used}
                limit={usage.usage.attachments.limit}
                period={usage.usage.attachments.period}
              />
              <UsageBar
                icon={Lightbulb}
                label={usage.usage.suggestions.label}
                used={usage.usage.suggestions.used}
                limit={usage.usage.suggestions.limit}
                period={usage.usage.suggestions.period}
              />
              <UsageBar
                icon={FileText}
                label={usage.usage.notices.label}
                used={usage.usage.notices.used}
                limit={usage.usage.notices.limit}
                period={usage.usage.notices.period}
              />
              <UsageBar
                icon={FileSignature}
                label={usage.usage.boardResolutions.label}
                used={usage.usage.boardResolutions.used}
                limit={usage.usage.boardResolutions.limit}
                period={usage.usage.boardResolutions.period}
              />
              <UsageBar
                icon={User}
                label={usage.usage.profiles.label}
                used={usage.usage.profiles.used}
                limit={usage.usage.profiles.limit}
                period={usage.usage.profiles.period}
              />
            </div>
          </div>
        )}

        {/* Account Info */}
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Account Details</h2>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Plan</p>
              <p className="text-lg font-bold text-gray-800 dark:text-white capitalize">{currentPlan}</p>
            </div>
            <div className="flex-1 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Email</p>
              <p className="text-lg font-bold text-gray-800 dark:text-white truncate">{user?.email}</p>
            </div>
            <div className="flex-1 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Name</p>
              <p className="text-lg font-bold text-gray-800 dark:text-white truncate">{user?.name}</p>
            </div>
          </div>
          {user?.plan_expires_at && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">
              Your {currentPlan} plan is active until{' '}
              <span className="font-semibold text-gray-600 dark:text-gray-300">
                {new Date(user.plan_expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              </span>.
            </p>
          )}

          {/* Cancel subscription — only shown when subscription is active */}
          {history?.subscriptionStatus === 'active' && (
            <div className="mt-5 pt-5 border-t border-gray-200 dark:border-gray-700">
              {cancelMsg && (
                <p className="text-sm text-amber-600 dark:text-amber-400 mb-3">{cancelMsg}</p>
              )}
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="text-sm text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 font-medium disabled:opacity-50"
              >
                {cancelling ? 'Cancelling…' : 'Cancel subscription'}
              </button>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Your plan stays active until the end of the billing period.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
