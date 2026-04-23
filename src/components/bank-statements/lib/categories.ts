import {
  Briefcase, Wallet, Home, Percent, Coins, Receipt, FileMinus,
  ShoppingBag, User, ArrowLeftRight, TrendingUp, Banknote, Landmark, HelpCircle,
  type LucideIcon,
} from 'lucide-react';

export const BANK_STATEMENT_CATEGORIES = [
  'Business Income',
  'Salary',
  'Rent Received',
  'Interest Income',
  'Dividends',
  'GST Payments',
  'TDS',
  'Business Expenses',
  'Personal',
  'Transfers',
  'Investments',
  'Loan EMI',
  'Taxes Paid',
  'Other',
] as const;

export type BankStatementCategory = typeof BANK_STATEMENT_CATEGORIES[number];

export const CATEGORY_META: Record<BankStatementCategory, { color: string; bg: string; icon: LucideIcon }> = {
  'Business Income':    { color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: Briefcase },
  Salary:               { color: 'text-blue-700 dark:text-blue-400',       bg: 'bg-blue-50 dark:bg-blue-900/20',       icon: Wallet },
  'Rent Received':      { color: 'text-teal-700 dark:text-teal-400',       bg: 'bg-teal-50 dark:bg-teal-900/20',       icon: Home },
  'Interest Income':    { color: 'text-indigo-700 dark:text-indigo-400',   bg: 'bg-indigo-50 dark:bg-indigo-900/20',   icon: Percent },
  Dividends:            { color: 'text-cyan-700 dark:text-cyan-400',       bg: 'bg-cyan-50 dark:bg-cyan-900/20',       icon: Coins },
  'GST Payments':       { color: 'text-rose-700 dark:text-rose-400',       bg: 'bg-rose-50 dark:bg-rose-900/20',       icon: Receipt },
  TDS:                  { color: 'text-pink-700 dark:text-pink-400',       bg: 'bg-pink-50 dark:bg-pink-900/20',       icon: FileMinus },
  'Business Expenses':  { color: 'text-orange-700 dark:text-orange-400',   bg: 'bg-orange-50 dark:bg-orange-900/20',   icon: ShoppingBag },
  Personal:             { color: 'text-gray-700 dark:text-gray-400',       bg: 'bg-gray-100 dark:bg-gray-800/40',      icon: User },
  Transfers:            { color: 'text-slate-700 dark:text-slate-400',     bg: 'bg-slate-100 dark:bg-slate-800/40',    icon: ArrowLeftRight },
  Investments:          { color: 'text-violet-700 dark:text-violet-400',   bg: 'bg-violet-50 dark:bg-violet-900/20',   icon: TrendingUp },
  'Loan EMI':           { color: 'text-amber-700 dark:text-amber-400',     bg: 'bg-amber-50 dark:bg-amber-900/20',     icon: Banknote },
  'Taxes Paid':         { color: 'text-red-700 dark:text-red-400',         bg: 'bg-red-50 dark:bg-red-900/20',         icon: Landmark },
  Other:                { color: 'text-zinc-700 dark:text-zinc-400',       bg: 'bg-zinc-100 dark:bg-zinc-800/40',      icon: HelpCircle },
};
