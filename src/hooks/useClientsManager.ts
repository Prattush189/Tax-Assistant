import { useState, useCallback, useEffect } from 'react';
import {
  fetchClients,
  createClient,
  updateClient,
  deleteClient,
  createClientDraft,
  bulkCreateClients,
  ClientData,
} from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export function useClientsManager() {
  const { isAuthenticated } = useAuth();
  const [clients, setClients] = useState<ClientData[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [limit, setLimit] = useState(5);
  const [used, setUsed] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const res = await fetchClients();
      setClients(res.clients);
      setSummary(res.summary);
      setLimit(res.limit);
      setUsed(res.used);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => { refresh(); }, [refresh]);

  const addClient = useCallback(async (data: { name: string; pan?: string; email?: string; phone?: string; formType?: string; assessmentYear?: string }) => {
    const client = await createClient(data);
    await refresh();
    return client;
  }, [refresh]);

  const editClient = useCallback(async (id: string, data: Partial<ClientData>) => {
    const updated = await updateClient(id, data);
    await refresh();
    return updated;
  }, [refresh]);

  const removeClient = useCallback(async (id: string) => {
    await deleteClient(id);
    await refresh();
  }, [refresh]);

  const createDraft = useCallback(async (clientId: string) => {
    const result = await createClientDraft(clientId);
    await refresh();
    return result;
  }, [refresh]);

  const bulkAdd = useCallback(async (data: Array<{ name: string; pan?: string; email?: string; phone?: string }>) => {
    const result = await bulkCreateClients(data);
    await refresh();
    return result;
  }, [refresh]);

  return {
    clients,
    summary,
    limit,
    used,
    loading,
    refresh,
    addClient,
    editClient,
    removeClient,
    createDraft,
    bulkAdd,
  };
}

export type ClientsManager = ReturnType<typeof useClientsManager>;
