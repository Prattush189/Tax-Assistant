import { useState, useMemo, useEffect } from 'react';
import { generateInvestmentSuggestions, type InvestmentSuggestion } from '../../lib/investmentPlanner';
import { useTaxCalculator } from '../../contexts/TaxCalculatorContext';
import { useAuth } from '../../contexts/AuthContext';
import { TrendingUp, Loader2, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';

function formatINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}

interface AiSuggestion {
  title: string;
  section: string;
  action: string;
  estimatedSaving: number;
  priority: number;
}

export function InvestmentPlannerTab() {
  const { user } = useAuth();
  const { fy, grossSalary, otherIncome, deductions, ageCategory, oldResult } = useTaxCalculator();
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const gross = parseFloat(grossSalary) || 0;
  const other = parseFloat(otherIncome) || 0;

  // Determine marginal rate from old regime result
  const marginalRate = oldResult.taxableIncome > 1000000 ? 0.30
    : oldResult.taxableIncome > 500000 ? 0.20
    : oldResult.taxableIncome > 250000 ? 0.05 : 0;

  // Basic investment suggestions
  const basicResult = useMemo(() => {
    if (gross <= 0) return null;
    return generateInvestmentSuggestions({
      taxableIncome: oldResult.taxableIncome,
      marginalRate,
      currentDeductions: {
        section80C: parseFloat(deductions.section80C) || 0,
        section80D_self: parseFloat(deductions.section80D_self) || 0,
        section80D_parents: parseFloat(deductions.section80D_parents) || 0,
        section80CCD1B: parseFloat(deductions.section80CCD1B) || 0,
      },
      ageCategory,
    });
  }, [gross, oldResult.taxableIncome, marginalRate, deductions, ageCategory]);

  // Fetch AI suggestions
  const fetchAiSuggestions = async () => {
    setAiLoading(true);
    setAiError('');
    try {
      const token = localStorage.getItem('tax_access_token');
      const res = await fetch('/api/suggestions/optimize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          grossIncome: gross + other,
          taxableIncome: oldResult.taxableIncome,
          regime: 'old',
          ageCategory,
          fy,
          deductions: {
            section80C: parseFloat(deductions.section80C) || 0,
            section80D_self: parseFloat(deductions.section80D_self) || 0,
            section80CCD1B: parseFloat(deductions.section80CCD1B) || 0,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setAiSuggestions(data.suggestions ?? []);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed to get AI suggestions');
    } finally {
      setAiLoading(false);
    }
  };

  if (gross <= 0) {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <TrendingUp className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
        <p className="text-gray-500 dark:text-gray-400">Enter your income in the Income Tax tab first to get personalized investment suggestions.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Summary */}
      {basicResult && basicResult.totalPotentialSaving > 0 && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 text-center">
          <p className="text-sm text-green-600 dark:text-green-400">Total potential tax savings</p>
          <p className="text-2xl font-bold text-green-700 dark:text-green-300">{formatINR(basicResult.totalPotentialSaving)}/year</p>
          <p className="text-xs text-green-500 mt-1">by investing {formatINR(basicResult.totalSuggestedInvestment)}</p>
        </div>
      )}

      {/* Basic Suggestions */}
      {basicResult && basicResult.suggestions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Investment Suggestions</h3>
          {basicResult.suggestions.map((s: InvestmentSuggestion, i: number) => (
            <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">{s.section}</span>
                  <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200 mt-1">{s.instrument}</h4>
                </div>
                <span className="text-sm font-bold text-green-600 dark:text-green-400">Save {formatINR(s.estimatedSaving)}</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{s.description}</p>
              <div className="flex gap-4 text-xs text-gray-400">
                <span>Invest: {formatINR(s.suggestedAmount)}</span>
                <span>Limit: {formatINR(s.maxLimit)}</span>
                <span>Used: {formatINR(s.currentlyUsed)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI Suggestions (Pro+) */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">AI-Powered Suggestions</h3>
          </div>
          <button
            onClick={fetchAiSuggestions}
            disabled={aiLoading}
            className={cn(
              "px-3 py-1.5 text-xs rounded-lg font-medium transition-colors",
              aiLoading
                ? "bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed"
                : "bg-emerald-600 text-white hover:bg-emerald-700"
            )}
          >
            {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Get AI Tips'}
          </button>
        </div>

        {aiError && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-xs text-red-600 dark:text-red-400">
            {aiError}
          </div>
        )}

        {aiSuggestions.length > 0 && (
          <div className="space-y-2">
            {aiSuggestions.map((s, i) => (
              <div key={i} className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 rounded-lg p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">{s.section}</span>
                    <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">{s.title}</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.action}</p>
                  </div>
                  <span className="text-sm font-bold text-green-600 dark:text-green-400 shrink-0 ml-3">{formatINR(s.estimatedSaving)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
