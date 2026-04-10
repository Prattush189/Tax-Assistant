import { useState } from 'react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';
import { IncomeTaxTab } from './IncomeTaxTab';
import { CapitalGainsTab } from './CapitalGainsTab';
import { GstTab } from './GstTab';
import { TdsTab } from './TdsTab';
import { AdvanceTaxTab } from './AdvanceTaxTab';
import { SalaryOptimizerTab } from './SalaryOptimizerTab';
import { InvestmentPlannerTab } from './InvestmentPlannerTab';
import { ProfileSelector } from './ProfileSelector';
import { ProLock } from '../ui/ProLock';
import { motion, AnimatePresence } from 'motion/react';
import { Calculator, TrendingUp, Receipt, Briefcase, Lightbulb, FileText, Lock } from 'lucide-react';

type Tab = 'income' | 'capitalGains' | 'gst' | 'tds' | 'advanceTax' | 'salary' | 'investment';

const TABS: { id: Tab; label: string; icon: typeof Calculator; pro?: boolean }[] = [
  { id: 'income', label: 'Income Tax', icon: Calculator },
  { id: 'capitalGains', label: 'Capital Gains', icon: TrendingUp },
  { id: 'gst', label: 'GST', icon: Receipt },
  { id: 'tds', label: 'TDS', icon: FileText },
  { id: 'advanceTax', label: 'Advance Tax', icon: Briefcase },
  { id: 'salary', label: 'Salary Optimizer', icon: Briefcase, pro: true },
  { id: 'investment', label: 'Investment Planner', icon: Lightbulb },
];

const PLAN_RANK: Record<string, number> = { free: 0, pro: 1, enterprise: 2 };

export function CalculatorView() {
  const [activeTab, setActiveTab] = useState<Tab>('income');
  const { user } = useAuth();
  const userRank = PLAN_RANK[user?.plan ?? 'free'] ?? 0;

  return (
    <div className="flex-1 flex flex-col p-4 md:p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full">
        {/* Profile Selector */}
        <ProfileSelector />

        {/* Animated Segmented Tab Bar */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap gap-1.5 mb-8 p-1.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/50 rounded-2xl shadow-sm max-w-full overflow-x-auto"
        >
          {TABS.map((tab) => {
            const isLocked = tab.pro && userRank < 1;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors rounded-xl z-10 whitespace-nowrap',
                  activeTab === tab.id
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100',
                )}
              >
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="activeCalculatorTab"
                    className="absolute inset-0 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/50 dark:border-emerald-800/30 rounded-xl -z-10 shadow-sm dark:shadow-none"
                    initial={false}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
                {isLocked && <Lock className="w-3 h-3 text-gray-400" />}
              </button>
            );
          })}
        </motion.div>

        {/* Tab content wrapper w/ smooth entry */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            {activeTab === 'income' && <IncomeTaxTab />}
            {activeTab === 'capitalGains' && <CapitalGainsTab />}
            {activeTab === 'gst' && <GstTab />}
            {activeTab === 'tds' && <TdsTab />}
            {activeTab === 'advanceTax' && <AdvanceTaxTab />}
            {activeTab === 'salary' && (
              <ProLock requiredPlan="pro" featureName="Salary Optimizer">
                <SalaryOptimizerTab />
              </ProLock>
            )}
            {activeTab === 'investment' && <InvestmentPlannerTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
