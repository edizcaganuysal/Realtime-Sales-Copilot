'use client';

import { useEffect, useMemo, useState } from 'react';

type RequestItem = {
  id: string;
  requestType: 'CUSTOM_AGENT' | 'FINE_TUNE';
  status: string;
  title: string;
  requesterName: string | null;
  requesterEmail: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

const STATUS_OPTIONS = ['all', 'new', 'in_review', 'approved', 'rejected'];

export default function AdminRequestsPage() {
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [items, setItems] = useState<RequestItem[]>([]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError('');

      const query = status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
      const res = await fetch(`/api/admin/requests${query}`, { cache: 'no-store' });
      const data = await res.json().catch(() => []);

      if (!active) return;

      if (!res.ok) {
        setError(data?.message ?? 'Failed to load requests');
        setItems([]);
        setLoading(false);
        return;
      }

      setItems(Array.isArray(data) ? data : []);
      setLoading(false);
    }

    void load().catch(() => {
      if (!active) return;
      setError('Failed to load requests');
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [status]);

  const rows = useMemo(() => items, [items]);

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-white">Requests</h1>
          <p className="mt-1 text-sm text-slate-500">Custom agent and fine-tuning requests from your org.</p>
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === 'all' ? 'All statuses' : option}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl border border-slate-800 bg-slate-900 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-8 text-sm text-slate-500">
          No requests found.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-950/70 border-b border-slate-800">
              <tr>
                <th className="px-5 py-3 text-left text-xs uppercase tracking-wider text-slate-500">Time</th>
                <th className="px-5 py-3 text-left text-xs uppercase tracking-wider text-slate-500">Type</th>
                <th className="px-5 py-3 text-left text-xs uppercase tracking-wider text-slate-500">Status</th>
                <th className="px-5 py-3 text-left text-xs uppercase tracking-wider text-slate-500">Requester</th>
                <th className="px-5 py-3 text-left text-xs uppercase tracking-wider text-slate-500">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((row) => (
                <tr key={`${row.requestType}-${row.id}`}>
                  <td className="px-5 py-3 text-slate-300">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="px-5 py-3 text-slate-200">{row.requestType === 'CUSTOM_AGENT' ? 'Custom agent' : 'Fine-tune'}</td>
                  <td className="px-5 py-3 text-slate-300">{row.status}</td>
                  <td className="px-5 py-3 text-slate-300">
                    {row.requesterName || row.requesterEmail || '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-400 max-w-md">
                    <p className="line-clamp-2">{row.notes || '—'}</p>
                    {row.metadata && Object.keys(row.metadata).length > 0 && (
                      <p className="mt-1 text-xs text-slate-500 truncate">{JSON.stringify(row.metadata)}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
