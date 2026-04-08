import { useState } from 'react';
import { cn } from '../../lib/utils';
import { IncomeTaxTab } from './IncomeTaxTab';
import { CapitalGainsTab } from './CapitalGainsTab';
import { GstTab } from './GstTab';
import { motion, AnimatePresence } from 'motion/react';

type Tab = 'income' | 'capitalGains' | 'gst';

const TABS: { id: Tab; label: string }[] = [
  { id: 'income', label: 'Income Tax' },
  { id: 'capitalGains', label: 'Capital Gains' },
  { id: 'gst', label: 'GST' },
];

export function CalculatorView() {
  const [activeTab, setActiveTab] = useState<Tab>('income');

  return (
    <div className="flex-1 flex flex-col p-4 md:p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full">
        {/* Animated Segmented Tab Bar */}
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap gap-2 mb-8 p-1.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/50 rounded-2xl shadow-sm w-fit max-w-full overflow-x-auto"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative px-5 py-2.5 text-sm font-medium transition-colors rounded-xl z-10 whitespace-nowrap',
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
              {tab.label}
            </button>
          ))}
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
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
