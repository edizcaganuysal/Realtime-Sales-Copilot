'use client';

import { useEffect, useState } from 'react';
import { PublisherPolicy, LiveLayout, RETENTION_DAYS } from '@live-sales-coach/shared';

type Settings = {
  requiresAgentApproval: boolean;
  allowRepAgentCreation: boolean;
  publisherPolicy: PublisherPolicy;
  liveLayoutDefault: LiveLayout;
  retentionDays: number;
};

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
        checked ? 'bg-emerald-500' : 'bg-slate-700'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-slate-800 last:border-0">
      <span className="text-sm text-slate-300">{label}</span>
      {children}
    </div>
  );
}

export default function GovernancePage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<'saved' | 'error' | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    fetch('/api/org')
      .then(async (r) => ({ ok: r.ok, data: await r.json() }))
      .then(({ ok, data }) => {
        if (!ok) {
          setLoadError(data?.message ?? 'Failed to load governance settings');
          return;
        }
        setSettings(data.settings);
      })
      .catch(() => setLoadError('Failed to load governance settings'));
  }, []);

  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => prev && { ...prev, [key]: value });
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setFlash(null);
    const res = await fetch('/api/org', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    setSaving(false);
    setFlash(res.ok ? 'saved' : 'error');
    setTimeout(() => setFlash(null), 3000);
  }

  if (!settings) {
    return (
      <div className="p-8">
        {loadError && (
          <div className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {loadError}
          </div>
        )}
        <div className="h-4 w-32 bg-slate-800 rounded animate-pulse mb-6" />
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-slate-800 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-white">Governance</h1>
        <p className="text-sm text-slate-500 mt-1">Org-wide defaults and permissions</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl px-5">
        <Row label="Require agent approval before publishing">
          <Toggle
            checked={settings.requiresAgentApproval}
            onChange={(v) => patch('requiresAgentApproval', v)}
          />
        </Row>

        <Row label="Allow reps to create agents">
          <Toggle
            checked={settings.allowRepAgentCreation}
            onChange={(v) => patch('allowRepAgentCreation', v)}
          />
        </Row>

        <Row label="Publisher policy">
          <select
            value={settings.publisherPolicy}
            onChange={(e) => patch('publisherPolicy', e.target.value as PublisherPolicy)}
            className="bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value={PublisherPolicy.ADMIN_ONLY}>Admin only</option>
            <option value={PublisherPolicy.ADMIN_AND_MANAGERS}>Admin &amp; Managers</option>
          </select>
        </Row>

        <Row label="Default live layout">
          <select
            value={settings.liveLayoutDefault}
            onChange={(e) => patch('liveLayoutDefault', e.target.value as LiveLayout)}
            className="bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value={LiveLayout.MINIMAL}>Minimal</option>
            <option value={LiveLayout.STANDARD}>Standard</option>
          </select>
        </Row>

        <Row label="Call recording retention">
          <select
            value={settings.retentionDays}
            onChange={(e) => patch('retentionDays', Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {RETENTION_DAYS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </Row>
      </div>

      <div className="mt-5 flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {flash === 'saved' && <span className="text-sm text-emerald-400">Saved</span>}
        {flash === 'error' && <span className="text-sm text-red-400">Failed to save</span>}
      </div>
    </div>
  );
}
