'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Headset, Settings2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable } from '@/components/ui/data-table';

type Session = {
  id: string;
  status: string;
  issueCategory: string | null;
  notes: string;
  customerJson: Record<string, unknown>;
  createdAt: string;
  resolvedAt: string | null;
};

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  ACTIVE: 'success',
  RESOLVED: 'info',
  ESCALATED: 'warning',
};

function duration(start: string, end: string | null) {
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  const sec = Math.floor((e.getTime() - s.getTime()) / 1000);
  const m = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

function customerLabel(json: Record<string, unknown>) {
  const name = typeof json.name === 'string' ? json.name : '';
  const email = typeof json.email === 'string' ? json.email : '';
  return name || email || '\u2014';
}

export default function SupportPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/support/sessions')
      .then((r) => r.json())
      .then((d) => {
        setSessions(Array.isArray(d) ? d : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const sorted = useMemo(
    () => [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [sessions],
  );

  return (
    <div className="p-8 max-w-6xl">
      <PageHeader
        title="Support Sessions"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/app/support/integrations"
              className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-700 text-slate-300 text-sm font-medium rounded-lg transition-colors hover:border-slate-500 hover:text-white"
            >
              <Settings2 size={14} /> Integrations
            </Link>
          </div>
        }
      />

      {loading ? (
        <LoadingSkeleton count={4} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Headset}
          message="No support sessions yet"
          action={
            <p className="text-sm text-slate-500">
              Start a support call from the dialer to begin a session.
            </p>
          }
        />
      ) : (
        <DataTable
          headers={[
            { label: 'Customer' },
            { label: 'Status' },
            { label: 'Issue' },
            { label: 'Duration' },
            { label: 'Started' },
            { label: '', className: 'w-28' },
          ]}
        >
          {sorted.map((session) => (
            <tr key={session.id} className="hover:bg-slate-800/50 transition-colors">
              <td className="px-5 py-3">
                <span className="font-medium text-white">
                  {customerLabel(session.customerJson)}
                </span>
              </td>
              <td className="px-5 py-3">
                <StatusBadge
                  variant={STATUS_VARIANT[session.status] ?? 'neutral'}
                  label={session.status}
                />
              </td>
              <td className="px-5 py-3 text-slate-400 text-xs">
                {session.issueCategory ?? '\u2014'}
              </td>
              <td className="px-5 py-3 tabular-nums text-slate-400">
                {duration(session.createdAt, session.resolvedAt)}
              </td>
              <td className="px-5 py-3 text-slate-400 text-xs">
                {new Date(session.createdAt).toLocaleString()}
              </td>
              <td className="px-5 py-3">
                <Link
                  href={`/app/support/${session.id}/live`}
                  className="text-xs text-sky-400 hover:text-sky-300"
                >
                  {session.status === 'ACTIVE' ? 'Open live' : 'View'}
                </Link>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
