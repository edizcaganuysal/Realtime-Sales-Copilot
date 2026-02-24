'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Plug,
  Settings2,
  Trash2,
  Zap,
} from 'lucide-react';

type Integration = {
  id: string;
  type: string;
  name: string;
  configJson: Record<string, unknown>;
  status: string;
};

type ActionDefinition = {
  id: string;
  integrationId: string;
  name: string;
  description: string;
  triggerPhrases: string[];
  inputSchema: Record<string, unknown>;
  executionConfig: Record<string, unknown>;
  requiresApproval: boolean;
  riskLevel: string;
  isActive: boolean;
};

const INTEGRATION_TYPES = [
  { value: 'stripe', label: 'Stripe' },
  { value: 'shopify', label: 'Shopify' },
  { value: 'zendesk', label: 'Zendesk' },
  { value: 'custom_api', label: 'Custom API' },
];

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [actionDefs, setActionDefs] = useState<ActionDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Integration form
  const [showIntForm, setShowIntForm] = useState(false);
  const [intForm, setIntForm] = useState({ name: '', type: 'custom_api', baseUrl: '', apiKey: '' });
  const [intSaving, setIntSaving] = useState(false);

  // Action definition form
  const [showActionForm, setShowActionForm] = useState<string | null>(null);
  const [actionForm, setActionForm] = useState({
    name: '',
    description: '',
    triggerPhrases: '',
    method: 'GET',
    endpoint: '',
    requiresApproval: true,
    riskLevel: 'LOW',
  });
  const [actionSaving, setActionSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/support/integrations').then((r) => r.json()),
      fetch('/api/support/action-definitions').then((r) => r.json()),
    ])
      .then(([ints, defs]) => {
        setIntegrations(Array.isArray(ints) ? ints : []);
        setActionDefs(Array.isArray(defs) ? defs : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function createIntegration() {
    setIntSaving(true);
    const res = await fetch('/api/support/integrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: intForm.name,
        type: intForm.type,
        configJson: { baseUrl: intForm.baseUrl, apiKey: intForm.apiKey },
      }),
    });
    const data = await res.json().catch(() => null);
    setIntSaving(false);
    if (res.ok && data) {
      setIntegrations((prev) => [...prev, data]);
      setShowIntForm(false);
      setIntForm({ name: '', type: 'custom_api', baseUrl: '', apiKey: '' });
    }
  }

  async function deleteIntegration(id: string) {
    await fetch(`/api/support/integrations/${id}`, { method: 'DELETE' });
    setIntegrations((prev) => prev.filter((i) => i.id !== id));
    setActionDefs((prev) => prev.filter((d) => d.integrationId !== id));
  }

  async function createActionDefinition(integrationId: string) {
    setActionSaving(true);
    const res = await fetch('/api/support/action-definitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        integrationId,
        name: actionForm.name,
        description: actionForm.description,
        triggerPhrases: actionForm.triggerPhrases
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        inputSchema: { fields: [] },
        executionConfig: {
          method: actionForm.method,
          endpoint: actionForm.endpoint,
        },
        requiresApproval: actionForm.requiresApproval,
        riskLevel: actionForm.riskLevel,
      }),
    });
    const data = await res.json().catch(() => null);
    setActionSaving(false);
    if (res.ok && data) {
      setActionDefs((prev) => [...prev, data]);
      setShowActionForm(null);
      setActionForm({
        name: '',
        description: '',
        triggerPhrases: '',
        method: 'GET',
        endpoint: '',
        requiresApproval: true,
        riskLevel: 'LOW',
      });
    }
  }

  async function deleteActionDefinition(id: string) {
    await fetch(`/api/support/action-definitions/${id}`, { method: 'DELETE' });
    setActionDefs((prev) => prev.filter((d) => d.id !== id));
  }

  if (loading) return <div className="p-8"><LoadingSkeleton count={3} /></div>;

  return (
    <div className="p-8 max-w-4xl">
      <PageHeader
        title="Integrations & Actions"
        actions={
          <button
            onClick={() => setShowIntForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={14} /> Add Integration
          </button>
        }
      />

      {/* Create Integration Form */}
      {showIntForm && (
        <div className="mb-6 rounded-lg border border-slate-700 bg-slate-800/60 p-4">
          <h3 className="text-sm font-semibold text-white mb-3">New Integration</h3>
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Name (e.g. Stripe Production)"
              value={intForm.name}
              onChange={(e) => setIntForm((f) => ({ ...f, name: e.target.value }))}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500"
            />
            <select
              value={intForm.type}
              onChange={(e) => setIntForm((f) => ({ ...f, type: e.target.value }))}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            >
              {INTEGRATION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              placeholder="Base URL (e.g. https://api.stripe.com)"
              value={intForm.baseUrl}
              onChange={(e) => setIntForm((f) => ({ ...f, baseUrl: e.target.value }))}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500"
            />
            <input
              placeholder="API Key"
              type="password"
              value={intForm.apiKey}
              onChange={(e) => setIntForm((f) => ({ ...f, apiKey: e.target.value }))}
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={createIntegration}
              disabled={intSaving || !intForm.name}
              className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {intSaving ? 'Saving...' : 'Create'}
            </button>
            <button
              onClick={() => setShowIntForm(false)}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Integration List */}
      {integrations.length === 0 ? (
        <EmptyState
          icon={Plug}
          message="No integrations configured"
          action={
            <button
              onClick={() => setShowIntForm(true)}
              className="text-sm text-sky-400 hover:text-sky-300 transition-colors"
            >
              Add your first integration
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {integrations.map((int) => {
            const expanded = expandedId === int.id;
            const intActions = actionDefs.filter((d) => d.integrationId === int.id);
            return (
              <div key={int.id} className="rounded-lg border border-slate-700 bg-slate-800/40">
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer"
                  onClick={() => setExpandedId(expanded ? null : int.id)}
                >
                  <div className="flex items-center gap-3">
                    {expanded ? (
                      <ChevronDown size={14} className="text-slate-400" />
                    ) : (
                      <ChevronRight size={14} className="text-slate-400" />
                    )}
                    <Plug size={16} className="text-sky-400" />
                    <div>
                      <p className="text-sm font-medium text-white">{int.name}</p>
                      <p className="text-xs text-slate-400">{int.type}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        int.status === 'active'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : 'border-red-500/30 bg-red-500/10 text-red-300'
                      }`}
                    >
                      {int.status}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteIntegration(int.id);
                      }}
                      className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-slate-700 px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Action Definitions ({intActions.length})
                      </h4>
                      <button
                        onClick={() => setShowActionForm(int.id)}
                        className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300"
                      >
                        <Plus size={12} /> Add Action
                      </button>
                    </div>

                    {/* Create Action Form */}
                    {showActionForm === int.id && (
                      <div className="mb-3 rounded-lg border border-slate-600 bg-slate-900 p-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            placeholder="Action name (e.g. Look up order)"
                            value={actionForm.name}
                            onChange={(e) => setActionForm((f) => ({ ...f, name: e.target.value }))}
                            className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white placeholder-slate-500"
                          />
                          <input
                            placeholder="Description"
                            value={actionForm.description}
                            onChange={(e) =>
                              setActionForm((f) => ({ ...f, description: e.target.value }))
                            }
                            className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white placeholder-slate-500"
                          />
                          <input
                            placeholder="Trigger phrases (comma-separated)"
                            value={actionForm.triggerPhrases}
                            onChange={(e) =>
                              setActionForm((f) => ({ ...f, triggerPhrases: e.target.value }))
                            }
                            className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white placeholder-slate-500"
                          />
                          <input
                            placeholder="Endpoint (e.g. /v1/orders/{{orderId}})"
                            value={actionForm.endpoint}
                            onChange={(e) =>
                              setActionForm((f) => ({ ...f, endpoint: e.target.value }))
                            }
                            className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white placeholder-slate-500"
                          />
                          <select
                            value={actionForm.method}
                            onChange={(e) =>
                              setActionForm((f) => ({ ...f, method: e.target.value }))
                            }
                            className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white"
                          >
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="PATCH">PATCH</option>
                          </select>
                          <select
                            value={actionForm.riskLevel}
                            onChange={(e) =>
                              setActionForm((f) => ({ ...f, riskLevel: e.target.value }))
                            }
                            className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white"
                          >
                            <option value="LOW">Low risk</option>
                            <option value="MEDIUM">Medium risk</option>
                            <option value="HIGH">High risk</option>
                          </select>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-slate-300">
                          <input
                            type="checkbox"
                            checked={actionForm.requiresApproval}
                            onChange={(e) =>
                              setActionForm((f) => ({
                                ...f,
                                requiresApproval: e.target.checked,
                              }))
                            }
                            className="rounded border-slate-600"
                          />
                          Requires agent approval before execution
                        </label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => createActionDefinition(int.id)}
                            disabled={actionSaving || !actionForm.name}
                            className="px-2 py-1 bg-sky-600 hover:bg-sky-500 text-white text-[11px] rounded transition-colors disabled:opacity-50"
                          >
                            {actionSaving ? 'Saving...' : 'Create Action'}
                          </button>
                          <button
                            onClick={() => setShowActionForm(null)}
                            className="text-[11px] text-slate-400 hover:text-white"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Action definitions list */}
                    {intActions.length === 0 ? (
                      <p className="text-xs text-slate-500 italic">
                        No actions defined yet
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {intActions.map((def) => (
                          <div
                            key={def.id}
                            className="flex items-center justify-between rounded border border-slate-700 bg-slate-800/60 px-3 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <Zap size={12} className="text-amber-400" />
                              <div>
                                <p className="text-xs font-medium text-white">{def.name}</p>
                                <p className="text-[10px] text-slate-400">
                                  {def.description} | Risk: {def.riskLevel} |{' '}
                                  {def.requiresApproval ? 'Needs approval' : 'Auto-execute'}
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => deleteActionDefinition(def.id)}
                              className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
