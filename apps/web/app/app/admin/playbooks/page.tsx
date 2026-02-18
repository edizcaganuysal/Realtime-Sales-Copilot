'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Playbook = {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
};

export default function PlaybooksPage() {
  const router = useRouter();
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const res = await fetch('/api/playbooks');
    const data = await res.json();
    setPlaybooks(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError('');
    const res = await fetch('/api/playbooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (res.ok) {
      const pb = await res.json();
      setShowNew(false);
      setNewName('');
      router.push(`/app/admin/playbooks/${pb.id}`);
    } else {
      const d = await res.json();
      setError(d.message ?? 'Failed to create');
      setCreating(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-white">Playbooks</h1>
          <p className="text-sm text-slate-500 mt-1">Define call stages and coaching checklists</p>
        </div>
        <button
          onClick={() => { setShowNew(true); setError(''); }}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          New playbook
        </button>
      </div>

      {showNew && (
        <form onSubmit={handleCreate} className="mb-5 bg-slate-900 border border-slate-800 rounded-xl p-4 flex gap-3 items-start">
          <div className="flex-1">
            <input
              autoFocus
              required
              maxLength={100}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Playbook name"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {error && <p className="text-red-400 text-xs mt-1.5">{error}</p>}
          </div>
          <button
            type="submit"
            disabled={creating}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
          <button
            type="button"
            onClick={() => setShowNew(false)}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 text-sm font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
        </form>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 bg-slate-800 rounded animate-pulse" />
            ))}
          </div>
        ) : playbooks.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-12">
            No playbooks yet. Create one to get started.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {playbooks.map((pb) => (
              <li
                key={pb.id}
                className="flex items-center justify-between px-5 py-4 hover:bg-slate-800/40 cursor-pointer transition-colors"
                onClick={() => router.push(`/app/admin/playbooks/${pb.id}`)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-white">{pb.name}</span>
                  {pb.isDefault && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium">
                      Default
                    </span>
                  )}
                </div>
                <span className="text-xs text-slate-500">
                  {new Date(pb.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
