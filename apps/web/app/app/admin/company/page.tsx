'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type CompanyProfile = {
  companyName: string;
  productName: string;
  productSummary: string;
  idealCustomerProfile: string;
  valueProposition: string;
  differentiators: string;
  proofPoints: string;
  repTalkingPoints: string;
  discoveryGuidance: string;
  qualificationGuidance: string;
  objectionHandling: string;
  competitorGuidance: string;
  pricingGuidance: string;
  implementationGuidance: string;
  faq: string;
  doNotSay: string;
};

type QualitySuggestion = {
  id: string;
  field: string;
  title: string;
  message: string;
  proposedValue: string;
};

type AiSuggestion = {
  text: string;
  mode: 'draft' | 'improve';
  notes: string[];
  warnings: string[];
};

const DEFAULT_PROFILE: CompanyProfile = {
  companyName: '',
  productName: '',
  productSummary: '',
  idealCustomerProfile: '',
  valueProposition: '',
  differentiators: '',
  proofPoints: '',
  repTalkingPoints: '',
  discoveryGuidance: '',
  qualificationGuidance: '',
  objectionHandling: '',
  competitorGuidance: '',
  pricingGuidance: '',
  implementationGuidance: '',
  faq: '',
  doNotSay: '',
};

const FIELDS: Array<{
  key: keyof CompanyProfile;
  label: string;
  hint: string;
  rows?: number;
}> = [
  { key: 'companyName', label: 'Company Name', hint: 'Use the legal or public-facing brand name.' },
  { key: 'productName', label: 'Primary Offer Name', hint: 'Name of service or offer reps sell most often.' },
  { key: 'productSummary', label: 'Company Overview', hint: 'Write 2-4 sentences with clear outcomes.', rows: 3 },
  { key: 'idealCustomerProfile', label: 'Target Customers', hint: 'Who buys and in which situations.', rows: 3 },
  { key: 'valueProposition', label: 'Value Proposition', hint: 'Use 3-7 outcome-driven bullets.', rows: 5 },
  { key: 'differentiators', label: 'Differentiators', hint: 'List practical, verifiable differences.', rows: 5 },
  { key: 'proofPoints', label: 'Proof Points', hint: 'Use numbers reps can cite safely.', rows: 6 },
  { key: 'repTalkingPoints', label: 'Rep Tone & Style', hint: 'How reps should communicate in live calls.', rows: 5 },
  { key: 'discoveryGuidance', label: 'Discovery Guidance', hint: 'Questions that expose pain and urgency.', rows: 5 },
  { key: 'qualificationGuidance', label: 'Qualification Guidance', hint: 'How to qualify fit and buying readiness.', rows: 5 },
  { key: 'objectionHandling', label: 'Objection Handling', hint: 'Structured responses for common objections.', rows: 8 },
  { key: 'competitorGuidance', label: 'Competitor Positioning', hint: 'Position without making risky claims.', rows: 4 },
  { key: 'pricingGuidance', label: 'Sales & Service Policies', hint: 'Booking, turnaround, cancellation, payment, licensing guardrails.', rows: 4 },
  { key: 'implementationGuidance', label: 'Implementation Guidance', hint: 'What happens after commitment.', rows: 4 },
  { key: 'faq', label: 'FAQ', hint: 'Add concise Q/A pairs.', rows: 8 },
  { key: 'doNotSay', label: 'Do Not Say', hint: 'Claims reps must avoid.', rows: 4 },
];

const FIELD_HELP: Partial<Record<keyof CompanyProfile, string>> = {
  productSummary: 'Keep it concise and concrete. Avoid generic adjectives.',
  idealCustomerProfile: 'Mention segment, trigger event, and buying context.',
  valueProposition: 'Use one bullet per line and include measurable outcomes where possible.',
  differentiators: 'Prefer operational strengths over broad marketing claims.',
  proofPoints: 'Use only facts you can defend in a customer conversation.',
  repTalkingPoints: 'Guide tone, pace, and structure for live conversations.',
  discoveryGuidance: 'Focus on uncovering urgency, impact, and ownership.',
  qualificationGuidance: 'Define fit criteria reps can score quickly.',
  objectionHandling: 'Use objection label + response + next question format.',
  competitorGuidance: 'Keep it factual and avoid negative competitor language.',
  pricingGuidance: 'Define booking and policy guardrails, not one-off promises.',
  implementationGuidance: 'Describe rollout steps and expected timing.',
  faq: 'Keep answers brief and avoid uncertain commitments.',
  doNotSay: 'Include compliance-sensitive claims and prohibited language.',
};

export default function AdminCompanyPage() {
  const [profile, setProfile] = useState<CompanyProfile>(DEFAULT_PROFILE);
  const [baseline, setBaseline] = useState<CompanyProfile>(DEFAULT_PROFILE);
  const [saving, setSaving] = useState(false);
  const [qualityChecking, setQualityChecking] = useState(false);
  const [qualitySuggestions, setQualitySuggestions] = useState<QualitySuggestion[]>([]);
  const [qualityError, setQualityError] = useState('');
  const [qualityOpen, setQualityOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'saved' | 'error' | null>(null);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiMessage, setAiMessage] = useState('');
  const [aiBusyKey, setAiBusyKey] = useState('');
  const [aiError, setAiError] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<Partial<Record<keyof CompanyProfile, AiSuggestion>>>({});

  useEffect(() => {
    async function load() {
      const [profileRes, aiStatusRes] = await Promise.all([
        fetch('/api/org/company-profile', { cache: 'no-store' }),
        fetch('/api/ai/fields/status', { cache: 'no-store' }),
      ]);
      const profileData = await profileRes.json().catch(() => ({}));
      const aiStatusData = await aiStatusRes.json().catch(() => ({ enabled: false }));
      const next = { ...DEFAULT_PROFILE, ...(profileData ?? {}) };
      setProfile(next);
      setBaseline(next);
      setAiEnabled(Boolean(aiStatusData?.enabled));
      setAiMessage(typeof aiStatusData?.message === 'string' ? aiStatusData.message : '');
      setLoading(false);
    }
    void load().catch(() => setLoading(false));
  }, []);

  const dirty = useMemo(
    () => JSON.stringify(profile) !== JSON.stringify(baseline),
    [baseline, profile],
  );

  function patch<K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    const res = await fetch('/api/org/company-profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });
    setSaving(false);
    if (res.ok) {
      const saved = await res.json();
      const normalized = { ...DEFAULT_PROFILE, ...(saved ?? {}) };
      setProfile(normalized);
      setBaseline(normalized);
      setStatus('saved');
    } else {
      setStatus('error');
    }
    setTimeout(() => setStatus(null), 3000);
  }

  function toFieldKey(raw: string): keyof CompanyProfile | null {
    const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const map: Record<string, keyof CompanyProfile> = {
      companyname: 'companyName',
      productname: 'productName',
      productsummary: 'productSummary',
      idealcustomerprofile: 'idealCustomerProfile',
      valueproposition: 'valueProposition',
      differentiators: 'differentiators',
      proofpoints: 'proofPoints',
      reptalkingpoints: 'repTalkingPoints',
      discoveryguidance: 'discoveryGuidance',
      qualificationguidance: 'qualificationGuidance',
      objectionhandling: 'objectionHandling',
      competitorguidance: 'competitorGuidance',
      pricingguidance: 'pricingGuidance',
      implementationguidance: 'implementationGuidance',
      faq: 'faq',
      donotsay: 'doNotSay',
    };
    return map[normalized] ?? null;
  }

  async function handleQualityCheck() {
    setQualityChecking(true);
    setQualityError('');
    const res = await fetch('/api/quality/company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });
    const data = await res.json().catch(() => ({}));
    setQualityChecking(false);
    if (!res.ok) {
      setQualityError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Quality check failed'));
      return;
    }
    const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
    setQualitySuggestions(
      suggestions.map((entry: Record<string, unknown>, index: number) => ({
        id: typeof entry.id === 'string' && entry.id ? entry.id : `suggestion_${index + 1}`,
        field: typeof entry.field === 'string' ? entry.field : 'general',
        title: typeof entry.title === 'string' ? entry.title : 'Improve quality',
        message: typeof entry.message === 'string' ? entry.message : '',
        proposedValue: typeof entry.proposedValue === 'string' ? entry.proposedValue : '',
      })),
    );
    setQualityOpen(true);
  }

  function applySuggestion(suggestion: QualitySuggestion) {
    const key = toFieldKey(suggestion.field);
    if (!key || !suggestion.proposedValue.trim()) return;
    patch(key, suggestion.proposedValue as CompanyProfile[typeof key]);
  }

  async function runAiAction(fieldKey: keyof CompanyProfile, mode: 'draft' | 'improve') {
    if (!aiEnabled) return;
    if (mode === 'improve' && !profile[fieldKey].trim()) {
      setAiError('Add some text before using AI Improve.');
      return;
    }

    setAiError('');
    const key = `${fieldKey}:${mode}`;
    setAiBusyKey(key);

    const endpoint = mode === 'draft' ? '/api/ai/fields/draft' : '/api/ai/fields/improve';
    const payload = {
      target: 'company',
      fieldKey,
      ...(mode === 'improve' ? { text: profile[fieldKey] } : {}),
      currentState: {
        profile,
      },
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    setAiBusyKey('');

    if (!res.ok) {
      setAiError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'AI request failed.'));
      return;
    }

    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    if (!text) {
      setAiError('AI returned an empty suggestion.');
      return;
    }

    setAiSuggestions((prev) => ({
      ...prev,
      [fieldKey]: {
        text,
        mode,
        notes: Array.isArray(data?.notes)
          ? data.notes.filter((entry: unknown) => typeof entry === 'string').slice(0, 6)
          : [],
        warnings: Array.isArray(data?.warnings)
          ? data.warnings.filter((entry: unknown) => typeof entry === 'string').slice(0, 6)
          : [],
      },
    }));
  }

  function applyAiSuggestion(fieldKey: keyof CompanyProfile) {
    const suggestion = aiSuggestions[fieldKey];
    if (!suggestion) return;
    patch(fieldKey, suggestion.text);
    setAiSuggestions((prev) => {
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  }

  function dismissAiSuggestion(fieldKey: keyof CompanyProfile) {
    setAiSuggestions((prev) => {
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  }

  if (loading) {
    return (
      <div className="p-8 space-y-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-16 bg-slate-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-white">Company Info</h1>
          <p className="text-sm text-slate-500 mt-1">
            This context powers live coaching and objection responses.
          </p>
        </div>
        <Link
          href="/app/admin/company/import"
          className="shrink-0 px-3 py-2 rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-200 text-sm font-medium hover:bg-sky-500/20 transition-colors"
        >
          Auto-fill from website or PDFs
        </Link>
      </div>

      <div className="space-y-4">
        {FIELDS.map((field) => {
          const suggestion = aiSuggestions[field.key];
          return (
            <section key={field.key} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium text-white">{field.label}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">{field.hint}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => runAiAction(field.key, 'draft')}
                    disabled={!aiEnabled || aiBusyKey.length > 0}
                    title={aiEnabled ? 'Generate AI draft' : aiMessage || 'AI unavailable'}
                    className="px-2.5 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                  >
                    {aiBusyKey === `${field.key}:draft` ? 'Drafting...' : 'AI Draft'}
                  </button>
                  <button
                    onClick={() => runAiAction(field.key, 'improve')}
                    disabled={!aiEnabled || aiBusyKey.length > 0 || !profile[field.key].trim()}
                    title={aiEnabled ? 'Improve current text' : aiMessage || 'AI unavailable'}
                    className="px-2.5 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                  >
                    {aiBusyKey === `${field.key}:improve` ? 'Improving...' : 'AI Improve'}
                  </button>
                </div>
              </div>

              {field.rows && field.rows > 1 ? (
                <textarea
                  value={profile[field.key]}
                  rows={field.rows}
                  onChange={(e) => patch(field.key, e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              ) : (
                <input
                  value={profile[field.key]}
                  onChange={(e) => patch(field.key, e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              )}

              {FIELD_HELP[field.key] && (
                <p className="mt-2 text-xs text-slate-500">{FIELD_HELP[field.key]}</p>
              )}

              {suggestion && (
                <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 space-y-2">
                  <p className="text-xs text-sky-200">
                    {suggestion.mode === 'draft' ? 'AI Draft suggestion' : 'AI Improve suggestion'}
                  </p>
                  <pre className="whitespace-pre-wrap text-xs text-sky-100">{suggestion.text}</pre>
                  {suggestion.notes.length > 0 && (
                    <ul className="text-xs text-sky-200 space-y-0.5">
                      {suggestion.notes.map((note) => (
                        <li key={`${field.key}-${note}`}>{note}</li>
                      ))}
                    </ul>
                  )}
                  {suggestion.warnings.length > 0 && (
                    <ul className="text-xs text-amber-200 space-y-0.5">
                      {suggestion.warnings.map((warning) => (
                        <li key={`${field.key}-${warning}`}>{warning}</li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => applyAiSuggestion(field.key)}
                      className="px-2.5 py-1 rounded-md border border-sky-400/50 text-xs text-sky-100 hover:border-sky-300"
                    >
                      Apply suggested edit
                    </button>
                    <button
                      onClick={() => dismissAiSuggestion(field.key)}
                      className="px-2.5 py-1 rounded-md border border-slate-600 text-xs text-slate-300 hover:border-slate-400"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="mt-5 flex items-center gap-4 flex-wrap">
        <button
          onClick={handleQualityCheck}
          disabled={qualityChecking}
          className="px-4 py-2 border border-slate-700 hover:border-slate-500 disabled:opacity-40 text-slate-200 text-sm font-medium rounded-lg transition-colors"
        >
          {qualityChecking ? 'Running quality check...' : 'Quality check'}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {saving ? 'Saving...' : 'Save company profile'}
        </button>
        {status === 'saved' && <span className="text-sm text-sky-400">Saved</span>}
        {status === 'error' && <span className="text-sm text-red-400">Failed to save</span>}
        {qualityError && <span className="text-sm text-red-400">{qualityError}</span>}
        {aiError && <span className="text-sm text-red-400">{aiError}</span>}
        {!aiEnabled && aiMessage && <span className="text-sm text-amber-300">{aiMessage}</span>}
      </div>

      {qualityOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl p-5 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold text-base">Quality suggestions</h3>
              <button
                onClick={() => setQualityOpen(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                Close
              </button>
            </div>

            {qualitySuggestions.length === 0 ? (
              <p className="text-sm text-slate-400">No suggestions returned.</p>
            ) : (
              <div className="space-y-3">
                {qualitySuggestions.map((suggestion) => (
                  <div key={suggestion.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-white">{suggestion.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{suggestion.field}</p>
                      </div>
                      <button
                        onClick={() => applySuggestion(suggestion)}
                        className="text-xs px-2.5 py-1 rounded-lg border border-sky-500/30 text-sky-300 hover:border-sky-500/60 transition-colors"
                      >
                        Apply suggested edit
                      </button>
                    </div>
                    <p className="mt-2 text-sm text-slate-300">{suggestion.message}</p>
                    {suggestion.proposedValue && (
                      <pre className="mt-2 whitespace-pre-wrap text-xs text-sky-200 bg-slate-900 border border-slate-800 rounded-lg p-3">
                        {suggestion.proposedValue}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
