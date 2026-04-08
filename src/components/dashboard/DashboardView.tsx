import { useTaxCalculator } from '../../contexts/TaxCalculatorContext';
import { TaxWaterfallChart } from './TaxWaterfallChart';
import { TaxSummaryCards } from './TaxSummaryCards';
import { RegimeComparison } from '../calculator/RegimeComparison';
import { motion } from 'motion/react';
import { LayoutDashboard } from 'lucide-react';

export function DashboardView() {
  const { grossSalary, oldResult, newResult, fy } = useTaxCalculator();

  const betterResult = newResult.totalTax <= oldResult.totalTax ? newResult : oldResult;
  const betterLabel = newResult.totalTax <= oldResult.totalTax ? 'New Regime' : 'Old Regime';

  if (!grossSalary || Number(grossSalary) === 0) {
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="flex-1 flex flex-col items-center justify-center gap-6 p-8"
      >
        <div className="w-24 h-24 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/40 dark:to-indigo-900/40 rounded-3xl flex items-center justify-center animate-bounce shadow-xl shadow-blue-500/10 dark:shadow-blue-900/20 border border-blue-200/50 dark:border-blue-800/50">
          <LayoutDashboard className="w-12 h-12 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="space-y-3 text-center max-w-md">
          <h3 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Your Personalised Dashboard</h3>
          <p className="text-gray-500 dark:text-gray-400 text-base leading-relaxed">
            Enter your gross income in the <span className="font-semibold text-blue-600 dark:text-blue-400">Calculator</span> tab to generate your tax breakdown, regime comparison, and visual charts.
          </p>
        </div>
      </motion.div>
    );
  }

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1, 
      transition: { staggerChildren: 0.1, delayChildren: 0.05 } 
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } }
  };

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="flex-1 overflow-y-auto p-4 md:p-6 scroll-smooth"
    >
      <div className="max-w-4xl mx-auto space-y-6">
        <motion.div variants={itemVariants} className="bg-white/50 dark:bg-gray-900/50 backdrop-blur-md p-4 rounded-2xl border border-gray-200/60 dark:border-gray-800/60 shadow-sm">
          <h2 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 bg-clip-text text-transparent">Tax Dashboard</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-medium">
            Based on {betterLabel} — FY {fy}
          </p>
        </motion.div>

        <motion.div variants={itemVariants}>
          <TaxSummaryCards result={betterResult} regimeLabel={betterLabel} />
        </motion.div>

        <motion.div variants={itemVariants} className="overflow-x-auto rounded-xl p-1">
          <TaxWaterfallChart result={betterResult} />
        </motion.div>

        {/* VIZ-04: RegimeComparison already implements full slab-by-slab table — reuse, do not rebuild */}
        <motion.div variants={itemVariants} className="bg-white/30 dark:bg-gray-900/30 backdrop-blur-sm p-4 rounded-2xl border border-gray-200/50 dark:border-gray-800/50">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
            <span className="w-1.5 h-6 bg-blue-500 rounded-full"></span>
            Regime Comparison
          </h3>
          <RegimeComparison oldResult={oldResult} newResult={newResult} fy={fy} />
        </motion.div>
      </div>
    </motion.div>
  );
}
