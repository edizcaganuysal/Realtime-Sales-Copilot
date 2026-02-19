'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

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
  createdAt: string;
};

type ProductForm = {
  name: string;
  elevator_pitch: string;
  value_props_text: string;
  differentiators_text: string;
  dont_say_text: string;
  pricing_rules_text: string;
  faqs_text: string;
  objections_text: string;
};

const INPUT =
  'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500';

const DEFAULT_FORM: ProductForm = {
  name: '',
  elevator_pitch: '',
  value_props_text: '',
  differentiators_text: '',
  dont_say_text: '',
  pricing_rules_text: '{}',
  faqs_text: '[]',
  objections_text: '[]',
};

function toLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

function toPrettyJson(value: unknown, fallback: string) {
  try {
    return JSON.stringify(value ?? JSON.parse(fallback), null, 2);
  } catch {
    return fallback;
  }
}

function linesToArray(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(DEFAULT_FORM);

  async function load() {
    setLoading(true);
    setError('');
    const res = await fetch('/api/products');
    const data = await res.json();
    if (!res.ok) {
      setError(data?.message ?? 'Failed to load products');
      setLoading(false);
      return;
    }
    setProducts(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => {
    load().catch(() => {
      setError('Failed to load products');
      setLoading(false);
    });
  }, []);

  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );

  function openCreate() {
    setEditing(null);
    setForm(DEFAULT_FORM);
    setError('');
    setModalOpen(true);
  }

  function openEdit(product: Product) {
    setEditing(product);
    setForm({
      name: product.name,
      elevator_pitch: product.elevatorPitch ?? '',
      value_props_text: toLines(product.valueProps).join('\n'),
      differentiators_text: toLines(product.differentiators).join('\n'),
      dont_say_text: toLines(product.dontSay).join('\n'),
      pricing_rules_text: toPrettyJson(product.pricingRules, '{}'),
      faqs_text: toPrettyJson(product.faqs, '[]'),
      objections_text: toPrettyJson(product.objections, '[]'),
    });
    setError('');
    setModalOpen(true);
  }

  async function handleSave() {
    const valueProps = linesToArray(form.value_props_text);
    if (!form.name.trim()) {
      setError('Product name is required.');
      return;
    }
    if (valueProps.length < 3) {
      setError('Enter at least 3 value props.');
      return;
    }

    let pricingRules: Record<string, unknown>;
    let faqs: unknown[];
    let objections: unknown[];

    try {
      const parsedPricing = JSON.parse(form.pricing_rules_text || '{}');
      const parsedFaqs = JSON.parse(form.faqs_text || '[]');
      const parsedObjections = JSON.parse(form.objections_text || '[]');
      if (!parsedPricing || typeof parsedPricing !== 'object' || Array.isArray(parsedPricing)) {
        throw new Error('Pricing rules must be a JSON object.');
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
      setError(parseError instanceof Error ? parseError.message : 'Invalid JSON input.');
      return;
    }

    const payload = {
      name: form.name,
      elevator_pitch: form.elevator_pitch,
      value_props: valueProps,
      differentiators: linesToArray(form.differentiators_text),
      dont_say: linesToArray(form.dont_say_text),
      pricing_rules: pricingRules,
      faqs,
      objections,
    };

    setSaving(true);
    setError('');

    const res = await fetch(editing ? `/api/products/${editing.id}` : '/api/products', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(data?.message ?? 'Failed to save product');
      return;
    }

    setModalOpen(false);
    setEditing(null);
    setForm(DEFAULT_FORM);
    await load();
  }

  async function handleDelete(product: Product) {
    if (!confirm(`Delete "${product.name}"?`)) return;
    setDeletingId(product.id);
    setError('');
    const res = await fetch(`/api/products/${product.id}`, { method: 'DELETE' });
    const data = await res.json();
    setDeletingId(null);
    if (!res.ok) {
      setError(data?.message ?? 'Failed to delete product');
      return;
    }
    await load();
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-white">Products</h1>
          <p className="text-sm text-slate-500 mt-1">
            Save product context once so agents can use it by default.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-3 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
        >
          New product
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-slate-900 border border-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : sortedProducts.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl px-6 py-10 text-center">
          <p className="text-slate-500 text-sm">No products yet.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {sortedProducts.map((product) => {
            const valueProps = toLines(product.valueProps);
            return (
              <div
                key={product.id}
                className="bg-slate-900 border border-slate-800 rounded-xl px-5 py-4 flex items-start justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-white font-medium truncate">{product.name}</h2>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                      {valueProps.length} value props
                    </span>
                  </div>
                  {product.elevatorPitch ? (
                    <p className="text-sm text-slate-400 line-clamp-2">{product.elevatorPitch}</p>
                  ) : (
                    <p className="text-sm text-slate-600">No elevator pitch</p>
                  )}
                  {valueProps.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {valueProps.slice(0, 3).map((line) => (
                        <span
                          key={`${product.id}-${line}`}
                          className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                        >
                          {line}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openEdit(product)}
                    className="text-xs px-2.5 py-1 border border-slate-600 hover:border-slate-400 text-slate-300 rounded-lg transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(product)}
                    disabled={deletingId === product.id}
                    className="text-xs px-2.5 py-1 border border-red-500/30 hover:border-red-500/60 text-red-400 rounded-lg transition-colors disabled:opacity-40"
                  >
                    {deletingId === product.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-5 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold text-base">
                {editing ? 'Edit product' : 'Create product'}
              </h3>
              <button
                onClick={() => {
                  setModalOpen(false);
                  setEditing(null);
                }}
                className="text-slate-500 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Name</label>
                <input
                  className={INPUT}
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Product name"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Elevator pitch</label>
                <textarea
                  rows={3}
                  className={INPUT + ' resize-none'}
                  value={form.elevator_pitch}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, elevator_pitch: e.target.value }))
                  }
                  placeholder="Short pitch reps can use"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Value props</label>
                <textarea
                  rows={5}
                  className={INPUT + ' resize-none'}
                  value={form.value_props_text}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, value_props_text: e.target.value }))
                  }
                  placeholder={'One per line\nAt least 3 lines'}
                />
                <p className="text-[11px] text-slate-600 mt-1">
                  Required: at least 3 value props.
                </p>
              </div>

              <details className="border border-slate-800 rounded-lg overflow-hidden">
                <summary className="cursor-pointer px-3 py-2 text-sm text-slate-300 bg-slate-800/70">
                  Advanced
                </summary>
                <div className="p-3 space-y-3 bg-slate-900">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Pricing rules (JSON object)</label>
                    <textarea
                      rows={4}
                      className={INPUT + ' resize-none font-mono text-xs'}
                      value={form.pricing_rules_text}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, pricing_rules_text: e.target.value }))
                      }
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">FAQs (JSON array)</label>
                    <textarea
                      rows={5}
                      className={INPUT + ' resize-none font-mono text-xs'}
                      value={form.faqs_text}
                      onChange={(e) => setForm((prev) => ({ ...prev, faqs_text: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Objections (JSON array)</label>
                    <textarea
                      rows={5}
                      className={INPUT + ' resize-none font-mono text-xs'}
                      value={form.objections_text}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, objections_text: e.target.value }))
                      }
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Differentiators</label>
                    <textarea
                      rows={3}
                      className={INPUT + ' resize-none'}
                      value={form.differentiators_text}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, differentiators_text: e.target.value }))
                      }
                      placeholder={'One per line'}
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Do not say</label>
                    <textarea
                      rows={3}
                      className={INPUT + ' resize-none'}
                      value={form.dont_say_text}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, dont_say_text: e.target.value }))
                      }
                      placeholder={'One per line'}
                    />
                  </div>
                </div>
              </details>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => {
                  setModalOpen(false);
                  setEditing(null);
                }}
                className="flex-1 py-2 text-sm text-slate-400 hover:text-white border border-slate-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg transition-colors"
              >
                {saving ? 'Saving...' : editing ? 'Save changes' : 'Create product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
