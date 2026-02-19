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
  citations: Record<string, string[]>;
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
  };
}

function parsePaths(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function toLines(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export default function ProductImportPage() {
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
  const [products, setProducts] = useState<ProductReview[]>([]);

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

          const valuePropsLines = Array.isArray(valueProps.value)
            ? valueProps.value
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter((entry) => entry.length > 0)
                .join('\n')
            : '';
          const differentiatorsLines = Array.isArray(differentiators.value)
            ? differentiators.value
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter((entry) => entry.length > 0)
                .join('\n')
            : '';
          const dontSayLines = Array.isArray(dontSay.value)
            ? dontSay.value
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter((entry) => entry.length > 0)
                .join('\n')
            : '';

          return {
            id: typeof raw.id === 'string' ? raw.id : `product-${index + 1}`,
            accepted: true,
            name: typeof name.value === 'string' ? name.value : '',
            elevator_pitch: typeof elevator.value === 'string' ? elevator.value : '',
            value_props_text: valuePropsLines,
            differentiators_text: differentiatorsLines,
            dont_say_text: dontSayLines,
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
            confidence:
              (name.confidence +
                elevator.confidence +
                valueProps.confidence +
                differentiators.confidence) /
              4,
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
        maxPages: Math.max(1, Math.min(15, maxPages)),
        depth: Math.max(1, Math.min(3, depth)),
        includePaths: parsePaths(includePathsText),
        excludePaths: parsePaths(excludePathsText),
      };

      const res = await fetch('/api/ingest/product/website', {
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
    const res = await fetch('/api/ingest/product/pdfs', {
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

  function patchProduct(index: number, patch: Partial<ProductReview>) {
    setProducts((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
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
      body: JSON.stringify({
        products: payloadProducts,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setApplying(false);
    if (!res.ok) {
      setError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to apply products.'));
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
          <h1 className="text-xl font-semibold text-white">Import Products</h1>
          <p className="text-sm text-slate-500 mt-1">
            Auto-detect products from a website or PDFs, then review and confirm before creating.
          </p>
        </div>
        <Link
          href="/app/admin/products"
          className="text-sm px-3 py-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
        >
          Back to products
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
              Select products to create and edit each field before applying.
            </p>
          </div>

          {products.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
              No products were detected. Try a different source or include paths.
            </div>
          ) : (
            products.map((product, index) => (
              <section key={product.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Product candidate {index + 1}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {(product.confidence * 100).toFixed(0)}% confidence
                    </p>
                  </div>
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

                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Name</label>
                  <input
                    value={product.name}
                    onChange={(event) => patchProduct(index, { name: event.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Elevator pitch</label>
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
                  <label className="block text-xs text-slate-400 mb-1.5">Value props</label>
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
                      <label className="block text-xs text-slate-400 mb-1.5">Differentiators</label>
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
                      <label className="block text-xs text-slate-400 mb-1.5">Do not say</label>
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
                      <label className="block text-xs text-slate-400 mb-1.5">Pricing rules (JSON object)</label>
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
                      <label className="block text-xs text-slate-400 mb-1.5">FAQs (JSON array)</label>
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
                      <label className="block text-xs text-slate-400 mb-1.5">Objections (JSON array)</label>
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
                  <summary className="cursor-pointer text-xs text-slate-400">
                    Citations
                  </summary>
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
              </section>
            ))
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={applyReview}
              disabled={applying || products.length === 0}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
            >
              {applying ? 'Applying...' : 'Create selected products'}
            </button>
            {applied && (
              <button
                onClick={() => router.push('/app/admin/products')}
                className="px-4 py-2 text-sm rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              >
                Applied. Back to products
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
