import {
  Briefcase, Wallet, Home, Percent, Coins, Receipt, FileMinus,
  ShoppingBag, User, ArrowLeftRight, TrendingUp, Banknote, Landmark, HelpCircle,
  CreditCard, ArrowDownToDot, ArrowUpFromDot, Shield, Smartphone, Lightbulb, Droplets,
  type LucideIcon,
} from 'lucide-react';

// Keep in sync with server/lib/bankStatementPrompt.ts —
// BANK_STATEMENT_CATEGORIES. The server is the source of truth (the
// AI prompt enumerates these), so any new category added there must
// be added here too with a colour + icon for the UI.
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
  'Bank Charges',
  'Bank Interest (Dr)',
  'Bank Interest (Cr)',
  'Insurance',
  'Mobile Charges',
  'Electricity Charges',
  'Water Charges',
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
  'Bank Charges':       { color: 'text-stone-700 dark:text-stone-400',     bg: 'bg-stone-100 dark:bg-stone-800/40',    icon: CreditCard },
  'Bank Interest (Dr)': { color: 'text-fuchsia-700 dark:text-fuchsia-400', bg: 'bg-fuchsia-50 dark:bg-fuchsia-900/20', icon: ArrowDownToDot },
  'Bank Interest (Cr)': { color: 'text-sky-700 dark:text-sky-400',         bg: 'bg-sky-50 dark:bg-sky-900/20',         icon: ArrowUpFromDot },
  Insurance:            { color: 'text-purple-700 dark:text-purple-400',   bg: 'bg-purple-50 dark:bg-purple-900/20',   icon: Shield },
  'Mobile Charges':     { color: 'text-lime-700 dark:text-lime-400',       bg: 'bg-lime-50 dark:bg-lime-900/20',       icon: Smartphone },
  'Electricity Charges':{ color: 'text-yellow-700 dark:text-yellow-400',   bg: 'bg-yellow-50 dark:bg-yellow-900/20',   icon: Lightbulb },
  'Water Charges':      { color: 'text-blue-700 dark:text-blue-400',       bg: 'bg-blue-50 dark:bg-blue-900/20',       icon: Droplets },
  Other:                { color: 'text-zinc-700 dark:text-zinc-400',       bg: 'bg-zinc-100 dark:bg-zinc-800/40',      icon: HelpCircle },
};
