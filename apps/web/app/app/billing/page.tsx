'use client';

import { useEffect, useMemo, useState } from 'react';

type Role = 'ADMIN' | 'MANAGER' | 'REP';

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

function formatCredits(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

export default function BillingPage() {
  const [role, setRole] = useState<Role | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  async function loadData() {
    setLoading(true);
    setError('');

    const [meRes, subRes, creditsRes] = await Promise.all([
      fetch('/api/auth/me', { cache: 'no-store' }),
      fetch('/api/org/subscription', { cache: 'no-store' }),
      fetch('/api/org/credits', { cache: 'no-store' }),
    ]);

    const meData = await meRes.json().catch(() => null);
    setRole(meData?.user?.role ?? null);

    if (subRes.ok) {
      const subData = await subRes.json();
      setSubscription(subData);
    } else {
      setSubscription(null);
    }

    const creditsData = await creditsRes.json().catch(() => null);
    if (creditsRes.ok && creditsData) {
      setBalance(creditsData.balance ?? 0);
      setLedger(Array.isArray(creditsData.ledger) ? creditsData.ledger : []);
    } else {
      setBalance(0);
      setLedger([]);
      if (creditsRes.status !== 404) {
        setError(creditsData?.message ?? 'Failed to load credits');
      }
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadData().catch(() => {
      setError('Failed to load billing data');
      setLoading(false);
    });
  }, []);

  const canAdjust = role === 'ADMIN';

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
    await loadData();
  }

  const ledgerRows = useMemo(() => ledger.slice(0, 50), [ledger]);

  if (loading) {
    return (
      <div className="p-8 space-y-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 rounded-xl border border-slate-800 bg-slate-900 animate-pulse" />
        ))}
      </div>
    );
  }

  if (role !== 'ADMIN') {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-white">Billing access is admin-only</h1>
        <p className="mt-2 text-sm text-slate-400">Ask an admin to manage plans and credits.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Billing & Credits</h1>
          <p className="mt-1 text-sm text-slate-400">No payment processing yet. Credits are managed manually.</p>
        </div>
        {canAdjust && (
          <button
            onClick={() => setShowAdjustModal(true)}
            className="px-4 py-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 text-sm font-medium hover:bg-cyan-500/20"
          >
            Adjust credits
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

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
          <p className="mt-2 text-3xl font-bold text-emerald-300">{formatCredits(balance)}</p>
          <p className="mt-1 text-sm text-slate-400">Available balance shown for all reps in live calls.</p>
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
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">Metadata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {ledgerRows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-3 text-slate-300">{new Date(row.createdAt).toLocaleString()}</td>
                    <td className="px-5 py-3 text-slate-200">{row.type}</td>
                    <td className={`px-5 py-3 text-right font-medium ${row.amount >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {row.amount >= 0 ? '+' : ''}
                      {formatCredits(row.amount)}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-200">{formatCredits(row.balanceAfter)}</td>
                    <td className="px-5 py-3 text-slate-400 max-w-xs truncate">
                      {row.metadataJson && Object.keys(row.metadataJson).length > 0
                        ? JSON.stringify(row.metadataJson)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="e.g. 5000 or -2000"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Reason</label>
                <textarea
                  rows={3}
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
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
                className="flex-1 rounded-lg bg-cyan-600 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
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
