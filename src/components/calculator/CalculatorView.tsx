import { IncomeTaxTab } from './IncomeTaxTab';
import { CapitalGainsTab } from './CapitalGainsTab';
import { GstTab } from './GstTab';
import { TdsTab } from './TdsTab';
import { AdvanceTaxTab } from './AdvanceTaxTab';
import { SalaryOptimizerTab } from './SalaryOptimizerTab';
import { InvestmentPlannerTab } from './InvestmentPlannerTab';
import { RentReceiptTab } from './RentReceiptTab';
import { Challan280Tab } from './Challan280Tab';
import { ProfileSelector } from './ProfileSelector';
import { ProLock } from '../ui/ProLock';
import { motion, AnimatePresence } from 'motion/react';
import { Calculator, TrendingUp, Receipt, Briefcase, Lightbulb, FileText, Home, CreditCard } from 'lucide-react';

export type CalculatorTab = 'income' | 'capitalGains' | 'gst' | 'tds' | 'advanceTax' | 'salary' | 'investment' | 'rentReceipt' | 'challan280';

// `ai: true` tabs render a small [AI] badge in the sidebar to flag tabs that
// call an AI model (e.g. Investment Planner's optimize-suggestions endpoint).
export const CALCULATOR_TABS: { id: CalculatorTab; label: string; icon: typeof Calculator; pro?: boolean; ai?: boolean }[] = [
  { id: 'income', label: 'Income Tax', icon: Calculator },
  { id: 'capitalGains', label: 'Capital Gains', icon: TrendingUp },
  { id: 'gst', label: 'GST', icon: Receipt },
  { id: 'tds', label: 'TDS', icon: FileText },
  { id: 'advanceTax', label: 'Advance Tax', icon: Briefcase },
  { id: 'salary', label: 'Salary Optimizer', icon: Briefcase, pro: true },
  { id: 'investment', label: 'Investment Planner', icon: Lightbulb, ai: true },
  { id: 'rentReceipt', label: 'Rent Receipts', icon: Home },
  { id: 'challan280', label: 'Challan 280', icon: CreditCard },
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
            {activeTab === 'rentReceipt' && <RentReceiptTab />}
            {activeTab === 'challan280' && <Challan280Tab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
