'use client';

import { useEffect, useState } from 'react';
import { AgentScope, AgentStatus, Role } from '@live-sales-coach/shared';
import type { MeResponse } from '@live-sales-coach/shared';
import { Bot, Plus, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { INPUT_BASE } from '@/components/ui/form-field';

type Agent = {
  id: string;
  name: string;
  prompt: string;
  scope: AgentScope;
  status: AgentStatus;
  ownerUserId: string | null;
  createdAt: string;
};

const STATUS_MAP: Record<AgentStatus, { label: string; variant: 'neutral' | 'warning' | 'success' | 'error' }> = {
  DRAFT: { label: 'Draft', variant: 'neutral' },
  PENDING_APPROVAL: { label: 'Pending', variant: 'warning' },
  APPROVED: { label: 'Approved', variant: 'success' },
  REJECTED: { label: 'Rejected', variant: 'error' },
};

type Tab = 'company' | 'mine' | 'pending';

export default function AgentsPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tab, setTab] = useState<Tab>('company');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [form, setForm] = useState({ name: '', prompt: '', scope: AgentScope.PERSONAL });
  const [requestForm, setRequestForm] = useState({ useCase: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestSuccess, setRequestSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then(setMe);
  }, []);

  useEffect(() => { loadAgents(); }, [tab]);

  async function loadAgents() {
    setLoading(true);
    const params =
      tab === 'company' ? '?scope=ORG&status=APPROVED'
      : tab === 'mine'  ? '?scope=PERSONAL'
                        : '?status=PENDING_APPROVAL';
    const res = await fetch('/api/agents' + params);
    const data = await res.json();
    setAgents(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  function openCreate() {
    setEditAgent(null);
    setForm({ name: '', prompt: '', scope: AgentScope.PERSONAL });
    setError('');
    setShowModal(true);
  }

  function openEdit(agent: Agent) {
    setEditAgent(agent);
    setForm({ name: agent.name, prompt: agent.prompt, scope: agent.scope });
    setError('');
    setShowModal(true);
  }

  async function handleSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    const res = editAgent
      ? await fetch('/api/agents/' + editAgent.id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: form.name, prompt: form.prompt }),
        })
      : await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
    if (!res.ok) {
      const d = await res.json();
      setError(Array.isArray(d.message) ? d.message[0] : (d.message ?? 'Failed'));
      setSubmitting(false);
      return;
    }
    setShowModal(false);
    setSubmitting(false);
    if (tab === 'mine') await loadAgents(); else setTab('mine');
  }

  async function handleSubmitAgent(agentId: string) {
    const res = await fetch('/api/agents/' + agentId + '/submit', { method: 'POST' });
    if (res.ok) await loadAgents();
  }

  async function handleDeleteAgent(agentId: string, name: string) {
    if (!confirm(`Delete "${name}"?`)) return;
    const res = await fetch('/api/agents/' + agentId, { method: 'DELETE' });
    if (res.ok) await loadAgents();
  }

  async function handleSubmitCustomAgentRequest(e: React.FormEvent) {
    e.preventDefault();
    setRequestSubmitting(true);
    setError('');
    const res = await fetch('/api/requests/custom-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        use_case: requestForm.useCase,
        notes: requestForm.notes,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setRequestSubmitting(false);
    if (!res.ok) {
      setError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to submit request'));
      return;
    }
    setShowRequestModal(false);
    setRequestForm({ useCase: '', notes: '' });
    setRequestSuccess('Custom agent build request submitted.');
    setTimeout(() => setRequestSuccess(''), 3000);
  }

  const isRep = me?.user.role === Role.REP;
  const canCreate = !isRep || (me?.orgSettings.allowRepAgentCreation ?? true);
  const canRequestCustomAgent = me?.user.role === Role.ADMIN || me?.user.role === Role.MANAGER;
  const TABS: { id: Tab; label: string }[] = [
    { id: 'company', label: 'Company' },
    { id: 'mine', label: 'My agents' },
    ...(!isRep ? [{ id: 'pending' as Tab, label: 'Pending' }] : []),
  ];

  return (
    <div className="p-8 max-w-4xl">
      <PageHeader
        title="Agents"
        actions={
          <>
            {canRequestCustomAgent && (
              <button
                onClick={() => {
                  setError('');
                  setShowRequestModal(true);
                }}
                className="px-3 py-1.5 border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 text-sky-200 text-sm font-medium rounded-lg transition-colors"
              >
                Request custom agent build
              </button>
            )}
            {canCreate && (
              <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium rounded-lg transition-colors">
                <Plus size={14} /> New agent
              </button>
            )}
          </>
        }
      />

      {requestSuccess && (
        <div className="mb-4 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-300">
          {requestSuccess}
        </div>
      )}

      <div className="flex gap-1 mb-5 bg-slate-900 border border-slate-800 rounded-xl p-1 w-fit">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ' + (tab === t.id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300')}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSkeleton count={3} height="h-20" />
      ) : agents.length === 0 ? (
        <EmptyState icon={Bot} message="No agents here yet" className="py-16" />
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <div key={agent.id} className="bg-slate-900 border border-slate-800 rounded-xl px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-white">{agent.name}</span>
                    <StatusBadge variant={STATUS_MAP[agent.status].variant}>{STATUS_MAP[agent.status].label}</StatusBadge>
                    {agent.scope === AgentScope.ORG && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-medium">ORG</span>}
                  </div>
                  <p className="text-xs text-slate-500 line-clamp-2">{agent.prompt}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {(agent.status === AgentStatus.DRAFT || agent.status === AgentStatus.REJECTED) && (
                    <>
                      <button onClick={() => openEdit(agent)} className="text-xs text-slate-400 hover:text-white transition-colors">Edit</button>
                      <button onClick={() => handleSubmitAgent(agent.id)} className="text-xs px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors">Submit</button>
                      <button
                        onClick={() => handleDeleteAgent(agent.id, agent.name)}
                        className="text-xs px-2.5 py-1 border border-red-500/30 hover:border-red-500/60 text-red-400 rounded-lg transition-colors"
                      >
                        Delete
                      </button>
                    </>
                  )}
                  {agent.status === AgentStatus.PENDING_APPROVAL && (
                    <>
                      <span className="text-xs text-slate-500">Awaiting review</span>
                      <button
                        onClick={() => handleDeleteAgent(agent.id, agent.name)}
                        className="text-xs px-2.5 py-1 border border-red-500/30 hover:border-red-500/60 text-red-400 rounded-lg transition-colors"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-white">{editAgent ? 'Edit agent' : 'New agent'}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-white"><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmitForm} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Name</label>
                <input required maxLength={100} className={INPUT_BASE} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Discovery Coach" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">System prompt</label>
                <textarea required rows={6} className={INPUT_BASE + ' resize-none'} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="You are a sales coach helping a rep during a discovery call..." />
              </div>
              {!editAgent && !isRep && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Scope</label>
                  <select className={INPUT_BASE} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as AgentScope })}>
                    <option value={AgentScope.PERSONAL}>Personal (just me)</option>
                    <option value={AgentScope.ORG}>Org-wide</option>
                  </select>
                </div>
              )}
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={submitting} className="flex-1 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                  {submitting ? 'Saving…' : editAgent ? 'Save changes' : 'Create agent'}
                </button>
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg transition-colors">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRequestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-white">Request custom agent build</h2>
              <button onClick={() => setShowRequestModal(false)} className="text-slate-500 hover:text-white"><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmitCustomAgentRequest} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Use case</label>
                <input
                  maxLength={120}
                  className={INPUT_BASE}
                  value={requestForm.useCase}
                  onChange={(e) => setRequestForm((prev) => ({ ...prev, useCase: e.target.value }))}
                  placeholder="What should this agent specialize in?"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Notes</label>
                <textarea
                  rows={5}
                  maxLength={2000}
                  className={INPUT_BASE + ' resize-none'}
                  value={requestForm.notes}
                  onChange={(e) => setRequestForm((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Context, workflows, target outcomes, and constraints."
                />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={requestSubmitting} className="flex-1 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                  {requestSubmitting ? 'Submitting...' : 'Submit request'}
                </button>
                <button type="button" onClick={() => setShowRequestModal(false)} className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg transition-colors">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
