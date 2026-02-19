'use client';

import { useEffect, useState } from 'react';
import { Bot, Plus, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { INPUT_BASE } from '@/components/ui/form-field';

type Agent = {
  id: string;
  name: string;
  prompt: string;
  useDefaultTemplate?: boolean;
  promptDelta?: string | null;
  fullPromptOverride?: string | null;
  createdAt: string;
};

type AgentForm = {
  name: string;
  useDefaultTemplate: boolean;
  promptDelta: string;
  fullPromptOverride: string;
};

const DEFAULT_FORM: AgentForm = {
  name: '',
  useDefaultTemplate: true,
  promptDelta: '',
  fullPromptOverride: '',
};

function toForm(agent: Agent): AgentForm {
  const useDefaultTemplate = agent.useDefaultTemplate ?? true;
  return {
    name: agent.name,
    useDefaultTemplate,
    promptDelta: agent.promptDelta?.trim() || agent.prompt.trim(),
    fullPromptOverride: agent.fullPromptOverride?.trim() || agent.prompt.trim(),
  };
}

function toPayload(form: AgentForm) {
  const trimmedName = form.name.trim();
  const delta = form.promptDelta.trim();
  const full = form.fullPromptOverride.trim();
  const useDefaultTemplate = form.useDefaultTemplate;
  const fallbackPrompt = useDefaultTemplate ? delta : full;

  return {
    name: trimmedName,
    prompt: fallbackPrompt,
    useDefaultTemplate,
    promptDelta: useDefaultTemplate ? delta : '',
    fullPromptOverride: useDefaultTemplate ? null : full,
  };
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [form, setForm] = useState<AgentForm>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadAgents();
  }, []);

  async function loadAgents() {
    setLoading(true);
    const res = await fetch('/api/agents', { cache: 'no-store' });
    const data = await res.json().catch(() => []);
    setAgents(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  function openCreate() {
    setEditAgent(null);
    setForm(DEFAULT_FORM);
    setError('');
    setShowModal(true);
  }

  function openEdit(agent: Agent) {
    setEditAgent(agent);
    setForm(toForm(agent));
    setError('');
    setShowModal(true);
  }

  async function handleSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    const payload = toPayload(form);
    if (!payload.name) {
      setError('Agent name is required.');
      return;
    }
    if (payload.useDefaultTemplate && !payload.promptDelta.trim()) {
      setError('Agent add-on instructions are required.');
      return;
    }
    if (!payload.useDefaultTemplate && !payload.fullPromptOverride?.trim()) {
      setError('Full agent prompt is required.');
      return;
    }

    setSubmitting(true);
    setError('');

    const res = editAgent
      ? await fetch(`/api/agents/${editAgent.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

    const data = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (!res.ok) {
      setError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to save agent'));
      return;
    }

    setShowModal(false);
    setEditAgent(null);
    setForm(DEFAULT_FORM);
    await loadAgents();
  }

  async function handleDeleteAgent(agentId: string, name: string) {
    if (!confirm(`Delete "${name}"?`)) return;
    const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
    if (res.ok) {
      setAgents((prev) => prev.filter((agent) => agent.id !== agentId));
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      <PageHeader
        title="Agents"
        description="Create and manage your personal coaching agents."
        actions={
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-500"
          >
            <Plus size={14} />
            New agent
          </button>
        }
      />

      {loading ? (
        <LoadingSkeleton count={3} height="h-20" />
      ) : agents.length === 0 ? (
        <EmptyState icon={Bot} message="No agents yet" className="py-16" />
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <div key={agent.id} className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{agent.name}</span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300">
                      {(agent.useDefaultTemplate ?? true) ? 'Default template' : 'Full prompt'}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs text-slate-500">
                    {(agent.useDefaultTemplate ?? true)
                      ? (agent.promptDelta?.trim() || agent.prompt)
                      : (agent.fullPromptOverride?.trim() || agent.prompt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openEdit(agent)}
                    className="rounded-md border border-slate-600 px-2.5 py-1 text-xs text-slate-200 transition-colors hover:border-slate-400"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => void handleDeleteAgent(agent.id, agent.name)}
                    className="rounded-md border border-red-500/30 px-2.5 py-1 text-xs text-red-400 transition-colors hover:border-red-500/60"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-xl rounded-xl border border-slate-800 bg-slate-900 p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">{editAgent ? 'Edit agent' : 'New agent'}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmitForm} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs text-slate-400">Name</label>
                <input
                  required
                  maxLength={100}
                  className={INPUT_BASE}
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Example: Discovery Coach"
                />
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={form.useDefaultTemplate}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, useDefaultTemplate: e.target.checked }))
                    }
                  />
                  Use default sales template
                </label>
                <p className="mt-1 text-xs text-slate-500">
                  Recommended. Keep this on unless you need a complete custom prompt.
                </p>
              </div>

              {form.useDefaultTemplate ? (
                <div>
                  <label className="mb-1.5 block text-xs text-slate-400">Agent add-on instructions</label>
                  <textarea
                    required
                    rows={6}
                    className={INPUT_BASE + ' resize-none'}
                    value={form.promptDelta}
                    onChange={(e) => setForm((prev) => ({ ...prev, promptDelta: e.target.value }))}
                    placeholder="Example: Focus on sharp discovery questions and concise objection handling."
                  />
                </div>
              ) : (
                <div>
                  <label className="mb-1.5 block text-xs text-slate-400">Full agent prompt</label>
                  <textarea
                    required
                    rows={8}
                    className={INPUT_BASE + ' resize-none'}
                    value={form.fullPromptOverride}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, fullPromptOverride: e.target.value }))
                    }
                    placeholder="Paste the full prompt this agent should use."
                  />
                </div>
              )}

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 rounded-lg bg-sky-600 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editAgent ? 'Save changes' : 'Create agent'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 rounded-lg bg-slate-800 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
