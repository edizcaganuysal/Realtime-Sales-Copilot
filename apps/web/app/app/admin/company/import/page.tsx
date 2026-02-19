'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

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
};

type CompanyFieldKey =
  | 'company_overview'
  | 'target_customers'
  | 'value_props'
  | 'tone_style'
  | 'compliance_and_policies'
  | 'forbidden_claims'
  | 'competitor_positioning'
  | 'escalation_rules'
  | 'knowledge_base_appendix';

const FIELD_SPECS: Array<{
  key: CompanyFieldKey;
  label: string;
  helper: string;
  rows: number;
}> = [
  {
    key: 'company_overview',
    label: 'Company overview',
    helper: 'Summarize positioning and what the company delivers in 2-4 sentences.',
    rows: 4,
  },
  {
    key: 'target_customers',
    label: 'Target customers',
    helper: 'Describe ideal customer segments and buying context.',
    rows: 4,
  },
  {
    key: 'value_props',
    label: 'Value propositions',
    helper: 'Use one bullet per line with measurable outcomes.',
    rows: 5,
  },
  {
    key: 'tone_style',
    label: 'Tone style',
    helper: 'Define rep tone in short practical guidance.',
    rows: 3,
  },
  {
    key: 'compliance_and_policies',
    label: 'Compliance and policies',
    helper: 'List claims and policy guardrails reps should follow.',
    rows: 4,
  },
  {
    key: 'forbidden_claims',
    label: 'Forbidden claims',
    helper: 'List statements reps must avoid making.',
    rows: 4,
  },
  {
    key: 'competitor_positioning',
    label: 'Competitor positioning',
    helper: 'Position against competitors safely without unsupported claims.',
    rows: 4,
  },
  {
    key: 'escalation_rules',
    label: 'Escalation rules',
    helper: 'Define when reps should escalate legal, pricing, or security questions.',
    rows: 4,
  },
  {
    key: 'knowledge_base_appendix',
    label: 'Knowledge base appendix',
    helper: 'Optional long-form context. Keep concise and factual.',
    rows: 6,
  },
];

function parsePaths(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

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

  return {
    value: normalized,
    confidence,
    citations,
    accepted: normalized.length > 0,
  };
}

export default function CompanyImportPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [sourceType, setSourceType] = useState<SourceType>('WEBSITE');
  const [url, setUrl] = useState('');
  const [maxPages, setMaxPages] = useState(8);
  const [depth, setDepth] = useState(2);
  const [includePathsText, setIncludePathsText] = useState('');
  const [excludePathsText, setExcludePathsText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [jobId, setJobId] = useState('');
  const [job, setJob] = useState<JobPayload | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [appendToKnowledgeBase, setAppendToKnowledgeBase] = useState(true);
  const [review, setReview] = useState<Record<CompanyFieldKey, ExtractedField>>({
    company_overview: { value: '', confidence: 0, citations: [], accepted: false },
    target_customers: { value: '', confidence: 0, citations: [], accepted: false },
    value_props: { value: '', confidence: 0, citations: [], accepted: false },
    tone_style: { value: '', confidence: 0, citations: [], accepted: false },
    compliance_and_policies: { value: '', confidence: 0, citations: [], accepted: false },
    forbidden_claims: { value: '', confidence: 0, citations: [], accepted: false },
    competitor_positioning: { value: '', confidence: 0, citations: [], accepted: false },
    escalation_rules: { value: '', confidence: 0, citations: [], accepted: false },
    knowledge_base_appendix: { value: '', confidence: 0, citations: [], accepted: false },
  });

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
        maxPages: Math.max(1, Math.min(15, maxPages)),
        depth: Math.max(1, Math.min(3, depth)),
        includePaths: parsePaths(includePathsText),
        excludePaths: parsePaths(excludePathsText),
      };

      const res = await fetch('/api/ingest/company/website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
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
    setStep(3);
  }

  function patchReview<K extends CompanyFieldKey>(
    key: K,
    patch: Partial<ExtractedField>,
  ) {
    setReview((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
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

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Import Company Profile</h1>
          <p className="text-sm text-slate-500 mt-1">
            Auto-fill company profile fields from a website or PDFs, then review every field before saving.
          </p>
        </div>
        <Link
          href="/app/admin/company"
          className="text-sm px-3 py-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
        >
          Back to company profile
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
                done
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : active
                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
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
                  ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-200'
                  : 'border-slate-700 text-slate-300'
              }`}
            >
              Website URL
            </button>
            <button
              onClick={() => setSourceType('PDF')}
              className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                sourceType === 'PDF'
                  ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-200'
                  : 'border-slate-700 text-slate-300'
              }`}
            >
              Upload PDF files
            </button>
          </div>
          <div className="pt-2">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-colors"
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
                  placeholder="https://example.com"
                />
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Max pages (default 8, max 15)</label>
                  <input
                    type="number"
                    min={1}
                    max={15}
                    value={maxPages}
                    onChange={(event) => setMaxPages(Number(event.target.value) || 8)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Depth (default 2)</label>
                  <input
                    type="number"
                    min={1}
                    max={3}
                    value={depth}
                    onChange={(event) => setDepth(Number(event.target.value) || 2)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Include paths (optional)</label>
                  <textarea
                    rows={3}
                    value={includePathsText}
                    onChange={(event) => setIncludePathsText(event.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="/product&#10;/pricing"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Exclude paths (optional)</label>
                  <textarea
                    rows={3}
                    value={excludePathsText}
                    onChange={(event) => setExcludePathsText(event.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="/blog&#10;/careers"
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
                  className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-cyan-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-cyan-500"
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
              className="px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50"
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
              className="bg-cyan-500 h-2 transition-all"
              style={{
                width:
                  progressTotal > 0
                    ? `${Math.min(100, Math.round((progressCompleted / progressTotal) * 100))}%`
                    : '10%',
              }}
            />
          </div>
          <p className="text-xs text-slate-500">
            {progressCompleted} / {progressTotal || '?'} processed
          </p>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-base font-semibold text-white">Step 4: Review and apply</h2>
            <p className="mt-1 text-sm text-slate-500">
              Accept, edit, and apply only the fields you want.
            </p>
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
            return (
              <section key={spec.key} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-white">{spec.label}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{spec.helper}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs px-2 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-200">
                      {(field.confidence * 100).toFixed(0)}% confidence
                    </span>
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
              </section>
            );
          })}

          <div className="flex items-center gap-3">
            <button
              onClick={applyReview}
              disabled={applying}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
            >
              {applying ? 'Applying...' : 'Apply to company profile'}
            </button>
            {applied && (
              <button
                onClick={() => router.push('/app/admin/company')}
                className="px-4 py-2 text-sm rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              >
                Applied. Back to company profile
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
