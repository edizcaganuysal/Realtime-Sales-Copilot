'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

type SalesContext = {
  companyName: string;
  whatWeSell: string;
  howItWorks: string;
  strategy: string;
  offerCategory: string;
  targetCustomer: string;
  targetRoles: string[];
  industries: string[];
  buyingTriggers: string[];
  disqualifiers: string[];
  globalValueProps: string[];
  proofPoints: string[];
  caseStudies: string[];
  allowedClaims: string[];
  forbiddenClaims: string[];
  salesPolicies: string[];
  escalationRules: string[];
  nextSteps: string[];
  competitors: string[];
  positioningRules: string[];
  discoveryQuestions: string[];
  qualificationRubric: string[];
  knowledgeAppendix: string;
};

type Product = {
  id: string;
  name: string;
  elevatorPitch: string | null;
  valueProps: unknown;
  differentiators: unknown;
  pricingRules: unknown;
  dontSay: unknown;
  faqs: unknown;
  objections: unknown;
};

type ProductForm = {
  name: string;
  elevator_pitch: string;
  value_props_text: string;
  differentiators_text: string;
  pricing_rules_text: string;
  faqs_text: string;
  objections_text: string;
  dont_say_text: string;
};

type AiSuggestion = {
  text: string;
  mode: 'draft' | 'improve';
  notes: string[];
  warnings: string[];
};

type ContextFieldType = 'text' | 'bullets' | 'long' | 'select';

type ContextField = {
  key: keyof SalesContext;
  label: string;
  helper: string;
  placeholder: string;
  type: ContextFieldType;
  options?: Array<{ label: string; value: string }>;
};

type Section = {
  title: string;
  fields: ContextField[];
};

type ProductFormFieldKey = keyof ProductForm;

const INPUT =
  'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-sky-500/50';

const DEFAULT_CONTEXT: SalesContext = {
  companyName: '',
  whatWeSell: '',
  howItWorks: '',
  strategy: '',
  offerCategory: 'service',
  targetCustomer: '',
  targetRoles: [],
  industries: [],
  buyingTriggers: [],
  disqualifiers: [],
  globalValueProps: [],
  proofPoints: [],
  caseStudies: [],
  allowedClaims: [],
  forbiddenClaims: [],
  salesPolicies: [],
  escalationRules: [],
  nextSteps: [],
  competitors: [],
  positioningRules: [],
  discoveryQuestions: [],
  qualificationRubric: [],
  knowledgeAppendix: '',
};

const DEFAULT_PRODUCT_FORM: ProductForm = {
  name: '',
  elevator_pitch: '',
  value_props_text: '',
  differentiators_text: '',
  pricing_rules_text: '{}',
  faqs_text: '[]',
  objections_text: '[]',
  dont_say_text: '',
};

const CONTEXT_SECTIONS: Section[] = [
  {
    title: 'Section 1 — Company snapshot',
    fields: [
      {
        key: 'companyName',
        label: 'Company name',
        helper: 'Use the exact brand name buyers recognize.',
        placeholder: 'Example: Acme Logistics',
        type: 'text',
      },
      {
        key: 'whatWeSell',
        label: 'What we sell (1 line reps can say)',
        helper: 'Keep this short, outcome-oriented, and plain English.',
        placeholder: 'Example: We help {ICP} achieve {outcome} by {how}.',
        type: 'text',
      },
      {
        key: 'howItWorks',
        label: 'How we work / delivery process (short)',
        helper: 'Describe your normal delivery flow in one compact block.',
        placeholder:
          'Example: Discovery call -> proposal -> kickoff -> weekly updates -> delivery -> support.',
        type: 'long',
      },
      {
        key: 'strategy',
        label: 'Copilot behavior defaults',
        helper:
          'Define how the copilot should respond: tone, response length, objection flow, and next-step style. This applies to all calls unless overridden by a specific Copilot Strategy (see Strategy page).',
        placeholder:
          'Example: Answer direct questions first, then ask one clarifier. Handle objections with Clarify -> Value map -> Confirm next step. Keep suggestions under 20 words. Always push for a next step when momentum is positive.',
        type: 'long',
      },
      {
        key: 'offerCategory',
        label: 'Primary offer category',
        helper: 'Select the closest category for your core offer.',
        placeholder: '',
        type: 'select',
        options: [
          { value: 'service', label: 'Service' },
          { value: 'software', label: 'Software' },
          { value: 'marketplace', label: 'Marketplace' },
          { value: 'other', label: 'Other' },
        ],
      },
    ],
  },
  {
    title: 'Section 3 — ICP & fit',
    fields: [
      {
        key: 'targetCustomer',
        label: 'Target customer profile (2-4 lines)',
        helper: 'Describe the best-fit customer in practical terms reps can qualify against.',
        placeholder:
          'Example: Mid-size property managers and brokers selling 5-50 listings/month.',
        type: 'long',
      },
      {
        key: 'targetRoles',
        label: 'Target roles/titles',
        helper: 'Add one role per line.',
        placeholder: 'Example: Broker of Record\nExample: Marketing Director',
        type: 'bullets',
      },
      {
        key: 'industries',
        label: 'Best-fit industries',
        helper: 'List verticals where outcomes are strongest.',
        placeholder: 'Example: Real estate\nExample: Property management',
        type: 'bullets',
      },
      {
        key: 'buyingTriggers',
        label: 'Buying triggers',
        helper: 'What events make buyers ready to act now.',
        placeholder:
          'Example: New listings\nExample: Scaling team\nExample: Poor current vendor quality',
        type: 'bullets',
      },
      {
        key: 'disqualifiers',
        label: 'Disqualifiers / red flags',
        helper: 'List signs of poor fit so reps can disqualify early.',
        placeholder: 'Example: No urgency\nExample: Requires unsupported scope',
        type: 'bullets',
      },
    ],
  },
  {
    title: 'Section 4 — Messaging & proof',
    fields: [
      {
        key: 'globalValueProps',
        label: 'Global value props',
        helper: 'Cross-offering value themes reps can use consistently.',
        placeholder: 'Example: Faster turnaround\nExample: Less back-and-forth',
        type: 'bullets',
      },
      {
        key: 'proofPoints',
        label: 'Proof points (verifiable)',
        helper: 'Use only factual, supportable proof.',
        placeholder: 'Example: 95% delivered within SLA\nExample: 2,000+ projects completed',
        type: 'bullets',
      },
      {
        key: 'caseStudies',
        label: 'Case studies / examples',
        helper: 'Share concise examples only when true and verifiable.',
        placeholder:
          'Example: Broker X improved listing conversion by Y% (only if true).',
        type: 'bullets',
      },
      {
        key: 'allowedClaims',
        label: 'Allowed claims (safe phrasing)',
        helper: 'Claims reps are safe to use on calls.',
        placeholder: 'Example: Typically delivered in 24-48 hours',
        type: 'bullets',
      },
      {
        key: 'forbiddenClaims',
        label: 'Forbidden claims / do-not-say',
        helper: 'Hard lines reps must never cross.',
        placeholder: 'Example: Guaranteed ranking improvement\nExample: Best in market',
        type: 'bullets',
      },
    ],
  },
  {
    title: 'Section 5 — Policies & safety',
    fields: [
      {
        key: 'salesPolicies',
        label: 'Sales/service policies',
        helper:
          'Booking, turnaround, cancellation, deposits, licensing, service area, and on-site rules.',
        placeholder:
          'Example: Cancellations within 24h may incur a fee\nExample: Delivery windows are confirmed before kickoff',
        type: 'bullets',
      },
      {
        key: 'escalationRules',
        label: 'Escalation rules',
        helper: 'When reps must escalate pricing, legal, security, or custom requests.',
        placeholder:
          'Example: Escalate custom pricing exceptions\nExample: Escalate licensing/legal requests',
        type: 'bullets',
      },
    ],
  },
  {
    title: 'Section 6 — Competitive context',
    fields: [
      {
        key: 'competitors',
        label: 'Competitors list',
        helper: 'List alternatives buyers commonly mention.',
        placeholder: 'Example: Vendor A\nExample: Vendor B',
        type: 'bullets',
      },
      {
        key: 'positioningRules',
        label: 'Safe positioning rules',
        helper: 'How to compare without unsupported claims.',
        placeholder:
          'Example: Focus on scope and outcomes\nExample: Avoid negative claims without proof',
        type: 'bullets',
      },
    ],
  },
  {
    title: 'Section 7 — Discovery & qualification',
    fields: [
      {
        key: 'discoveryQuestions',
        label: 'Best discovery questions',
        helper: 'High-signal questions reps can ask in live calls.',
        placeholder:
          'Example: What is your current process today?\nExample: What is slowing your team down most?',
        type: 'bullets',
      },
      {
        key: 'qualificationRubric',
        label: 'Qualification rubric',
        helper: 'Criteria for fit, urgency, and decision readiness.',
        placeholder:
          'Example: Urgent timeline\nExample: Budget owner involved\nExample: Clear success criteria',
        type: 'bullets',
      },
      {
        key: 'nextSteps',
        label: 'Preferred next steps',
        helper: 'Default follow-up actions reps should move toward.',
        placeholder: 'Example: Book technical walkthrough\nExample: Send scoped proposal',
        type: 'bullets',
      },
    ],
  },
  {
    title: 'Section 8 — Knowledge appendix (optional, long-form)',
    fields: [
      {
        key: 'knowledgeAppendix',
        label: 'Knowledge appendix',
        helper: 'Long-form details the copilot can draw from during calls. Use for anything that does not fit in the structured fields above.',
        placeholder:
          'Add anything the copilot should know: FAQs with specific answers, customer success stories (names optional), common misconceptions, internal terminology, pricing tier details, implementation timelines, partner integrations, team structure, or onboarding steps.\n\nExample: "Our typical implementation takes 2–4 weeks: week 1 is configuration, weeks 2–3 are training, week 4 is go-live support."',
        type: 'long',
      },
    ],
  },
];

function toLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

function fromLines(value: string): string[] {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function toPrettyJson(value: unknown, fallback: string) {
  try {
    return JSON.stringify(value ?? JSON.parse(fallback), null, 2);
  } catch {
    return fallback;
  }
}

function toInputValue(context: SalesContext, key: keyof SalesContext): string {
  const value = context[key];
  if (Array.isArray(value)) return value.join('\n');
  return (value as string | null | undefined) ?? '';
}

function fieldRows(type: ContextFieldType) {
  if (type === 'long') return 5;
  return 4;
}

export default function ContextPage() {
  const [context, setContext] = useState<SalesContext>(DEFAULT_CONTEXT);
  const [baseline, setBaseline] = useState<SalesContext>(DEFAULT_CONTEXT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'saved' | 'error' | null>(null);

  const [offerings, setOfferings] = useState<Product[]>([]);
  const [offeringsLoading, setOfferingsLoading] = useState(true);
  const [offeringsError, setOfferingsError] = useState('');
  const [offeringModalOpen, setOfferingModalOpen] = useState(false);
  const [offeringEditing, setOfferingEditing] = useState<Product | null>(null);
  const [offeringForm, setOfferingForm] = useState<ProductForm>(DEFAULT_PRODUCT_FORM);
  const [offeringSaving, setOfferingSaving] = useState(false);
  const [offeringDeletingId, setOfferingDeletingId] = useState<string | null>(null);

  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiMessage, setAiMessage] = useState('');
  const [aiBusyKey, setAiBusyKey] = useState('');
  const [aiError, setAiError] = useState('');
  const [contextAiSuggestions, setContextAiSuggestions] = useState<
    Partial<Record<keyof SalesContext, AiSuggestion>>
  >({});
  const [offeringAiSuggestions, setOfferingAiSuggestions] = useState<
    Partial<Record<ProductFormFieldKey, AiSuggestion>>
  >({});

  const dirty = useMemo(
    () => JSON.stringify(context) !== JSON.stringify(baseline),
    [baseline, context],
  );

  // Completeness: track the 5 fields most critical for copilot quality
  const CRITICAL_FIELDS: Array<{ key: keyof SalesContext; label: string }> = [
    { key: 'companyName', label: 'Company name' },
    { key: 'whatWeSell', label: 'What we sell' },
    { key: 'targetCustomer', label: 'Target customer' },
    { key: 'globalValueProps', label: 'Value props' },
    { key: 'proofPoints', label: 'Proof points' },
  ];

  const completenessScore = useMemo(() => {
    return CRITICAL_FIELDS.filter(({ key }) => {
      const val = context[key];
      if (Array.isArray(val)) return val.length > 0;
      return typeof val === 'string' && val.trim().length > 0;
    }).length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

  const isContextEmpty = useMemo(() => {
    return (
      !context.companyName.trim() &&
      !context.whatWeSell.trim() &&
      context.globalValueProps.length === 0 &&
      context.proofPoints.length === 0
    );
  }, [context]);

  useEffect(() => {
    async function bootstrap() {
      const [contextRes, productsRes, aiStatusRes] = await Promise.all([
        fetch('/api/org/sales-context', { cache: 'no-store' }),
        fetch('/api/products', { cache: 'no-store' }),
        fetch('/api/ai/fields/status', { cache: 'no-store' }),
      ]);

      const contextData = await contextRes.json().catch(() => ({}));
      const productsData = await productsRes.json().catch(() => []);
      const aiData = await aiStatusRes.json().catch(() => ({ enabled: false }));

      const nextContext: SalesContext = {
        ...DEFAULT_CONTEXT,
        ...contextData,
        companyName: contextData?.companyName ?? '',
        whatWeSell: contextData?.whatWeSell ?? '',
        howItWorks: contextData?.howItWorks ?? '',
        strategy: contextData?.strategy ?? '',
        offerCategory: contextData?.offerCategory ?? 'service',
        targetCustomer: contextData?.targetCustomer ?? '',
        knowledgeAppendix: contextData?.knowledgeAppendix ?? '',
        targetRoles: Array.isArray(contextData?.targetRoles) ? contextData.targetRoles : [],
        industries: Array.isArray(contextData?.industries) ? contextData.industries : [],
        buyingTriggers: Array.isArray(contextData?.buyingTriggers) ? contextData.buyingTriggers : [],
        disqualifiers: Array.isArray(contextData?.disqualifiers) ? contextData.disqualifiers : [],
        globalValueProps: Array.isArray(contextData?.globalValueProps) ? contextData.globalValueProps : [],
        proofPoints: Array.isArray(contextData?.proofPoints) ? contextData.proofPoints : [],
        caseStudies: Array.isArray(contextData?.caseStudies) ? contextData.caseStudies : [],
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

      setContext(nextContext);
      setBaseline(nextContext);
      setOfferings(Array.isArray(productsData) ? productsData : []);
      setAiEnabled(Boolean(aiData?.enabled));
      setAiMessage(typeof aiData?.message === 'string' ? aiData.message : '');
      setLoading(false);
      setOfferingsLoading(false);
    }

    void bootstrap().catch(() => {
      setLoading(false);
      setOfferingsLoading(false);
      setOfferingsError('Failed to load context.');
    });
  }, []);

  function setContextField(key: keyof SalesContext, value: string) {
    setContext((prev) => {
      const current = prev[key];
      if (Array.isArray(current)) {
        return { ...prev, [key]: fromLines(value) };
      }
      return { ...prev, [key]: value };
    });
  }

  async function handleSaveContext() {
    setSaving(true);
    setStatus(null);

    const res = await fetch('/api/org/sales-context', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context),
    });

    const saved = await res.json().catch(() => context);
    setSaving(false);

    if (!res.ok) {
      setStatus('error');
      setTimeout(() => setStatus(null), 3000);
      return;
    }

    const nextContext: SalesContext = {
      ...DEFAULT_CONTEXT,
      ...saved,
      companyName: saved?.companyName ?? '',
      whatWeSell: saved?.whatWeSell ?? '',
      howItWorks: saved?.howItWorks ?? '',
      strategy: saved?.strategy ?? '',
      offerCategory: saved?.offerCategory ?? 'service',
      targetCustomer: saved?.targetCustomer ?? '',
      knowledgeAppendix: saved?.knowledgeAppendix ?? '',
      targetRoles: Array.isArray(saved?.targetRoles) ? saved.targetRoles : [],
      industries: Array.isArray(saved?.industries) ? saved.industries : [],
      buyingTriggers: Array.isArray(saved?.buyingTriggers) ? saved.buyingTriggers : [],
      disqualifiers: Array.isArray(saved?.disqualifiers) ? saved.disqualifiers : [],
      globalValueProps: Array.isArray(saved?.globalValueProps) ? saved.globalValueProps : [],
      proofPoints: Array.isArray(saved?.proofPoints) ? saved.proofPoints : [],
      caseStudies: Array.isArray(saved?.caseStudies) ? saved.caseStudies : [],
      allowedClaims: Array.isArray(saved?.allowedClaims) ? saved.allowedClaims : [],
      forbiddenClaims: Array.isArray(saved?.forbiddenClaims) ? saved.forbiddenClaims : [],
      salesPolicies: Array.isArray(saved?.salesPolicies) ? saved.salesPolicies : [],
      escalationRules: Array.isArray(saved?.escalationRules) ? saved.escalationRules : [],
      nextSteps: Array.isArray(saved?.nextSteps) ? saved.nextSteps : [],
      competitors: Array.isArray(saved?.competitors) ? saved.competitors : [],
      positioningRules: Array.isArray(saved?.positioningRules) ? saved.positioningRules : [],
      discoveryQuestions: Array.isArray(saved?.discoveryQuestions) ? saved.discoveryQuestions : [],
      qualificationRubric: Array.isArray(saved?.qualificationRubric)
        ? saved.qualificationRubric
        : [],
    };

    setContext(nextContext);
    setBaseline(nextContext);
    setStatus('saved');
    setTimeout(() => setStatus(null), 3000);
  }

  async function runContextAiAction(fieldKey: keyof SalesContext, mode: 'draft' | 'improve') {
    if (!aiEnabled) return;
    const currentValue = toInputValue(context, fieldKey);
    if (mode === 'improve' && !currentValue.trim()) {
      setAiError('Add text before using AI Improve.');
      return;
    }

    setAiError('');
    const busy = `context:${String(fieldKey)}:${mode}`;
    setAiBusyKey(busy);

    const endpoint = mode === 'draft' ? '/api/ai/fields/draft' : '/api/ai/fields/improve';
    const payload = {
      target: 'company',
      fieldKey,
      ...(mode === 'improve' ? { text: currentValue } : {}),
      currentState: {
        salesContext: context,
        offerings: offerings.map((item) => ({
          name: item.name,
          elevatorPitch: item.elevatorPitch ?? '',
        })),
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

    setContextAiSuggestions((prev) => ({
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

  function applyContextAiSuggestion(fieldKey: keyof SalesContext) {
    const suggestion = contextAiSuggestions[fieldKey];
    if (!suggestion) return;

    setContext((prev) => {
      const current = prev[fieldKey];
      if (Array.isArray(current)) {
        return { ...prev, [fieldKey]: fromLines(suggestion.text) };
      }
      return { ...prev, [fieldKey]: suggestion.text };
    });

    setContextAiSuggestions((prev) => {
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  }

  function dismissContextAiSuggestion(fieldKey: keyof SalesContext) {
    setContextAiSuggestions((prev) => {
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  }

  function openCreateOffering() {
    setOfferingEditing(null);
    setOfferingForm(DEFAULT_PRODUCT_FORM);
    setOfferingAiSuggestions({});
    setOfferingsError('');
    setOfferingModalOpen(true);
  }

  function openEditOffering(product: Product) {
    setOfferingEditing(product);
    setOfferingForm({
      name: product.name,
      elevator_pitch: product.elevatorPitch ?? '',
      value_props_text: toLines(product.valueProps).join('\n'),
      differentiators_text: toLines(product.differentiators).join('\n'),
      pricing_rules_text: toPrettyJson(product.pricingRules, '{}'),
      faqs_text: toPrettyJson(product.faqs, '[]'),
      objections_text: toPrettyJson(product.objections, '[]'),
      dont_say_text: toLines(product.dontSay).join('\n'),
    });
    setOfferingAiSuggestions({});
    setOfferingsError('');
    setOfferingModalOpen(true);
  }

  async function saveOffering() {
    const valueProps = fromLines(offeringForm.value_props_text);
    if (!offeringForm.name.trim()) {
      setOfferingsError('Offering name is required.');
      return;
    }
    if (valueProps.length < 3) {
      setOfferingsError('Add at least 3 value props.');
      return;
    }

    let pricingRules: Record<string, unknown>;
    let faqs: unknown[];
    let objections: unknown[];

    try {
      const parsedPricing = JSON.parse(offeringForm.pricing_rules_text || '{}');
      const parsedFaqs = JSON.parse(offeringForm.faqs_text || '[]');
      const parsedObjections = JSON.parse(offeringForm.objections_text || '[]');
      if (!parsedPricing || typeof parsedPricing !== 'object' || Array.isArray(parsedPricing)) {
        throw new Error('Pricing/packaging guardrails must be a JSON object.');
      }
      if (!Array.isArray(parsedFaqs)) {
        throw new Error('FAQs must be a JSON array.');
      }
      if (!Array.isArray(parsedObjections)) {
        throw new Error('Objections must be a JSON array.');
      }
      pricingRules = parsedPricing;
      faqs = parsedFaqs;
      objections = parsedObjections;
    } catch (parseError) {
      setOfferingsError(parseError instanceof Error ? parseError.message : 'Invalid JSON in advanced fields.');
      return;
    }

    const payload = {
      name: offeringForm.name.trim(),
      elevator_pitch: offeringForm.elevator_pitch,
      value_props: valueProps,
      differentiators: fromLines(offeringForm.differentiators_text),
      pricing_rules: pricingRules,
      faqs,
      objections,
      dont_say: fromLines(offeringForm.dont_say_text),
    };

    setOfferingSaving(true);
    setOfferingsError('');

    const res = await fetch(offeringEditing ? `/api/products/${offeringEditing.id}` : '/api/products', {
      method: offeringEditing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    setOfferingSaving(false);

    if (!res.ok) {
      setOfferingsError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to save offering.'));
      return;
    }

    const listRes = await fetch('/api/products', { cache: 'no-store' });
    const listData = await listRes.json().catch(() => []);
    setOfferings(Array.isArray(listData) ? listData : []);
    setOfferingModalOpen(false);
    setOfferingEditing(null);
    setOfferingForm(DEFAULT_PRODUCT_FORM);
    setOfferingAiSuggestions({});
  }

  async function deleteOffering(product: Product) {
    if (!confirm(`Delete "${product.name}"?`)) return;
    setOfferingDeletingId(product.id);
    setOfferingsError('');
    const res = await fetch(`/api/products/${product.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    setOfferingDeletingId(null);
    if (!res.ok) {
      setOfferingsError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to delete offering.'));
      return;
    }
    setOfferings((prev) => prev.filter((item) => item.id !== product.id));
  }

  async function runOfferingAiAction(fieldKey: ProductFormFieldKey, mode: 'draft' | 'improve') {
    if (!aiEnabled) return;
    const currentText = offeringForm[fieldKey];
    if (mode === 'improve' && !currentText.trim()) {
      setAiError('Add text before using AI Improve.');
      return;
    }

    setAiError('');
    const busy = `offering:${fieldKey}:${mode}`;
    setAiBusyKey(busy);

    const endpoint = mode === 'draft' ? '/api/ai/fields/draft' : '/api/ai/fields/improve';
    const payload = {
      target: 'product',
      fieldKey,
      ...(mode === 'improve' ? { text: currentText } : {}),
      currentState: {
        form: offeringForm,
        context,
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

    setOfferingAiSuggestions((prev) => ({
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

  function applyOfferingAiSuggestion(fieldKey: ProductFormFieldKey) {
    const suggestion = offeringAiSuggestions[fieldKey];
    if (!suggestion) return;
    setOfferingForm((prev) => ({ ...prev, [fieldKey]: suggestion.text }));
    setOfferingAiSuggestions((prev) => {
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  }

  function dismissOfferingAiSuggestion(fieldKey: ProductFormFieldKey) {
    setOfferingAiSuggestions((prev) => {
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  }

  function renderContextField(field: ContextField) {
    const value = toInputValue(context, field.key);
    const suggestion = contextAiSuggestions[field.key];
    const busyDraft = aiBusyKey === `context:${String(field.key)}:draft`;
    const busyImprove = aiBusyKey === `context:${String(field.key)}:improve`;

    const isRequired = CRITICAL_FIELDS.some((f) => f.key === field.key);
    return (
      <section key={field.key} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-white">{field.label}</h3>
              {isRequired && (
                <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                  Key field
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">{field.helper}</p>
          </div>
          {field.type !== 'select' ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void runContextAiAction(field.key, 'draft')}
                disabled={!aiEnabled || aiBusyKey.length > 0}
                title={aiEnabled ? 'Generate AI draft' : aiMessage || 'AI unavailable'}
                className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
              >
                {busyDraft ? 'Drafting...' : 'AI Draft'}
              </button>
              <button
                type="button"
                onClick={() => void runContextAiAction(field.key, 'improve')}
                disabled={!aiEnabled || aiBusyKey.length > 0 || !value.trim()}
                title={aiEnabled ? 'Improve current text' : aiMessage || 'AI unavailable'}
                className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
              >
                {busyImprove ? 'Improving...' : 'AI Improve'}
              </button>
            </div>
          ) : null}
        </div>

        {field.type === 'select' ? (
          <select
            value={value}
            onChange={(event) => setContextField(field.key, event.target.value)}
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
            onChange={(event) => setContextField(field.key, event.target.value)}
            placeholder={field.placeholder}
          />
        ) : (
          <textarea
            rows={fieldRows(field.type)}
            className={`${INPUT} resize-y`}
            value={value}
            onChange={(event) => setContextField(field.key, event.target.value)}
            placeholder={field.placeholder}
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
                  <li key={`${String(field.key)}-${note}`}>{note}</li>
                ))}
              </ul>
            ) : null}
            {suggestion.warnings.length > 0 ? (
              <ul className="space-y-0.5 text-xs text-amber-200">
                {suggestion.warnings.map((warning) => (
                  <li key={`${String(field.key)}-${warning}`}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => applyContextAiSuggestion(field.key)}
                className="rounded-md border border-sky-400/50 px-2.5 py-1 text-xs text-sky-100 hover:border-sky-300"
              >
                Apply suggested edit
              </button>
              <button
                type="button"
                onClick={() => dismissContextAiSuggestion(field.key)}
                className="rounded-md border border-slate-600 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-400"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  function renderOfferingAiControls(fieldKey: ProductFormFieldKey) {
    const value = offeringForm[fieldKey];
    const busyDraft = aiBusyKey === `offering:${fieldKey}:draft`;
    const busyImprove = aiBusyKey === `offering:${fieldKey}:improve`;
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void runOfferingAiAction(fieldKey, 'draft')}
          disabled={!aiEnabled || aiBusyKey.length > 0}
          title={aiEnabled ? 'Generate AI draft' : aiMessage || 'AI unavailable'}
          className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
        >
          {busyDraft ? 'Drafting...' : 'AI Draft'}
        </button>
        <button
          type="button"
          onClick={() => void runOfferingAiAction(fieldKey, 'improve')}
          disabled={!aiEnabled || aiBusyKey.length > 0 || !value.trim()}
          title={aiEnabled ? 'Improve current text' : aiMessage || 'AI unavailable'}
          className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
        >
          {busyImprove ? 'Improving...' : 'AI Improve'}
        </button>
      </div>
    );
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

  return (
    <div className="max-w-6xl p-8">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Context</h1>
          <p className="mt-1 text-sm text-slate-500">
            Complete sales context for live calls, objections, proof, safety, and next steps.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/app/context/import"
            className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-200 hover:bg-sky-500/20"
          >
            Auto-fill context
          </Link>
        </div>
      </div>

      {/* Completeness banner */}
      {isContextEmpty ? (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-sky-500/30 bg-sky-500/10 px-5 py-4">
          <div>
            <p className="text-sm font-medium text-sky-200">Get started in 2 minutes</p>
            <p className="mt-0.5 text-xs text-sky-300/80">
              Use the Auto-fill button to crawl your website and pre-fill most fields automatically — no manual input needed.
            </p>
          </div>
          <Link
            href="/app/context/import"
            className="shrink-0 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            Auto-fill from website
          </Link>
        </div>
      ) : completenessScore < 5 ? (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-amber-200">
              <span className="font-medium">{completenessScore}/5 key fields complete</span>
              {' — '}the copilot may give generic answers until the remaining fields are filled.
            </p>
            <span className="shrink-0 text-xs text-amber-300/70">
              Missing: {CRITICAL_FIELDS.filter(({ key }) => {
                const val = context[key];
                if (Array.isArray(val)) return val.length === 0;
                return typeof val === 'string' && val.trim().length === 0;
              }).map(f => f.label).join(', ')}
            </span>
          </div>
        </div>
      ) : (
        <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-3">
          <p className="text-sm text-emerald-200">
            <span className="font-medium">5/5 key fields complete</span> — your copilot has everything it needs for quality suggestions.
          </p>
        </div>
      )}

      <section className="mb-5 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">Section 2 — Offerings</h2>
          <button
            type="button"
            onClick={openCreateOffering}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
          >
            Add offering
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Manage all offerings here so call coaching always has current offering context.
        </p>

        {offeringsError ? (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {offeringsError}
          </div>
        ) : null}

        {offeringsLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, index) => (
              <div key={index} className="h-20 animate-pulse rounded-lg bg-slate-800" />
            ))}
          </div>
        ) : offerings.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-6 text-sm text-slate-500">
            No offerings yet. Add your first offering.
          </div>
        ) : (
          <div className="grid gap-2">
            {[...offerings]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((product) => (
                <div
                  key={product.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-white">{product.name}</h3>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-400">
                      {product.elevatorPitch?.trim() || 'No elevator pitch yet.'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEditOffering(product)}
                      className="rounded-md border border-slate-600 px-2.5 py-1 text-xs text-slate-200 hover:border-slate-400"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteOffering(product)}
                      disabled={offeringDeletingId === product.id}
                      className="rounded-md border border-red-500/30 px-2.5 py-1 text-xs text-red-300 hover:border-red-500/60 disabled:opacity-50"
                    >
                      {offeringDeletingId === product.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>

      <div className="space-y-5">
        {CONTEXT_SECTIONS.map((section) => (
          <section key={section.title} className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-200">{section.title}</h2>
            <div className="space-y-3">{section.fields.map((field) => renderContextField(field))}</div>
          </section>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSaveContext()}
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

      {offeringModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">
                {offeringEditing ? 'Edit offering' : 'Add offering'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setOfferingModalOpen(false);
                  setOfferingEditing(null);
                }}
                className="text-slate-500 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label className="block text-xs text-slate-400">Offering name</label>
                  {renderOfferingAiControls('name')}
                </div>
                <input
                  className={INPUT}
                  value={offeringForm.name}
                  onChange={(event) => setOfferingForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Example: Full Package"
                />
                <p className="mt-1 text-[11px] text-slate-600">Use the service/package name buyers ask for.</p>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label className="block text-xs text-slate-400">Elevator pitch</label>
                  {renderOfferingAiControls('elevator_pitch')}
                </div>
                <textarea
                  rows={3}
                  className={`${INPUT} resize-none`}
                  value={offeringForm.elevator_pitch}
                  onChange={(event) =>
                    setOfferingForm((prev) => ({ ...prev, elevator_pitch: event.target.value }))
                  }
                  placeholder="Example: A complete {service} package that delivers {outcome} in {timeline}."
                />
                <p className="mt-1 text-[11px] text-slate-600">Keep this practical and speakable in 1-2 lines.</p>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label className="block text-xs text-slate-400">Top value props</label>
                  {renderOfferingAiControls('value_props_text')}
                </div>
                <textarea
                  rows={4}
                  className={`${INPUT} resize-none`}
                  value={offeringForm.value_props_text}
                  onChange={(event) =>
                    setOfferingForm((prev) => ({ ...prev, value_props_text: event.target.value }))
                  }
                  placeholder={
                    'Example: Faster turnaround\nExample: Higher quality\nExample: Less back-and-forth'
                  }
                />
                <p className="mt-1 text-[11px] text-slate-600">Add 3-6 bullets. Minimum 3 required.</p>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label className="block text-xs text-slate-400">Differentiators</label>
                  {renderOfferingAiControls('differentiators_text')}
                </div>
                <textarea
                  rows={3}
                  className={`${INPUT} resize-none`}
                  value={offeringForm.differentiators_text}
                  onChange={(event) =>
                    setOfferingForm((prev) => ({ ...prev, differentiators_text: event.target.value }))
                  }
                  placeholder={
                    'Example: Same-day delivery\nExample: Dedicated editor\nExample: On-site support'
                  }
                />
                <p className="mt-1 text-[11px] text-slate-600">Keep these specific and verifiable.</p>
              </div>

              <details className="overflow-hidden rounded-lg border border-slate-800">
                <summary className="cursor-pointer bg-slate-800/70 px-3 py-2 text-sm text-slate-300">
                  Advanced
                </summary>
                <div className="space-y-3 bg-slate-900 p-3">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <label className="block text-xs text-slate-400">Pricing/packaging guardrails (JSON object)</label>
                      {renderOfferingAiControls('pricing_rules_text')}
                    </div>
                    <textarea
                      rows={4}
                      className={`${INPUT} resize-none font-mono text-xs`}
                      value={offeringForm.pricing_rules_text}
                      onChange={(event) =>
                        setOfferingForm((prev) => ({ ...prev, pricing_rules_text: event.target.value }))
                      }
                      placeholder={'{"guardrails":["No discounts above 10% without approval"]}'}
                    />
                    <p className="mt-1 text-[11px] text-slate-600">
                      Example: No discounts above 10% without approval. Packages start from {'{range}'} if you must mention.
                    </p>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <label className="block text-xs text-slate-400">FAQs (JSON array)</label>
                      {renderOfferingAiControls('faqs_text')}
                    </div>
                    <textarea
                      rows={4}
                      className={`${INPUT} resize-none font-mono text-xs`}
                      value={offeringForm.faqs_text}
                      onChange={(event) =>
                        setOfferingForm((prev) => ({ ...prev, faqs_text: event.target.value }))
                      }
                      placeholder={'[{"question":"How long does it take?","answer":"Typically 24-48 hours."}]'}
                    />
                    <p className="mt-1 text-[11px] text-slate-600">Q/A format works best for coaching outputs.</p>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <label className="block text-xs text-slate-400">Common objections + best responses (JSON array)</label>
                      {renderOfferingAiControls('objections_text')}
                    </div>
                    <textarea
                      rows={4}
                      className={`${INPUT} resize-none font-mono text-xs`}
                      value={offeringForm.objections_text}
                      onChange={(event) =>
                        setOfferingForm((prev) => ({ ...prev, objections_text: event.target.value }))
                      }
                      placeholder={'[{"objection":"Too expensive","response_bullets":["Acknowledge","Value framing","Offer options"]}]'}
                    />
                    <p className="mt-1 text-[11px] text-slate-600">
                      Example: Objection: Too expensive. Response: value framing + options + confirm.
                    </p>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <label className="block text-xs text-slate-400">Forbidden claims / do-not-say</label>
                      {renderOfferingAiControls('dont_say_text')}
                    </div>
                    <textarea
                      rows={3}
                      className={`${INPUT} resize-none`}
                      value={offeringForm.dont_say_text}
                      onChange={(event) =>
                        setOfferingForm((prev) => ({ ...prev, dont_say_text: event.target.value }))
                      }
                      placeholder={'Example: Guaranteed results\nExample: Always same-day for all scopes'}
                    />
                    <p className="mt-1 text-[11px] text-slate-600">List statements reps must avoid.</p>
                  </div>
                </div>
              </details>
            </div>

            {Object.entries(offeringAiSuggestions).length > 0 ? (
              <div className="mt-4 space-y-3">
                {Object.entries(offeringAiSuggestions).map(([fieldKey, suggestion]) => {
                  if (!suggestion) return null;
                  return (
                    <div key={fieldKey} className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 space-y-2">
                      <p className="text-xs text-sky-200">
                        {suggestion.mode === 'draft' ? 'AI Draft suggestion' : 'AI Improve suggestion'} ({fieldKey})
                      </p>
                      <pre className="whitespace-pre-wrap text-xs text-sky-100">{suggestion.text}</pre>
                      {suggestion.notes.length > 0 ? (
                        <ul className="space-y-0.5 text-xs text-sky-200">
                          {suggestion.notes.map((note) => (
                            <li key={`${fieldKey}-${note}`}>{note}</li>
                          ))}
                        </ul>
                      ) : null}
                      {suggestion.warnings.length > 0 ? (
                        <ul className="space-y-0.5 text-xs text-amber-200">
                          {suggestion.warnings.map((warning) => (
                            <li key={`${fieldKey}-${warning}`}>{warning}</li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => applyOfferingAiSuggestion(fieldKey as ProductFormFieldKey)}
                          className="rounded-md border border-sky-400/50 px-2.5 py-1 text-xs text-sky-100 hover:border-sky-300"
                        >
                          Apply suggested edit
                        </button>
                        <button
                          type="button"
                          onClick={() => dismissOfferingAiSuggestion(fieldKey as ProductFormFieldKey)}
                          className="rounded-md border border-slate-600 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-400"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setOfferingModalOpen(false);
                  setOfferingEditing(null);
                }}
                className="flex-1 rounded-lg border border-slate-700 py-2 text-sm text-slate-300 hover:border-slate-500 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveOffering()}
                disabled={offeringSaving}
                className="flex-1 rounded-lg bg-sky-600 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {offeringSaving ? 'Saving...' : offeringEditing ? 'Save offering' : 'Create offering'}
              </button>
            </div>

            {(offeringsError || (!aiEnabled && aiMessage) || aiError) ? (
              <div className="mt-3 text-sm text-red-300">{offeringsError || aiError || aiMessage}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
