'use client';

import { useEffect, useState } from 'react';
import { AgentStatus } from '@live-sales-coach/shared';

type Agent = {
  id: string;
  name: string;
  prompt: string;
  scope: string;
  status: AgentStatus;
  ownerUserId: string | null;
  createdAt: string;
};

const STATUS_BADGE: Partial<Record<AgentStatus, string>> = {
  APPROVED: 'bg-emerald-500/15 text-emerald-400',
  REJECTED: 'bg-red-500/15 text-red-400',
  PENDING_APPROVAL: 'bg-yellow-500/15 text-yellow-400',
  DRAFT: 'bg-slate-700 text-slate-400',
};

export default function AdminAgentsPage() {
  const [pending, setPending] = useState<Agent[]>([]);
  const [orgAgents, setOrgAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [pendingRes, orgRes] = await Promise.all([
      fetch('/api/agents?status=PENDING_APPROVAL'),
      fetch('/api/agents?scope=ORG'),
    ]);
    const [pendingData, orgData] = await Promise.all([pendingRes.json(), orgRes.json()]);
    setPending(Array.isArray(pendingData) ? pendingData : []);
    setOrgAgents(Array.isArray(orgData) ? orgData : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAction(agentId: string, action: 'approve' | 'reject') {
    setActioning(agentId + action);
    const res = await fetch(`/api/agents/${agentId}/${action}`, { method: 'POST' });
    setActioning(null);
    if (res.ok) await load();
  }

  if (loading) {
    return (
      <div className="p-8 space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 bg-slate-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl space-y-10">
      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-white">Pending approval</h2>
          <p className="text-xs text-slate-500 mt-0.5">{pending.length} agent{pending.length !== 1 ? 's' : ''} awaiting review</p>
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
                    <p className="text-xs text-slate-600 mt-1">{new Date(agent.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleAction(agent.id, 'reject')}
                      disabled={!!actioning}
                      className="text-xs px-2.5 py-1 border border-red-500/30 hover:border-red-500/60 text-red-400 hover:text-red-300 rounded-lg transition-colors disabled:opacity-40"
                    >
                      {actioning === agent.id + 'reject' ? '…' : 'Reject'}
                    </button>
                    <button
                      onClick={() => handleAction(agent.id, 'approve')}
                      disabled={!!actioning}
                      className="text-xs px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg transition-colors"
                    >
                      {actioning === agent.id + 'approve' ? '…' : 'Approve'}
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
          <h2 className="text-base font-semibold text-white">Org agents</h2>
          <p className="text-xs text-slate-500 mt-0.5">All org-scoped agents</p>
        </div>

        {orgAgents.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-5 py-8 text-center">
            <p className="text-slate-500 text-sm">No org agents yet</p>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-5 py-3">Name</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-5 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-5 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {orgAgents.map((agent) => (
                  <tr key={agent.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-3.5">
                      <div>
                        <p className="text-white font-medium">{agent.name}</p>
                        <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">{agent.prompt}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={'text-xs px-1.5 py-0.5 rounded font-medium ' + (STATUS_BADGE[agent.status] ?? '')}>
                        {agent.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 text-xs">
                      {new Date(agent.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
