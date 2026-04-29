import { useState, useCallback, useEffect } from 'react';
import {
  fetchBankStatements,
  fetchBankStatement,
  analyzeBankStatementFile,
  analyzeBankStatementCsv,
  renameBankStatement,
  deleteBankStatement,
  cancelBankStatement,
  updateBankTransaction,
  fetchBankStatementRules,
  createBankStatementRule,
  deleteBankStatementRule,
  fetchBankStatementConditions,
  createBankStatementCondition,
  deleteBankStatementCondition,
  BankStatementSummary,
  BankTransaction,
  BankStatementRule,
  BankStatementCondition,
  BankStatementAnalyzeProgress,
} from '../services/api';

export type BankStatementDetail = {
  statement: BankStatementSummary;
  transactions: BankTransaction[];
  /** True when the server short-circuited because this exact file was
   *  already analyzed successfully — we surface a different toast
   *  ("opened the existing one") so the user understands no new
   *  Gemini call was made. */
  alreadyAnalyzed?: boolean;
  /** Server-side reconciliation flag: rows whose printed balance delta
   *  doesn't match the credit/debit value the AI extracted. Populated
   *  on the analyze response only — fetchBankStatement returns just
   *  the persisted shape, so this drops to undefined on a later page
   *  reload. UI shows it as an amber heads-up next to the totals. */
  reconciliationWarning?: string;
};

/**
 * Manages the user's bank statement analyses: list, currently selected
 * statement detail, upload + analyze, rename, delete, and per-transaction
 * category reassignment.
 */
export interface BankStatementUsage {
  creditsUsed: number;
  creditsLimit: number;
  pagesPerCredit: number;
  csvRowsPerCredit: number;
}

const DEFAULT_USAGE: BankStatementUsage = { creditsUsed: 0, creditsLimit: 0, pagesPerCredit: 5, csvRowsPerCredit: 100 };

export function useBankStatementManager(enabled: boolean) {
  const [statements, setStatements] = useState<BankStatementSummary[]>([]);
  const [usage, setUsage] = useState<BankStatementUsage>(DEFAULT_USAGE);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [current, setCurrent] = useState<BankStatementDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<BankStatementAnalyzeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<BankStatementRule[]>([]);
  const [conditions, setConditions] = useState<BankStatementCondition[]>([]);

  useEffect(() => {
    if (!enabled) return;
    (async () => {
      setIsLoading(true);
      try {
        const [list, ruleList, condList] = await Promise.all([
          fetchBankStatements(),
          fetchBankStatementRules(),
          fetchBankStatementConditions(),
        ]);
        setStatements(list.statements);
        if (list.usage) setUsage(list.usage);
        setRules(ruleList.rules);
        setConditions(condList.conditions);
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
      if (data.usage) setUsage(data.usage);
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

  // Reload-resume. Server now creates the bank_statements row UPFRONT with
  // status='analyzing' before kicking off the Gemini pipeline; the express
  // handler keeps running on tab close (Node default), so the row updates
  // to 'done' on completion regardless of whether the original request
  // socket is still open. Poll every 5 s while any statement is in
  // 'analyzing' so a reload mid-run shows live status and the UI can
  // disable buttons that mustn't fire during the generation.
  useEffect(() => {
    if (!enabled) return;
    const hasInProgress = statements.some(s => s.status === 'analyzing');
    if (!hasInProgress) return;
    const handle = setInterval(() => {
      void refresh();
      if (currentId) void load(currentId);
    }, 5000);
    return () => clearInterval(handle);
  }, [enabled, statements, currentId, refresh, load]);

  const analyzeFile = useCallback(async (file: File): Promise<BankStatementDetail> => {
    setIsAnalyzing(true);
    setAnalyzeProgress(null);
    setError(null);
    try {
      const result = await analyzeBankStatementFile(file, (p) => setAnalyzeProgress(p));
      // Replace if the row already exists in the list (server returned
      // an existing analysis via the file_hash dedup, OR the polling
      // loop has already added it). Without this guard a re-upload of
      // the same file produced two visually identical sidebar entries
      // pointing at one row.
      setStatements((prev) => {
        const filtered = prev.filter((s) => s.id !== result.statement.id);
        return [result.statement, ...filtered];
      });
      setCurrentId(result.statement.id);
      setCurrent(result);
      // Refresh usage — credits were just debited server-side, and
      // without this the on-page % bar stays at its pre-analysis value
      // until the user reloads (which makes Settings and the bank/
      // ledger pages disagree on the same number).
      void refresh();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
      // Refresh sidebar so the failed placeholder row picks up its
      // 'error' status and any partial-chunk credits get reflected.
      void refresh();
      throw e;
    } finally {
      setIsAnalyzing(false);
      setAnalyzeProgress(null);
    }
  }, [refresh]);

  const analyzeCsv = useCallback(async (csvText: string, filename?: string): Promise<BankStatementDetail> => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeBankStatementCsv(csvText, filename);
      setStatements((prev) => {
        const filtered = prev.filter((s) => s.id !== result.statement.id);
        return [result.statement, ...filtered];
      });
      setCurrentId(result.statement.id);
      setCurrent(result);
      void refresh();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
      // Refresh sidebar so the failed placeholder row picks up its
      // 'error' status and any partial-chunk credits get reflected.
      void refresh();
      throw e;
    } finally {
      setIsAnalyzing(false);
    }
  }, [refresh]);

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

  /** Cancel an analyzing statement. Counts toward the monthly quota
   *  (server already debited featureUsage on the cancel endpoint to
   *  close the Generate→Cancel loophole). */
  const cancel = useCallback(async (id: string): Promise<void> => {
    const { statement } = await cancelBankStatement(id);
    if (statement) {
      setStatements((prev) => prev.map((s) => (s.id === id ? statement : s)));
      setCurrent((prev) => (prev && prev.statement.id === id ? { ...prev, statement } : prev));
    }
    // Cancel debits credits for the chunks that finished pre-cancel,
    // so refresh usage to keep the % bar honest.
    void refresh();
  }, [refresh]);

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

  const addCondition = useCallback(async (text: string): Promise<BankStatementCondition> => {
    const { condition } = await createBankStatementCondition(text);
    setConditions((prev) => [condition, ...prev]);
    return condition;
  }, []);

  const removeCondition = useCallback(async (id: string) => {
    await deleteBankStatementCondition(id);
    setConditions((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // Any analysis still running on the server, derived from the persisted
  // status flag rather than the in-flight isAnalyzing boolean (which
  // resets on tab reload). UI uses this to gate Add rule / Add condition
  // / Choose file etc. so the user can't kick off a parallel run.
  const hasInProgressJob = isAnalyzing || statements.some(s => s.status === 'analyzing');

  return {
    statements,
    usage,
    currentId,
    current,
    isLoading,
    isAnalyzing,
    hasInProgressJob,
    analyzeProgress,
    error,
    rules,
    conditions,
    refresh,
    clear,
    load,
    analyzeFile,
    analyzeCsv,
    rename,
    remove,
    cancel,
    reassignCategory,
    addRule,
    removeRule,
    addCondition,
    removeCondition,
  };
}

export type BankStatementManager = ReturnType<typeof useBankStatementManager>;
