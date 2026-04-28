import { useCallback, useEffect, useState } from 'react';
import {
  fetchLedgerScrutinyJobs,
  fetchLedgerScrutinyJob,
  uploadLedgerScrutinyPdf,
  uploadLedgerScrutinyPreExtracted,
  scrutinizeLedger,
  renameLedgerScrutinyJob,
  deleteLedgerScrutinyJob,
  cancelLedgerScrutinyJob,
  updateLedgerObservationStatus,
  LedgerScrutinyJob,
  LedgerScrutinyDetail,
  LedgerObservationStatus,
  LedgerScrutinyProgress,
} from '../services/api';

export function useLedgerScrutinyManager(enabled: boolean) {
  const [jobs, setJobs] = useState<LedgerScrutinyJob[]>([]);
  const [usage, setUsage] = useState<{ used: number; limit: number; creditsUsed: number; creditsLimit: number; pagesPerCredit: number; csvRowsPerCredit: number }>({ used: 0, limit: 0, creditsUsed: 0, creditsLimit: 0, pagesPerCredit: 10, csvRowsPerCredit: 100 });
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [current, setCurrent] = useState<LedgerScrutinyDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isScrutinizing, setIsScrutinizing] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState<string>('');
  const [scrutinizeProgress, setScrutinizeProgress] = useState<LedgerScrutinyProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    (async () => {
      setIsLoading(true);
      try {
        const data = await fetchLedgerScrutinyJobs();
        setJobs(data.jobs);
        setUsage(data.usage);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load ledger scrutiny jobs');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [enabled]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await fetchLedgerScrutinyJobs();
      setJobs(data.jobs);
      setUsage(data.usage);
    } catch {
      // non-fatal
    }
  }, [enabled]);

  const clear = useCallback(() => {
    setCurrentId(null);
    setCurrent(null);
    setStreamBuffer('');
  }, []);

  const load = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchLedgerScrutinyJob(id);
      setCurrentId(id);
      setCurrent(data);
      setStreamBuffer('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ledger');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Resume polling for in-progress jobs across reloads. Server-side, Node
  // does NOT abort handlers when the client disconnects — an extraction
  // started in a tab that the user closed keeps running and persists its
  // result via setStatus / saveExtraction. Poll every 5 s while any job
  // is in `extracting` or `scrutinizing`, refreshing the list (and the
  // currently-loaded detail) until the in-progress jobs settle. This way
  // a reload mid-run shows the correct progress instead of a stale state,
  // and the upload route's in-progress guard prevents the user from
  // accidentally firing a duplicate run.
  useEffect(() => {
    if (!enabled) return;
    const hasInProgress = jobs.some(j => j.status === 'extracting' || j.status === 'scrutinizing');
    if (!hasInProgress) return;
    const handle = setInterval(() => { void refresh(); if (currentId) void load(currentId); }, 5000);
    return () => clearInterval(handle);
  }, [enabled, jobs, currentId, refresh, load]);

  const upload = useCallback(async (file: File): Promise<LedgerScrutinyDetail> => {
    setIsUploading(true);
    setError(null);
    try {
      const result = await uploadLedgerScrutinyPdf(file);
      setJobs((prev) => [result.job, ...prev.filter((j) => j.id !== result.job.id)]);
      setCurrentId(result.job.id);
      setCurrent(result);
      setStreamBuffer('');
      // Refresh usage so the on-page % bar reflects the credits the
      // server just debited; otherwise it lags Settings until reload.
      void refresh();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      throw e;
    } finally {
      setIsUploading(false);
    }
  }, [refresh]);

  const uploadMapped = useCallback(async (preExtracted: unknown, filename: string): Promise<LedgerScrutinyDetail> => {
    setIsUploading(true);
    setError(null);
    try {
      const result = await uploadLedgerScrutinyPreExtracted(preExtracted, filename);
      setJobs((prev) => [result.job, ...prev.filter((j) => j.id !== result.job.id)]);
      setCurrentId(result.job.id);
      setCurrent(result);
      setStreamBuffer('');
      void refresh();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      throw e;
    } finally {
      setIsUploading(false);
    }
  }, [refresh]);

  const scrutinize = useCallback(async (jobId: string): Promise<void> => {
    setIsScrutinizing(true);
    setError(null);
    setStreamBuffer('');
    setScrutinizeProgress(null);
    return new Promise<void>((resolve, reject) => {
      void scrutinizeLedger(
        jobId,
        (chunk) => { setStreamBuffer((prev) => prev + chunk); },
        (msg, _kind) => {
          setIsScrutinizing(false);
          setScrutinizeProgress(null);
          setError(msg);
          reject(new Error(msg));
        },
        async () => {
          try {
            const detail = await fetchLedgerScrutinyJob(jobId);
            setCurrent(detail);
            setJobs((prev) => prev.map((j) => (j.id === jobId ? detail.job : j)));
            await refresh();
          } catch (e) {
            console.error('[ledger] reload failed', e);
          }
          setIsScrutinizing(false);
          setScrutinizeProgress(null);
          resolve();
        },
        (p) => setScrutinizeProgress(p),
      );
    });
  }, [refresh]);

  const rename = useCallback(async (id: string, name: string) => {
    const { job } = await renameLedgerScrutinyJob(id, name);
    setJobs((prev) => prev.map((j) => (j.id === id ? job : j)));
    setCurrent((prev) => (prev && prev.job.id === id ? { ...prev, job } : prev));
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteLedgerScrutinyJob(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
    if (currentId === id) clear();
  }, [currentId, clear]);

  /** Cancel a running scrutiny. Counts toward the monthly quota — Gemini
   *  has likely already done partial work, and refunding would let users
   *  bypass the limit by spamming Generate→Cancel. The server keeps the
   *  Promise chain running internally but discards the result. */
  const cancel = useCallback(async (id: string): Promise<void> => {
    const { job } = await cancelLedgerScrutinyJob(id);
    if (job) {
      setJobs((prev) => prev.map((j) => (j.id === id ? job : j)));
      setCurrent((prev) => (prev && prev.job.id === id ? { ...prev, job } : prev));
    }
    // Cancel debits credits for the chunks that finished pre-cancel,
    // so refresh usage to keep the % bar honest.
    void refresh();
  }, [refresh]);

  const setObservationStatus = useCallback(async (
    obsId: string,
    status: LedgerObservationStatus,
  ) => {
    if (!current) return;
    const { observation } = await updateLedgerObservationStatus(current.job.id, obsId, status);
    setCurrent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        observations: prev.observations.map((o) => (o.id === obsId ? observation : o)),
      };
    });
  }, [current]);

  // Any job that's still running on the server. Disables new uploads and
  // delete/export actions across the UI so a user can only have ONE
  // ledger audit in flight at a time — keeps the cost ceiling tight and
  // matches the server-side findInProgressByHashForUser guard which
  // already refuses parallel runs of the same file.
  const hasInProgressJob = jobs.some(j =>
    j.status === 'extracting' || j.status === 'scrutinizing' || j.status === 'pending');

  return {
    jobs,
    usage,
    currentId,
    current,
    isLoading,
    isUploading,
    isScrutinizing,
    hasInProgressJob,
    streamBuffer,
    scrutinizeProgress,
    error,
    refresh,
    clear,
    load,
    upload,
    uploadMapped,
    scrutinize,
    rename,
    remove,
    cancel,
    setObservationStatus,
  };
}

export type LedgerScrutinyManager = ReturnType<typeof useLedgerScrutinyManager>;
