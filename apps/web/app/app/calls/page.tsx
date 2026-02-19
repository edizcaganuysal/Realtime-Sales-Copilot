'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Phone, PhoneCall, Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable } from '@/components/ui/data-table';

type Outcome = 'won' | 'lost' | 'follow_up' | 'unknown';

type Call = {
  id: string;
  phoneTo: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  notes: string | null;
  outcome: Outcome;
  dealValue: number | null;
};

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  INITIATED: 'neutral',
  IN_PROGRESS: 'success',
  COMPLETED: 'info',
  FAILED: 'error',
};

const OUTCOMES: Array<{ value: Outcome; label: string }> = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'follow_up', label: 'Follow up' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

function duration(start: string | null, end: string | null) {
  if (!start) return '\u2014';
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  const sec = Math.floor((e.getTime() - s.getTime()) / 1000);
  const m = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/calls')
      .then((r) => r.json())
      .then((d) => {
        setCalls(Array.isArray(d) ? d : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const sortedCalls = useMemo(
    () => [...calls].sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || '')),
    [calls],
  );

  async function setOutcome(callId: string, outcome: Outcome) {
    setSavingId(callId);
    const res = await fetch(`/api/calls/${callId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome }),
    });
    const updated = await res.json().catch(() => null);
    setSavingId(null);
    if (!res.ok || !updated) return;
    setCalls((prev) => prev.map((item) => (item.id === callId ? { ...item, ...updated } : item)));
  }

  return (
    <div className="p-8 max-w-6xl">
      <PageHeader
        title="Calls"
        actions={
          <Link
            href="/app/dialer/new"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={14} /> Start a call
          </Link>
        }
      />

      {loading ? (
        <LoadingSkeleton count={4} />
      ) : sortedCalls.length === 0 ? (
        <EmptyState
          icon={PhoneCall}
          message="No calls yet"
          action={
            <Link
              href="/app/dialer/new"
              className="flex items-center gap-1.5 text-sm text-sky-400 hover:text-sky-300 transition-colors"
            >
              <Phone size={14} /> Start your first call
            </Link>
          }
        />
      ) : (
        <DataTable
          headers={[
            { label: 'Number' },
            { label: 'Status' },
            { label: 'Outcome' },
            { label: 'Duration' },
            { label: 'Started' },
            { label: '', className: 'w-28' },
          ]}
        >
          {sortedCalls.map((call) => (
            <tr key={call.id} className="hover:bg-slate-800/40 transition-colors">
              <td className="px-5 py-3.5">
                <div>
                  <p className="text-white font-medium font-mono">{call.phoneTo}</p>
                  {call.notes ? (
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{call.notes}</p>
                  ) : null}
                </div>
              </td>
              <td className="px-5 py-3.5">
                <StatusBadge variant={STATUS_VARIANT[call.status] ?? 'neutral'}>
                  {call.status.replace('_', ' ')}
                </StatusBadge>
              </td>
              <td className="px-5 py-3.5">
                <select
                  value={call.outcome || 'unknown'}
                  onChange={(event) => {
                    void setOutcome(call.id, event.target.value as Outcome);
                  }}
                  disabled={savingId === call.id}
                  className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                >
                  {OUTCOMES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-5 py-3.5 text-slate-400 text-xs tabular-nums">
                {duration(call.startedAt, call.endedAt)}
              </td>
              <td className="px-5 py-3.5 text-slate-500 text-xs">
                {call.startedAt ? new Date(call.startedAt).toLocaleString() : '\u2014'}
              </td>
              <td className="px-5 py-3.5 text-right">
                {call.status === 'IN_PROGRESS' ? (
                  <Link
                    href={`/app/calls/${call.id}/live`}
                    className="text-xs px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors"
                  >
                    Rejoin
                  </Link>
                ) : (
                  <Link
                    href={`/app/calls/${call.id}`}
                    className="text-xs px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg transition-colors"
                  >
                    Review
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
