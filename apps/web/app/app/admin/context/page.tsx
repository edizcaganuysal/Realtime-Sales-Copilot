'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type SalesContext = {
  companyName: string;
  whatWeSell: string;
  offerCategory: string;
  targetCustomer: string;
  targetRoles: string[];
  industries: string[];
  disqualifiers: string[];
  proofPoints: string[];
  allowedClaims: string[];
  forbiddenClaims: string[];
  salesPolicies: string[];
  escalationRules: string[];
  nextSteps: string[];
  schedulingLink: string;
  competitors: string[];
  positioningRules: string[];
  discoveryQuestions: string[];
  qualificationRubric: string[];
  knowledgeAppendix: string;
};

type OfferingSummary = {
  id: string;
  name: string;
  elevatorPitch?: string | null;
};

type AiSuggestion = {
  text: string;
  mode: 'draft' | 'improve';
  notes: string[];
  warnings: string[];
};

type FieldConfig = {
  key: keyof SalesContext;
  label: string;
  hint: string;
  type: 'text' | 'bullets' | 'select' | 'long';
  options?: Array<{ label: string; value: string }>;
};

const DEFAULT_CONTEXT: SalesContext = {
  companyName: '',
  whatWeSell: '',
  offerCategory: 'service',
  targetCustomer: '',
  targetRoles: [],
  industries: [],
  disqualifiers: [],
  proofPoints: [],
  allowedClaims: [],
  forbiddenClaims: [],
  salesPolicies: [],
  escalationRules: [],
  nextSteps: [],
  schedulingLink: '',
  competitors: [],
  positioningRules: [],
  discoveryQuestions: [],
  qualificationRubric: [],
  knowledgeAppendix: '',
};

const INPUT =
  'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-sky-500/40';

const CORE_FIELDS: FieldConfig[] = [
  {
    key: 'companyName',
    label: 'Company name',
    hint: 'Use your public-facing company name.',
    type: 'text',
  },
  {
    key: 'whatWeSell',
    label: 'What we sell',
    hint: 'One clear line reps can say confidently.',
    type: 'text',
  },
  {
    key: 'offerCategory',
    label: 'Primary offer category',
    hint: 'Used to tune coaching language.',
    type: 'select',
    options: [
      { value: 'service', label: 'Service' },
      { value: 'software', label: 'Software' },
      { value: 'marketplace', label: 'Marketplace' },
      { value: 'other', label: 'Other' },
    ],
  },
  {
    key: 'targetCustomer',
    label: 'Target customer description',
    hint: 'Describe best-fit customer profile in 2-4 lines.',
    type: 'long',
  },
  {
    key: 'targetRoles',
    label: 'Target roles and titles',
    hint: 'One role per line.',
    type: 'bullets',
  },
  {
    key: 'industries',
    label: 'Best-fit industries',
    hint: 'One industry per line.',
    type: 'bullets',
  },
  {
    key: 'disqualifiers',
    label: 'Disqualifiers',
    hint: 'List red flags that indicate poor fit.',
    type: 'bullets',
  },
  {
    key: 'proofPoints',
    label: 'Proof points',
    hint: 'Only verifiable claims and outcomes.',
    type: 'bullets',
  },
  {
    key: 'allowedClaims',
    label: 'Allowed claims',
    hint: 'Safe phrasing reps can use.',
    type: 'bullets',
  },
  {
    key: 'forbiddenClaims',
    label: 'Forbidden claims / do-not-say',
    hint: 'Claims that must never be made.',
    type: 'bullets',
  },
  {
    key: 'salesPolicies',
    label: 'Sales and service policies',
    hint: 'Booking, turnaround, cancellations, deposits, licensing, service area, on-site rules.',
    type: 'bullets',
  },
  {
    key: 'escalationRules',
    label: 'Escalation rules',
    hint: 'When reps must escalate pricing, legal, security, or custom requests.',
    type: 'bullets',
  },
  {
    key: 'nextSteps',
    label: 'Preferred next steps',
    hint: 'Define the follow-up actions reps should drive.',
    type: 'bullets',
  },
  {
    key: 'schedulingLink',
    label: 'Scheduling link',
    hint: 'Optional booking URL.',
    type: 'text',
  },
];

const ADVANCED_FIELDS: FieldConfig[] = [
  {
    key: 'competitors',
    label: 'Competitors list',
    hint: 'One competitor per line.',
    type: 'bullets',
  },
  {
    key: 'positioningRules',
    label: 'Safe positioning rules',
    hint: 'How to position safely against alternatives.',
    type: 'bullets',
  },
  {
    key: 'discoveryQuestions',
    label: 'Best discovery questions',
    hint: 'High-signal questions reps should ask.',
    type: 'bullets',
  },
  {
    key: 'qualificationRubric',
    label: 'Qualification rubric',
    hint: 'Criteria reps use to assess fit and urgency.',
    type: 'bullets',
  },
  {
    key: 'knowledgeAppendix',
    label: 'Knowledge appendix',
    hint: 'Long-form reference context for coaching.',
    type: 'long',
  },
];

function toLines(value: string[]) {
  return value.join('\n');
}

function fromLines(value: string) {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function toInputValue(context: SalesContext, key: keyof SalesContext) {
  const value = context[key];
  if (Array.isArray(value)) {
    return toLines(value);
  }
  return value;
}

export default function AdminContextPage() {
  const [context, setContext] = useState<SalesContext>(DEFAULT_CONTEXT);
  const [baseline, setBaseline] = useState<SalesContext>(DEFAULT_CONTEXT);
  const [offerings, setOfferings] = useState<OfferingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'saved' | 'error' | null>(null);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiMessage, setAiMessage] = useState('');
  const [aiBusyKey, setAiBusyKey] = useState('');
  const [aiError, setAiError] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<Partial<Record<keyof SalesContext, AiSuggestion>>>({});

  const dirty = useMemo(
    () => JSON.stringify(context) !== JSON.stringify(baseline),
    [baseline, context],
  );

  useEffect(() => {
    async function load() {
      const [contextRes, offeringsRes, aiStatusRes] = await Promise.all([
        fetch('/api/org/sales-context', { cache: 'no-store' }),
        fetch('/api/products', { cache: 'no-store' }),
        fetch('/api/ai/fields/status', { cache: 'no-store' }),
      ]);

      const contextData = await contextRes.json().catch(() => ({}));
      const offeringsData = await offeringsRes.json().catch(() => []);
      const aiStatusData = await aiStatusRes.json().catch(() => ({ enabled: false }));

      const next: SalesContext = {
        ...DEFAULT_CONTEXT,
        ...contextData,
        targetRoles: Array.isArray(contextData?.targetRoles) ? contextData.targetRoles : [],
        industries: Array.isArray(contextData?.industries) ? contextData.industries : [],
        disqualifiers: Array.isArray(contextData?.disqualifiers) ? contextData.disqualifiers : [],
        proofPoints: Array.isArray(contextData?.proofPoints) ? contextData.proofPoints : [],
        allowedClaims: Array.isArray(contextData?.allowedClaims) ? contextData.allowedClaims : [],
        forbiddenClaims: Array.isArray(contextData?.forbiddenClaims) ? contextData.forbiddenClaims : [],
        salesPolicies: Array.isArray(contextData?.salesPolicies) ? contextData.salesPolicies : [],
        escalationRules: Array.isArray(contextData?.escalationRules) ? contextData.escalationRules : [],
        nextSteps: Array.isArray(contextData?.nextSteps) ? contextData.nextSteps : [],
        competitors: Array.isArray(contextData?.competitors) ? contextData.competitors : [],
        positioningRules: Array.isArray(contextData?.positioningRules)
          ? contextData.positioningRules
          : [],
        discoveryQuestions: Array.isArray(contextData?.discoveryQuestions)
          ? contextData.discoveryQuestions
          : [],
        qualificationRubric: Array.isArray(contextData?.qualificationRubric)
          ? contextData.qualificationRubric
          : [],
      };

      setContext(next);
      setBaseline(next);
      setOfferings(Array.isArray(offeringsData) ? offeringsData : []);
      setAiEnabled(Boolean(aiStatusData?.enabled));
      setAiMessage(typeof aiStatusData?.message === 'string' ? aiStatusData.message : '');
      setLoading(false);
    }

    void load().catch(() => setLoading(false));
  }, []);

  function setField(key: keyof SalesContext, value: string) {
    setContext((prev) => {
      const current = prev[key];
      if (Array.isArray(current)) {
        return { ...prev, [key]: fromLines(value) };
      }
      return { ...prev, [key]: value };
    });
  }

  async function handleSave() {
    setSaving(true);
    setStatus(null);

    const res = await fetch('/api/org/sales-context', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context),
    });

    setSaving(false);

    if (!res.ok) {
      setStatus('error');
      setTimeout(() => setStatus(null), 3000);
      return;
    }

    const saved = await res.json().catch(() => context);
    const next = {
      ...DEFAULT_CONTEXT,
      ...saved,
      targetRoles: Array.isArray(saved?.targetRoles) ? saved.targetRoles : [],
      industries: Array.isArray(saved?.industries) ? saved.industries : [],
      disqualifiers: Array.isArray(saved?.disqualifiers) ? saved.disqualifiers : [],
      proofPoints: Array.isArray(saved?.proofPoints) ? saved.proofPoints : [],
      allowedClaims: Array.isArray(saved?.allowedClaims) ? saved.allowedClaims : [],
      forbiddenClaims: Array.isArray(saved?.forbiddenClaims) ? saved.forbiddenClaims : [],
      salesPolicies: Array.isArray(saved?.salesPolicies) ? saved.salesPolicies : [],
      escalationRules: Array.isArray(saved?.escalationRules) ? saved.escalationRules : [],
      nextSteps: Array.isArray(saved?.nextSteps) ? saved.nextSteps : [],
      competitors: Array.isArray(saved?.competitors) ? saved.competitors : [],
      positioningRules: Array.isArray(saved?.positioningRules) ? saved.positioningRules : [],
      discoveryQuestions: Array.isArray(saved?.discoveryQuestions) ? saved.discoveryQuestions : [],
      qualificationRubric: Array.isArray(saved?.qualificationRubric) ? saved.qualificationRubric : [],
    };

    setContext(next);
    setBaseline(next);
    setStatus('saved');
    setTimeout(() => setStatus(null), 3000);
  }

  async function runAiAction(fieldKey: keyof SalesContext, mode: 'draft' | 'improve') {
    if (!aiEnabled) return;
    const currentValue = toInputValue(context, fieldKey);
    if (mode === 'improve' && !currentValue.trim()) {
      setAiError('Add text before using AI Improve.');
      return;
    }

    setAiError('');
    const busy = `${fieldKey}:${mode}`;
    setAiBusyKey(busy);

    const endpoint = mode === 'draft' ? '/api/ai/fields/draft' : '/api/ai/fields/improve';

    const payload = {
      target: 'company',
      fieldKey,
      ...(mode === 'improve' ? { text: currentValue } : {}),
      currentState: {
        salesContext: context,
        offerings: offerings.map((item) => ({ name: item.name, elevatorPitch: item.elevatorPitch ?? '' })),
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
      setAiError('AI returned empty text.');
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

  function applyAiSuggestion(fieldKey: keyof SalesContext) {
    const suggestion = aiSuggestions[fieldKey];
    if (!suggestion) return;

    setContext((prev) => {
      const current = prev[fieldKey];
      if (Array.isArray(current)) {
        return { ...prev, [fieldKey]: fromLines(suggestion.text) };
      }
      return { ...prev, [fieldKey]: suggestion.text };
    });

    setAiSuggestions((prev) => {
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  }

  function dismissAiSuggestion(fieldKey: keyof SalesContext) {
    setAiSuggestions((prev) => {
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  }

  if (loading) {
    return (
      <div className="space-y-3 p-8">
        {[...Array(8)].map((_, index) => (
          <div key={index} className="h-16 animate-pulse rounded-xl bg-slate-800" />
        ))}
      </div>
    );
  }

  const renderField = (field: FieldConfig) => {
    const value = toInputValue(context, field.key);
    const suggestion = aiSuggestions[field.key];

    return (
      <section key={field.key} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-white">{field.label}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{field.hint}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void runAiAction(field.key, 'draft')}
              disabled={!aiEnabled || aiBusyKey.length > 0}
              title={aiEnabled ? 'Generate AI draft' : aiMessage || 'AI unavailable'}
              className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
            >
              {aiBusyKey === `${field.key}:draft` ? 'Drafting...' : 'AI Draft'}
            </button>
            <button
              type="button"
              onClick={() => void runAiAction(field.key, 'improve')}
              disabled={!aiEnabled || aiBusyKey.length > 0 || !value.trim()}
              title={aiEnabled ? 'Improve text' : aiMessage || 'AI unavailable'}
              className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
            >
              {aiBusyKey === `${field.key}:improve` ? 'Improving...' : 'AI Improve'}
            </button>
          </div>
        </div>

        {field.type === 'select' ? (
          <select
            value={value}
            onChange={(event) => setField(field.key, event.target.value)}
            className={INPUT}
          >
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : field.type === 'text' ? (
          <input
            className={INPUT}
            value={value}
            onChange={(event) => setField(field.key, event.target.value)}
          />
        ) : (
          <textarea
            rows={field.type === 'long' ? 5 : 4}
            className={`${INPUT} resize-y`}
            value={value}
            onChange={(event) => setField(field.key, event.target.value)}
            placeholder={field.type === 'bullets' ? 'One item per line' : ''}
          />
        )}

        {suggestion ? (
          <div className="mt-3 space-y-2 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3">
            <p className="text-xs text-sky-200">
              {suggestion.mode === 'draft' ? 'AI Draft suggestion' : 'AI Improve suggestion'}
            </p>
            <pre className="whitespace-pre-wrap text-xs text-sky-100">{suggestion.text}</pre>
            {suggestion.notes.length > 0 ? (
              <ul className="space-y-0.5 text-xs text-sky-200">
                {suggestion.notes.map((note) => (
                  <li key={`${field.key}-${note}`}>{note}</li>
                ))}
              </ul>
            ) : null}
            {suggestion.warnings.length > 0 ? (
              <ul className="space-y-0.5 text-xs text-amber-200">
                {suggestion.warnings.map((warning) => (
                  <li key={`${field.key}-${warning}`}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => applyAiSuggestion(field.key)}
                className="rounded-md border border-sky-400/50 px-2.5 py-1 text-xs text-sky-100 hover:border-sky-300"
              >
                Apply suggested edit
              </button>
              <button
                type="button"
                onClick={() => dismissAiSuggestion(field.key)}
                className="rounded-md border border-slate-600 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-400"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
      </section>
    );
  };

  return (
    <div className="max-w-6xl p-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Sales Context</h1>
          <p className="mt-1 text-sm text-slate-500">
            Company context, policies, proof, and discovery guidance used by all coaching agents.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/app/admin/company/import"
            className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-200 hover:bg-sky-500/20"
          >
            Auto-fill
          </Link>
          <Link
            href="/app/admin/context/offerings"
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-slate-500"
          >
            Manage offerings
          </Link>
        </div>
      </div>

      <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-white">Offerings summary</h2>
          <Link
            href="/app/admin/context/offerings"
            className="text-xs text-sky-300 hover:text-sky-200"
          >
            Edit offerings
          </Link>
        </div>
        {offerings.length === 0 ? (
          <p className="text-xs text-slate-500">No offerings yet. Add at least one offering.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {offerings.slice(0, 8).map((offering) => (
              <span
                key={offering.id}
                className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-200"
              >
                {offering.name}
              </span>
            ))}
            {offerings.length > 8 ? (
              <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
                +{offerings.length - 8}
              </span>
            ) : null}
          </div>
        )}
      </section>

      <div className="space-y-4">{CORE_FIELDS.map((field) => renderField(field))}</div>

      <details className="mt-5 rounded-xl border border-slate-800 bg-slate-900">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-200">
          Advanced
        </summary>
        <div className="space-y-4 p-4 pt-0">{ADVANCED_FIELDS.map((field) => renderField(field))}</div>
      </details>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
        >
          {saving ? 'Saving...' : 'Save context'}
        </button>
        {status === 'saved' ? <span className="text-sm text-sky-400">Saved</span> : null}
        {status === 'error' ? <span className="text-sm text-red-400">Failed to save</span> : null}
        {aiError ? <span className="text-sm text-red-400">{aiError}</span> : null}
        {!aiEnabled && aiMessage ? <span className="text-sm text-amber-300">{aiMessage}</span> : null}
      </div>
    </div>
  );
}
