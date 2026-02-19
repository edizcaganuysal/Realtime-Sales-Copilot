'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type Role = 'ADMIN' | 'MANAGER' | 'REP';
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
  metadataJson?: Record<string, unknown>;
  createdAt: string;
};

type CreditRequest = {
  id: string;
  package: string;
  credits: number;
  notes: string | null;
  status: string;
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

function statusClass(status: string) {
  const value = status.toLowerCase();
  if (value === 'fulfilled') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30';
  if (value === 'approved') return 'text-sky-300 bg-sky-500/10 border-sky-500/30';
  if (value === 'rejected') return 'text-red-300 bg-red-500/10 border-red-500/30';
  return 'text-amber-300 bg-amber-500/10 border-amber-500/30';
}

export default function BillingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<BillingTab>(resolveTab(searchParams.get('tab')));
  const [role, setRole] = useState<Role | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [requests, setRequests] = useState<CreditRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<string>('SMALL');
  const [customCredits, setCustomCredits] = useState('');
  const [requestNotes, setRequestNotes] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);
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
    setSelectedPlanId(plans[0].id);
  }, [plans, selectedPlanId]);

  async function loadData() {
    setLoading(true);
    setError('');
    const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
    const meData = await meRes.json().catch(() => null);
    const nextRole = (meData?.user?.role ?? null) as Role | null;
    setRole(nextRole);

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

    if (nextRole === 'ADMIN' || nextRole === 'MANAGER') {
      const requestsRes = await fetch('/api/billing/credits/requests', { cache: 'no-store' });
      const requestData = await requestsRes.json().catch(() => []);
      if (requestsRes.ok && Array.isArray(requestData)) {
        setRequests(requestData);
      } else {
        setRequests([]);
      }
    } else {
      setRequests([]);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadData().catch(() => {
      setError('Failed to load billing data');
      setLoading(false);
    });
  }, []);

  const isAdmin = role === 'ADMIN';
  const ledgerRows = useMemo(() => ledger.slice(0, 50), [ledger]);

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

  async function handleAdjustCredits() {
    const amount = Number(adjustAmount);
    if (!Number.isInteger(amount) || amount === 0) {
      setError('Amount must be a non-zero integer.');
      return;
    }
    if (!adjustReason.trim()) {
      setError('Reason is required.');
      return;
    }

    setAdjusting(true);
    setError('');

    const res = await fetch('/api/org/credits/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, reason: adjustReason.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setAdjusting(false);

    if (!res.ok) {
      setError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to adjust credits'));
      return;
    }

    setShowAdjustModal(false);
    setAdjustAmount('');
    setAdjustReason('');
    setNotice('Credits updated.');
    window.dispatchEvent(new Event('credits:refresh'));
    await loadData();
  }

  async function handleSubmitRequest() {
    if (!isAdmin) {
      setError('Ask your admin to submit credit requests.');
      return;
    }

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

    setSubmittingRequest(true);
    setError('');

    const res = await fetch('/api/billing/credits/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credits,
        package: selectedPackage,
        notes: requestNotes.trim() || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSubmittingRequest(false);

    if (!res.ok) {
      setError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to submit request'));
      return;
    }

    setRequestNotes('');
    setCustomCredits('');
    setNotice('Request submitted.');
    await loadData();
  }

  async function handleUpgradePlan() {
    if (!isAdmin) {
      setError('Ask your admin to update the plan.');
      return;
    }
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

    setNotice('Plan updated. Billing will be automated later.');
    window.dispatchEvent(new Event('credits:refresh'));
    await loadData();
  }

  if (loading) {
    return (
      <div className="p-8 space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 rounded-xl border border-slate-800 bg-slate-900 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Billing & Credits</h1>
          <p className="mt-1 text-sm text-slate-400">Features are identical across plans. Credits scale by tier.</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAdjustModal(true)}
            className="px-4 py-2 rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-200 text-sm font-medium hover:bg-sky-500/20"
          >
            Adjust credits
          </button>
        )}
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
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
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
                {subscription ? `${formatCredits(subscription.monthlyCredits)} credits/month` : 'Complete onboarding to pick a plan.'}
              </p>
              {subscription && (
                <p className="mt-2 text-xs text-slate-500">
                  Status: {subscription.status} · Updated {new Date(subscription.updatedAt).toLocaleString()}
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-xs uppercase tracking-wider text-slate-500">Credits balance</p>
              <p className="mt-2 text-3xl font-bold text-sky-300">{formatCredits(balance)}</p>
              <p className="mt-1 text-sm text-slate-400">Balance refreshes after usage and manual adjustments.</p>
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
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-base font-semibold text-white">Request credits</h2>
            <p className="mt-1 text-sm text-slate-400">Submit a request now. Payments will be automated later.</p>

            {!isAdmin && (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                Ask your admin to submit this request.
              </div>
            )}

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
                  placeholder="e.g. 50000"
                />
              </div>
            )}

            <div className="mt-3">
              <label className="mb-1 block text-xs text-slate-400">Notes</label>
              <textarea
                rows={3}
                value={requestNotes}
                onChange={(event) => setRequestNotes(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                placeholder="Any context for this request"
              />
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={handleSubmitRequest}
                disabled={submittingRequest || !isAdmin}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {submittingRequest ? 'Submitting...' : 'Submit request'}
              </button>
            </div>
          </div>

          {(role === 'ADMIN' || role === 'MANAGER') && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
              <div className="border-b border-slate-800 px-5 py-3">
                <h3 className="text-sm font-semibold text-white">Request status</h3>
              </div>
              {requests.length === 0 ? (
                <div className="px-5 py-8 text-sm text-slate-500">No requests yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-950/70">
                      <tr>
                        <th className="px-5 py-3 text-left text-xs uppercase tracking-wider text-slate-500">Time</th>
                        <th className="px-5 py-3 text-left text-xs uppercase tracking-wider text-slate-500">Package</th>
                        <th className="px-5 py-3 text-right text-xs uppercase tracking-wider text-slate-500">Credits</th>
                        <th className="px-5 py-3 text-left text-xs uppercase tracking-wider text-slate-500">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {requests.map((request) => (
                        <tr key={request.id}>
                          <td className="px-5 py-3 text-slate-300">{new Date(request.createdAt).toLocaleString()}</td>
                          <td className="px-5 py-3 text-slate-200">{request.package}</td>
                          <td className="px-5 py-3 text-right text-slate-200">{formatCredits(request.credits)}</td>
                          <td className="px-5 py-3">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass(request.status)}`}>
                              {request.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'upgrade' && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-base font-semibold text-white">Upgrade plan</h2>
            <p className="mt-1 text-sm text-slate-400">All features included in every tier. Higher tiers include more monthly credits.</p>
            {!isAdmin && (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                Ask your admin to update the plan.
              </div>
            )}
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
                disabled={updatingPlan || !isAdmin}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {updatingPlan ? 'Updating...' : 'Update plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <h3 className="text-base font-semibold text-white">Adjust credits</h3>
            <p className="mt-1 text-xs text-slate-500">Use positive or negative values. Example: 5000 or -2000.</p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Amount</label>
                <input
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                  placeholder="e.g. 5000 or -2000"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Reason</label>
                <textarea
                  rows={3}
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
                  placeholder="Why are you adjusting credits?"
                />
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setShowAdjustModal(false)}
                className="flex-1 rounded-lg border border-slate-700 py-2 text-sm text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleAdjustCredits}
                disabled={adjusting}
                className="flex-1 rounded-lg bg-sky-600 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {adjusting ? 'Saving...' : 'Save adjustment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
