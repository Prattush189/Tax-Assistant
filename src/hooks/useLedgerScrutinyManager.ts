import { useCallback, useEffect, useState } from 'react';
import {
  fetchLedgerScrutinyJobs,
  fetchLedgerScrutinyJob,
  uploadLedgerScrutinyPdf,
  scrutinizeLedger,
  renameLedgerScrutinyJob,
  deleteLedgerScrutinyJob,
  updateLedgerObservationStatus,
  LedgerScrutinyJob,
  LedgerScrutinyDetail,
  LedgerObservationStatus,
  LedgerScrutinyProgress,
} from '../services/api';

export function useLedgerScrutinyManager(enabled: boolean) {
  const [jobs, setJobs] = useState<LedgerScrutinyJob[]>([]);
  const [usage, setUsage] = useState<{ used: number; limit: number }>({ used: 0, limit: 0 });
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

  const upload = useCallback(async (file: File): Promise<LedgerScrutinyDetail> => {
    setIsUploading(true);
    setError(null);
    try {
      const result = await uploadLedgerScrutinyPdf(file);
      setJobs((prev) => [result.job, ...prev.filter((j) => j.id !== result.job.id)]);
      setCurrentId(result.job.id);
      setCurrent(result);
      setStreamBuffer('');
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      throw e;
    } finally {
      setIsUploading(false);
    }
  }, []);

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

  return {
    jobs,
    usage,
    currentId,
    current,
    isLoading,
    isUploading,
    isScrutinizing,
    streamBuffer,
    scrutinizeProgress,
    error,
    refresh,
    clear,
    load,
    upload,
    scrutinize,
    rename,
    remove,
    setObservationStatus,
  };
}

export type LedgerScrutinyManager = ReturnType<typeof useLedgerScrutinyManager>;
