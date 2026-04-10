import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { fetchUserUsage, UserUsageResponse } from '../../services/api';
import { Check, Crown, Building2, Sparkles, MessageSquare, Paperclip, Lightbulb, FileText, User, TrendingUp } from 'lucide-react';
import { cn } from '../../lib/utils';

const plans = [
  {
    id: 'free' as const,
    name: 'Free',
    description: 'Get started with essential tax tools',
    icon: Sparkles,
    features: [
      '10 chat messages per day',
      '1 attachment per message',
      'All tax calculators (Income Tax, Capital Gains, GST, TDS, Advance Tax)',
      'Investment Planner with 50 AI suggestions/month',
      'Income Tax Acts 1961 & 2025 references',
      'Clickable PDF references for all Acts',
      'Document analysis (PDF/image)',
      '1 saved tax profile',
      'Chat history',
    ],
    gradient: 'from-gray-500 to-gray-600',
    shadow: 'shadow-gray-500/20',
    ring: 'ring-gray-300 dark:ring-gray-600',
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    description: 'For professionals who need advanced tools',
    icon: Crown,
    features: [
      '1,000 chat messages per month',
      '3 attachments per message',
      'Live web search for latest tax updates',
      'Salary Structure Optimizer',
      '200 AI tax suggestions/month',
      'PDF export of tax computations',
      'Reference tax profiles in chat',
      '10 saved tax profiles',
      'Notice drafting (30/month)',
      'Priority responses & email support',
    ],
    gradient: 'from-[#0D9668] to-[#0A7B55]',
    shadow: 'shadow-[#0D9668]/20',
    ring: 'ring-[#0D9668] dark:ring-[#0A7B55]',
    popular: true,
  },
  {
    id: 'enterprise' as const,
    name: 'Enterprise',
    description: 'For CA firms and large businesses',
    icon: Building2,
    features: [
      '10,000 chat messages per month',
      '5 attachments per message',
      'Everything in Pro, plus:',
      '1,000 AI tax suggestions/month',
      '50 saved tax profiles',
      '100 notice drafts per month',
      'Fastest response times',
      'Dedicated support',
      'Plugin/API access',
      'Multi-user team accounts',
      'Custom integrations',
      'SLA guarantees',
    ],
    gradient: 'from-indigo-500 to-purple-600',
    shadow: 'shadow-indigo-500/20',
    ring: 'ring-indigo-400 dark:ring-indigo-500',
  },
];

interface UsageBarProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  used: number;
  limit: number;
  period?: 'day' | 'month' | 'total';
}

function UsageBar({ icon: Icon, label, used, limit, period }: UsageBarProps) {
  const percentage = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  // Color by usage level
  const getColor = (pct: number) => {
    if (pct >= 90) return 'bg-red-500 dark:bg-red-500';
    if (pct >= 75) return 'bg-amber-500 dark:bg-amber-500';
    if (pct >= 50) return 'bg-yellow-500 dark:bg-yellow-500';
    return 'bg-[#0D9668] dark:bg-[#2DD4A0]';
  };

  const periodLabel = period === 'day' ? '/day' : period === 'month' ? '/mo' : '';

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
          "text-xs font-bold shrink-0",
          percentage >= 90 ? "text-red-600 dark:text-red-400" :
          percentage >= 75 ? "text-amber-600 dark:text-amber-400" :
          "text-gray-500 dark:text-gray-400"
        )}>
          {percentage.toFixed(0)}%
        </span>
      </div>
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500 ease-out", getColor(percentage))}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export function PlanPage() {
  const { user } = useAuth();
  const currentPlan = user?.plan || 'free';
  const [usage, setUsage] = useState<UserUsageResponse | null>(null);

  useEffect(() => {
    fetchUserUsage()
      .then(setUsage)
      .catch((err) => console.error('Failed to fetch usage:', err));
  }, []);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">Choose Your Plan</h1>
          <p className="text-gray-500 dark:text-gray-400 text-lg">
            Upgrade to unlock more messages and premium features
          </p>
        </div>

        {/* Current Usage Bars */}
        {usage && (
          <div className="mb-10 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold text-gray-800 dark:text-white">Your Usage</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Current plan: <span className="font-semibold text-[#0D9668] dark:text-[#2DD4A0] capitalize">{usage.plan}</span>
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
                icon={User}
                label={usage.usage.profiles.label}
                used={usage.usage.profiles.used}
                limit={usage.usage.profiles.limit}
                period={usage.usage.profiles.period}
              />
            </div>
          </div>
        )}

        {/* Plan Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-10">
          {plans.map((plan) => {
            const isCurrent = currentPlan === plan.id;
            const Icon = plan.icon;
            return (
              <div
                key={plan.id}
                className={cn(
                  "relative bg-white dark:bg-gray-900 rounded-2xl border-2 p-6 transition-all",
                  isCurrent
                    ? `${plan.ring} ring-2`
                    : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700",
                  plan.popular && !isCurrent && "border-[#0D9668]/50 dark:border-[#0A7B55]/50"
                )}
              >
                {/* Badge */}
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-gradient-to-r from-[#0D9668] to-[#0A7B55] text-white text-xs font-bold rounded-full">
                    MOST POPULAR
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
                <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-1">{plan.name}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{plan.description}</p>

                {/* Features */}
                <ul className="space-y-3 mb-6">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <Check className={cn(
                        "w-4 h-4 shrink-0 mt-0.5",
                        isCurrent ? "text-[#0D9668]" : "text-gray-400"
                      )} />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* Button */}
                {isCurrent ? (
                  <div className="w-full py-3 text-center text-sm font-semibold text-[#0A7B55] dark:text-[#2DD4A0] bg-[#0D9668]/10 dark:bg-[#0A7B55]/10 rounded-xl">
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
                    Contact Us
                  </a>
                )}
              </div>
            );
          })}
        </div>

        {/* Account Info Footer */}
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
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">
            To upgrade your plan, <a href="https://assist.smartbizin.com/get-demo" target="_blank" rel="noopener noreferrer" className="text-[#0D9668] hover:underline">contact us</a>. Plan changes are managed by the administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
