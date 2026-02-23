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

// ─── Company context types ───────────────────────────────────────────────────

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

type ExtractedField = {
  value: string;
  confidence: number;
  citations: string[];
  accepted: boolean;
  suggested: boolean;
};

// ─── Product types ───────────────────────────────────────────────────────────

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

// ─── Field specs ─────────────────────────────────────────────────────────────

const FIELD_SPECS: Array<{ key: CompanyFieldKey; label: string; helper: string; rows: number }> = [
  { key: 'company_overview', label: 'Company overview', helper: 'Summarize positioning and core services in 2-4 concise sentences.', rows: 4 },
  { key: 'target_customers', label: 'Target customers', helper: 'Describe ideal buyer types and common purchase triggers.', rows: 4 },
  { key: 'value_props', label: 'Value propositions', helper: 'Use one factual bullet per line.', rows: 5 },
  { key: 'tone_style', label: 'Rep tone style', helper: 'Guide call tone and communication style.', rows: 3 },
  { key: 'sales_strategy', label: 'Sales strategy', helper: 'How reps should structure answers, objections, and next steps.', rows: 5 },
  { key: 'compliance_and_policies', label: 'Sales & service policies', helper: 'Booking, turnaround, cancellation, payment, licensing, and service-area guardrails.', rows: 5 },
  { key: 'forbidden_claims', label: 'Forbidden claims', helper: 'Claims reps should never make.', rows: 4 },
  { key: 'competitor_positioning', label: 'Competitor positioning', helper: 'How to compare safely and credibly.', rows: 4 },
  { key: 'escalation_rules', label: 'Escalation rules', helper: 'When reps must escalate special requests.', rows: 4 },
  { key: 'knowledge_base_appendix', label: 'Knowledge base appendix', helper: 'Optional long-form context. Keep concise and factual.', rows: 6 },
];

const EMPTY_REVIEW: Record<CompanyFieldKey, ExtractedField> = {
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
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseExtractedField(raw: unknown): ExtractedField {
  const data = toRecord(raw);
  const value = data.value;
  let normalized = '';
  if (Array.isArray(value)) {
    normalized = value.map((e) => (typeof e === 'string' ? e.trim() : '')).filter(Boolean).join('\n');
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
    ? data.citations.map((e) => (typeof e === 'string' ? e.trim() : '')).filter(Boolean)
    : [];

  const suggested = data.suggested === true || (citations.length === 0 && confidence < 0.7);

  return { value: normalized, confidence, citations, accepted: normalized.length > 0 && !suggested, suggested };
}

function toConfidence(value: unknown) {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(num) ? Math.max(0, Math.min(1, num)) : 0;
}

function toCitations(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((e) => (typeof e === 'string' ? e.trim() : '')).filter(Boolean);
}

function parseProductField(raw: unknown) {
  const data = toRecord(raw);
  return { value: data.value, confidence: toConfidence(data.confidence), citations: toCitations(data.citations), suggested: data.suggested === true };
}

function parseArrayLines(value: unknown) {
  if (!Array.isArray(value)) return '';
  return value.map((e) => (typeof e === 'string' ? e.trim() : '')).filter(Boolean).join('\n');
}

function toLines(text: string) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CombinedImportPage() {
  const router = useRouter();

  // Wizard step
  const [step, setStep] = useState(1);
  const [sourceType, setSourceType] = useState<SourceType>('WEBSITE');
  const [url, setUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [focus, setFocus] = useState<IngestFocus>('STANDARD');
  const [pagesToScan, setPagesToScan] = useState('30');
  const [includePathsText, setIncludePathsText] = useState('');
  const [excludePathsText, setExcludePathsText] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [showOutOfCreditsModal, setShowOutOfCreditsModal] = useState(false);

  // Two parallel jobs
  const [companyJobId, setCompanyJobId] = useState('');
  const [productJobId, setProductJobId] = useState('');
  const [companyJob, setCompanyJob] = useState<JobPayload | null>(null);
  const [productJob, setProductJob] = useState<JobPayload | null>(null);

  // Company context review state
  const [review, setReview] = useState<Record<CompanyFieldKey, ExtractedField>>(EMPTY_REVIEW);
  const [appendToKnowledgeBase, setAppendToKnowledgeBase] = useState(true);
  const [companyAiSuggestions, setCompanyAiSuggestions] = useState<Partial<Record<CompanyFieldKey, AiSuggestion>>>({});

  // Products review state
  const [products, setProducts] = useState<ProductReview[]>([]);
  const [productAiSuggestions, setProductAiSuggestions] = useState<Record<string, Partial<Record<string, AiSuggestion>>>>({});

  // Apply state
  const [applying, setApplying] = useState(false);
  const [appliedCompany, setAppliedCompany] = useState(false);
  const [appliedProducts, setAppliedProducts] = useState(false);

  // AI state (shared)
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiMessage, setAiMessage] = useState('');
  const [aiBusyKey, setAiBusyKey] = useState('');
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    async function loadAiStatus() {
      const res = await fetch('/api/ai/fields/status', { cache: 'no-store' });
      const data = await res.json().catch(() => ({ enabled: false }));
      setAiEnabled(Boolean(data?.enabled));
      setAiMessage(typeof data?.message === 'string' ? data.message : '');
    }
    void loadAiStatus();
  }, []);

  // ── Poll both jobs ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 3) return;
    if (!companyJobId && !productJobId) return;
    let active = true;

    async function poll() {
      const [cRes, pRes] = await Promise.all([
        companyJobId ? fetch(`/api/ingest/jobs/${companyJobId}`, { cache: 'no-store' }) : null,
        productJobId ? fetch(`/api/ingest/jobs/${productJobId}`, { cache: 'no-store' }) : null,
      ]);

      const cData = cRes ? ((await cRes.json().catch(() => null)) as JobPayload | null) : null;
      const pData = pRes ? ((await pRes.json().catch(() => null)) as JobPayload | null) : null;

      if (!active) return;
      if (cData) setCompanyJob(cData);
      if (pData) setProductJob(pData);

      const cDone = !companyJobId || cData?.status === 'succeeded' || cData?.status === 'failed';
      const pDone = !productJobId || pData?.status === 'succeeded' || pData?.status === 'failed';

      if (cDone && pDone) {
        // Parse company fields
        if (cData?.status === 'succeeded') {
          const fields = toRecord(cData.result?.fields);
          setReview({
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
          });
        }

        // Parse product list
        if (pData?.status === 'succeeded') {
          const rawProducts = Array.isArray(pData.result?.products)
            ? (pData.result.products as Array<Record<string, unknown>>)
            : [];
          const parsed = rawProducts.map((raw, index) => {
            const name = parseProductField(raw.name);
            const elevator = parseProductField(raw.elevator_pitch);
            const valueProps = parseProductField(raw.value_props);
            const differentiators = parseProductField(raw.differentiators);
            const pricingRules = parseProductField(raw.pricing_rules);
            const dontSay = parseProductField(raw.dont_say);
            const faqs = parseProductField(raw.faqs);
            const objections = parseProductField(raw.objections);

            const citationSet = new Set<string>([
              ...name.citations, ...elevator.citations, ...valueProps.citations,
              ...differentiators.citations, ...pricingRules.citations,
              ...dontSay.citations, ...faqs.citations, ...objections.citations,
            ]);

            const confidence = (name.confidence + elevator.confidence + valueProps.confidence + differentiators.confidence) / 4;
            const suggested = name.suggested || elevator.suggested || valueProps.suggested || differentiators.suggested || citationSet.size === 0;
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
                pricingRules.value && typeof pricingRules.value === 'object' && !Array.isArray(pricingRules.value) ? pricingRules.value : {},
                null, 2,
              ),
              faqs_text: JSON.stringify(Array.isArray(faqs.value) ? faqs.value : [], null, 2),
              objections_text: JSON.stringify(Array.isArray(objections.value) ? objections.value : [], null, 2),
              confidence,
              suggested,
              citations: {
                name: name.citations, elevator_pitch: elevator.citations, value_props: valueProps.citations,
                differentiators: differentiators.citations, pricing_rules: pricingRules.citations,
                dont_say: dontSay.citations, faqs: faqs.citations, objections: objections.citations,
              },
            } as ProductReview;
          });
          setProducts(parsed);
        }

        setRunning(false);
        setStep(4);
      }
    }

    void poll();
    const id = setInterval(() => { void poll(); }, 2000);
    return () => { active = false; clearInterval(id); };
  }, [companyJobId, productJobId, step]);

  // ── Sources map (from whichever job has sources) ───────────────────────────
  const sourcesById = useMemo(() => {
    const job = companyJob ?? productJob;
    const sourceList = Array.isArray(job?.result?.sources) ? (job.result.sources as Array<Record<string, unknown>>) : [];
    const map = new Map<string, { title: string; uri: string }>();
    for (const source of sourceList) {
      const id = typeof source.id === 'string' ? source.id : '';
      if (!id) continue;
      map.set(id, { title: typeof source.title === 'string' ? source.title : id, uri: typeof source.uri === 'string' ? source.uri : '' });
    }
    return map;
  }, [companyJob, productJob]);

  // ── Start extraction ───────────────────────────────────────────────────────
  async function runExtraction() {
    setError('');
    setAppliedCompany(false);
    setAppliedProducts(false);
    setRunning(true);
    setCompanyJob(null);
    setProductJob(null);

    if (sourceType === 'WEBSITE') {
      if (!url.trim()) { setError('Website URL is required.'); setRunning(false); return; }

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
      const [cRes, pRes] = await Promise.all([
        fetch('/api/ingest/company/website', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
        fetch('/api/ingest/product/website', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
      ]);

      const [cData, pData] = await Promise.all([
        cRes.json().catch(() => ({})),
        pRes.json().catch(() => ({})),
      ]);

      if (!cRes.ok || !pRes.ok) {
        const failed = !cRes.ok ? cData : pData;
        const msg = Array.isArray(failed?.message) ? failed.message[0] : (failed?.message ?? 'Failed to start extraction.');
        if ((!cRes.ok && cRes.status === 402) || (!pRes.ok && pRes.status === 402) || String(msg).toLowerCase().includes('not enough credits')) {
          setShowOutOfCreditsModal(true);
        }
        setError(msg);
        setRunning(false);
        return;
      }

      const cJobId = typeof cData?.jobId === 'string' ? cData.jobId : '';
      const pJobId = typeof pData?.jobId === 'string' ? pData.jobId : '';
      if (!cJobId || !pJobId) { setError('Job ID missing from response.'); setRunning(false); return; }

      setCompanyJobId(cJobId);
      setProductJobId(pJobId);
      window.dispatchEvent(new Event('credits:refresh'));
      setStep(3);
      return;
    }

    // PDF
    if (files.length === 0) { setError('Upload at least one PDF.'); setRunning(false); return; }
    if (files.length > 5) { setError('You can upload up to 5 PDFs.'); setRunning(false); return; }
    const oversized = files.find((f) => f.size > 20 * 1024 * 1024);
    if (oversized) { setError(`File exceeds 20MB: ${oversized.name}`); setRunning(false); return; }

    const makeFormData = () => { const fd = new FormData(); files.forEach((f) => fd.append('files', f)); return fd; };

    const [cRes, pRes] = await Promise.all([
      fetch('/api/ingest/company/pdfs', { method: 'POST', body: makeFormData() }),
      fetch('/api/ingest/product/pdfs', { method: 'POST', body: makeFormData() }),
    ]);

    const [cData, pData] = await Promise.all([
      cRes.json().catch(() => ({})),
      pRes.json().catch(() => ({})),
    ]);

    if (!cRes.ok || !pRes.ok) {
      const failed = !cRes.ok ? cData : pData;
      const msg = Array.isArray(failed?.message) ? failed.message[0] : (failed?.message ?? 'Failed to start extraction.');
      if ((!cRes.ok && cRes.status === 402) || (!pRes.ok && pRes.status === 402) || String(msg).toLowerCase().includes('not enough credits')) {
        setShowOutOfCreditsModal(true);
      }
      setError(msg);
      setRunning(false);
      return;
    }

    const cJobId = typeof cData?.jobId === 'string' ? cData.jobId : '';
    const pJobId = typeof pData?.jobId === 'string' ? pData.jobId : '';
    if (!cJobId || !pJobId) { setError('Job ID missing from response.'); setRunning(false); return; }

    setCompanyJobId(cJobId);
    setProductJobId(pJobId);
    window.dispatchEvent(new Event('credits:refresh'));
    setStep(3);
  }

  // ── Company context helpers ────────────────────────────────────────────────
  function patchReview<K extends CompanyFieldKey>(key: K, patch: Partial<ExtractedField>) {
    setReview((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function runCompanyAiAction(fieldKey: CompanyFieldKey, mode: 'draft' | 'improve') {
    if (!aiEnabled) return;
    if (mode === 'improve' && !review[fieldKey].value.trim()) { setAiError('Add text before using AI Improve.'); return; }
    setAiError('');
    const busy = `company:${fieldKey}:${mode}`;
    setAiBusyKey(busy);

    const endpoint = mode === 'draft' ? '/api/ai/fields/draft' : '/api/ai/fields/improve';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'company', fieldKey, ...(mode === 'improve' ? { text: review[fieldKey].value } : {}), currentState: { sourceType, url, review } }),
    });
    const data = await res.json().catch(() => ({}));
    setAiBusyKey('');
    if (!res.ok) { setAiError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'AI request failed.')); return; }
    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    if (!text) { setAiError('AI returned empty text.'); return; }
    setCompanyAiSuggestions((prev) => ({ ...prev, [fieldKey]: { text, mode, notes: Array.isArray(data?.notes) ? data.notes.slice(0, 6) : [], warnings: Array.isArray(data?.warnings) ? data.warnings.slice(0, 6) : [] } }));
  }

  function applyCompanyAiSuggestion(fieldKey: CompanyFieldKey) {
    const s = companyAiSuggestions[fieldKey];
    if (!s) return;
    patchReview(fieldKey, { value: s.text });
    setCompanyAiSuggestions((prev) => { const next = { ...prev }; delete next[fieldKey]; return next; });
  }

  // ── Product helpers ────────────────────────────────────────────────────────
  function patchProduct(index: number, patch: Partial<ProductReview>) {
    setProducts((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function runProductAiAction(productId: string, fieldKey: keyof ProductReview, mode: 'draft' | 'improve') {
    if (!aiEnabled) return;
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const currentText = typeof product[fieldKey] === 'string' ? String(product[fieldKey]) : '';
    if (mode === 'improve' && !currentText.trim()) { setAiError('Add text before using AI Improve.'); return; }
    setAiError('');
    const busy = `product:${productId}:${String(fieldKey)}:${mode}`;
    setAiBusyKey(busy);

    const endpoint = mode === 'draft' ? '/api/ai/fields/draft' : '/api/ai/fields/improve';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'product', fieldKey, ...(mode === 'improve' ? { text: currentText } : {}), currentState: { sourceType, url, product, allProducts: products } }),
    });
    const data = await res.json().catch(() => ({}));
    setAiBusyKey('');
    if (!res.ok) { setAiError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'AI request failed.')); return; }
    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    if (!text) { setAiError('AI returned empty text.'); return; }
    setProductAiSuggestions((prev) => ({ ...prev, [productId]: { ...(prev[productId] || {}), [String(fieldKey)]: { text, mode, notes: Array.isArray(data?.notes) ? data.notes.slice(0, 6) : [], warnings: Array.isArray(data?.warnings) ? data.warnings.slice(0, 6) : [] } } }));
  }

  function applyProductAiSuggestion(productId: string, fieldKey: keyof ProductReview, index: number) {
    const s = productAiSuggestions[productId]?.[String(fieldKey)];
    if (!s) return;
    patchProduct(index, { [fieldKey]: s.text } as Partial<ProductReview>);
    setProductAiSuggestions((prev) => { const item = { ...(prev[productId] || {}) }; delete item[String(fieldKey)]; return { ...prev, [productId]: item }; });
  }

  // ── Apply ──────────────────────────────────────────────────────────────────
  async function applyAll() {
    setApplying(true);
    setError('');

    // Apply company context
    if (companyJobId && companyJob?.status === 'succeeded' && !appliedCompany) {
      const accepted = Object.fromEntries(FIELD_SPECS.map((s) => [s.key, review[s.key].accepted]));
      const values = Object.fromEntries(FIELD_SPECS.map((s) => [s.key, review[s.key].value]));
      const cRes = await fetch(`/api/ingest/jobs/${companyJobId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: { accepted, values, appendToKnowledgeBase } }),
      });
      const cData = await cRes.json().catch(() => ({}));
      if (!cRes.ok) {
        setApplying(false);
        setError(Array.isArray(cData?.message) ? cData.message[0] : (cData?.message ?? 'Failed to apply context.'));
        return;
      }
      setAppliedCompany(true);
    }

    // Apply products
    if (productJobId && productJob?.status === 'succeeded' && !appliedProducts) {
      const payloadProducts = [];
      for (const product of products) {
        let pricingRules: Record<string, unknown>;
        let faqs: unknown[];
        let objections: unknown[];
        try {
          const pricing = JSON.parse(product.pricing_rules_text || '{}');
          const parsedFaqs = JSON.parse(product.faqs_text || '[]');
          const parsedObjections = JSON.parse(product.objections_text || '[]');
          if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) throw new Error(`Pricing rules must be a JSON object for ${product.name || 'a product'}.`);
          if (!Array.isArray(parsedFaqs)) throw new Error(`FAQs must be a JSON array for ${product.name || 'a product'}.`);
          if (!Array.isArray(parsedObjections)) throw new Error(`Objections must be a JSON array for ${product.name || 'a product'}.`);
          pricingRules = pricing; faqs = parsedFaqs; objections = parsedObjections;
        } catch (parseError) {
          setApplying(false);
          setError(parseError instanceof Error ? parseError.message : 'Invalid JSON in product review.');
          return;
        }
        payloadProducts.push({ accepted: product.accepted, name: product.name.trim(), elevator_pitch: product.elevator_pitch, value_props: toLines(product.value_props_text), differentiators: toLines(product.differentiators_text), dont_say: toLines(product.dont_say_text), pricing_rules: pricingRules, faqs, objections });
      }
      const pRes = await fetch(`/api/ingest/jobs/${productJobId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: payloadProducts }),
      });
      const pData = await pRes.json().catch(() => ({}));
      if (!pRes.ok) {
        setApplying(false);
        setError(Array.isArray(pData?.message) ? pData.message[0] : (pData?.message ?? 'Failed to apply offerings.'));
        return;
      }
      setAppliedProducts(true);
    }

    setApplying(false);
  }

  // ── Progress helpers ───────────────────────────────────────────────────────
  function getProgress(job: JobPayload | null) {
    const p = toRecord(job?.result?.progress);
    return {
      stage: typeof p.stage === 'string' ? p.stage : 'queued',
      message: typeof p.message === 'string' ? p.message : 'Waiting…',
      completed: typeof p.completed === 'number' ? p.completed : 0,
      total: typeof p.total === 'number' ? p.total : 0,
    };
  }

  const cProgress = getProgress(companyJob);
  const pProgress = getProgress(productJob);

  const companySucceeded = companyJob?.status === 'succeeded';
  const productSucceeded = productJob?.status === 'succeeded';
  const companyFailed = companyJob?.status === 'failed';
  const productFailed = productJob?.status === 'failed';
  const bothApplied = (appliedCompany || !companySucceeded) && (appliedProducts || !productSucceeded);

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Auto-fill context</h1>
          <p className="text-sm text-slate-500 mt-1">
            Paste a website URL or upload PDFs to extract company context and offerings in one step.
          </p>
        </div>
        <Link href="/app/context" className="text-sm px-3 py-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 transition-colors">
          Back to context
        </Link>
      </div>

      {/* Step indicator */}
      <div className="grid grid-cols-4 gap-2">
        {(['Source', 'Configure', 'Extract', 'Review'] as const).map((label, index) => {
          const n = index + 1;
          const active = step === n;
          const done = step > n;
          return (
            <div key={label} className={`rounded-lg border px-3 py-2 text-sm ${done || active ? 'border-sky-500/40 bg-sky-500/10 text-sky-300' : 'border-slate-800 bg-slate-900 text-slate-500'}`}>
              {n}. {label}
            </div>
          );
        })}
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</div>}

      {/* Step 1: Source */}
      {step === 1 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
          <h2 className="text-base font-semibold text-white">Step 1: Choose source</h2>
          <div className="flex gap-2">
            {(['WEBSITE', 'PDF'] as SourceType[]).map((type) => (
              <button key={type} onClick={() => setSourceType(type)} className={`px-3 py-2 text-sm rounded-lg border transition-colors ${sourceType === type ? 'border-sky-500/50 bg-sky-500/10 text-sky-200' : 'border-slate-700 text-slate-300'}`}>
                {type === 'WEBSITE' ? 'Website URL' : 'Upload PDF files'}
              </button>
            ))}
          </div>
          <button onClick={() => setStep(2)} className="px-4 py-2 text-sm font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors">
            Continue
          </button>
        </div>
      )}

      {/* Step 2: Configure */}
      {step === 2 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
          <h2 className="text-base font-semibold text-white">Step 2: Configure</h2>
          {sourceType === 'WEBSITE' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Website URL</label>
                <input value={url} onChange={(e) => setUrl(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" placeholder="https://example.com" />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Scan depth</label>
                  <select
                    value={focus}
                    onChange={(e) => setFocus(e.target.value as IngestFocus)}
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
                    onChange={(e) => setPagesToScan(e.target.value)}
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
                    onChange={(e) => setIncludePathsText(e.target.value)}
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
                    onChange={(e) => setExcludePathsText(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="/blog&#10;/privacy&#10;/terms"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block text-xs text-slate-400 mb-1.5">PDF files (max 5, each max 20MB)</label>
              <input type="file" multiple accept="application/pdf,.pdf" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-sky-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-sky-500" />
              {files.length > 0 && (
                <ul className="space-y-1">{files.map((f) => <li key={`${f.name}-${f.size}`} className="text-xs text-slate-400">{f.name} ({Math.ceil(f.size / 1024)} KB)</li>)}</ul>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="px-4 py-2 text-sm rounded-lg border border-slate-700 text-slate-300">Back</button>
            <button onClick={runExtraction} disabled={running} className="px-4 py-2 text-sm font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50">
              {running ? 'Starting…' : 'Run extraction'}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Progress */}
      {step === 3 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-5">
          <h2 className="text-base font-semibold text-white">Step 3: Extracting</h2>
          <p className="text-sm text-slate-400">Running two parallel extractions from the same source — context fields and offering candidates.</p>

          {/* Company job progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-300">Company context</p>
              <span className={`text-xs px-2 py-0.5 rounded border ${companyFailed ? 'border-red-500/30 bg-red-500/10 text-red-300' : companySucceeded ? 'border-sky-500/30 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-400'}`}>
                {companyJob?.status ?? 'queued'}
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div className="bg-sky-500 h-1.5 transition-all" style={{ width: companySucceeded ? '100%' : cProgress.total > 0 ? `${Math.min(100, Math.round((cProgress.completed / cProgress.total) * 100))}%` : '8%' }} />
            </div>
            <p className="text-xs text-slate-500">{cProgress.message}</p>
          </div>

          {/* Product job progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-300">Offering candidates</p>
              <span className={`text-xs px-2 py-0.5 rounded border ${productFailed ? 'border-red-500/30 bg-red-500/10 text-red-300' : productSucceeded ? 'border-sky-500/30 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-400'}`}>
                {productJob?.status ?? 'queued'}
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div className="bg-sky-500 h-1.5 transition-all" style={{ width: productSucceeded ? '100%' : pProgress.total > 0 ? `${Math.min(100, Math.round((pProgress.completed / pProgress.total) * 100))}%` : '8%' }} />
            </div>
            <p className="text-xs text-slate-500">{pProgress.message}</p>
          </div>
        </div>
      )}

      {/* Step 4: Review */}
      {step === 4 && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-base font-semibold text-white">Step 4: Review and apply</h2>
            <p className="mt-1 text-sm text-slate-500">Accept, edit, and apply the fields you want. Both context and offerings are applied together.</p>
            {(companyFailed || productFailed) && (
              <p className="mt-2 text-xs text-amber-300">
                {companyFailed && productFailed ? 'Both extractions failed. You may still review any partial results below.' : companyFailed ? 'Company context extraction failed — only offerings are available.' : 'Offerings extraction failed — only company context is available.'}
              </p>
            )}
          </div>

          {/* ── Company context section ── */}
          {companySucceeded && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white">Company context</h3>
                <span className="text-xs px-2 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-sky-300">Context fields</span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={appendToKnowledgeBase} onChange={(e) => setAppendToKnowledgeBase(e.target.checked)} />
                  Append extracted long-form appendix to knowledge base
                </label>
              </div>

              {FIELD_SPECS.map((spec) => {
                const field = review[spec.key];
                const suggestion = companyAiSuggestions[spec.key];
                return (
                  <section key={spec.key} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div>
                        <h4 className="text-sm font-semibold text-white">{spec.label}</h4>
                        <p className="text-xs text-slate-500 mt-0.5">{spec.helper}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <span className="text-xs px-2 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-sky-200">{(field.confidence * 100).toFixed(0)}% confidence</span>
                        {field.suggested && <span className="text-xs px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-200">Suggested</span>}
                        <label className="flex items-center gap-1 text-xs text-slate-300">
                          <input type="checkbox" checked={field.accepted} onChange={(e) => patchReview(spec.key, { accepted: e.target.checked })} />
                          Accept
                        </label>
                        <button onClick={() => runCompanyAiAction(spec.key, 'draft')} disabled={!aiEnabled || aiBusyKey.length > 0} title={aiEnabled ? 'Generate AI draft' : aiMessage || 'AI unavailable'} className="px-2.5 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40">
                          {aiBusyKey === `company:${spec.key}:draft` ? 'Drafting…' : 'AI Draft'}
                        </button>
                        <button onClick={() => runCompanyAiAction(spec.key, 'improve')} disabled={!aiEnabled || aiBusyKey.length > 0 || !field.value.trim()} title={aiEnabled ? 'Improve current text' : aiMessage || 'AI unavailable'} className="px-2.5 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40">
                          {aiBusyKey === `company:${spec.key}:improve` ? 'Improving…' : 'AI Improve'}
                        </button>
                      </div>
                    </div>

                    <textarea rows={spec.rows} value={field.value} onChange={(e) => patchReview(spec.key, { value: e.target.value })} className="mt-3 w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />

                    {field.citations.length > 0 && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs text-slate-400">Citations ({field.citations.length})</summary>
                        <ul className="mt-2 space-y-1 text-xs text-slate-400">
                          {field.citations.map((id) => {
                            const source = sourcesById.get(id);
                            return <li key={`${spec.key}-${id}`}>{id}: {source?.title || id}{source?.uri ? ` - ${source.uri}` : ''}</li>;
                          })}
                        </ul>
                      </details>
                    )}

                    {suggestion && (
                      <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 space-y-2">
                        <p className="text-xs text-sky-200">{suggestion.mode === 'draft' ? 'AI Draft suggestion' : 'AI Improve suggestion'}</p>
                        <pre className="whitespace-pre-wrap text-xs text-sky-100">{suggestion.text}</pre>
                        {suggestion.notes.length > 0 && <ul className="text-xs text-sky-200 space-y-0.5">{suggestion.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
                        {suggestion.warnings.length > 0 && <ul className="text-xs text-amber-200 space-y-0.5">{suggestion.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
                        <div className="flex items-center gap-2">
                          <button onClick={() => applyCompanyAiSuggestion(spec.key)} className="px-2.5 py-1 rounded-md border border-sky-400/50 text-xs text-sky-100 hover:border-sky-300">Apply suggested edit</button>
                          <button onClick={() => setCompanyAiSuggestions((prev) => { const next = { ...prev }; delete next[spec.key]; return next; })} className="px-2.5 py-1 rounded-md border border-slate-600 text-xs text-slate-300 hover:border-slate-400">Dismiss</button>
                        </div>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          {/* ── Offerings section ── */}
          {productSucceeded && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white">Offering candidates</h3>
                <span className="text-xs px-2 py-0.5 rounded border border-slate-700 bg-slate-800 text-slate-400">{products.length} detected</span>
              </div>

              {products.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">No offerings were detected. Try a different URL or upload documents.</div>
              ) : (
                products.map((product, index) => (
                  <section key={product.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <h4 className="text-sm font-semibold text-white">Offering candidate {index + 1}</h4>
                        <p className="text-xs text-slate-500">{(product.confidence * 100).toFixed(0)}% confidence</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {product.suggested && <span className="text-xs px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-200">Suggested</span>}
                        <label className="flex items-center gap-1 text-xs text-slate-300">
                          <input type="checkbox" checked={product.accepted} onChange={(e) => patchProduct(index, { accepted: e.target.checked })} />
                          Create this offering
                        </label>
                      </div>
                    </div>

                    {/* Name */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <label className="block text-xs text-slate-400">Name</label>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => runProductAiAction(product.id, 'name', 'draft')} disabled={!aiEnabled || aiBusyKey.length > 0} className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40">{aiBusyKey === `product:${product.id}:name:draft` ? 'Drafting…' : 'AI Draft'}</button>
                          <button onClick={() => runProductAiAction(product.id, 'name', 'improve')} disabled={!aiEnabled || aiBusyKey.length > 0 || !product.name.trim()} className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40">{aiBusyKey === `product:${product.id}:name:improve` ? 'Improving…' : 'AI Improve'}</button>
                        </div>
                      </div>
                      <input value={product.name} onChange={(e) => patchProduct(index, { name: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                    </div>

                    {/* Elevator pitch */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <label className="block text-xs text-slate-400">Elevator pitch</label>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => runProductAiAction(product.id, 'elevator_pitch', 'draft')} disabled={!aiEnabled || aiBusyKey.length > 0} className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40">{aiBusyKey === `product:${product.id}:elevator_pitch:draft` ? 'Drafting…' : 'AI Draft'}</button>
                          <button onClick={() => runProductAiAction(product.id, 'elevator_pitch', 'improve')} disabled={!aiEnabled || aiBusyKey.length > 0 || !product.elevator_pitch.trim()} className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40">{aiBusyKey === `product:${product.id}:elevator_pitch:improve` ? 'Improving…' : 'AI Improve'}</button>
                        </div>
                      </div>
                      <textarea rows={3} value={product.elevator_pitch} onChange={(e) => patchProduct(index, { elevator_pitch: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                    </div>

                    {/* Value props */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <label className="block text-xs text-slate-400">Value props</label>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => runProductAiAction(product.id, 'value_props_text', 'draft')} disabled={!aiEnabled || aiBusyKey.length > 0} className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40">{aiBusyKey === `product:${product.id}:value_props_text:draft` ? 'Drafting…' : 'AI Draft'}</button>
                          <button onClick={() => runProductAiAction(product.id, 'value_props_text', 'improve')} disabled={!aiEnabled || aiBusyKey.length > 0 || !product.value_props_text.trim()} className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40">{aiBusyKey === `product:${product.id}:value_props_text:improve` ? 'Improving…' : 'AI Improve'}</button>
                        </div>
                      </div>
                      <textarea rows={4} value={product.value_props_text} onChange={(e) => patchProduct(index, { value_props_text: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white" />
                    </div>

                    {/* Advanced */}
                    <details className="rounded-lg border border-slate-800 overflow-hidden">
                      <summary className="cursor-pointer px-3 py-2 text-sm text-slate-300 bg-slate-800/70">Advanced</summary>
                      <div className="p-3 space-y-3 bg-slate-900">
                        {([
                          { key: 'differentiators_text', label: 'Differentiators', rows: 3, mono: false },
                          { key: 'dont_say_text', label: 'Do not say', rows: 3, mono: false },
                          { key: 'pricing_rules_text', label: 'Pricing rules (JSON object)', rows: 4, mono: true },
                          { key: 'faqs_text', label: 'FAQs (JSON array)', rows: 4, mono: true },
                          { key: 'objections_text', label: 'Objections (JSON array)', rows: 4, mono: true },
                        ] as Array<{ key: keyof ProductReview; label: string; rows: number; mono: boolean }>).map(({ key, label, rows, mono }) => (
                          <div key={String(key)}>
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <label className="block text-xs text-slate-400">{label}</label>
                              <div className="flex items-center gap-1.5">
                                <button onClick={() => runProductAiAction(product.id, key, 'draft')} disabled={!aiEnabled || aiBusyKey.length > 0} className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40">{aiBusyKey === `product:${product.id}:${String(key)}:draft` ? 'Drafting…' : 'AI Draft'}</button>
                                <button onClick={() => runProductAiAction(product.id, key, 'improve')} disabled={!aiEnabled || aiBusyKey.length > 0 || !String(product[key]).trim()} className="px-2 py-1 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40">{aiBusyKey === `product:${product.id}:${String(key)}:improve` ? 'Improving…' : 'AI Improve'}</button>
                              </div>
                            </div>
                            <textarea rows={rows} value={String(product[key])} onChange={(e) => patchProduct(index, { [key]: e.target.value } as Partial<ProductReview>)} className={`w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white ${mono ? 'font-mono text-xs' : ''}`} />
                          </div>
                        ))}
                      </div>
                    </details>

                    {/* Citations */}
                    <details>
                      <summary className="cursor-pointer text-xs text-slate-400">Citations</summary>
                      <div className="mt-2 space-y-2 text-xs text-slate-400">
                        {Object.entries(product.citations).map(([fk, ids]) => (
                          <div key={`${product.id}-${fk}`}>
                            <p className="text-slate-500">{fk}</p>
                            {ids.length === 0 ? <p className="text-slate-600">No citations</p> : (
                              <ul className="mt-1 space-y-1">{ids.map((id) => { const s = sourcesById.get(id); return <li key={`${product.id}-${fk}-${id}`}>{id}: {s?.title || id}{s?.uri ? ` - ${s.uri}` : ''}</li>; })}</ul>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>

                    {/* AI suggestions for this product */}
                    {Object.entries(productAiSuggestions[product.id] || {}).map(([fk, suggestion]) => {
                      if (!suggestion) return null;
                      return (
                        <div key={`${product.id}-${fk}`} className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 space-y-2">
                          <p className="text-xs text-sky-200">{suggestion.mode === 'draft' ? 'AI Draft suggestion' : 'AI Improve suggestion'} ({fk})</p>
                          <pre className="whitespace-pre-wrap text-xs text-sky-100">{suggestion.text}</pre>
                          {suggestion.notes.length > 0 && <ul className="text-xs text-sky-200 space-y-0.5">{suggestion.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
                          {suggestion.warnings.length > 0 && <ul className="text-xs text-amber-200 space-y-0.5">{suggestion.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
                          <div className="flex items-center gap-2">
                            <button onClick={() => applyProductAiSuggestion(product.id, fk as keyof ProductReview, index)} className="px-2.5 py-1 rounded-md border border-sky-400/50 text-xs text-sky-100 hover:border-sky-300">Apply suggested edit</button>
                            <button onClick={() => setProductAiSuggestions((prev) => { const item = { ...(prev[product.id] || {}) }; delete item[fk]; return { ...prev, [product.id]: item }; })} className="px-2.5 py-1 rounded-md border border-slate-600 text-xs text-slate-300 hover:border-slate-400">Dismiss</button>
                          </div>
                        </div>
                      );
                    })}
                  </section>
                ))
              )}
            </div>
          )}

          {/* Apply bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={applyAll} disabled={applying || bothApplied || (!companySucceeded && !productSucceeded)} className="px-4 py-2 text-sm font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50">
              {applying ? 'Applying…' : 'Apply all'}
            </button>
            {bothApplied && (
              <button onClick={() => router.push('/app/context')} className="px-4 py-2 text-sm rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-200">
                Applied. Back to context
              </button>
            )}
            {aiError && <span className="text-sm text-red-300">{aiError}</span>}
            {!aiEnabled && aiMessage && <span className="text-sm text-amber-300">{aiMessage}</span>}
          </div>
        </div>
      )}

      <OutOfCreditsModal open={showOutOfCreditsModal} onClose={() => setShowOutOfCreditsModal(false)} />
    </div>
  );
}
