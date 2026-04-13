import { useState, useRef } from 'react';
import { Plus, Trash2, FileText, Upload, Users, CheckCircle, Clock, AlertTriangle, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useClientsManager } from '../../hooks/useClientsManager';
import type { ClientData } from '../../services/api';
import toast from 'react-hot-toast';
import Papa from 'papaparse';

const STATUS_LABELS: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: 'Pending', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400', icon: Clock },
  draft: { label: 'Draft', color: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400', icon: FileText },
  validated: { label: 'Validated', color: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400', icon: CheckCircle },
  exported: { label: 'Exported', color: 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400', icon: FileText },
  filed: { label: 'Filed', color: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400', icon: CheckCircle },
  verified: { label: 'Verified', color: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400', icon: CheckCircle },
};

export function ClientDashboard() {
  const mgr = useClientsManager();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', pan: '', email: '', phone: '', formType: 'ITR1' });
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = mgr.clients.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.pan ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const handleAdd = async () => {
    if (!addForm.name.trim()) return;
    try {
      await mgr.addClient(addForm);
      setAddForm({ name: '', pan: '', email: '', phone: '', formType: 'ITR1' });
      setShowAdd(false);
      toast.success('Client added');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add client');
    }
  };

  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const text = ev.target?.result as string;
        const result = Papa.parse(text, { header: true, skipEmptyLines: true });
        const rows = result.data as Record<string, string>[];
        const clients = rows.map(r => ({
          name: r.name || r.Name || r.CLIENT_NAME || '',
          pan: r.pan || r.PAN || r.Pan || '',
          email: r.email || r.Email || r.EMAIL || '',
          phone: r.phone || r.Phone || r.PHONE || r.mobile || r.Mobile || '',
        })).filter(c => c.name.trim().length > 0);

        if (clients.length === 0) {
          toast.error('No valid clients found in CSV. Need a "name" column.');
          return;
        }
        const result2 = await mgr.bulkAdd(clients);
        toast.success(`${result2.created} clients imported${result2.skipped > 0 ? `, ${result2.skipped} skipped (limit)` : ''}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'CSV import failed');
      }
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleCreateDraft = async (client: ClientData) => {
    try {
      await mgr.createDraft(client.id);
      toast.success(`Draft created for ${client.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create draft');
    }
  };

  const total = mgr.clients.length;
  const statusCounts = mgr.summary;

  return (
    <div className="flex-1 flex flex-col p-4 md:p-6 overflow-y-auto">
      <div className="max-w-5xl mx-auto w-full space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
              <Users className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Client Manager</h1>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {total} client{total !== 1 ? 's' : ''} · {mgr.used}/{mgr.limit} used
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors">
              <Upload className="w-3.5 h-3.5" />
              Import CSV
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSVImport} />
            </label>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Client
            </button>
          </div>
        </div>

        {/* Status summary */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {['pending', 'draft', 'validated', 'exported', 'filed', 'verified'].map(s => {
            const info = STATUS_LABELS[s];
            const Icon = info.icon;
            return (
              <div key={s} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3 text-center">
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{statusCounts[s] ?? 0}</p>
                <p className="text-[10px] font-medium text-gray-500 uppercase">{info.label}</p>
              </div>
            );
          })}
        </div>

        {/* Add client form */}
        {showAdd && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Add new client</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input value={addForm.name} onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Client name *" className="px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-gray-900 dark:text-gray-100" />
              <input value={addForm.pan} onChange={e => setAddForm(p => ({ ...p, pan: e.target.value.toUpperCase() }))}
                placeholder="PAN" maxLength={10} className="px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-gray-900 dark:text-gray-100 font-mono" />
              <input value={addForm.email} onChange={e => setAddForm(p => ({ ...p, email: e.target.value }))}
                placeholder="Email" className="px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-gray-900 dark:text-gray-100" />
              <input value={addForm.phone} onChange={e => setAddForm(p => ({ ...p, phone: e.target.value }))}
                placeholder="Phone" className="px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-gray-900 dark:text-gray-100" />
            </div>
            <div className="flex gap-2">
              <button onClick={handleAdd} disabled={!addForm.name.trim()}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50">
                Add
              </button>
              <button onClick={() => setShowAdd(false)}
                className="px-4 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or PAN..."
            className="w-full pl-10 pr-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-gray-900 dark:text-gray-100"
          />
        </div>

        {/* Client list */}
        {mgr.loading ? (
          <p className="text-sm text-gray-400 text-center py-8">Loading clients...</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-400">{search ? 'No matching clients' : 'No clients yet. Add one to get started.'}</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Client</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">PAN</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Form</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const status = STATUS_LABELS[c.filing_status] ?? STATUS_LABELS.pending;
                  return (
                    <tr key={c.id} className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 dark:text-gray-100">{c.name}</p>
                        {c.email && <p className="text-[11px] text-gray-400">{c.email}</p>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{c.pan || '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{c.form_type} · AY {c.assessment_year}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold', status.color)}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-1 justify-end">
                          {!c.itr_draft_id && (
                            <button
                              onClick={() => handleCreateDraft(c)}
                              className="px-2 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded transition-colors"
                              title="Create ITR draft"
                            >
                              Create Draft
                            </button>
                          )}
                          {c.itr_draft_id && (
                            <span className="px-2 py-1 text-[11px] text-gray-400">Draft linked</span>
                          )}
                          <button
                            onClick={async () => { await mgr.removeClient(c.id); toast.success('Client removed'); }}
                            className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                            title="Delete client"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
