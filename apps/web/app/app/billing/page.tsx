'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type BillingTab = 'overview' | 'add-credits' | 'upgrade';

type Plan = {
  id: string;
  name: string;
  monthlyCredits: number;
  isActive: boolean;
};

type Subscription = {
  orgId: string;
  planId: string;
  status: string;
  creditsBalance: number;
  updatedAt: string;
  planName: string;
  monthlyCredits: number;
};

type LedgerRow = {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  createdAt: string;
};

const PACKAGE_OPTIONS = [
  { id: 'SMALL', label: '+25k credits', credits: 25000 },
  { id: 'MEDIUM', label: '+100k credits', credits: 100000 },
  { id: 'LARGE', label: '+250k credits', credits: 250000 },
] as const;

function formatCredits(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function resolveTab(raw: string | null): BillingTab {
  if (raw === 'add-credits') return 'add-credits';
  if (raw === 'upgrade') return 'upgrade';
  return 'overview';
}

export default function BillingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<BillingTab>(resolveTab(searchParams.get('tab')));
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedPackage, setSelectedPackage] = useState<string>('SMALL');
  const [customCredits, setCustomCredits] = useState('');
  const [processingAdd, setProcessingAdd] = useState(false);
  const [updatingPlan, setUpdatingPlan] = useState(false);

  useEffect(() => {
    setTab(resolveTab(searchParams.get('tab')));
  }, [searchParams]);

  useEffect(() => {
    if (!subscription) return;
    setSelectedPlanId(subscription.planId);
  }, [subscription?.planId]);

  useEffect(() => {
    if (selectedPlanId) return;
    if (plans.length === 0) return;
    setSelectedPlanId(plans[0]!.id);
  }, [plans, selectedPlanId]);

  useEffect(() => {
    void loadData();
  }, []);

  const ledgerRows = useMemo(() => ledger.slice(0, 50), [ledger]);

  async function loadData() {
    setLoading(true);
    setError('');

    const [subRes, creditsRes, plansRes] = await Promise.all([
      fetch('/api/org/subscription', { cache: 'no-store' }),
      fetch('/api/org/credits', { cache: 'no-store' }),
      fetch('/api/plans', { cache: 'no-store' }),
    ]);

    if (subRes.ok) {
      const subData = await subRes.json().catch(() => null);
      setSubscription(subData);
    } else {
      setSubscription(null);
    }

    const creditsData = await creditsRes.json().catch(() => null);
    if (creditsRes.ok && creditsData) {
      setBalance(typeof creditsData.balance === 'number' ? creditsData.balance : 0);
      setLedger(Array.isArray(creditsData.ledger) ? creditsData.ledger : []);
    } else {
      setBalance(0);
      setLedger([]);
      if (creditsRes.status !== 404) {
        setError(creditsData?.message ?? 'Failed to load credits');
      }
    }

    const plansData = await plansRes.json().catch(() => []);
    if (plansRes.ok && Array.isArray(plansData)) {
      setPlans(plansData);
    } else {
      setPlans([]);
    }

    setLoading(false);
  }

  function switchTab(nextTab: BillingTab) {
    setTab(nextTab);
    setError('');
    setNotice('');
    const params = new URLSearchParams(searchParams.toString());
    if (nextTab === 'overview') {
      params.delete('tab');
    } else {
      params.set('tab', nextTab);
    }
    const query = params.toString();
    router.replace(`/app/billing${query ? `?${query}` : ''}`);
  }

  async function handleAddCredits() {
    const selected = PACKAGE_OPTIONS.find((item) => item.id === selectedPackage);
    const credits =
      selectedPackage === 'CUSTOM'
        ? Number(customCredits)
        : selected
          ? selected.credits
          : 0;

    if (!Number.isInteger(credits) || credits <= 0) {
      setError('Enter a valid credit amount.');
      return;
    }

    setProcessingAdd(true);
    setError('');

    const res = await fetch('/api/org/credits/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: credits,
        reason: `DEMO_PURCHASE_${selectedPackage}`,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setProcessingAdd(false);

    if (!res.ok) {
      setError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to add credits'));
      return;
    }

    setNotice('Credits added instantly in demo mode.');
    setCustomCredits('');
    window.dispatchEvent(new Event('credits:refresh'));
    await loadData();
  }

  async function handleUpgradePlan() {
    if (!selectedPlanId) {
      setError('Select a plan.');
      return;
    }

    setUpdatingPlan(true);
    setError('');

    const res = await fetch('/api/org/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_id: selectedPlanId }),
    });
    const data = await res.json().catch(() => ({}));
    setUpdatingPlan(false);

    if (!res.ok) {
      setError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to update plan'));
      return;
    }

    setNotice('Plan updated instantly for demo mode.');
    window.dispatchEvent(new Event('credits:refresh'));
    await loadData();
  }

  if (loading) {
    return (
      <div className="p-8 space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-800 bg-slate-900" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Billing</h1>
        <p className="mt-1 text-sm text-slate-400">
          Demo mode is active. Plan updates and credit purchases apply immediately.
        </p>
      </div>

      <div className="mb-5 flex gap-2">
        <button
          onClick={() => switchTab('overview')}
          className={`rounded-lg px-3 py-2 text-sm font-medium border ${
            tab === 'overview'
              ? 'border-sky-500/50 bg-sky-500/10 text-sky-300'
              : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => switchTab('add-credits')}
          className={`rounded-lg px-3 py-2 text-sm font-medium border ${
            tab === 'add-credits'
              ? 'border-sky-500/50 bg-sky-500/10 text-sky-300'
              : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          Add credits
        </button>
        <button
          onClick={() => switchTab('upgrade')}
          className={`rounded-lg px-3 py-2 text-sm font-medium border ${
            tab === 'upgrade'
              ? 'border-sky-500/50 bg-sky-500/10 text-sky-300'
              : 'border-slate-700 text-slate-300 hover:border-slate-500'
          }`}
        >
          Upgrade plan
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-300">
          {notice}
        </div>
      )}

      {tab === 'overview' && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-xs uppercase tracking-wider text-slate-500">Current plan</p>
              <p className="mt-2 text-xl font-semibold text-white">
                {subscription?.planName ?? 'No plan selected'}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {subscription ? `${formatCredits(subscription.monthlyCredits)} credits/month` : 'Select a plan to get started.'}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-xs uppercase tracking-wider text-slate-500">Credits balance</p>
              <p className="mt-2 text-3xl font-bold text-sky-300">{formatCredits(balance)}</p>
              <p className="mt-1 text-sm text-slate-400">Updates after every usage and purchase.</p>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
            <div className="border-b border-slate-800 px-5 py-3">
              <h2 className="text-sm font-semibold text-white">Credit ledger (last 50)</h2>
            </div>
            {ledgerRows.length === 0 ? (
              <div className="px-5 py-8 text-sm text-slate-500">No ledger entries yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-950/70">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Time</th>
                      <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Type</th>
                      <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500">Amount</th>
                      <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500">Balance after</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {ledgerRows.map((row) => (
                      <tr key={row.id}>
                        <td className="px-5 py-3 text-slate-300">{new Date(row.createdAt).toLocaleString()}</td>
                        <td className="px-5 py-3 text-slate-200">{row.type}</td>
                        <td className={`px-5 py-3 text-right font-medium ${row.amount >= 0 ? 'text-sky-300' : 'text-red-300'}`}>
                          {row.amount >= 0 ? '+' : ''}
                          {formatCredits(row.amount)}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-200">{formatCredits(row.balanceAfter)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'add-credits' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-base font-semibold text-white">Add credits</h2>
          <p className="mt-1 text-sm text-slate-400">
            Select a package and credits are added immediately.
          </p>

          <div className="mt-4 grid gap-2 md:grid-cols-4">
            {PACKAGE_OPTIONS.map((pkg) => (
              <button
                key={pkg.id}
                type="button"
                onClick={() => setSelectedPackage(pkg.id)}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  selectedPackage === pkg.id
                    ? 'border-sky-500/40 bg-sky-500/10'
                    : 'border-slate-700 bg-slate-950/60 hover:border-slate-500'
                }`}
              >
                <p className="text-sm font-medium text-white">{pkg.label}</p>
                <p className="mt-1 text-xs text-slate-400">{formatCredits(pkg.credits)} credits</p>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelectedPackage('CUSTOM')}
              className={`rounded-xl border p-3 text-left transition-colors ${
                selectedPackage === 'CUSTOM'
                  ? 'border-sky-500/40 bg-sky-500/10'
                  : 'border-slate-700 bg-slate-950/60 hover:border-slate-500'
              }`}
            >
              <p className="text-sm font-medium text-white">Custom amount</p>
              <p className="mt-1 text-xs text-slate-400">Enter exact credits</p>
            </button>
          </div>

          {selectedPackage === 'CUSTOM' && (
            <div className="mt-3">
              <label className="mb-1 block text-xs text-slate-400">Custom credits</label>
              <input
                value={customCredits}
                onChange={(event) => setCustomCredits(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                placeholder="Example: 50000"
              />
            </div>
          )}

          <div className="mt-5">
            <button
              type="button"
              onClick={handleAddCredits}
              disabled={processingAdd}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {processingAdd ? 'Processing...' : 'Add credits now'}
            </button>
          </div>
        </div>
      )}

      {tab === 'upgrade' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-base font-semibold text-white">Upgrade plan</h2>
          <p className="mt-1 text-sm text-slate-400">
            All features are included in every tier. Higher tiers include more credits.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {plans.map((plan) => {
              const selected = selectedPlanId === plan.id;
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedPlanId(plan.id)}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    selected
                      ? 'border-sky-500/40 bg-sky-500/10'
                      : 'border-slate-700 bg-slate-950/60 hover:border-slate-500'
                  }`}
                >
                  <p className="text-base font-semibold text-white">{plan.name}</p>
                  <p className="mt-2 text-2xl font-bold text-sky-300">{formatCredits(plan.monthlyCredits)}</p>
                  <p className="mt-1 text-xs uppercase tracking-wider text-slate-500">credits / month</p>
                </button>
              );
            })}
          </div>

          <div className="mt-5">
            <button
              type="button"
              onClick={handleUpgradePlan}
              disabled={updatingPlan}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {updatingPlan ? 'Updating...' : 'Update plan'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
