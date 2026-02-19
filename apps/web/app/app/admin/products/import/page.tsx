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

type ProductReview = {
  id: string;
  accepted: boolean;
  name: string;
  elevator_pitch: string;
  value_props_text: string;
  differentiators_text: string;
  dont_say_text: string;
  pricing_rules_text: string;
  faqs_text: string;
  objections_text: string;
  confidence: number;
  suggested: boolean;
  citations: Record<string, string[]>;
};

type AiSuggestion = {
  text: string;
  mode: 'draft' | 'improve';
  notes: string[];
  warnings: string[];
};

function toRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toConfidence(value: unknown) {
  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;
  if (Number.isFinite(num)) return Math.max(0, Math.min(1, num));
  return 0;
}

function toCitations(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

function parseField(raw: unknown) {
  const data = toRecord(raw);
  return {
    value: data.value,
    confidence: toConfidence(data.confidence),
    citations: toCitations(data.citations),
    suggested: data.suggested === true,
  };
}

function toLines(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseArrayLines(value: unknown) {
  if (!Array.isArray(value)) return '';
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
    .join('\n');
}

export default function ProductImportPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [sourceType, setSourceType] = useState<SourceType>('WEBSITE');
  const [url, setUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [jobId, setJobId] = useState('');
  const [job, setJob] = useState<JobPayload | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [showOutOfCreditsModal, setShowOutOfCreditsModal] = useState(false);
  const [products, setProducts] = useState<ProductReview[]>([]);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiMessage, setAiMessage] = useState('');
  const [aiBusyKey, setAiBusyKey] = useState('');
  const [aiError, setAiError] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, Partial<Record<string, AiSuggestion>>>>({});

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
    async function loadAiStatus() {
      const res = await fetch('/api/ai/fields/status', { cache: 'no-store' });
      const data = await res.json().catch(() => ({ enabled: false }));
      setAiEnabled(Boolean(data?.enabled));
      setAiMessage(typeof data?.message === 'string' ? data.message : '');
    }
    void loadAiStatus();
  }, []);

  useEffect(() => {
    if (!jobId || step !== 3) return;
    let active = true;

    async function poll() {
      const res = await fetch(`/api/ingest/jobs/${jobId}`, { cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as JobPayload | null;
      if (!active || !data) return;
      setJob(data);
      if (data.status === 'succeeded') {
        const rawProducts = Array.isArray(data.result?.products)
          ? (data.result.products as Array<Record<string, unknown>>)
          : [];
        const parsed = rawProducts.map((raw, index) => {
          const name = parseField(raw.name);
          const elevator = parseField(raw.elevator_pitch);
          const valueProps = parseField(raw.value_props);
          const differentiators = parseField(raw.differentiators);
          const pricingRules = parseField(raw.pricing_rules);
          const dontSay = parseField(raw.dont_say);
          const faqs = parseField(raw.faqs);
          const objections = parseField(raw.objections);

          const citationSet = new Set<string>([
            ...name.citations,
            ...elevator.citations,
            ...valueProps.citations,
            ...differentiators.citations,
            ...pricingRules.citations,
            ...dontSay.citations,
            ...faqs.citations,
            ...objections.citations,
          ]);

          const confidence =
            (name.confidence +
              elevator.confidence +
              valueProps.confidence +
              differentiators.confidence) /
            4;

          const suggested =
            name.suggested ||
            elevator.suggested ||
            valueProps.suggested ||
            differentiators.suggested ||
            citationSet.size === 0;

          const defaultAccepted = confidence >= 0.85 && citationSet.size > 0 && !suggested;

          return {
            id: typeof raw.id === 'string' ? raw.id : `product-${index + 1}`,
            accepted: defaultAccepted,
            name: typeof name.value === 'string' ? name.value : '',
            elevator_pitch: typeof elevator.value === 'string' ? elevator.value : '',
            value_props_text: parseArrayLines(valueProps.value),
            differentiators_text: parseArrayLines(differentiators.value),
            dont_say_text: parseArrayLines(dontSay.value),
            pricing_rules_text: JSON.stringify(
              pricingRules.value && typeof pricingRules.value === 'object' && !Array.isArray(pricingRules.value)
                ? pricingRules.value
                : {},
              null,
              2,
            ),
            faqs_text: JSON.stringify(Array.isArray(faqs.value) ? faqs.value : [], null, 2),
            objections_text: JSON.stringify(
              Array.isArray(objections.value) ? objections.value : [],
              null,
              2,
            ),
            confidence,
            suggested,
            citations: {
              name: name.citations,
              elevator_pitch: elevator.citations,
              value_props: valueProps.citations,
              differentiators: differentiators.citations,
              pricing_rules: pricingRules.citations,
              dont_say: dontSay.citations,
              faqs: faqs.citations,
              objections: objections.citations,
            },
          } as ProductReview;
        });
        setProducts(parsed);
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
      };

      const res = await fetch('/api/ingest/product/website', {
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
    const res = await fetch('/api/ingest/product/pdfs', {
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

  function patchProduct(index: number, patch: Partial<ProductReview>) {
    setProducts((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function runAiAction(
    productId: string,
    fieldKey: keyof ProductReview,
    mode: 'draft' | 'improve',
  ) {
    if (!aiEnabled) return;
    const product = products.find((item) => item.id === productId);
    if (!product) return;

    const currentText = typeof product[fieldKey] === 'string' ? String(product[fieldKey]) : '';
    if (mode === 'improve' && !currentText.trim()) {
      setAiError('Add text before using AI Improve.');
      return;
    }

    setAiError('');
    const busy = `${productId}:${String(fieldKey)}:${mode}`;
    setAiBusyKey(busy);

    const endpoint = mode === 'draft' ? '/api/ai/fields/draft' : '/api/ai/fields/improve';
    const payload = {
      target: 'product',
      fieldKey,
      ...(mode === 'improve' ? { text: currentText } : {}),
      currentState: {
        sourceType,
        url,
        product,
        allProducts: products,
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
      [productId]: {
        ...(prev[productId] || {}),
        [String(fieldKey)]: {
          text,
          mode,
          notes: Array.isArray(data?.notes)
            ? data.notes.filter((entry: unknown) => typeof entry === 'string').slice(0, 6)
            : [],
          warnings: Array.isArray(data?.warnings)
            ? data.warnings.filter((entry: unknown) => typeof entry === 'string').slice(0, 6)
            : [],
        },
      },
    }));
  }

  function applyAiSuggestion(productId: string, fieldKey: keyof ProductReview, index: number) {
    const suggestion = aiSuggestions[productId]?.[String(fieldKey)];
    if (!suggestion) return;
    patchProduct(index, { [fieldKey]: suggestion.text } as Partial<ProductReview>);
    setAiSuggestions((prev) => {
      const productEntry = { ...(prev[productId] || {}) };
      delete productEntry[String(fieldKey)];
      return {
        ...prev,
        [productId]: productEntry,
      };
    });
  }

  async function applyReview() {
    if (!jobId) return;
    setApplying(true);
    setError('');

    const payloadProducts = [];
    for (const product of products) {
      let pricingRules: Record<string, unknown>;
      let faqs: unknown[];
      let objections: unknown[];
      try {
        const pricing = JSON.parse(product.pricing_rules_text || '{}');
        const parsedFaqs = JSON.parse(product.faqs_text || '[]');
        const parsedObjections = JSON.parse(product.objections_text || '[]');
        if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) {
          throw new Error(`Pricing rules must be a JSON object for ${product.name || 'a product'}.`);
        }
        if (!Array.isArray(parsedFaqs)) {
          throw new Error(`FAQs must be a JSON array for ${product.name || 'a product'}.`);
        }
        if (!Array.isArray(parsedObjections)) {
          throw new Error(`Objections must be a JSON array for ${product.name || 'a product'}.`);
        }
        pricingRules = pricing;
        faqs = parsedFaqs;
        objections = parsedObjections;
      } catch (parseError) {
        setApplying(false);
        setError(parseError instanceof Error ? parseError.message : 'Invalid JSON in product review.');
        return;
      }

      payloadProducts.push({
        accepted: product.accepted,
        name: product.name.trim(),
        elevator_pitch: product.elevator_pitch,
        value_props: toLines(product.value_props_text),
        differentiators: toLines(product.differentiators_text),
        dont_say: toLines(product.dont_say_text),
        pricing_rules: pricingRules,
        faqs,
        objections,
      });
    }

    const res = await fetch(`/api/ingest/jobs/${jobId}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: payloadProducts }),
    });
    const data = await res.json().catch(() => ({}));
    setApplying(false);
    if (!res.ok) {
      setError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to apply offerings.'));
      return;
    }
    setApplied(true);
  }

  const progress = toRecord(job?.result?.progress);
  const progressStage = typeof progress.stage === 'string' ? progress.stage : 'running';
  const progressMessage = typeof progress.message === 'string' ? progress.message : 'Processing';
  const progressCompleted = typeof progress.completed === 'number' ? progress.completed : 0;
  const progressTotal = typeof progress.total === 'number' ? progress.total : 0;
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
          <h1 className="text-xl font-semibold text-white">Import Offerings</h1>
          <p className="text-sm text-slate-500 mt-1">
            Detect offering candidates, review evidence, and create only approved offerings.
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
              className="bg-sky-500 h-2 transition-all"
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
              Select candidates to create and review evidence before applying.
            </p>
          </div>

          {products.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
              No offerings were detected. Try a different URL or upload documents.
            </div>
          ) : (
            products.map((product, index) => (
              <section key={product.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Offering candidate {index + 1}</h3>
                    <p className="text-xs text-slate-500">
                      {(product.confidence * 100).toFixed(0)}% confidence
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {product.suggested && (
                      <span className="text-xs px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-200">
                        Suggested
                      </span>
                    )}
                    <label className="flex items-center gap-1 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={product.accepted}
                        onChange={(event) =>
                          patchProduct(index, { accepted: event.target.checked })
                        }
                      />
                      Create this product
                    </label>
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label className="block text-xs text-slate-400">Name</label>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => runAiAction(product.id, 'name', 'draft')}
                        disabled={!aiEnabled || aiBusyKey.length > 0}
                        title={aiEnabled ? 'Generate AI draft' : aiMessage || 'AI unavailable'}
                        className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                      >
                        {aiBusyKey === `${product.id}:name:draft` ? 'Drafting...' : 'AI Draft'}
                      </button>
                      <button
                        onClick={() => runAiAction(product.id, 'name', 'improve')}
                        disabled={!aiEnabled || aiBusyKey.length > 0 || !product.name.trim()}
                        title={aiEnabled ? 'Improve current text' : aiMessage || 'AI unavailable'}
                        className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                      >
                        {aiBusyKey === `${product.id}:name:improve` ? 'Improving...' : 'AI Improve'}
                      </button>
                    </div>
                  </div>
                  <input
                    value={product.name}
                    onChange={(event) => patchProduct(index, { name: event.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label className="block text-xs text-slate-400">Elevator pitch</label>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => runAiAction(product.id, 'elevator_pitch', 'draft')}
                        disabled={!aiEnabled || aiBusyKey.length > 0}
                        className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                      >
                        {aiBusyKey === `${product.id}:elevator_pitch:draft` ? 'Drafting...' : 'AI Draft'}
                      </button>
                      <button
                        onClick={() => runAiAction(product.id, 'elevator_pitch', 'improve')}
                        disabled={!aiEnabled || aiBusyKey.length > 0 || !product.elevator_pitch.trim()}
                        className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                      >
                        {aiBusyKey === `${product.id}:elevator_pitch:improve` ? 'Improving...' : 'AI Improve'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={3}
                    value={product.elevator_pitch}
                    onChange={(event) =>
                      patchProduct(index, { elevator_pitch: event.target.value })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label className="block text-xs text-slate-400">Value props</label>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => runAiAction(product.id, 'value_props_text', 'draft')}
                        disabled={!aiEnabled || aiBusyKey.length > 0}
                        className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                      >
                        {aiBusyKey === `${product.id}:value_props_text:draft` ? 'Drafting...' : 'AI Draft'}
                      </button>
                      <button
                        onClick={() => runAiAction(product.id, 'value_props_text', 'improve')}
                        disabled={!aiEnabled || aiBusyKey.length > 0 || !product.value_props_text.trim()}
                        className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                      >
                        {aiBusyKey === `${product.id}:value_props_text:improve` ? 'Improving...' : 'AI Improve'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={4}
                    value={product.value_props_text}
                    onChange={(event) =>
                      patchProduct(index, { value_props_text: event.target.value })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>

                <details className="rounded-lg border border-slate-800 overflow-hidden">
                  <summary className="cursor-pointer px-3 py-2 text-sm text-slate-300 bg-slate-800/70">
                    Advanced
                  </summary>
                  <div className="p-3 space-y-3 bg-slate-900">
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <label className="block text-xs text-slate-400">Differentiators</label>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => runAiAction(product.id, 'differentiators_text', 'draft')}
                            disabled={!aiEnabled || aiBusyKey.length > 0}
                            className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                          >
                            {aiBusyKey === `${product.id}:differentiators_text:draft` ? 'Drafting...' : 'AI Draft'}
                          </button>
                          <button
                            onClick={() => runAiAction(product.id, 'differentiators_text', 'improve')}
                            disabled={!aiEnabled || aiBusyKey.length > 0 || !product.differentiators_text.trim()}
                            className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                          >
                            {aiBusyKey === `${product.id}:differentiators_text:improve` ? 'Improving...' : 'AI Improve'}
                          </button>
                        </div>
                      </div>
                      <textarea
                        rows={3}
                        value={product.differentiators_text}
                        onChange={(event) =>
                          patchProduct(index, { differentiators_text: event.target.value })
                        }
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                      />
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <label className="block text-xs text-slate-400">Do not say</label>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => runAiAction(product.id, 'dont_say_text', 'draft')}
                            disabled={!aiEnabled || aiBusyKey.length > 0}
                            className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                          >
                            {aiBusyKey === `${product.id}:dont_say_text:draft` ? 'Drafting...' : 'AI Draft'}
                          </button>
                          <button
                            onClick={() => runAiAction(product.id, 'dont_say_text', 'improve')}
                            disabled={!aiEnabled || aiBusyKey.length > 0 || !product.dont_say_text.trim()}
                            className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                          >
                            {aiBusyKey === `${product.id}:dont_say_text:improve` ? 'Improving...' : 'AI Improve'}
                          </button>
                        </div>
                      </div>
                      <textarea
                        rows={3}
                        value={product.dont_say_text}
                        onChange={(event) =>
                          patchProduct(index, { dont_say_text: event.target.value })
                        }
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                      />
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <label className="block text-xs text-slate-400">Pricing rules (JSON object)</label>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => runAiAction(product.id, 'pricing_rules_text', 'draft')}
                            disabled={!aiEnabled || aiBusyKey.length > 0}
                            className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                          >
                            {aiBusyKey === `${product.id}:pricing_rules_text:draft` ? 'Drafting...' : 'AI Draft'}
                          </button>
                          <button
                            onClick={() => runAiAction(product.id, 'pricing_rules_text', 'improve')}
                            disabled={!aiEnabled || aiBusyKey.length > 0 || !product.pricing_rules_text.trim()}
                            className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                          >
                            {aiBusyKey === `${product.id}:pricing_rules_text:improve` ? 'Improving...' : 'AI Improve'}
                          </button>
                        </div>
                      </div>
                      <textarea
                        rows={4}
                        value={product.pricing_rules_text}
                        onChange={(event) =>
                          patchProduct(index, { pricing_rules_text: event.target.value })
                        }
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <label className="block text-xs text-slate-400">FAQs (JSON array)</label>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => runAiAction(product.id, 'faqs_text', 'draft')}
                            disabled={!aiEnabled || aiBusyKey.length > 0}
                            className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                          >
                            {aiBusyKey === `${product.id}:faqs_text:draft` ? 'Drafting...' : 'AI Draft'}
                          </button>
                          <button
                            onClick={() => runAiAction(product.id, 'faqs_text', 'improve')}
                            disabled={!aiEnabled || aiBusyKey.length > 0 || !product.faqs_text.trim()}
                            className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                          >
                            {aiBusyKey === `${product.id}:faqs_text:improve` ? 'Improving...' : 'AI Improve'}
                          </button>
                        </div>
                      </div>
                      <textarea
                        rows={4}
                        value={product.faqs_text}
                        onChange={(event) =>
                          patchProduct(index, { faqs_text: event.target.value })
                        }
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <label className="block text-xs text-slate-400">Objections (JSON array)</label>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => runAiAction(product.id, 'objections_text', 'draft')}
                            disabled={!aiEnabled || aiBusyKey.length > 0}
                            className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                          >
                            {aiBusyKey === `${product.id}:objections_text:draft` ? 'Drafting...' : 'AI Draft'}
                          </button>
                          <button
                            onClick={() => runAiAction(product.id, 'objections_text', 'improve')}
                            disabled={!aiEnabled || aiBusyKey.length > 0 || !product.objections_text.trim()}
                            className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
                          >
                            {aiBusyKey === `${product.id}:objections_text:improve` ? 'Improving...' : 'AI Improve'}
                          </button>
                        </div>
                      </div>
                      <textarea
                        rows={4}
                        value={product.objections_text}
                        onChange={(event) =>
                          patchProduct(index, { objections_text: event.target.value })
                        }
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                  </div>
                </details>

                <details>
                  <summary className="cursor-pointer text-xs text-slate-400">Citations</summary>
                  <div className="mt-2 space-y-2 text-xs text-slate-400">
                    {Object.entries(product.citations).map(([fieldKey, ids]) => (
                      <div key={`${product.id}-${fieldKey}`}>
                        <p className="text-slate-500">{fieldKey}</p>
                        {ids.length === 0 ? (
                          <p className="text-slate-600">No citations</p>
                        ) : (
                          <ul className="mt-1 space-y-1">
                            {ids.map((id) => {
                              const source = sourcesById.get(id);
                              return (
                                <li key={`${product.id}-${fieldKey}-${id}`}>
                                  {id}: {source?.title || id}
                                  {source?.uri ? ` - ${source.uri}` : ''}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </details>

                {Object.entries(aiSuggestions[product.id] || {}).map(([fieldKey, suggestion]) => {
                  if (!suggestion) return null;
                  return (
                    <div key={`${product.id}-${fieldKey}`} className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 space-y-2">
                      <p className="text-xs text-sky-200">
                        {suggestion.mode === 'draft' ? 'AI Draft suggestion' : 'AI Improve suggestion'} ({fieldKey})
                      </p>
                      <pre className="whitespace-pre-wrap text-xs text-sky-100">{suggestion.text}</pre>
                      {suggestion.notes.length > 0 && (
                        <ul className="text-xs text-sky-200 space-y-0.5">
                          {suggestion.notes.map((note) => (
                            <li key={`${product.id}-${fieldKey}-${note}`}>{note}</li>
                          ))}
                        </ul>
                      )}
                      {suggestion.warnings.length > 0 && (
                        <ul className="text-xs text-amber-200 space-y-0.5">
                          {suggestion.warnings.map((warning) => (
                            <li key={`${product.id}-${fieldKey}-${warning}`}>{warning}</li>
                          ))}
                        </ul>
                      )}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => applyAiSuggestion(product.id, fieldKey as keyof ProductReview, index)}
                          className="px-2.5 py-1 rounded-md border border-sky-400/50 text-xs text-sky-100 hover:border-sky-300"
                        >
                          Apply suggested edit
                        </button>
                        <button
                          onClick={() =>
                            setAiSuggestions((prev) => {
                              const item = { ...(prev[product.id] || {}) };
                              delete item[fieldKey];
                              return { ...prev, [product.id]: item };
                            })
                          }
                          className="px-2.5 py-1 rounded-md border border-slate-600 text-xs text-slate-300 hover:border-slate-400"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  );
                })}
              </section>
            ))
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={applyReview}
              disabled={applying || products.length === 0}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50"
            >
              {applying ? 'Applying...' : 'Create selected offerings'}
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
