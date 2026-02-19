'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';

type LiveDisplaySettings = {
  showStats: boolean;
  showTranscript: boolean;
};

type MeResponse = {
  user: {
    name: string;
    email: string;
  };
};

const STORAGE_KEY = 'live_call_display_settings';
const DEFAULTS: LiveDisplaySettings = {
  showStats: true,
  showTranscript: true,
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
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${
        checked ? 'bg-sky-500' : 'bg-slate-700'
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
    <div className="flex items-center justify-between border-b border-slate-800 py-4 last:border-0">
      <span className="text-sm text-slate-300">{label}</span>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<LiveDisplaySettings>(DEFAULTS);
  const [saved, setSaved] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<LiveDisplaySettings>;
      setSettings({ ...DEFAULTS, ...parsed });
    } catch {
      setSettings(DEFAULTS);
    }
  }, []);

  useEffect(() => {
    void fetch('/api/auth/me', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => setMe(data))
      .catch(() => null);
  }, []);

  function patch<K extends keyof LiveDisplaySettings>(key: K, value: LiveDisplaySettings[K]) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  }

  return (
    <div className="p-8 max-w-2xl space-y-5">
      <PageHeader title="Settings" description="Personal account and live screen preferences." />

      <SectionCard title="Account">
        <div className="space-y-2 text-sm text-slate-300">
          <p className="font-medium text-white">{me?.user.name ?? 'Account'}</p>
          <p className="text-slate-400">{me?.user.email ?? ''}</p>
        </div>
      </SectionCard>

      <SectionCard title="Live display" contentClassName="px-5 py-0">
        <Row label="Show compact call stats">
          <Toggle checked={settings.showStats} onChange={(v) => patch('showStats', v)} />
        </Row>
        <Row label="Show transcript drawer">
          <Toggle checked={settings.showTranscript} onChange={(v) => patch('showTranscript', v)} />
        </Row>
      </SectionCard>

      {saved && <p className="text-xs text-sky-400">Saved</p>}
    </div>
  );
}
