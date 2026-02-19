'use client';

import { useState } from 'react';

export default function AdminAiPage() {
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    recordings: false,
    transcripts: false,
    crmExports: false,
    complianceNotes: '',
    notes: '',
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    const dataSources = [
      form.recordings ? 'recordings' : '',
      form.transcripts ? 'transcripts' : '',
      form.crmExports ? 'crm_exports' : '',
    ].filter((value) => value.length > 0);

    const res = await fetch('/api/requests/fine-tune', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data_sources: dataSources,
        compliance_notes: form.complianceNotes,
        notes: form.notes,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (!res.ok) {
      setError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to submit request'));
      return;
    }

    setShowModal(false);
    setForm({
      recordings: false,
      transcripts: false,
      crmExports: false,
      complianceNotes: '',
      notes: '',
    });
    setSuccess('Fine-tuning request submitted. Our team will contact you.');
    setTimeout(() => setSuccess(''), 3000);
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-white">AI</h1>
        <p className="text-sm text-slate-500 mt-1">Model strategy and advanced enablement requests.</p>
      </div>

      {success && (
        <div className="mb-4 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-300">
          {success}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white">Fine-tuned Company Model</h2>
            <p className="mt-1 text-sm text-slate-400">
              Train a company-specific model using your sales assets and constraints.
            </p>
          </div>
          <button
            onClick={() => {
              setError('');
              setShowModal(true);
            }}
            className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium"
          >
            Request fine-tuning
          </button>
        </div>
      </section>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-6">
            <h3 className="text-base font-semibold text-white">Request fine-tuning</h3>
            <p className="mt-1 text-xs text-slate-500">Tell us what data exists and your compliance constraints.</p>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <p className="text-xs text-slate-400 mb-2">What data exists?</p>
                <div className="space-y-2 text-sm text-slate-300">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.recordings}
                      onChange={(e) => setForm((prev) => ({ ...prev, recordings: e.target.checked }))}
                    />
                    Call recordings
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.transcripts}
                      onChange={(e) => setForm((prev) => ({ ...prev, transcripts: e.target.checked }))}
                    />
                    Call transcripts
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.crmExports}
                      onChange={(e) => setForm((prev) => ({ ...prev, crmExports: e.target.checked }))}
                    />
                    CRM exports
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Compliance constraints</label>
                <textarea
                  rows={3}
                  maxLength={2000}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.complianceNotes}
                  onChange={(e) => setForm((prev) => ({ ...prev, complianceNotes: e.target.value }))}
                  placeholder="Data residency, retention, approved processors, security requirements"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Notes</label>
                <textarea
                  rows={4}
                  maxLength={3000}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Goals, timelines, required behaviors, and evaluation criteria"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 rounded-lg border border-slate-700 py-2 text-sm text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 rounded-lg bg-sky-600 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Submit request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
