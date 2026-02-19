'use client';

import { useEffect, useState } from 'react';

type LiveDisplaySettings = {
  showStats: boolean;
  showChecklist: boolean;
  showTranscript: boolean;
};

const STORAGE_KEY = 'live_call_display_settings';
const DEFAULTS: LiveDisplaySettings = {
  showStats: true,
  showChecklist: true,
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
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
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

export default function SettingsPage() {
  const [settings, setSettings] = useState<LiveDisplaySettings>(DEFAULTS);
  const [saved, setSaved] = useState(false);

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

  function patch<K extends keyof LiveDisplaySettings>(key: K, value: LiveDisplaySettings[K]) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-white">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">Customize what appears during live calls.</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl px-5">
        <Row label="Show compact call stats">
          <Toggle checked={settings.showStats} onChange={(v) => patch('showStats', v)} />
        </Row>
        <Row label="Show stage checklist">
          <Toggle checked={settings.showChecklist} onChange={(v) => patch('showChecklist', v)} />
        </Row>
        <Row label="Show transcript panel">
          <Toggle checked={settings.showTranscript} onChange={(v) => patch('showTranscript', v)} />
        </Row>
      </div>

      {saved && <p className="text-xs text-emerald-400 mt-3">Saved</p>}
    </div>
  );
}
