import { useState } from 'react';
import { cn } from '../../lib/utils';
import { IncomeTaxTab } from './IncomeTaxTab';
import { CapitalGainsTab } from './CapitalGainsTab';
import { GstTab } from './GstTab';

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
      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-slate-200 dark:border-slate-700">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'income' && <IncomeTaxTab />}
      {activeTab === 'capitalGains' && <CapitalGainsTab />}
      {activeTab === 'gst' && <GstTab />}
    </div>
  );
}
