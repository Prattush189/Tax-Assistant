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
  type BillingDetails,
} from '../../services/api';
import { BillingDetailsDialog } from './BillingDetailsDialog';
import { SwitchPlanWarningDialog } from './SwitchPlanWarningDialog';
import {
  Check,
  Crown,
  Building2,
  Sparkles,
  Shield,
  Loader2,
  AlertCircle,
  Clock,
  BadgeCheck,
  Download,
  X,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { generatePaymentReceipt, generatePaymentInvoice, type PaymentData } from '../../lib/paymentPdf';

// ── Pricing ──────────────────────────────────────────────────────────────────

const PRICES = {
  pro:        { monthly: 500,  yearly: 5700  },
  enterprise: { monthly: 750,  yearly: 8550  },
} as const;

const GST_PCT = 18;
const GST_RATE = GST_PCT / 100;

function gstAmount(basePrice: number): number {
  return Math.round(basePrice * GST_RATE);
}

function totalWithGst(basePrice: number): number {
  return basePrice + gstAmount(basePrice);
}

function yearlySaving(plan: 'pro' | 'enterprise'): number {
  return PRICES[plan].monthly * 12 - PRICES[plan].yearly;
}

function yearlyDiscountPct(plan: 'pro' | 'enterprise'): number {
  return Math.round((yearlySaving(plan) / (PRICES[plan].monthly * 12)) * 100);
}

// ── Plan definitions ──────────────────────────────────────────────────────────

// Per-feature lines are kept short and scannable — one quota or
// capability per bullet. Strings starting with "Everything in" get
// rendered as a divider, not a bullet, so users see at a glance that
// higher tiers stack on top of lower tiers.
// Feature lists are now capability-only — no per-month counts. The
// single token budget (250K / 2M / 6M) is what gates total usage,
// shown in Settings → Your Usage and on each feature's landing page.
// Plan tiers differ in (a) which features are unlocked and (b) the
// size of the shared token pool.
const plans = [
  {
    id: 'free' as const,
    name: 'Free',
    description: '30-day trial — try every general-purpose feature',
    icon: Sparkles,
    features: [
      'AI tax chat assistant',
      'Document uploads',
      'AI tax-saving suggestions',
      'Notice draft generator',
      'Board resolution generator',
      'Partnership deed generator',
      'Bank Statement Analyzer',
      'AI Ledger Scrutiny',
      'All tax calculators (Income Tax, CG, GST, TDS)',
      'Rent receipts + Challan 280',
      'Saved tax profile',
    ],
    gradient: 'from-gray-500 to-gray-600',
    shadow: 'shadow-gray-500/20',
    ring: 'ring-gray-300 dark:ring-gray-600',
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    description: 'For professionals who need the analyzers',
    icon: Crown,
    features: [
      'Everything in Free, plus:',
      '8× the monthly capacity (across every feature)',
      'Salary Structure Optimizer',
      'Tax Planning PDF report',
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
      'Everything in Pro, plus:',
      '24× the monthly capacity (across every feature)',
      'IT portal profile import',
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

// ── PaymentSuccessDialog ──────────────────────────────────────────────────────

const GST_RATE_DIALOG = 0.18;

function PaymentSuccessDialog({
  payment,
  userName,
  userEmail,
  billingDetails,
  onClose,
}: {
  payment: PaymentData;
  userName: string;
  userEmail: string;
  billingDetails: BillingDetails | null;
  onClose: () => void;
}) {
  const total    = payment.amount / 100;
  const base     = Math.round(total / (1 + GST_RATE_DIALOG) * 100) / 100;
  const gst      = Math.round((total - base) * 100) / 100;
  const planName = payment.plan === 'pro' ? 'Pro' : 'Enterprise';
  const cycle    = payment.billing === 'monthly' ? 'Monthly' : 'Yearly';
  const receiptNo = 'AI-' + payment.id.slice(0, 10).toUpperCase();

  const userInfo = {
    name: userName, email: userEmail,
    ...(billingDetails ?? {}),
  };
  const handleReceipt = () => generatePaymentReceipt(payment, userInfo);
  const handleInvoice = () => generatePaymentInvoice(payment, userInfo);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Success icon */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-[#0D9668]/10 dark:bg-[#0D9668]/20 flex items-center justify-center">
            <CheckCircle2 className="w-9 h-9 text-[#0D9668] dark:text-[#2DD4A0]" />
          </div>
        </div>

        <h2 className="text-xl font-bold text-center text-gray-800 dark:text-white mb-1">
          Payment Successful!
        </h2>
        <p className="text-sm text-center text-gray-500 dark:text-gray-400 mb-5">
          Your {planName} plan is now active.
        </p>

        {/* Receipt card */}
        <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-4 mb-5 space-y-2.5">
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-500 dark:text-gray-400">Receipt No.</span>
            <span className="text-xs font-mono font-semibold text-gray-700 dark:text-gray-200">{receiptNo}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-500 dark:text-gray-400">Plan</span>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{planName} · {cycle}</span>
          </div>
          <div className="border-t border-dashed border-gray-200 dark:border-gray-700 pt-2.5 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">Base amount</span>
              <span className="text-xs text-gray-700 dark:text-gray-300">₹{base.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">IGST @ 18%</span>
              <span className="text-xs text-gray-700 dark:text-gray-300">₹{gst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-gray-200 dark:border-gray-700">
              <span className="text-sm font-bold text-gray-800 dark:text-white">Total Paid</span>
              <span className="text-sm font-bold text-[#0D9668] dark:text-[#2DD4A0]">₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>

        {/* Download buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handleReceipt}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#0D9668]/10 dark:bg-[#0D9668]/20 text-[#0D9668] dark:text-[#2DD4A0] rounded-xl text-sm font-semibold hover:bg-[#0D9668]/20 dark:hover:bg-[#0D9668]/30 transition-colors"
          >
            <Download className="w-4 h-4" />
            Receipt
          </button>
          <button
            onClick={handleInvoice}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-xl text-sm font-semibold hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
          >
            <Download className="w-4 h-4" />
            Tax Invoice
          </button>
        </div>

        <p className="text-xs text-center text-gray-400 dark:text-gray-500 mt-4">
          You can also download these later from Settings → Billing
        </p>
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
  const [successPayment, setSuccessPayment] = useState<PaymentData | null>(null);
  const [showBillingDialog, setShowBillingDialog] = useState<'pro' | 'enterprise' | null>(null);
  const [lastBillingDetails, setLastBillingDetails] = useState<BillingDetails | null>(null);
  // Plan-switch warning. When the user is already on a different paid
  // plan and clicks the other one's button, show a confirmation modal
  // explaining that the existing subscription will be cancelled. Only
  // gated when current and target are BOTH paid (free → paid never
  // hits this).
  const [pendingSwitch, setPendingSwitch] = useState<'pro' | 'enterprise' | null>(null);

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

      const basePrice = PRICES[planId][billing];
      const gst       = gstAmount(basePrice);
      const total     = totalWithGst(basePrice);
      const period    = billing === 'monthly' ? 'month' : 'year';

      const options = {
        key: sub.keyId,
        subscription_id: sub.subscriptionId,
        name: 'Smartbiz AI',
        description: `${planId === 'pro' ? 'Pro' : 'Enterprise'} · ₹${basePrice.toLocaleString('en-IN')} + ₹${gst.toLocaleString('en-IN')} GST (${GST_PCT}%) = ₹${total.toLocaleString('en-IN')}/${period}`,
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
            // Show success dialog with latest paid payment
            const latest = freshHistory.payments.find(p => p.status === 'paid');
            if (latest) setSuccessPayment(latest);
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
      {/* Switch-plan warning — only when going Pro ↔ Enterprise */}
      {pendingSwitch && (
        <SwitchPlanWarningDialog
          fromPlan={currentPlan === 'pro' ? 'Pro' : 'Enterprise'}
          toPlan={pendingSwitch === 'pro' ? 'Pro' : 'Enterprise'}
          onConfirm={() => {
            const target = pendingSwitch;
            setPendingSwitch(null);
            setShowBillingDialog(target);
          }}
          onCancel={() => setPendingSwitch(null)}
        />
      )}

      {/* Billing details dialog — shown before Razorpay opens */}
      {showBillingDialog && (
        <BillingDetailsDialog
          planName={showBillingDialog === 'pro' ? 'Pro' : 'Enterprise'}
          userEmail={user?.email ?? ''}
          onConfirm={(details) => {
            setLastBillingDetails(details);
            setShowBillingDialog(null);
            void handlePay(showBillingDialog);
          }}
          onCancel={() => setShowBillingDialog(null)}
        />
      )}

      {/* Payment success dialog */}
      {successPayment && (
        <PaymentSuccessDialog
          payment={successPayment}
          userName={user?.name ?? ''}
          userEmail={user?.email ?? ''}
          billingDetails={lastBillingDetails}
          onClose={() => setSuccessPayment(null)}
        />
      )}

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
              Save 5%
            </span>
          </button>
        </div>

        {/* Tax note */}
        <p className="text-xs text-center text-gray-400 dark:text-gray-500 -mt-5 mb-8">
          All prices are exclusive of {GST_PCT}% GST
        </p>

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
                      <>
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-bold text-gray-800 dark:text-white">
                            ₹{monthlyPrice.toLocaleString('en-IN')}
                          </span>
                          <span className="text-sm text-gray-500 dark:text-gray-400">/month</span>
                        </div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          Excl. {GST_PCT}% GST · Total ₹{totalWithGst(monthlyPrice).toLocaleString('en-IN')}/month
                        </p>
                      </>
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
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          Excl. {GST_PCT}% GST · Total ₹{totalWithGst(yearlyPrice).toLocaleString('en-IN')}/year
                        </p>
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

                {/* Features. "Everything in X, plus:" lines render as
                    a faint divider rather than a checkmark bullet so
                    the eye can break the list into "inherited" vs
                    "tier-specific" without rereading every item. */}
                <ul className="space-y-2.5 mb-6 flex-1">
                  {plan.features.map((feature, i) => {
                    const isInheritance = /^Everything in /i.test(feature);
                    // Lines starting with "Nx" (e.g. "3× the monthly capacity")
                    // render as a colored highlight badge so the value-prop
                    // headline of higher tiers reads at a glance.
                    const isHighlight = /^\d+×/.test(feature);
                    if (isInheritance) {
                      return (
                        <li key={i} className="text-xs font-medium text-gray-400 dark:text-gray-500 italic pt-1 pb-0.5">
                          {feature}
                        </li>
                      );
                    }
                    if (isHighlight) {
                      return (
                        <li key={i} className="flex items-start gap-2 text-sm font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 px-2.5 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800">
                          <span className="text-indigo-500 dark:text-indigo-400">★</span>
                          <span>{feature}</span>
                        </li>
                      );
                    }
                    return (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <Check className={cn(
                          'w-4 h-4 shrink-0 mt-0.5',
                          isCurrent ? 'text-[#0D9668]' : 'text-gray-400'
                        )} />
                        <span>{feature}</span>
                      </li>
                    );
                  })}
                </ul>

                {/* CTA Button */}
                {isCurrent ? (
                  <div className="w-full py-3 text-center text-sm font-semibold text-[#0A7B55] dark:text-[#2DD4A0] bg-[#0D9668]/10 dark:bg-[#0A7B55]/10 rounded-xl flex items-center justify-center gap-2">
                    <BadgeCheck className="w-4 h-4" />
                    Current Plan
                  </div>
                ) : isPaid ? (
                  <button
                    onClick={() => {
                      const target = plan.id as 'pro' | 'enterprise';
                      // If user is already on a different paid plan,
                      // intercept with the switch-warning modal so we
                      // can tell them the old sub will be cancelled.
                      // Free / cancelled users skip this and go
                      // straight to the billing-details dialog.
                      if ((currentPlan === 'pro' || currentPlan === 'enterprise') && currentPlan !== target) {
                        setPendingSwitch(target);
                      } else {
                        setShowBillingDialog(target);
                      }
                    }}
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
                        {currentPlan === 'pro' || currentPlan === 'enterprise'
                          ? `Switch to ${plan.name}`
                          : `Upgrade to ${plan.name}`}
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
