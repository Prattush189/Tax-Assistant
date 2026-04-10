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
import { Calculator, TrendingUp, Receipt, Briefcase, Lightbulb, FileText } from 'lucide-react';

export type CalculatorTab = 'income' | 'capitalGains' | 'gst' | 'tds' | 'advanceTax' | 'salary' | 'investment';

export const CALCULATOR_TABS: { id: CalculatorTab; label: string; icon: typeof Calculator; pro?: boolean }[] = [
  { id: 'income', label: 'Income Tax', icon: Calculator },
  { id: 'capitalGains', label: 'Capital Gains', icon: TrendingUp },
  { id: 'gst', label: 'GST', icon: Receipt },
  { id: 'tds', label: 'TDS', icon: FileText },
  { id: 'advanceTax', label: 'Advance Tax', icon: Briefcase },
  { id: 'salary', label: 'Salary Optimizer', icon: Briefcase, pro: true },
  { id: 'investment', label: 'Investment Planner', icon: Lightbulb },
];

interface CalculatorViewProps {
  activeTab: CalculatorTab;
}

export function CalculatorView({ activeTab }: CalculatorViewProps) {
  return (
    <div className="flex-1 flex flex-col p-4 md:p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full">
        {/* Profile Selector */}
        <ProfileSelector />

        <div className="mb-6" />

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
