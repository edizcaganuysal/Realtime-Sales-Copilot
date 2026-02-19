'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Phone, PhoneCall, Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable } from '@/components/ui/data-table';

type Call = {
  id: string;
  phoneTo: string;
  status: string;
  guidanceLevel: string;
  layoutPreset: string;
  startedAt: string | null;
  endedAt: string | null;
  notes: string | null;
};

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  INITIATED: 'neutral',
  IN_PROGRESS: 'success',
  COMPLETED: 'info',
  FAILED: 'error',
};

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

  useEffect(() => {
    fetch('/api/calls')
      .then((r) => r.json())
      .then((d) => {
        setCalls(Array.isArray(d) ? d : []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="p-8 max-w-4xl">
      <PageHeader
        title="Calls"
        actions={
          <Link
            href="/app/dialer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={14} /> New call
          </Link>
        }
      />

      {loading ? (
        <LoadingSkeleton count={4} />
      ) : calls.length === 0 ? (
        <EmptyState
          icon={PhoneCall}
          message="No calls yet"
          action={
            <Link
              href="/app/dialer"
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
            { label: 'Duration' },
            { label: 'Started' },
            { label: '', className: 'w-24' },
          ]}
        >
          {calls.map((call) => (
            <tr key={call.id} className="hover:bg-slate-800/40 transition-colors">
              <td className="px-5 py-3.5">
                <div>
                  <p className="text-white font-medium font-mono">{call.phoneTo}</p>
                  {call.notes && (
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{call.notes}</p>
                  )}
                </div>
              </td>
              <td className="px-5 py-3.5">
                <StatusBadge variant={STATUS_VARIANT[call.status] ?? 'neutral'}>
                  {call.status.replace('_', ' ')}
                </StatusBadge>
              </td>
              <td className="px-5 py-3.5 text-slate-400 text-xs tabular-nums">
                {duration(call.startedAt, call.endedAt)}
              </td>
              <td className="px-5 py-3.5 text-slate-500 text-xs">
                {call.startedAt ? new Date(call.startedAt).toLocaleString() : '\u2014'}
              </td>
              <td className="px-5 py-3.5 text-right">
                {call.status === 'IN_PROGRESS' && (
                  <Link
                    href={`/app/calls/${call.id}/live`}
                    className="text-xs px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors"
                  >
                    Rejoin
                  </Link>
                )}
                {(call.status === 'COMPLETED' || call.status === 'FAILED') && (
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
