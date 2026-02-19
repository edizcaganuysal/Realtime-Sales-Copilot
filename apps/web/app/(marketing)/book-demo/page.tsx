'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type FormState = {
  type: string;
  name: string;
  email: string;
  company: string;
  role: string;
  notes: string;
};

const TYPE_OPTIONS = [
  { value: 'general', label: 'General demo' },
  { value: 'custom-agent', label: 'Custom agent request' },
  { value: 'enterprise', label: 'Enterprise discussion' },
  { value: 'signup', label: 'Sign up interest' },
];

const INPUT =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900';

function normalizeType(value: string | null): string {
  if (!value) return 'general';
  return TYPE_OPTIONS.some((option) => option.value === value) ? value : 'general';
}

export default function BookDemoPage() {
  return (
    <Suspense>
      <BookDemoForm />
    </Suspense>
  );
}

function BookDemoForm() {
  const searchParams = useSearchParams();
  const initialType = useMemo(() => normalizeType(searchParams.get('type')), [searchParams]);

  const [form, setForm] = useState<FormState>({
    type: initialType,
    name: '',
    email: '',
    company: '',
    role: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setForm((prev) => ({ ...prev, type: initialType }));
  }, [initialType]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess(false);

    const response = await fetch('/api/sales-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const message =
        typeof payload?.message === 'string'
          ? payload.message
          : 'Unable to send your request right now. Please try again.';
      setError(message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setSuccess(true);
    setForm({
      type: form.type,
      name: '',
      email: '',
      company: '',
      role: '',
      notes: '',
    });
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Book demo</h1>
        <p className="mt-3 text-sm text-slate-600">
          Tell us about your team and goals. We will follow up with the right setup and next steps.
        </p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Request type</label>
            <select
              value={form.type}
              onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))}
              className={INPUT}
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Name</label>
              <input
                required
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                className={INPUT}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <input
                required
                type="email"
                value={form.email}
                onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                className={INPUT}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Company</label>
              <input
                required
                value={form.company}
                onChange={(event) => setForm((prev) => ({ ...prev, company: event.target.value }))}
                className={INPUT}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Role</label>
              <input
                required
                value={form.role}
                onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))}
                className={INPUT}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes</label>
            <textarea
              rows={4}
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              className={INPUT + ' resize-none'}
              placeholder="Tell us what you want to achieve."
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          {success && (
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
              Request received. We will contact you soon.
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Sending...' : 'Submit request'}
          </button>
        </form>
      </div>
    </div>
  );
}
