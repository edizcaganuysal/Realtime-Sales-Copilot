'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GuidanceLevel, LiveLayout } from '@live-sales-coach/shared';
import type { MeResponse } from '@live-sales-coach/shared';
import { Phone } from 'lucide-react';

type Agent = { id: string; name: string };
type Playbook = { id: string; name: string };

const INPUT =
  'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

const GUIDANCE_LABELS: Record<GuidanceLevel, string> = {
  MINIMAL: 'Minimal — nudges only',
  STANDARD: 'Standard — suggestions + nudges',
  GUIDED: 'Guided — full checklist + coaching',
};

const LAYOUT_LABELS: Record<string, string> = {
  MINIMAL: 'Minimal',
  STANDARD: 'Standard',
};

export default function DialerPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [form, setForm] = useState({
    phoneTo: '',
    agentId: '',
    playbookId: '',
    guidanceLevel: GuidanceLevel.STANDARD,
    layoutPreset: LiveLayout.STANDARD,
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/me').then((r) => r.json()),
      fetch('/api/agents?scope=ORG&status=APPROVED').then((r) => r.json()),
      fetch('/api/playbooks').then((r) => r.json()),
    ]).then(([meData, agentsData, playbooksData]) => {
      setMe(meData);
      setAgents(Array.isArray(agentsData) ? agentsData : []);
      setPlaybooks(Array.isArray(playbooksData) ? playbooksData : []);
      if (meData?.orgSettings?.liveLayoutDefault) {
        setForm((f) => ({ ...f, layoutPreset: meData.orgSettings.liveLayoutDefault }));
      }
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    const body: Record<string, string> = { phoneTo: form.phoneTo };
    if (form.agentId) body.agentId = form.agentId;
    if (form.playbookId) body.playbookId = form.playbookId;
    body.guidanceLevel = form.guidanceLevel;
    body.layoutPreset = form.layoutPreset;
    if (form.notes) body.notes = form.notes;

    const res = await fetch('/api/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const d = await res.json();
      setError(Array.isArray(d.message) ? d.message[0] : (d.message ?? 'Failed to start call'));
      setSubmitting(false);
      return;
    }

    const call = await res.json();
    router.push(`/app/calls/${call.id}/live`);
  }

  return (
    <div className="p-8 max-w-lg">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center">
          <Phone size={18} className="text-emerald-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-white">New call</h1>
          <p className="text-xs text-slate-500">Configure and start an outbound call</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Phone number</label>
          <input
            required
            type="tel"
            className={INPUT}
            placeholder="+1 (555) 000-0000"
            value={form.phoneTo}
            onChange={(e) => setForm({ ...form, phoneTo: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Agent (optional)</label>
          <select
            className={INPUT}
            value={form.agentId}
            onChange={(e) => setForm({ ...form, agentId: e.target.value })}
          >
            <option value="">— No agent —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Playbook (optional)</label>
          <select
            className={INPUT}
            value={form.playbookId}
            onChange={(e) => setForm({ ...form, playbookId: e.target.value })}
          >
            <option value="">— No playbook —</option>
            {playbooks.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Guidance</label>
            <select
              className={INPUT}
              value={form.guidanceLevel}
              onChange={(e) => setForm({ ...form, guidanceLevel: e.target.value as GuidanceLevel })}
            >
              {Object.entries(GUIDANCE_LABELS).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Layout</label>
            <select
              className={INPUT}
              value={form.layoutPreset}
              onChange={(e) => setForm({ ...form, layoutPreset: e.target.value as LiveLayout })}
            >
              {Object.entries(LAYOUT_LABELS).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Notes (optional)</label>
          <textarea
            rows={3}
            className={INPUT + ' resize-none'}
            placeholder="Context about this call, contact, or goal…"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
        >
          <Phone size={15} />
          {submitting ? 'Starting…' : 'Start call'}
        </button>
      </form>
    </div>
  );
}
