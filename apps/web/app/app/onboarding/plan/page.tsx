'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Plan = {
  id: string;
  name: string;
  monthlyCredits: number;
  isActive: boolean;
};

type MeResponse = {
  user: {
    role: 'ADMIN' | 'MANAGER' | 'REP';
  };
};

function formatCredits(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

export default function PlanOnboardingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'MANAGER' | 'REP' | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError('');

      const [meRes, plansRes, subscriptionRes] = await Promise.all([
        fetch('/api/auth/me', { cache: 'no-store' }),
        fetch('/api/plans', { cache: 'no-store' }),
        fetch('/api/org/subscription', { cache: 'no-store' }),
      ]);

      if (!active) return;

      const meData = await meRes.json().catch(() => null);
      const currentRole = meData?.user?.role ?? null;
      setRole(currentRole);

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
      setError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to subscribe'));
      return;
    }

    router.replace('/app/home');
  }

  if (loading) {
    return (
      <div className="p-8 max-w-5xl space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-40 rounded-2xl border border-slate-800 bg-slate-900 animate-pulse" />
        ))}
      </div>
    );
  }

  if (role !== 'ADMIN') {
    return (
      <div className="p-8 max-w-xl">
        <h1 className="text-xl font-semibold text-white">Plan setup is admin-only</h1>
        <p className="mt-2 text-sm text-slate-400">
          Ask an admin to choose a plan for this organization.
        </p>
        <button
          onClick={() => router.replace('/app/home')}
          className="mt-4 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-sm"
        >
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Choose your plan</h1>
        <p className="text-sm text-slate-400 mt-1">
          All tiers include the same features. Higher tiers include more monthly credits.
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
                  ? 'border-emerald-500/50 bg-emerald-500/10'
                  : 'border-slate-800 bg-slate-900 hover:border-slate-600'
              }`}
            >
              <p className="text-base font-semibold text-white">{plan.name}</p>
              <p className="mt-3 text-2xl font-bold text-emerald-300">
                {formatCredits(plan.monthlyCredits)}
              </p>
              <p className="mt-1 text-xs uppercase tracking-wider text-slate-500">credits / month</p>
              <p className="mt-4 text-sm text-slate-400">
                Identical feature access. Monthly credits scale with plan tier.
              </p>
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        <button
          onClick={handleConfirm}
          disabled={submitting || !selectedPlanId}
          className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium"
        >
          {submitting ? 'Applying plan...' : 'Confirm plan'}
        </button>
      </div>
    </div>
  );
}
