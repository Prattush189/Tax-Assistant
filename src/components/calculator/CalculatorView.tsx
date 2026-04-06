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
          className="flex flex-wrap gap-2 mb-8 p-1.5 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border border-slate-200/80 dark:border-slate-800/80 rounded-2xl shadow-sm w-fit max-w-full overflow-x-auto"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative px-5 py-2.5 text-sm font-medium transition-colors rounded-xl z-10 whitespace-nowrap',
                activeTab === tab.id
                  ? 'text-blue-700 dark:text-blue-300'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
              )}
            >
              {activeTab === tab.id && (
                <motion.div
                  layoutId="activeCalculatorTab"
                  className="absolute inset-0 bg-blue-100/60 dark:bg-blue-900/40 border border-blue-200/50 dark:border-blue-800/50 rounded-xl -z-10 shadow-[0_2px_10px_-2px_rgba(59,130,246,0.1)] dark:shadow-none"
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
