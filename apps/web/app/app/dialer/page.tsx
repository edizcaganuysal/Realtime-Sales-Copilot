'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CallMode } from '@live-sales-coach/shared';
import { Phone, Bot, Plus, ChevronRight, Shield, Zap, Users, Crown, Smile, X, Pencil, Trash2 } from 'lucide-react';
import { OutOfCreditsModal } from '@/components/out-of-credits-modal';

type Agent = { id: string; name: string };
type ProductOption = { id: string; name: string; elevatorPitch?: string | null };
type PracticePersona = {
  id: string;
  name: string;
  title: string;
  description: string;
  difficulty: string;
  color: string;
  isCustom?: boolean;
};

const INPUT =
  'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500';

const DIFFICULTY_COLORS: Record<string, string> = {
  Medium: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
  Hard: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  Expert: 'text-red-400 bg-red-500/10 border-red-500/30',
};

const PERSONA_ICONS: Record<string, React.ReactNode> = {
  'budget-blocker': <Shield size={20} />,
  'time-waster': <Zap size={20} />,
  'competitor-loyalist': <Users size={20} />,
  'skeptical-exec': <Crown size={20} />,
  'friendly-noshow': <Smile size={20} />,
};

const PERSONA_COLORS: Record<string, string> = {
  amber: 'border-amber-500/30 hover:border-amber-500/60 bg-amber-500/5',
  red: 'border-red-500/30 hover:border-red-500/60 bg-red-500/5',
  blue: 'border-blue-500/30 hover:border-blue-500/60 bg-blue-500/5',
  violet: 'border-violet-500/30 hover:border-violet-500/60 bg-violet-500/5',
  emerald: 'border-sky-500/30 hover:border-sky-500/60 bg-sky-500/5',
  slate: 'border-slate-500/30 hover:border-slate-500/60 bg-slate-500/5',
};

const PERSONA_ICON_COLORS: Record<string, string> = {
  amber: 'text-amber-400 bg-amber-500/15',
  red: 'text-red-400 bg-red-500/15',
  blue: 'text-blue-400 bg-blue-500/15',
  violet: 'text-violet-400 bg-violet-500/15',
  emerald: 'text-sky-400 bg-sky-500/15',
  slate: 'text-slate-400 bg-slate-500/15',
};

const PERSONA_SELECTED: Record<string, string> = {
  amber: 'border-amber-400 bg-amber-500/15 ring-1 ring-amber-500/30',
  red: 'border-red-400 bg-red-500/15 ring-1 ring-red-500/30',
  blue: 'border-blue-400 bg-blue-500/15 ring-1 ring-blue-500/30',
  violet: 'border-violet-400 bg-violet-500/15 ring-1 ring-violet-500/30',
  emerald: 'border-sky-400 bg-sky-500/15 ring-1 ring-sky-500/30',
  slate: 'border-slate-400 bg-slate-500/15 ring-1 ring-slate-500/30',
};

export default function DialerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [personas, setPersonas] = useState<PracticePersona[]>([]);
  const [mode, setMode] = useState<CallMode>(CallMode.OUTBOUND);
  const [allProducts, setAllProducts] = useState(true);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const [modalForm, setModalForm] = useState({ name: '', title: '', description: '', prompt: '', difficulty: 'Medium' });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ phoneTo: '', agentId: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showOutOfCreditsModal, setShowOutOfCreditsModal] = useState(false);

  useEffect(() => {
    const modeParam = searchParams.get('mode');
    if (modeParam === 'practice' || modeParam === 'mock') {
      setMode(CallMode.MOCK);
    } else if (modeParam === 'outbound' || modeParam === 'real') {
      setMode(CallMode.OUTBOUND);
    }

    const personaParam = searchParams.get('persona');
    if (personaParam) {
      setSelectedPersonaId(personaParam);
    }
  }, [searchParams]);

  const loadPersonas = useCallback(async () => {
    try {
      const res = await fetch('/api/calls/practice-personas');
      const data = await res.json();
      const safe = Array.isArray(data) ? data : [];
      setPersonas(safe);
      if (safe.length > 0 && !selectedPersonaId) {
        setSelectedPersonaId(safe[0].id);
      }
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    Promise.all([
      fetch('/api/agents?scope=ORG&status=APPROVED').then((r) => r.json()),
      fetch('/api/products').then((r) => r.json()),
    ])
      .then(([agentsData, productsData]) => {
        const safeAgents = Array.isArray(agentsData) ? agentsData : [];
        setAgents(safeAgents);
        setForm((f) => {
          const preferredAgent = safeAgents.find((a: Agent) =>
            a.name.toLowerCase().includes('gtaphotopro'),
          );
          return { ...f, agentId: f.agentId || preferredAgent?.id || '' };
        });

        const safeProducts = Array.isArray(productsData) ? productsData : [];
        setProducts(safeProducts);
      })
      .catch(() => {
        setProducts([]);
      });
    loadPersonas();
  }, [loadPersonas]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((product) => {
      const target = `${product.name} ${product.elevatorPitch ?? ''}`.toLowerCase();
      return target.includes(q);
    });
  }, [products, productSearch]);

  function toggleProductSelection(id: string) {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id],
    );
  }

  function openCreateModal() {
    setEditingPersonaId(null);
    setModalForm({ name: '', title: '', description: '', prompt: '', difficulty: 'Medium' });
    setShowModal(true);
  }

  function openEditModal(persona: PracticePersona) {
    setEditingPersonaId(persona.id);
    setModalForm({
      name: persona.name,
      title: persona.title,
      description: persona.description,
      prompt: '', // will be populated below if we fetch it
      difficulty: persona.difficulty,
    });
    setShowModal(true);
  }

  async function handleSavePersona() {
    if (!modalForm.name.trim() || !modalForm.prompt.trim()) return;
    setSaving(true);

    try {
      if (editingPersonaId) {
        // Update existing
        const res = await fetch(`/api/calls/practice-personas/${editingPersonaId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(modalForm),
        });
        if (res.ok) {
          await loadPersonas();
          setShowModal(false);
        }
      } else {
        // Create new
        const res = await fetch('/api/calls/practice-personas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(modalForm),
        });
        if (res.ok) {
          const created = await res.json();
          await loadPersonas();
          setSelectedPersonaId(created.id);
          setShowModal(false);
        }
      }
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  }

  async function handleDeletePersona(personaId: string) {
    try {
      await fetch(`/api/calls/practice-personas/${personaId}`, { method: 'DELETE' });
      await loadPersonas();
      if (selectedPersonaId === personaId) {
        setSelectedPersonaId(personas[0]?.id ?? null);
      }
    } catch { /* ignore */ }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    if (!isMock && !allProducts && selectedProductIds.length === 0) {
      setError('Select at least one product or keep All products enabled.');
      setSubmitting(false);
      return;
    }

    const body: Record<string, unknown> = {
      phoneTo: mode === CallMode.MOCK ? 'MOCK' : form.phoneTo,
      mode,
    };
    if (form.agentId) body.agentId = form.agentId;
    if (form.notes) body.notes = form.notes;

    if (mode === CallMode.MOCK && selectedPersonaId) {
      body.practicePersonaId = selectedPersonaId;
    }
    body.products_mode = allProducts ? 'ALL' : 'SELECTED';
    if (!allProducts) {
      body.selected_product_ids = selectedProductIds;
    }

    const res = await fetch('/api/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const d = await res.json();
      const message = Array.isArray(d?.message) ? d.message[0] : (d?.message ?? 'Failed to start call');
      if (res.status === 402 || String(message).toLowerCase().includes('not enough credits')) {
        setShowOutOfCreditsModal(true);
      }
      setError(message);
      setSubmitting(false);
      return;
    }

    const call = await res.json();
    window.dispatchEvent(new Event('credits:refresh'));
    router.push(`/app/calls/${call.id}/live`);
  }

  const isMock = mode === CallMode.MOCK;

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isMock ? 'bg-violet-500/15' : 'bg-sky-500/15'}`}>
          {isMock ? <Bot size={18} className="text-violet-400" /> : <Phone size={18} className="text-sky-400" />}
        </div>
        <div>
          <h1 className="text-lg font-semibold text-white">{isMock ? 'Practice call' : 'New call'}</h1>
          <p className="text-xs text-slate-500">
            {isMock ? 'Practice with a challenging AI prospect' : 'Configure and start an outbound call'}
          </p>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-5">
        <button
          type="button"
          onClick={() => setMode(CallMode.OUTBOUND)}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors border ${
            !isMock
              ? 'bg-sky-600/20 border-sky-500/40 text-sky-400'
              : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
          }`}
        >
          <Phone size={14} />
          Real call
        </button>
        <button
          type="button"
          onClick={() => setMode(CallMode.MOCK)}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors border ${
            isMock
              ? 'bg-violet-600/20 border-violet-500/40 text-violet-400'
              : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
          }`}
        >
          <Bot size={14} />
          Practice (AI)
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Practice persona selection */}
        {isMock && (
          <div>
            <label className="block text-xs text-slate-400 mb-2">Choose your prospect</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {personas.map((p) => {
                const isSelected = selectedPersonaId === p.id;
                const colorClass = isSelected
                  ? (PERSONA_SELECTED[p.color] ?? PERSONA_SELECTED.slate)
                  : (PERSONA_COLORS[p.color] ?? PERSONA_COLORS.slate);
                const iconColor = PERSONA_ICON_COLORS[p.color] ?? PERSONA_ICON_COLORS.slate;

                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPersonaId(p.id)}
                    className={`relative text-left p-3.5 rounded-xl border transition-all group ${colorClass}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconColor}`}>
                        {PERSONA_ICONS[p.id] ?? <Bot size={20} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-white text-sm font-semibold truncate">{p.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${DIFFICULTY_COLORS[p.difficulty] ?? DIFFICULTY_COLORS.Medium}`}>
                            {p.difficulty}
                          </span>
                        </div>
                        <p className="text-slate-500 text-[11px] mb-1">{p.title}</p>
                        <p className="text-slate-400 text-xs leading-relaxed">{p.description}</p>
                      </div>
                    </div>
                    {/* Edit/Delete for custom personas */}
                    {p.isCustom && (
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); openEditModal(p); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); openEditModal(p); } }}
                          className="p-1 rounded bg-slate-700/80 text-slate-400 hover:text-white transition-colors"
                        >
                          <Pencil size={12} />
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); handleDeletePersona(p.id); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleDeletePersona(p.id); } }}
                          className="p-1 rounded bg-slate-700/80 text-slate-400 hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={12} />
                        </span>
                      </div>
                    )}
                    {isSelected && !p.isCustom && (
                      <div className="absolute top-2 right-2">
                        <ChevronRight size={14} className="text-slate-400" />
                      </div>
                    )}
                  </button>
                );
              })}

              {/* Create new custom persona */}
              <button
                type="button"
                onClick={openCreateModal}
                className="text-left p-3.5 rounded-xl border border-dashed border-slate-700/50 hover:border-slate-500 bg-transparent transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-slate-800 text-slate-500">
                    <Plus size={20} />
                  </div>
                  <div>
                    <span className="text-slate-300 text-sm font-medium">New custom prospect</span>
                    <p className="text-slate-600 text-xs mt-0.5">Create and save a training scenario</p>
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Phone number (real calls only) */}
        {!isMock && (
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Phone number</label>
            <input
              required={!isMock}
              type="tel"
              className={INPUT}
              placeholder="+1 (555) 000-0000"
              value={form.phoneTo}
              onChange={(e) => setForm({ ...form, phoneTo: e.target.value })}
            />
          </div>
        )}

        {!isMock && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <label className="block text-xs text-slate-400">Products</label>
              <button
                type="button"
                onClick={() => setAllProducts((prev) => !prev)}
                className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                  allProducts
                    ? 'border-sky-500/40 text-sky-300 bg-sky-500/10'
                    : 'border-slate-600 text-slate-300 bg-slate-800'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${allProducts ? 'bg-sky-400' : 'bg-slate-400'}`}
                />
                {allProducts ? 'All products' : 'Selected products'}
              </button>
            </div>

            {!allProducts && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2.5">
                <input
                  className={INPUT}
                  placeholder="Search products..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                />
                <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                  {filteredProducts.length === 0 ? (
                    <p className="text-xs text-slate-600 py-2">No products found.</p>
                  ) : (
                    filteredProducts.map((product) => {
                      const selected = selectedProductIds.includes(product.id);
                      return (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => toggleProductSelection(product.id)}
                          className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                            selected
                              ? 'border-sky-500/40 bg-sky-500/10'
                              : 'border-slate-700 hover:border-slate-500 bg-slate-800/60'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm text-white">{product.name}</span>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded ${selected ? 'bg-sky-500/20 text-sky-300' : 'bg-slate-700 text-slate-400'}`}
                            >
                              {selected ? 'Selected' : 'Pick'}
                            </span>
                          </div>
                          {product.elevatorPitch && (
                            <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                              {product.elevatorPitch}
                            </p>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Coaching agent */}
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Coaching agent (optional)</label>
          <select
            className={INPUT}
            value={form.agentId}
            onChange={(e) => setForm({ ...form, agentId: e.target.value })}
          >
            <option value="">— Default coach —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">
            {isMock ? 'Scenario notes (optional)' : 'Notes (optional)'}
          </label>
          <textarea
            rows={2}
            className={INPUT + ' resize-none'}
            placeholder={
              isMock
                ? 'Add context: "They run a 50-agent brokerage in Toronto..."'
                : 'Context about this call, contact, or goal...'
            }
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className={`w-full flex items-center justify-center gap-2 py-2.5 disabled:opacity-50 text-white font-medium rounded-lg transition-colors ${
            isMock ? 'bg-violet-600 hover:bg-violet-500' : 'bg-sky-600 hover:bg-sky-500'
          }`}
        >
          {isMock ? <Bot size={15} /> : <Phone size={15} />}
          {submitting ? 'Starting...' : isMock ? 'Start practice call' : 'Start call'}
        </button>
      </form>

      {/* Create / Edit persona modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold">
                {editingPersonaId ? 'Edit prospect' : 'Create custom prospect'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Name</label>
                <input
                  className={INPUT}
                  placeholder="e.g. The HIPAA Gatekeeper"
                  value={modalForm.name}
                  onChange={(e) => setModalForm({ ...modalForm, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Title</label>
                  <input
                    className={INPUT}
                    placeholder="e.g. IT Director, Hospital"
                    value={modalForm.title}
                    onChange={(e) => setModalForm({ ...modalForm, title: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Difficulty</label>
                  <select
                    className={INPUT}
                    value={modalForm.difficulty}
                    onChange={(e) => setModalForm({ ...modalForm, difficulty: e.target.value })}
                  >
                    <option value="Medium">Medium</option>
                    <option value="Hard">Hard</option>
                    <option value="Expert">Expert</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Short description</label>
                <input
                  className={INPUT}
                  placeholder="e.g. Concerned about compliance, tight budget cycle..."
                  value={modalForm.description}
                  onChange={(e) => setModalForm({ ...modalForm, description: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Persona prompt</label>
                <textarea
                  rows={6}
                  className={INPUT + ' resize-none'}
                  placeholder={'Describe who this prospect is and how they should behave.\n\nExample: "You are a skeptical IT Director at a hospital. You\'re concerned about HIPAA compliance and have a very tight budget cycle..."'}
                  value={modalForm.prompt}
                  onChange={(e) => setModalForm({ ...modalForm, prompt: e.target.value })}
                />
                <p className="text-slate-600 text-[11px] mt-1">
                  Be specific about their objections, concerns, personality, and behavior patterns.
                </p>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2 text-sm text-slate-400 hover:text-white border border-slate-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSavePersona}
                  disabled={saving || !modalForm.name.trim() || !modalForm.prompt.trim()}
                  className="flex-1 py-2 text-sm text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg transition-colors"
                >
                  {saving ? 'Saving...' : editingPersonaId ? 'Save changes' : 'Create prospect'}
                </button>
              </div>
            </div>
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
