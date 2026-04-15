import { useState, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { createSubscription, verifySubscriptionPayment, fetchUserUsage } from '../../services/api';
import { Crown, Building2, Shield, Loader2, AlertCircle, Lock } from 'lucide-react';
import { cn } from '../../lib/utils';

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

const PLANS = [
  {
    id: 'pro' as const,
    name: 'Pro',
    icon: Crown,
    monthly: 400,
    yearly: 3600,
    gradient: 'from-[#0D9668] to-[#0A7B55]',
    shadow: 'shadow-[#0D9668]/30',
    features: ['1,500 chats/month', '15 board resolutions/month', 'Salary optimizer', 'Tax planning PDF'],
  },
  {
    id: 'enterprise' as const,
    name: 'Enterprise',
    icon: Building2,
    monthly: 700,
    yearly: 6000,
    gradient: 'from-indigo-500 to-purple-600',
    shadow: 'shadow-indigo-500/30',
    features: ['3,000 chats/month', '50 board resolutions/month', '10-seat team', 'Priority SLA'],
  },
];

export function TrialExpiredWall() {
  const { user, refreshUser } = useAuth();
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [paying, setPaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePay = useCallback(async (planId: 'pro' | 'enterprise') => {
    setError(null);
    setPaying(planId);

    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        setError('Could not load payment gateway. Check your connection and try again.');
        setPaying(null);
        return;
      }

      const sub = await createSubscription(planId, billing);

      const options = {
        key: sub.keyId,
        subscription_id: sub.subscriptionId,
        name: 'Smartbiz AI',
        description: `${planId === 'pro' ? 'Pro' : 'Enterprise'} · ₹${(billing === 'monthly' ? PLANS.find(p => p.id === planId)!.monthly : PLANS.find(p => p.id === planId)!.yearly).toLocaleString('en-IN')}/${billing === 'monthly' ? 'month' : 'year'} · Auto-renews · Cancel any time`,
        prefill: { name: user?.name ?? '', email: user?.email ?? '' },
        theme: { color: '#0D9668' },
        modal: { ondismiss: () => setPaying(null) },
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
            // Wall disappears automatically once refreshUser() updates plan to paid
            await fetchUserUsage();
          } catch {
            setError('Payment received but activation failed. Please contact support.');
          } finally {
            setPaying(null);
          }
        },
      };

      const rzp = new (window as unknown as { Razorpay: new (opts: unknown) => { open(): void } }).Razorpay(options);
      rzp.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed. Please try again.');
      setPaying(null);
    }
  }, [billing, user, refreshUser]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/95 backdrop-blur-md p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-gray-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Your Free Trial Has Ended</h1>
          <p className="text-gray-400 text-sm">
            Your 30-day trial is over. Upgrade to keep all your data, chats, and continue working.
          </p>
        </div>

        {/* Billing Toggle */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <button
            onClick={() => setBilling('monthly')}
            className={cn(
              'px-5 py-2 rounded-xl text-sm font-semibold transition-all',
              billing === 'monthly'
                ? 'bg-[#0D9668] text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            )}
          >
            Monthly
          </button>
          <button
            onClick={() => setBilling('yearly')}
            className={cn(
              'px-5 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2',
              billing === 'yearly'
                ? 'bg-[#0D9668] text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            )}
          >
            Yearly
            <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">Save 25–29%</span>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 bg-red-900/30 border border-red-800 rounded-2xl px-4 py-3 mb-5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Plan Cards */}
        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          {PLANS.map((plan) => {
            const isPaying = paying === plan.id;
            const price = billing === 'monthly' ? plan.monthly : plan.yearly;
            const period = billing === 'monthly' ? '/month' : '/year';
            const yearSaving = plan.monthly * 12 - plan.yearly;
            const Icon = plan.icon;

            return (
              <div
                key={plan.id}
                className="bg-gray-900 border border-gray-700 rounded-2xl p-5 flex flex-col"
              >
                <div className={cn(
                  'w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center mb-3',
                  plan.gradient
                )}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">{plan.name}</h3>

                <div className="mb-3">
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-white">₹{price.toLocaleString('en-IN')}</span>
                    <span className="text-sm text-gray-400">{period}</span>
                  </div>
                  {billing === 'yearly' && (
                    <p className="text-xs text-[#2DD4A0] font-semibold mt-0.5">
                      Save ₹{yearSaving.toLocaleString('en-IN')}/year
                    </p>
                  )}
                </div>

                <ul className="space-y-1.5 mb-4 flex-1">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-gray-300">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#0D9668] shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handlePay(plan.id)}
                  disabled={!!paying}
                  className={cn(
                    'w-full py-2.5 text-sm font-semibold text-white rounded-xl transition-all flex items-center justify-center gap-2',
                    `bg-gradient-to-r ${plan.gradient} ${plan.shadow} shadow-lg hover:opacity-90`,
                    paying && 'opacity-60 cursor-not-allowed'
                  )}
                >
                  {isPaying ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Opening Payment…</>
                  ) : (
                    <><Shield className="w-4 h-4" /> Upgrade to {plan.name}</>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-gray-500">
          Payments secured by Razorpay · 256-bit SSL · Cancel any time
        </p>
      </div>
    </div>
  );
}
