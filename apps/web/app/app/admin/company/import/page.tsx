'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OutOfCreditsModal } from '@/components/out-of-credits-modal';

type SourceType = 'WEBSITE' | 'PDF';

type JobPayload = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  target: 'COMPANY' | 'PRODUCT';
  sourceType: SourceType;
  result: Record<string, unknown>;
  error?: string | null;
};

type ExtractedField = {
  value: string;
  confidence: number;
  citations: string[];
  accepted: boolean;
  suggested: boolean;
};

type CompanyFieldKey =
  | 'company_overview'
  | 'target_customers'
  | 'value_props'
  | 'tone_style'
  | 'sales_strategy'
  | 'compliance_and_policies'
  | 'forbidden_claims'
  | 'competitor_positioning'
  | 'escalation_rules'
  | 'knowledge_base_appendix';

type IngestFocus = 'QUICK' | 'STANDARD' | 'DEEP';

type AiSuggestion = {
  text: string;
  mode: 'draft' | 'improve';
  notes: string[];
  warnings: string[];
};

const FIELD_SPECS: Array<{
  key: CompanyFieldKey;
  label: string;
  helper: string;
  rows: number;
}> = [
  {
    key: 'company_overview',
    label: 'Company overview',
    helper: 'Summarize positioning and core services in 2-4 concise sentences.',
    rows: 4,
  },
  {
    key: 'target_customers',
    label: 'Target customers',
    helper: 'Describe ideal buyer types and common purchase triggers.',
    rows: 4,
  },
  {
    key: 'value_props',
    label: 'Value propositions',
    helper: 'Use one factual bullet per line.',
    rows: 5,
  },
  {
    key: 'tone_style',
    label: 'Rep tone style',
    helper: 'Guide call tone and communication style.',
    rows: 3,
  },
  {
    key: 'sales_strategy',
    label: 'Sales strategy',
    helper: 'How reps should structure answers, objections, and next-step closes.',
    rows: 5,
  },
  {
    key: 'compliance_and_policies',
    label: 'Sales & service policies',
    helper: 'Booking, turnaround, cancellation, payment, licensing, and service-area guardrails.',
    rows: 5,
  },
  {
    key: 'forbidden_claims',
    label: 'Forbidden claims',
    helper: 'Claims reps should never make.',
    rows: 4,
  },
  {
    key: 'competitor_positioning',
    label: 'Competitor positioning',
    helper: 'How to compare safely and credibly.',
    rows: 4,
  },
  {
    key: 'escalation_rules',
    label: 'Escalation rules',
    helper: 'When reps must escalate to manager/admin.',
    rows: 4,
  },
  {
    key: 'knowledge_base_appendix',
    label: 'Knowledge base appendix',
    helper: 'Optional long-form context. Keep concise and factual.',
    rows: 6,
  },
];

function toRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseExtractedField(raw: unknown): ExtractedField {
  const data = toRecord(raw);
  const value = data.value;
  let normalized = '';
  if (Array.isArray(value)) {
    normalized = value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0)
      .join('\n');
  } else if (typeof value === 'string') {
    normalized = value.trim();
  } else if (value && typeof value === 'object') {
    normalized = JSON.stringify(value, null, 2);
  }

  const confidenceRaw = data.confidence;
  const confidence =
    typeof confidenceRaw === 'number'
      ? Math.max(0, Math.min(1, confidenceRaw))
      : typeof confidenceRaw === 'string'
        ? Math.max(0, Math.min(1, Number(confidenceRaw) || 0))
        : 0;

  const citations = Array.isArray(data.citations)
    ? data.citations
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0)
    : [];

  const suggested =
    data.suggested === true || (citations.length === 0 && confidence < 0.7);

  return {
    value: normalized,
    confidence,
    citations,
    accepted: normalized.length > 0 && confidence >= 0.5,
    suggested,
  };
}

export default function CompanyImportPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [sourceType, setSourceType] = useState<SourceType>('WEBSITE');
  const [url, setUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [focus, setFocus] = useState<IngestFocus>('STANDARD');
  const [pagesToScan, setPagesToScan] = useState('30');
  const [includePathsText, setIncludePathsText] = useState('');
  const [excludePathsText, setExcludePathsText] = useState('');
  const [jobId, setJobId] = useState('');
  const [job, setJob] = useState<JobPayload | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [showOutOfCreditsModal, setShowOutOfCreditsModal] = useState(false);
  const [appendToKnowledgeBase, setAppendToKnowledgeBase] = useState(true);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiMessage, setAiMessage] = useState('');
  const [aiBusyKey, setAiBusyKey] = useState('');
  const [aiError, setAiError] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<Partial<Record<CompanyFieldKey, AiSuggestion>>>({});
  const [extractionStartedAt, setExtractionStartedAt] = useState<number | null>(null);
  const [, setAnimTick] = useState(0);
  const [review, setReview] = useState<Record<CompanyFieldKey, ExtractedField>>({
    company_overview: { value: '', confidence: 0, citations: [], accepted: false, suggested: false },
    target_customers: { value: '', confidence: 0, citations: [], accepted: false, suggested: false },
    value_props: { value: '', confidence: 0, citations: [], accepted: false, suggested: false },
    tone_style: { value: '', confidence: 0, citations: [], accepted: false, suggested: false },
    sales_strategy: { value: '', confidence: 0, citations: [], accepted: false, suggested: false },
    compliance_and_policies: { value: '', confidence: 0, citations: [], accepted: false, suggested: false },
    forbidden_claims: { value: '', confidence: 0, citations: [], accepted: false, suggested: false },
    competitor_positioning: { value: '', confidence: 0, citations: [], accepted: false, suggested: false },
    escalation_rules: { value: '', confidence: 0, citations: [], accepted: false, suggested: false },
    knowledge_base_appendix: { value: '', confidence: 0, citations: [], accepted: false, suggested: false },
  });

  useEffect(() => {
    async function loadAiStatus() {
      const res = await fetch('/api/ai/fields/status', { cache: 'no-store' });
      const data = await res.json().catch(() => ({ enabled: false }));
      setAiEnabled(Boolean(data?.enabled));
      setAiMessage(typeof data?.message === 'string' ? data.message : '');
    }
    void loadAiStatus();
  }, []);

  const sourcesById = useMemo(() => {
    const sourceList = Array.isArray(job?.result?.sources)
      ? (job?.result?.sources as Array<Record<string, unknown>>)
      : [];
    const map = new Map<string, { title: string; uri: string }>();
    for (const source of sourceList) {
      const id = typeof source.id === 'string' ? source.id : '';
      if (!id) continue;
      map.set(id, {
        title: typeof source.title === 'string' ? source.title : id,
        uri: typeof source.uri === 'string' ? source.uri : '',
      });
    }
    return map;
  }, [job?.result]);

  useEffect(() => {
    if (!jobId || step !== 3) return;
    let active = true;

    async function poll() {
      const res = await fetch(`/api/ingest/jobs/${jobId}`, { cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as JobPayload | null;
      if (!active || !data) return;
      setJob(data);
      if (data.status === 'succeeded') {
        const fields = toRecord(data.result?.fields);
        const next: Record<CompanyFieldKey, ExtractedField> = {
          company_overview: parseExtractedField(fields.company_overview),
          target_customers: parseExtractedField(fields.target_customers),
          value_props: parseExtractedField(fields.value_props),
          tone_style: parseExtractedField(fields.tone_style),
          sales_strategy: parseExtractedField(fields.sales_strategy),
          compliance_and_policies: parseExtractedField(fields.compliance_and_policies),
          forbidden_claims: parseExtractedField(fields.forbidden_claims),
          competitor_positioning: parseExtractedField(fields.competitor_positioning),
          escalation_rules: parseExtractedField(fields.escalation_rules),
          knowledge_base_appendix: parseExtractedField(fields.knowledge_base_appendix),
        };
        setReview(next);
        setRunning(false);
        setStep(4);
      } else if (data.status === 'failed') {
        setError(data.error || 'Extraction failed.');
        setRunning(false);
      }
    }

    void poll();
    const intervalId = setInterval(() => {
      void poll();
    }, 2000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [jobId, step]);

  useEffect(() => {
    if (step !== 3) return;
    setExtractionStartedAt(Date.now());
    const timer = setInterval(() => setAnimTick((t) => t + 1), 300);
    return () => clearInterval(timer);
  }, [step]);

  async function runExtraction() {
    setError('');
    setApplied(false);
    setRunning(true);
    setJob(null);

    if (sourceType === 'WEBSITE') {
      if (!url.trim()) {
        setError('Website URL is required.');
        setRunning(false);
        return;
      }

      const payload = {
        url: url.trim(),
        focus,
        pagesToScan: Math.max(1, Number.parseInt(pagesToScan, 10) || 30),
        includePaths: includePathsText
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
        excludePaths: excludePathsText
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      };

      const res = await fetch('/api/ingest/company/website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to start extraction.');
        if (res.status === 402 || String(message).toLowerCase().includes('not enough credits')) {
          setShowOutOfCreditsModal(true);
        }
        setError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to start extraction.'));
        setRunning(false);
        return;
      }
      const createdJobId = typeof data?.jobId === 'string' ? data.jobId : '';
      if (!createdJobId) {
        setError('Job ID missing from response.');
        setRunning(false);
        return;
      }
      setJobId(createdJobId);
      window.dispatchEvent(new Event('credits:refresh'));
      setStep(3);
      return;
    }

    if (files.length === 0) {
      setError('Upload at least one PDF.');
      setRunning(false);
      return;
    }

    if (files.length > 5) {
      setError('You can upload up to 5 PDFs.');
      setRunning(false);
      return;
    }

    const oversized = files.find((file) => file.size > 20 * 1024 * 1024);
    if (oversized) {
      setError(`File exceeds 20MB: ${oversized.name}`);
      setRunning(false);
      return;
    }

    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    const res = await fetch('/api/ingest/company/pdfs', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to start extraction.');
      if (res.status === 402 || String(message).toLowerCase().includes('not enough credits')) {
        setShowOutOfCreditsModal(true);
      }
      setError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to start extraction.'));
      setRunning(false);
      return;
    }
    const createdJobId = typeof data?.jobId === 'string' ? data.jobId : '';
    if (!createdJobId) {
      setError('Job ID missing from response.');
      setRunning(false);
      return;
    }
    setJobId(createdJobId);
    window.dispatchEvent(new Event('credits:refresh'));
    setStep(3);
  }

  function patchReview<K extends CompanyFieldKey>(
    key: K,
    patch: Partial<ExtractedField>,
  ) {
    setReview((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function runAiAction(fieldKey: CompanyFieldKey, mode: 'draft' | 'improve') {
    if (!aiEnabled) return;
    if (mode === 'improve' && !review[fieldKey].value.trim()) {
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
      ...(mode === 'improve' ? { text: review[fieldKey].value } : {}),
      currentState: {
        sourceType,
        url,
        review,
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

  function applyAiSuggestion(fieldKey: CompanyFieldKey) {
    const suggestion = aiSuggestions[fieldKey];
    if (!suggestion) return;
    patchReview(fieldKey, { value: suggestion.text });
    setAiSuggestions((prev) => {
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  }

  async function applyReview() {
    if (!jobId) return;
    setApplying(true);
    setError('');

    const accepted = Object.fromEntries(
      FIELD_SPECS.map((spec) => [spec.key, review[spec.key].accepted]),
    );
    const values = Object.fromEntries(FIELD_SPECS.map((spec) => [spec.key, review[spec.key].value]));

    const res = await fetch(`/api/ingest/jobs/${jobId}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company: {
          accepted,
          values,
          appendToKnowledgeBase,
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    setApplying(false);
    if (!res.ok) {
      setError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to apply extracted data.'));
      return;
    }
    setApplied(true);
  }

  const progress = toRecord(job?.result?.progress);
  const progressStage = typeof progress.stage === 'string' ? progress.stage : 'running';
  const progressMessage = typeof progress.message === 'string' ? progress.message : 'Processing';
  const progressCompleted = typeof progress.completed === 'number' ? progress.completed : 0;
  const progressTotal = typeof progress.total === 'number' ? progress.total : 0;
  const jobSucceeded = job?.status === 'succeeded';
  const jobFailed = job?.status === 'failed';
  const displayPct = jobSucceeded
    ? 100
    : jobFailed
      ? 0
      : extractionStartedAt
        ? Math.round(95 * (1 - Math.exp(-(Date.now() - extractionStartedAt) / 70000)))
        : 0;
  const runNote =
    typeof job?.result?.note === 'string'
      ? job.result.note
      : typeof toRecord(job?.result?.stats).note === 'string'
        ? String(toRecord(job?.result?.stats).note)
        : '';

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Import Context</h1>
          <p className="text-sm text-slate-500 mt-1">
            Paste website URL or upload PDFs, run extraction, then accept/edit each field.
          </p>
        </div>
        <Link
          href="/app/admin/context"
          className="text-sm px-3 py-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
        >
          Back to context
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {(['Source', 'Configure', 'Extract', 'Review'] as const).map((label, index) => {
          const stepNumber = index + 1;
          const active = step === stepNumber;
          const done = step > stepNumber;
          return (
            <div
              key={label}
              className={`rounded-lg border px-3 py-2 text-sm ${
                done || active
                  ? 'border-sky-500/40 bg-sky-500/10 text-sky-300'
                  : 'border-slate-800 bg-slate-900 text-slate-500'
              }`}
            >
              {stepNumber}. {label}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {step === 1 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
          <h2 className="text-base font-semibold text-white">Step 1: Choose source</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setSourceType('WEBSITE')}
              className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                sourceType === 'WEBSITE'
                  ? 'border-sky-500/50 bg-sky-500/10 text-sky-200'
                  : 'border-slate-700 text-slate-300'
              }`}
            >
              Website URL
            </button>
            <button
              onClick={() => setSourceType('PDF')}
              className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                sourceType === 'PDF'
                  ? 'border-sky-500/50 bg-sky-500/10 text-sky-200'
                  : 'border-slate-700 text-slate-300'
              }`}
            >
              Upload PDF files
            </button>
          </div>
          <div className="pt-2">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
          <h2 className="text-base font-semibold text-white">Step 2: Configure</h2>

          {sourceType === 'WEBSITE' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Website URL</label>
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  placeholder="https://www.gtaphotopro.com"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Scan depth</label>
                  <select
                    value={focus}
                    onChange={(event) => setFocus(event.target.value as IngestFocus)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    <option value="QUICK">Quick (fastest, lower detail)</option>
                    <option value="STANDARD">Standard (balanced)</option>
                    <option value="DEEP">Deep (most detail)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Pages to scan</label>
                  <input
                    type="number"
                    min={1}
                    max={80}
                    value={pagesToScan}
                    onChange={(event) => setPagesToScan(event.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">
                    Include paths (optional, one per line)
                  </label>
                  <textarea
                    rows={3}
                    value={includePathsText}
                    onChange={(event) => setIncludePathsText(event.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="/services&#10;/pricing&#10;/faq"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">
                    Exclude paths (optional, one per line)
                  </label>
                  <textarea
                    rows={3}
                    value={excludePathsText}
                    onChange={(event) => setExcludePathsText(event.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="/blog&#10;/privacy&#10;/terms"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">PDF files (max 5, each max 20MB)</label>
                <input
                  type="file"
                  multiple
                  accept="application/pdf,.pdf"
                  onChange={(event) => {
                    const selected = Array.from(event.target.files ?? []);
                    setFiles(selected);
                  }}
                  className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-sky-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-sky-500"
                />
              </div>
              {files.length > 0 && (
                <ul className="space-y-1">
                  {files.map((file) => (
                    <li key={`${file.name}-${file.size}`} className="text-xs text-slate-400">
                      {file.name} ({Math.ceil(file.size / 1024)} KB)
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="pt-2 flex gap-2">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 text-sm rounded-lg border border-slate-700 text-slate-300"
            >
              Back
            </button>
            <button
              onClick={runExtraction}
              disabled={running}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50"
            >
              {running ? 'Starting...' : 'Run extraction'}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-3">
          <h2 className="text-base font-semibold text-white">Step 3: Run extraction</h2>
          <p className="text-sm text-slate-400">
            Job status: <span className="text-slate-200">{job?.status ?? 'queued'}</span>
          </p>
          <p className="text-sm text-slate-400">
            Stage: <span className="text-slate-200">{progressStage}</span> - {progressMessage}
          </p>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-sky-500 h-2 transition-[width] duration-300"
              style={{ width: `${displayPct}%` }}
            />
          </div>
          <p className="text-xs text-slate-500">
            {progressCompleted} / {progressTotal || '?'} processed
          </p>
          {runNote && (
            <p className="text-xs text-slate-300 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5">
              {runNote}
            </p>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-base font-semibold text-white">Step 4: Review and apply</h2>
            <p className="mt-1 text-sm text-slate-500">
              Accept, edit, and apply only the fields you want.
            </p>
            {runNote && (
              <p className="mt-2 text-xs text-slate-300 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 inline-flex">
                {runNote}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={appendToKnowledgeBase}
                onChange={(event) => setAppendToKnowledgeBase(event.target.checked)}
              />
              Append extracted long-form appendix to knowledge base
            </label>
          </div>

          {FIELD_SPECS.map((spec) => {
            const field = review[spec.key];
            const suggestion = aiSuggestions[spec.key];
            return (
              <section key={spec.key} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-white">{spec.label}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{spec.helper}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <span className="text-xs px-2 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-sky-200">
                      {(field.confidence * 100).toFixed(0)}% confidence
                    </span>
                    {field.suggested && (
                      <span className="text-xs px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-200">
                        Suggested
                      </span>
                    )}
                    <label className="flex items-center gap-1 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={field.accepted}
                        onChange={(event) =>
                          patchReview(spec.key, { accepted: event.target.checked })
                        }
                      />
                      Accept
                    </label>
                    <button
                      onClick={() => runAiAction(spec.key, 'draft')}
                      disabled={!aiEnabled || aiBusyKey.length > 0}
                      title={aiEnabled ? 'Generate AI draft' : aiMessage || 'AI unavailable'}
                      className="px-2.5 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                    >
                      {aiBusyKey === `${spec.key}:draft` ? 'Drafting...' : 'AI Draft'}
                    </button>
                    <button
                      onClick={() => runAiAction(spec.key, 'improve')}
                      disabled={!aiEnabled || aiBusyKey.length > 0 || !field.value.trim()}
                      title={aiEnabled ? 'Improve current text' : aiMessage || 'AI unavailable'}
                      className="px-2.5 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                    >
                      {aiBusyKey === `${spec.key}:improve` ? 'Improving...' : 'AI Improve'}
                    </button>
                  </div>
                </div>

                <textarea
                  rows={spec.rows}
                  value={field.value}
                  onChange={(event) => patchReview(spec.key, { value: event.target.value })}
                  className="mt-3 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                />

                {field.citations.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-slate-400">
                      Citations ({field.citations.length})
                    </summary>
                    <ul className="mt-2 space-y-1 text-xs text-slate-400">
                      {field.citations.map((id) => {
                        const source = sourcesById.get(id);
                        return (
                          <li key={`${spec.key}-${id}`}>
                            {id}: {source?.title || id}
                            {source?.uri ? ` - ${source.uri}` : ''}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
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
                          <li key={`${spec.key}-${note}`}>{note}</li>
                        ))}
                      </ul>
                    )}
                    {suggestion.warnings.length > 0 && (
                      <ul className="text-xs text-amber-200 space-y-0.5">
                        {suggestion.warnings.map((warning) => (
                          <li key={`${spec.key}-${warning}`}>{warning}</li>
                        ))}
                      </ul>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => applyAiSuggestion(spec.key)}
                        className="px-2.5 py-1 rounded-md border border-sky-400/50 text-xs text-sky-100 hover:border-sky-300"
                      >
                        Apply suggested edit
                      </button>
                      <button
                        onClick={() =>
                          setAiSuggestions((prev) => {
                            const next = { ...prev };
                            delete next[spec.key];
                            return next;
                          })
                        }
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

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={applyReview}
              disabled={applying}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50"
            >
              {applying ? 'Applying...' : 'Apply to context'}
            </button>
            {applied && (
              <button
                onClick={() => router.push('/app/admin/context')}
                className="px-4 py-2 text-sm rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-200"
              >
                Applied. Back to context
              </button>
            )}
            {aiError && <span className="text-sm text-red-300">{aiError}</span>}
            {!aiEnabled && aiMessage && <span className="text-sm text-amber-300">{aiMessage}</span>}
          </div>
        </div>
      )}
      <OutOfCreditsModal
        open={showOutOfCreditsModal}
        onClose={() => setShowOutOfCreditsModal(false)}
      />
    </div>
  );
}
