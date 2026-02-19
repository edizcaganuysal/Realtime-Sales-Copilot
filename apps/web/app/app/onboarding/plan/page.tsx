'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Plan = {
  id: string;
  name: string;
  monthlyCredits: number;
  isActive: boolean;
};

function formatCredits(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

export default function PlanOnboardingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError('');

      const [plansRes, subscriptionRes] = await Promise.all([
        fetch('/api/plans', { cache: 'no-store' }),
        fetch('/api/org/subscription', { cache: 'no-store' }),
      ]);

      if (!active) return;

      if (subscriptionRes.ok) {
        router.replace('/app/home');
        return;
      }

      const plansData = await plansRes.json().catch(() => []);
      if (!plansRes.ok) {
        setError(plansData?.message ?? 'Failed to load plans');
        setLoading(false);
        return;
      }

      const safePlans = Array.isArray(plansData) ? plansData : [];
      setPlans(safePlans);
      setSelectedPlanId(safePlans[0]?.id ?? '');
      setLoading(false);
    }

    void load().catch(() => {
      if (!active) return;
      setError('Failed to load onboarding data');
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [router]);

  async function handleConfirm() {
    if (!selectedPlanId) {
      setError('Select a plan to continue.');
      return;
    }

    setSubmitting(true);
    setError('');

    const res = await fetch('/api/org/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_id: selectedPlanId }),
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (!res.ok) {
      setError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to apply plan'));
      return;
    }

    router.replace('/app/home');
  }

  if (loading) {
    return (
      <div className="p-8 max-w-5xl space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-2xl border border-slate-800 bg-slate-900" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Choose your plan</h1>
        <p className="mt-1 text-sm text-slate-400">
          Features are identical across tiers. Credits change by plan.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const selected = selectedPlanId === plan.id;
          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => setSelectedPlanId(plan.id)}
              className={`rounded-2xl border p-5 text-left transition-colors ${
                selected
                  ? 'border-sky-500/50 bg-sky-500/10'
                  : 'border-slate-800 bg-slate-900 hover:border-slate-600'
              }`}
            >
              <p className="text-base font-semibold text-white">{plan.name}</p>
              <p className="mt-3 text-2xl font-bold text-sky-300">{formatCredits(plan.monthlyCredits)}</p>
              <p className="mt-1 text-xs uppercase tracking-wider text-slate-500">credits / month</p>
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        <button
          onClick={handleConfirm}
          disabled={submitting || !selectedPlanId}
          className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {submitting ? 'Applying plan...' : 'Confirm plan'}
        </button>
      </div>
    </div>
  );
}
