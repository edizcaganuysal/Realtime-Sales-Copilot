'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PhoneCall } from 'lucide-react';

type Call = {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  outcome?: 'won' | 'lost' | 'follow_up' | 'unknown';
};

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function MetricCard({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

export default function HomePage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/calls', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        setCalls(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const metrics = useMemo(() => {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    let callsLast7 = 0;
    let totalMinutes = 0;
    let won = 0;
    let followUps = 0;

    for (const call of calls) {
      const start = call.startedAt ? new Date(call.startedAt).getTime() : 0;
      const end = call.endedAt ? new Date(call.endedAt).getTime() : 0;

      if (start >= weekAgo) callsLast7 += 1;
      if (start > 0 && end > start) {
        totalMinutes += Math.max(1, Math.floor((end - start) / 60000));
      }

      if (call.outcome === 'won') won += 1;
      if (call.outcome === 'follow_up') followUps += 1;
    }

    return {
      totalCalls: calls.length,
      callsLast7,
      totalMinutes,
      won,
      followUps,
    };
  }, [calls]);

  return (
    <div className="max-w-6xl p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Home</h1>
          <p className="mt-1 text-sm text-slate-400">Personal sales dashboard for demos.</p>
        </div>
        <Link
          href="/app/dialer/new"
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
        >
          <PhoneCall size={15} />
          Start a call
        </Link>
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[...Array(4)].map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-xl border border-slate-800 bg-slate-900" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Calls made"
            value={String(metrics.totalCalls)}
            sub={`${metrics.callsLast7} in last 7 days`}
          />
          <MetricCard
            title="Total talk time"
            value={formatDuration(metrics.totalMinutes)}
            sub="Completed call duration"
          />
          <MetricCard
            title="Deals closed"
            value={String(metrics.won)}
            sub="Based on call outcomes"
          />
          <MetricCard
            title="Upcoming follow-ups"
            value={String(metrics.followUps)}
            sub="Calls marked as follow up"
          />
        </div>
      )}
    </div>
  );
}
