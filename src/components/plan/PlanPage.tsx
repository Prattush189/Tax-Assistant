import { useAuth } from '../../contexts/AuthContext';
import { Check, Crown, Building2, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';

const plans = [
  {
    id: 'free' as const,
    name: 'Free',
    price: 0,
    priceLabel: '₹0',
    period: '/forever',
    description: 'Get started with basic tax assistance',
    icon: Sparkles,
    features: [
      '10 messages per day',
      'Basic tax calculations',
      'Document analysis',
      'Chat history',
    ],
    gradient: 'from-slate-500 to-slate-600',
    shadow: 'shadow-slate-500/20',
    ring: 'ring-slate-300 dark:ring-slate-600',
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    price: 1000,
    priceLabel: '₹1,000',
    period: '/month',
    description: 'For professionals who need more',
    icon: Crown,
    features: [
      '1,000 messages per month',
      'Priority responses',
      'Advanced document analysis',
      'Full chat history',
      'Email support',
    ],
    gradient: 'from-[#D4A020] to-[#B8860B]',
    shadow: 'shadow-[#D4A020]/20',
    ring: 'ring-[#D4A020] dark:ring-[#B8860B]',
    popular: true,
  },
  {
    id: 'enterprise' as const,
    name: 'Enterprise',
    price: 7000,
    originalPrice: '₹10,000',
    priceLabel: '₹7,000',
    period: '/month',
    description: 'For teams and businesses',
    icon: Building2,
    features: [
      '10,000 messages per month',
      'Fastest response times',
      'Dedicated support',
      'Plugin/API access',
      'Multi-user teams',
      'Custom integrations',
    ],
    gradient: 'from-indigo-500 to-purple-600',
    shadow: 'shadow-indigo-500/20',
    ring: 'ring-indigo-400 dark:ring-indigo-500',
    discount: '30% OFF',
  },
];

export function PlanPage() {
  const { user } = useAuth();
  const currentPlan = user?.plan || 'free';

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-slate-800 dark:text-white mb-2">Choose Your Plan</h1>
          <p className="text-slate-500 dark:text-slate-400 text-lg">
            Upgrade to unlock more messages and premium features
          </p>
        </div>

        {/* Plan Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-10">
          {plans.map((plan) => {
            const isCurrent = currentPlan === plan.id;
            const Icon = plan.icon;
            return (
              <div
                key={plan.id}
                className={cn(
                  "relative bg-white dark:bg-slate-900 rounded-2xl border-2 p-6 transition-all",
                  isCurrent
                    ? `${plan.ring} ring-2`
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700",
                  plan.popular && !isCurrent && "border-[#D4A020]/50 dark:border-[#B8860B]/50"
                )}
              >
                {/* Badges */}
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-gradient-to-r from-[#D4A020] to-[#B8860B] text-white text-xs font-bold rounded-full">
                    MOST POPULAR
                  </div>
                )}
                {plan.discount && (
                  <div className="absolute -top-3 right-4 px-3 py-1 bg-gradient-to-r from-green-500 to-emerald-600 text-white text-xs font-bold rounded-full">
                    {plan.discount}
                  </div>
                )}

                {/* Icon */}
                <div className={cn(
                  "w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center mb-4",
                  plan.gradient
                )}>
                  <Icon className="w-6 h-6 text-white" />
                </div>

                {/* Name & Description */}
                <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-1">{plan.name}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{plan.description}</p>

                {/* Price */}
                <div className="mb-6">
                  {plan.originalPrice && (
                    <span className="text-lg text-slate-400 line-through mr-2">{plan.originalPrice}</span>
                  )}
                  <span className="text-3xl font-bold text-slate-800 dark:text-white">{plan.priceLabel}</span>
                  <span className="text-slate-500 dark:text-slate-400 text-sm">{plan.period}</span>
                </div>

                {/* Features */}
                <ul className="space-y-3 mb-6">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                      <Check className={cn(
                        "w-4 h-4 shrink-0",
                        isCurrent ? "text-green-500" : "text-slate-400"
                      )} />
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* Button */}
                {isCurrent ? (
                  <div className="w-full py-3 text-center text-sm font-semibold text-[#B8860B] dark:text-[#D4A020] bg-[#D4A020]/10 dark:bg-[#B8860B]/10 rounded-xl">
                    Current Plan
                  </div>
                ) : (
                  <a
                    href="https://assist.smartbizin.com/get-demo"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "block w-full py-3 text-center text-sm font-semibold text-white rounded-xl transition-all",
                      `bg-gradient-to-r ${plan.gradient} hover:opacity-90 ${plan.shadow} shadow-lg`
                    )}
                  >
                    {plan.price === 0 ? 'Downgrade' : 'Contact to Upgrade'}
                  </a>
                )}
              </div>
            );
          })}
        </div>

        {/* Current Usage Info */}
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200/50 dark:border-slate-700/50 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">Your Current Plan</h2>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Plan</p>
              <p className="text-lg font-bold text-slate-800 dark:text-white capitalize">{currentPlan}</p>
            </div>
            <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Message Limit</p>
              <p className="text-lg font-bold text-slate-800 dark:text-white">
                {currentPlan === 'free' ? '10/day' : currentPlan === 'pro' ? '1,000/mo' : '10,000/mo'}
              </p>
            </div>
            <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Account</p>
              <p className="text-lg font-bold text-slate-800 dark:text-white truncate">{user?.email}</p>
            </div>
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-4">
            To upgrade your plan, <a href="https://assist.smartbizin.com/get-demo" target="_blank" rel="noopener noreferrer" className="text-[#D4A020] hover:underline">contact us</a>. Plan changes are managed by the administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
