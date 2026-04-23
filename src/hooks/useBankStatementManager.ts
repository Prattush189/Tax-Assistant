import { useState, useCallback, useEffect } from 'react';
import {
  fetchBankStatements,
  fetchBankStatement,
  analyzeBankStatementFile,
  analyzeBankStatementCsv,
  renameBankStatement,
  deleteBankStatement,
  updateBankTransaction,
  fetchBankStatementRules,
  createBankStatementRule,
  deleteBankStatementRule,
  BankStatementSummary,
  BankTransaction,
  BankStatementRule,
} from '../services/api';

export type BankStatementDetail = {
  statement: BankStatementSummary;
  transactions: BankTransaction[];
};

/**
 * Manages the user's bank statement analyses: list, currently selected
 * statement detail, upload + analyze, rename, delete, and per-transaction
 * category reassignment.
 */
export function useBankStatementManager(enabled: boolean) {
  const [statements, setStatements] = useState<BankStatementSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [current, setCurrent] = useState<BankStatementDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<BankStatementRule[]>([]);

  useEffect(() => {
    if (!enabled) return;
    (async () => {
      setIsLoading(true);
      try {
        const [list, ruleList] = await Promise.all([fetchBankStatements(), fetchBankStatementRules()]);
        setStatements(list.statements);
        setRules(ruleList.rules);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load statements');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [enabled]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await fetchBankStatements();
      setStatements(data.statements);
    } catch {
      // non-fatal
    }
  }, [enabled]);

  const clear = useCallback(() => {
    setCurrentId(null);
    setCurrent(null);
  }, []);

  const load = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchBankStatement(id);
      setCurrentId(id);
      setCurrent(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load statement');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const analyzeFile = useCallback(async (file: File): Promise<BankStatementDetail> => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeBankStatementFile(file);
      setStatements((prev) => [result.statement, ...prev]);
      setCurrentId(result.statement.id);
      setCurrent(result);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
      throw e;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const analyzeCsv = useCallback(async (csvText: string, filename?: string): Promise<BankStatementDetail> => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeBankStatementCsv(csvText, filename);
      setStatements((prev) => [result.statement, ...prev]);
      setCurrentId(result.statement.id);
      setCurrent(result);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
      throw e;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const rename = useCallback(async (id: string, name: string) => {
    const { statement } = await renameBankStatement(id, name);
    setStatements((prev) => prev.map((s) => (s.id === id ? statement : s)));
    setCurrent((prev) => (prev && prev.statement.id === id ? { ...prev, statement } : prev));
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteBankStatement(id);
    setStatements((prev) => prev.filter((s) => s.id !== id));
    if (currentId === id) clear();
  }, [currentId, clear]);

  const reassignCategory = useCallback(
    async (txId: string, category: string, subcategory?: string | null) => {
      if (!current) return;
      await updateBankTransaction(current.statement.id, txId, category, subcategory ?? null);
      setCurrent((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          transactions: prev.transactions.map((t) =>
            t.id === txId
              ? { ...t, category, subcategory: subcategory ?? null, userOverride: true }
              : t,
          ),
        };
      });
    },
    [current],
  );

  const addRule = useCallback(async (input: {
    matchText: string;
    category?: string | null;
    counterpartyLabel?: string | null;
  }): Promise<BankStatementRule> => {
    const { rule } = await createBankStatementRule(input);
    setRules((prev) => [rule, ...prev]);
    return rule;
  }, []);

  const removeRule = useCallback(async (id: string) => {
    await deleteBankStatementRule(id);
    setRules((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return {
    statements,
    currentId,
    current,
    isLoading,
    isAnalyzing,
    error,
    rules,
    refresh,
    clear,
    load,
    analyzeFile,
    analyzeCsv,
    rename,
    remove,
    reassignCategory,
    addRule,
    removeRule,
  };
}

export type BankStatementManager = ReturnType<typeof useBankStatementManager>;
