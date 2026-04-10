import { Lock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface ProLockProps {
  requiredPlan: 'pro' | 'enterprise';
  children: React.ReactNode;
  featureName?: string;
}

const PLAN_RANK: Record<string, number> = { free: 0, pro: 1, enterprise: 2 };

export function ProLock({ requiredPlan, children, featureName }: ProLockProps) {
  const { user } = useAuth();
  const hasAccess = PLAN_RANK[user?.plan ?? 'free'] >= PLAN_RANK[requiredPlan];

  if (hasAccess) {
    return <>{children}</>;
  }

  const planLabel = requiredPlan === 'enterprise' ? 'Enterprise' : 'Pro';

  return (
    <div className="relative">
      {children}
      <div className="absolute inset-0 z-10 backdrop-blur-sm bg-white/60 dark:bg-gray-900/60 flex flex-col items-center justify-center rounded-xl">
        <Lock className="w-8 h-8 text-gray-400 mb-2" />
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 text-center px-4">
          {featureName || 'This feature'} requires {planLabel} plan
        </p>
        <button
          onClick={() => { window.location.href = '/plan'; }}
          className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
        >
          Upgrade to {planLabel}
        </button>
      </div>
    </div>
  );
}
