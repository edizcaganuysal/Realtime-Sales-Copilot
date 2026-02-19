'use client';

import { useEffect, useMemo, useState } from 'react';

type Agent = { id: string; name: string };
type Product = { id: string; name: string };

type DebugOutput = {
  primarySuggestion: string;
  suggestions: string[];
  nudges: string[];
  cards: string[];
  objection: string | null;
  sentiment: string;
};

export default function PromptDebugPage() {
  const [transcript, setTranscript] = useState('PROSPECT: What is included in your full package?');
  const [productsMode, setProductsMode] = useState<'ALL' | 'SELECTED'>('ALL');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [agentId, setAgentId] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    output?: DebugOutput;
    systemPrompt?: string;
    userPrompt?: string;
    llmAvailable?: boolean;
    raw?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    async function load() {
      const [agentsRes, productsRes] = await Promise.all([
        fetch('/api/agents', { cache: 'no-store' }),
        fetch('/api/products', { cache: 'no-store' }),
      ]);
      const [agentsData, productsData] = await Promise.all([
        agentsRes.json().catch(() => []),
        productsRes.json().catch(() => []),
      ]);
      if (Array.isArray(agentsData)) {
        setAgents(
          agentsData
            .map((row) => ({ id: String(row.id || ''), name: String(row.name || '') }))
            .filter((row) => row.id && row.name),
        );
      }
      if (Array.isArray(productsData)) {
        setProducts(
          productsData
            .map((row) => ({ id: String(row.id || ''), name: String(row.name || '') }))
            .filter((row) => row.id && row.name),
        );
      }
    }
    void load();
  }, []);

  const selectedProductsLabel = useMemo(() => {
    if (selectedProductIds.length === 0) return 'None selected';
    const names = products
      .filter((item) => selectedProductIds.includes(item.id))
      .map((item) => item.name);
    return names.join(', ');
  }, [products, selectedProductIds]);

  async function runDebug() {
    if (!transcript.trim()) {
      setError('Transcript is required.');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    const res = await fetch('/api/calls/prompt-debug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript,
        products_mode: productsMode,
        selected_product_ids: selectedProductIds,
        ...(agentId ? { agentId } : {}),
      }),
    });

    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Prompt debug failed.'));
      return;
    }

    setResult(data);
  }

  function toggleProduct(id: string) {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  return (
    <div className="p-8 max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-white">Prompt Debug</h1>
        <p className="text-sm text-slate-500 mt-1">Validate prompt and output against transcript + offering context.</p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Transcript snippet</label>
          <textarea
            rows={8}
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            placeholder="PROSPECT: ..."
          />
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Agent</label>
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            >
              <option value="">Default coach</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Offerings mode</label>
            <select
              value={productsMode}
              onChange={(event) => setProductsMode(event.target.value as 'ALL' | 'SELECTED')}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            >
              <option value="ALL">All offerings</option>
              <option value="SELECTED">Selected offerings</option>
            </select>
          </div>
        </div>

        {productsMode === 'SELECTED' && (
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <p className="text-xs text-slate-400 mb-2">Selected offerings: {selectedProductsLabel}</p>
            <div className="grid gap-1 md:grid-cols-2">
              {products.map((product) => (
                <label key={product.id} className="text-sm text-slate-300 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedProductIds.includes(product.id)}
                    onChange={() => toggleProduct(product.id)}
                  />
                  {product.name}
                </label>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={runDebug}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-sky-600 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
        >
          {loading ? 'Running...' : 'Run debug'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-xs text-slate-500 mb-2">LLM available: {String(Boolean(result.llmAvailable))}</p>
            <p className="text-xs text-slate-500 mb-2">Primary suggestion</p>
            <p className="text-sm text-white">{result.output?.primarySuggestion || 'No suggestion generated.'}</p>
            <div className="mt-3 grid md:grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-slate-500 mb-1">Nudges</p>
                <ul className="text-sm text-slate-300 space-y-1">
                  {(result.output?.nudges || []).map((nudge) => (
                    <li key={nudge}>{nudge}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Context cards</p>
                <ul className="text-sm text-slate-300 space-y-1">
                  {(result.output?.cards || []).map((card) => (
                    <li key={card}>{card}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <details className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <summary className="cursor-pointer text-sm text-slate-200">System prompt</summary>
            <pre className="mt-3 whitespace-pre-wrap text-xs text-slate-300">{result.systemPrompt || ''}</pre>
          </details>

          <details className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <summary className="cursor-pointer text-sm text-slate-200">User prompt</summary>
            <pre className="mt-3 whitespace-pre-wrap text-xs text-slate-300">{result.userPrompt || ''}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
