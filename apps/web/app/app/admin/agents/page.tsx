'use client';

import { useEffect, useMemo, useState } from 'react';
import { AgentStatus } from '@live-sales-coach/shared';
import { X } from 'lucide-react';

type Agent = {
  id: string;
  name: string;
  prompt: string;
  scope: string;
  useDefaultTemplate?: boolean;
  promptDelta?: string;
  fullPromptOverride?: string | null;
  status: AgentStatus;
  ownerUserId: string | null;
  configJson?: Record<string, unknown>;
  createdAt: string;
};

const STATUS_BADGE: Partial<Record<AgentStatus, string>> = {
  APPROVED: 'bg-sky-500/15 text-sky-400',
  REJECTED: 'bg-red-500/15 text-red-400',
  PENDING_APPROVAL: 'bg-yellow-500/15 text-yellow-400',
  DRAFT: 'bg-slate-700 text-slate-300',
};

const INPUT_CLASS =
  'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-sky-500';

export default function AdminAgentsPage() {
  const [pending, setPending] = useState<Agent[]>([]);
  const [orgAgents, setOrgAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [reviewing, setReviewing] = useState<Agent | null>(null);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [form, setForm] = useState({
    name: '',
    prompt: '',
    scope: 'ORG',
    configText: '{}',
    useDefaultTemplate: true,
    promptDelta: '',
    fullPromptOverride: '',
  });

  async function load() {
    setLoading(true);
    setError('');
    const [pendingRes, orgRes] = await Promise.all([
      fetch('/api/agents?status=PENDING_APPROVAL'),
      fetch('/api/agents?scope=ORG'),
    ]);
    const [pendingData, orgData] = await Promise.all([pendingRes.json(), orgRes.json()]);
    setPending(Array.isArray(pendingData) ? pendingData : []);
    setOrgAgents(Array.isArray(orgData) ? orgData : []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function openEdit(agent: Agent) {
    setEditing(agent);
    setForm({
      name: agent.name,
      prompt: agent.prompt,
      scope: agent.scope,
      configText: JSON.stringify(agent.configJson ?? {}, null, 2),
      useDefaultTemplate: agent.useDefaultTemplate ?? true,
      promptDelta: agent.promptDelta ?? agent.prompt ?? '',
      fullPromptOverride: agent.fullPromptOverride ?? '',
    });
    setError('');
  }

  async function handleAction(agentId: string, action: 'approve' | 'reject') {
    setActioning(agentId + action);
    setError('');
    const res = await fetch(`/api/agents/${agentId}/${action}`, { method: 'POST' });
    const data = await res.json();
    setActioning(null);
    if (!res.ok) {
      setError(data?.message ?? `Failed to ${action} agent`);
      return;
    }
    setReviewing(null);
    await load();
  }

  async function handleSaveEdit() {
    if (!editing) return;
    setActioning(editing.id + 'edit');
    setError('');
    let parsedConfig: Record<string, unknown>;
    try {
      parsedConfig = JSON.parse(form.configText);
    } catch {
      setError('Config JSON is invalid.');
      setActioning(null);
      return;
    }

    const res = await fetch(`/api/agents/${editing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        prompt: form.prompt,
        scope: form.scope,
        configJson: parsedConfig,
        useDefaultTemplate: form.useDefaultTemplate,
        promptDelta: form.promptDelta,
        fullPromptOverride: form.fullPromptOverride.trim() ? form.fullPromptOverride : null,
      }),
    });
    const data = await res.json();
    setActioning(null);
    if (!res.ok) {
      setError(data?.message ?? 'Failed to save agent');
      return;
    }
    setEditing(null);
    await load();
  }

  async function handleDelete(agent: Agent) {
    if (!confirm(`Delete "${agent.name}"?`)) return;
    setActioning(agent.id + 'delete');
    setError('');
    const res = await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' });
    const data = await res.json();
    setActioning(null);
    if (!res.ok) {
      setError(data?.message ?? 'Failed to delete agent');
      return;
    }
    await load();
  }

  const sortedOrgAgents = useMemo(
    () => [...orgAgents].sort((a, b) => a.name.localeCompare(b.name)),
    [orgAgents],
  );

  if (loading) {
    return (
      <div className="p-8 space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 bg-slate-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl space-y-10">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-white">Pending Approval</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Review prompt and settings before approving/rejecting.
          </p>
        </div>

        {pending.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-5 py-8 text-center">
            <p className="text-slate-500 text-sm">No pending agents</p>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800">
            {pending.map((agent) => (
              <div key={agent.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-white">{agent.name}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-medium">
                        {agent.scope}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-2">{agent.prompt}</p>
                    <p className="text-xs text-slate-600 mt-1">
                      Created {new Date(agent.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setReviewing(agent)}
                      className="text-xs px-2.5 py-1 border border-slate-600 hover:border-slate-400 text-slate-300 rounded-lg transition-colors"
                    >
                      Review
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-white">Org Agents</h2>
          <p className="text-xs text-slate-500 mt-0.5">Edit or delete pre-made and org-shared agents</p>
        </div>

        {sortedOrgAgents.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-5 py-8 text-center">
            <p className="text-slate-500 text-sm">No org agents yet</p>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-5 py-3">
                    Name
                  </th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-5 py-3">
                    Status
                  </th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-5 py-3">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {sortedOrgAgents.map((agent) => (
                  <tr key={agent.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="text-white font-medium">{agent.name}</p>
                      <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">{agent.prompt}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${STATUS_BADGE[agent.status] ?? ''}`}>
                        {agent.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(agent)}
                          className="text-xs px-2.5 py-1 border border-slate-600 hover:border-slate-400 text-slate-300 rounded-lg transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(agent)}
                          disabled={actioning === agent.id + 'delete'}
                          className="text-xs px-2.5 py-1 border border-red-500/30 hover:border-red-500/60 text-red-400 rounded-lg transition-colors disabled:opacity-40"
                        >
                          {actioning === agent.id + 'delete' ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {reviewing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold text-base">Review Agent</h3>
              <button onClick={() => setReviewing(null)} className="text-slate-500 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 mb-5">
              <div className="text-sm">
                <span className="text-slate-400">Name: </span>
                <span className="text-white">{reviewing.name}</span>
              </div>
              <div className="text-sm">
                <span className="text-slate-400">Scope: </span>
                <span className="text-white">{reviewing.scope}</span>
              </div>
              <div className="text-sm">
                <span className="text-slate-400">Status: </span>
                <span className="text-white">{reviewing.status}</span>
              </div>

              <div>
                <p className="text-xs text-slate-400 mb-1.5">Prompt</p>
                <pre className="whitespace-pre-wrap text-xs bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-200">
                  {reviewing.prompt}
                </pre>
              </div>

              <div>
                <p className="text-xs text-slate-400 mb-1.5">Config</p>
                <pre className="whitespace-pre-wrap text-xs bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-200">
                  {JSON.stringify(reviewing.configJson ?? {}, null, 2)}
                </pre>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleAction(reviewing.id, 'reject')}
                disabled={!!actioning}
                className="text-xs px-3 py-1.5 border border-red-500/30 hover:border-red-500/60 text-red-400 rounded-lg transition-colors disabled:opacity-40"
              >
                {actioning === reviewing.id + 'reject' ? 'Rejecting...' : 'Reject'}
              </button>
              <button
                onClick={() => handleAction(reviewing.id, 'approve')}
                disabled={!!actioning}
                className="text-xs px-3 py-1.5 bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors text-white disabled:opacity-40"
              >
                {actioning === reviewing.id + 'approve' ? 'Approving...' : 'Approve'}
              </button>
              <button
                onClick={() => openEdit(reviewing)}
                className="text-xs px-3 py-1.5 border border-slate-600 hover:border-slate-400 text-slate-300 rounded-lg transition-colors"
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold text-base">Edit Agent</h3>
              <button onClick={() => setEditing(null)} className="text-slate-500 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Prompt</label>
                <textarea
                  rows={7}
                  value={form.prompt}
                  onChange={(e) => setForm((p) => ({ ...p, prompt: e.target.value }))}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Prompt mode</label>
                <select
                  value={form.useDefaultTemplate ? 'DEFAULT' : 'FULL'}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, useDefaultTemplate: e.target.value === 'DEFAULT' }))
                  }
                  className={INPUT_CLASS}
                >
                  <option value="DEFAULT">Default template + context + delta</option>
                  <option value="FULL">Context + full override prompt</option>
                </select>
              </div>
              {form.useDefaultTemplate ? (
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Agent add-on prompt (delta)</label>
                  <textarea
                    rows={5}
                    value={form.promptDelta}
                    onChange={(e) => setForm((p) => ({ ...p, promptDelta: e.target.value }))}
                    className={INPUT_CLASS}
                  />
                </div>
              ) : (
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Full prompt override</label>
                  <textarea
                    rows={6}
                    value={form.fullPromptOverride}
                    onChange={(e) => setForm((p) => ({ ...p, fullPromptOverride: e.target.value }))}
                    className={INPUT_CLASS}
                  />
                </div>
              )}
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Scope</label>
                <select
                  value={form.scope}
                  onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value }))}
                  className={INPUT_CLASS}
                >
                  <option value="ORG">ORG</option>
                  <option value="PERSONAL">PERSONAL</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">Config JSON</label>
                <textarea
                  rows={6}
                  value={form.configText}
                  onChange={(e) => setForm((p) => ({ ...p, configText: e.target.value }))}
                  className={INPUT_CLASS}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={handleSaveEdit}
                disabled={!!actioning}
                className="text-xs px-3 py-1.5 bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors text-white disabled:opacity-40"
              >
                {actioning === editing.id + 'edit' ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => setEditing(null)}
                className="text-xs px-3 py-1.5 border border-slate-600 hover:border-slate-400 text-slate-300 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
