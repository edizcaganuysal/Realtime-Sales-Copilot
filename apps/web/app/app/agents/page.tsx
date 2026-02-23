'use client';

import { useEffect, useState } from 'react';
import { Plus, Target, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { INPUT_BASE } from '@/components/ui/form-field';

type SalesRules = {
  spin?: boolean;
  anti_repeat?: boolean;
  concise?: boolean;
  next_step?: boolean;
  challenger?: boolean;
  feature_last?: boolean;
  no_filler?: boolean;
};

type Agent = {
  id: string;
  name: string;
  prompt: string;
  useDefaultTemplate?: boolean;
  promptDelta?: string | null;
  fullPromptOverride?: string | null;
  configJson?: { rules?: SalesRules } | null;
  openers?: string[] | null;
  createdAt: string;
};

type AgentForm = {
  name: string;
  useDefaultTemplate: boolean;
  promptDelta: string;
  fullPromptOverride: string;
  rules: SalesRules;
  openers: string[];
};

const RULE_DEFS: { key: keyof SalesRules; label: string; description: string; recommended: boolean }[] = [
  { key: 'spin', label: 'SPIN discovery', description: 'Ask Situation/Problem/Implication/Need questions before pitching.', recommended: true },
  { key: 'anti_repeat', label: 'No repetition', description: 'Never repeat a value prop or differentiator already used this call.', recommended: true },
  { key: 'concise', label: 'Short suggestions', description: 'All suggestions must be 1–2 speakable sentences. No paragraphs.', recommended: true },
  { key: 'next_step', label: 'Push next steps', description: 'Periodically propose a concrete next step (calendar hold, pilot, short call).', recommended: true },
  { key: 'challenger', label: 'Challenger insights', description: 'Share a concise reframing insight when prospect is stuck on status quo.', recommended: true },
  { key: 'feature_last', label: 'Discovery before features', description: 'Never lead with product features — always start with the prospect\'s situation.', recommended: false },
  { key: 'no_filler', label: 'No generic openers', description: 'Never start with "I understand", "That makes sense", "Great question", etc.', recommended: false },
];

const DEFAULT_RULES: SalesRules = {
  spin: true,
  anti_repeat: true,
  concise: true,
  next_step: true,
  challenger: true,
  feature_last: false,
  no_filler: false,
};

const DEFAULT_FORM: AgentForm = {
  name: '',
  useDefaultTemplate: true,
  promptDelta: '',
  fullPromptOverride: '',
  rules: { ...DEFAULT_RULES },
  openers: [],
};

function toForm(agent: Agent): AgentForm {
  const savedRules = agent.configJson?.rules ?? {};
  const rules: SalesRules = {};
  for (const def of RULE_DEFS) {
    rules[def.key] = savedRules[def.key] !== undefined ? savedRules[def.key] : def.recommended;
  }
  return {
    name: agent.name,
    useDefaultTemplate: agent.useDefaultTemplate ?? true,
    promptDelta: agent.promptDelta?.trim() || agent.prompt.trim(),
    fullPromptOverride: agent.fullPromptOverride?.trim() || agent.prompt.trim(),
    rules,
    openers: Array.isArray(agent.openers) ? agent.openers : [],
  };
}

function toPayload(form: AgentForm) {
  const trimmedName = form.name.trim();
  const delta = form.promptDelta.trim();

  return {
    name: trimmedName,
    prompt: delta,
    useDefaultTemplate: true,
    promptDelta: delta,
    fullPromptOverride: null,
    configJson: { rules: form.rules },
    openers: form.openers.map((o) => o.trim()).filter((o) => o.length > 0),
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
  const [newOpener, setNewOpener] = useState('');
  const [draftingOpeners, setDraftingOpeners] = useState(false);
  const [generatingStrategy, setGeneratingStrategy] = useState(false);

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
    setNewOpener('');
    setError('');
    setShowModal(true);
  }

  function openEdit(agent: Agent) {
    setEditAgent(agent);
    setForm(toForm(agent));
    setNewOpener('');
    setError('');
    setShowModal(true);
  }

  async function handleSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    const payload = toPayload(form);
    if (!payload.name) {
      setError('Strategy name is required.');
      return;
    }
    if (!payload.promptDelta.trim()) {
      setError('Strategy instructions are required.');
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
    setNewOpener('');
    await loadAgents();
  }

  async function handleDeleteAgent(agentId: string, name: string) {
    if (!confirm(`Delete "${name}"?`)) return;
    const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
    if (res.ok) {
      setAgents((prev) => prev.filter((agent) => agent.id !== agentId));
    }
  }

  function addOpener() {
    const trimmed = newOpener.trim();
    if (!trimmed) return;
    setForm((prev) => ({ ...prev, openers: [...prev.openers, trimmed] }));
    setNewOpener('');
  }

  function removeOpener(idx: number) {
    setForm((prev) => ({ ...prev, openers: prev.openers.filter((_, i) => i !== idx) }));
  }

  async function handleDraftOpeners() {
    if (!editAgent) return;
    setDraftingOpeners(true);
    const res = await fetch(`/api/agents/${editAgent.id}/draft-openers`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setDraftingOpeners(false);
    if (res.ok && Array.isArray(data?.openers)) {
      setForm((prev) => ({ ...prev, openers: data.openers as string[] }));
    }
  }

  async function handleGenerateStrategy() {
    setGeneratingStrategy(true);
    let agentId = editAgent?.id;

    if (!agentId) {
      // Auto-save the agent first to get an ID, then generate
      const trimmedName = form.name.trim();
      if (!trimmedName) {
        setError('Enter a strategy name first, then generate.');
        setGeneratingStrategy(false);
        return;
      }
      const saveRes = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...toPayload(form),
          promptDelta: form.promptDelta.trim() || 'Generating from context…',
          prompt: form.promptDelta.trim() || 'Generating from context…',
        }),
      });
      const savedData = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        setError(Array.isArray(savedData?.message) ? savedData.message[0] : (savedData?.message ?? 'Failed to create agent'));
        setGeneratingStrategy(false);
        return;
      }
      agentId = (savedData as { id: string }).id;
      setEditAgent(savedData as Agent);
      void loadAgents();
    }

    const res = await fetch(`/api/agents/${agentId}/generate-strategy`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setGeneratingStrategy(false);
    if (res.ok && typeof data?.strategy === 'string') {
      setForm((prev) => ({ ...prev, promptDelta: data.strategy }));
    }
  }

  function toggleRule(key: keyof SalesRules) {
    setForm((prev) => ({
      ...prev,
      rules: { ...prev.rules, [key]: !prev.rules[key] },
    }));
  }

  return (
    <div className="p-8 max-w-4xl">
      <PageHeader
        title="Copilot Strategy"
        description="Define how your sales copilot should behave. Add an opening line and write how you want it to respond — length, tone, focus areas."
        actions={
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-500"
          >
            <Plus size={14} />
            New strategy
          </button>
        }
      />

      {loading ? (
        <LoadingSkeleton count={3} height="h-20" />
      ) : agents.length === 0 ? (
        <EmptyState
          icon={Target}
          message="No strategies yet"
          className="py-16"
          action={
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sky-500"
            >
              <Plus size={14} />
              Create strategy
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <div key={agent.id} className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{agent.name}</span>
                    {Array.isArray(agent.openers) && agent.openers.length > 0 && (
                      <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] text-sky-300">
                        {agent.openers.length} opener{agent.openers.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-2 text-xs text-slate-500">
                    {agent.promptDelta?.trim() || agent.prompt}
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
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 overflow-y-auto py-8">
          <div className="w-full max-w-xl rounded-xl border border-slate-800 bg-slate-900 p-6 mx-4 my-auto">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">{editAgent ? 'Edit strategy' : 'New strategy'}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmitForm} className="space-y-5">
              <div>
                <label className="mb-1.5 block text-xs text-slate-400">Name</label>
                <input
                  required
                  maxLength={100}
                  className={INPUT_BASE}
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Example: Discovery-First, Enterprise Closer"
                />
              </div>

              {/* Fundamental rules toggles */}
              <div>
                <label className="mb-0.5 block text-xs text-slate-400">Fundamental Rules</label>
                <p className="mb-2.5 text-[11px] text-slate-500">Toggle the rules the copilot should follow during calls.</p>
                <div className="space-y-1.5">
                  {RULE_DEFS.map((rule) => (
                    <button
                      key={rule.key}
                      type="button"
                      onClick={() => toggleRule(rule.key)}
                      className={`w-full flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        form.rules[rule.key]
                          ? 'border-sky-500/40 bg-sky-500/10'
                          : 'border-slate-700 bg-slate-800/40'
                      }`}
                    >
                      <div className={`mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center transition-colors ${
                        form.rules[rule.key]
                          ? 'border-sky-500 bg-sky-500'
                          : 'border-slate-600'
                      }`}>
                        {form.rules[rule.key] && (
                          <svg viewBox="0 0 10 8" className="w-2.5 h-2" fill="none">
                            <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-slate-200">{rule.label}</span>
                          {rule.recommended && (
                            <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[10px] text-emerald-400">Recommended</span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">{rule.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Strategy instructions */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs text-slate-400">Strategy instructions</label>
                  <button
                    type="button"
                    disabled={generatingStrategy}
                    onClick={handleGenerateStrategy}
                    className="text-[11px] rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-sky-300 transition-colors hover:border-sky-500/60 disabled:opacity-50"
                  >
                    {generatingStrategy ? 'Generating...' : 'Generate from Context'}
                  </button>
                </div>
                <p className="mb-2 text-[11px] text-slate-500">Describe how you want the copilot to behave. Write in plain language — no prompt engineering needed.</p>
                <textarea
                  required
                  rows={5}
                  className={INPUT_BASE + ' resize-none'}
                  value={form.promptDelta}
                  onChange={(e) => setForm((prev) => ({ ...prev, promptDelta: e.target.value }))}
                  placeholder={"Examples:\n• 'Keep suggestions under 15 words.'\n• 'Always ask about timeline before proposing next steps.'\n• 'Focus on ROI discovery before pitching features.'\n• 'Use a consultative, not pushy, tone.'"}
                />
              </div>

              {/* Openers */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div>
                    <label className="text-xs text-slate-400">Openers</label>
                    <p className="text-[11px] text-slate-600 mt-0.5">1 sentence openers. Keep under ~18 words.</p>
                  </div>
                  {editAgent && (
                    <button
                      type="button"
                      disabled={draftingOpeners}
                      onClick={handleDraftOpeners}
                      className="text-[11px] rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-sky-300 transition-colors hover:border-sky-500/60 disabled:opacity-50"
                    >
                      {draftingOpeners ? 'Drafting...' : 'AI Draft Openers'}
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {form.openers.map((opener, idx) => (
                    <div key={idx} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1.5">
                      {idx === 0 && (
                        <span className="shrink-0 rounded bg-sky-500/20 px-1 py-0.5 text-[10px] text-sky-300">Default</span>
                      )}
                      <span className="flex-1 text-xs text-slate-300 truncate">{opener}</span>
                      <button
                        type="button"
                        onClick={() => removeOpener(idx)}
                        className="shrink-0 text-slate-600 hover:text-red-400 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <input
                      className={INPUT_BASE + ' text-xs py-1.5'}
                      placeholder="Type an opener and press Add..."
                      value={newOpener}
                      onChange={(e) => setNewOpener(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); addOpener(); }
                      }}
                    />
                    <button
                      type="button"
                      onClick={addOpener}
                      className="shrink-0 rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-400 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 rounded-lg bg-sky-600 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editAgent ? 'Save changes' : 'Create strategy'}
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
