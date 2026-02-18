'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Phone, PhoneCall, Plus } from 'lucide-react';

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

const STATUS_BADGE: Record<string, string> = {
  INITIATED: 'bg-slate-700 text-slate-400',
  IN_PROGRESS: 'bg-emerald-500/15 text-emerald-400',
  COMPLETED: 'bg-blue-500/15 text-blue-400',
  FAILED: 'bg-red-500/15 text-red-400',
};

function duration(start: string | null, end: string | null) {
  if (!start) return '—';
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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-white">Calls</h1>
        <Link
          href="/app/dialer"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={14} /> New call
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-slate-900 border border-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : calls.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <PhoneCall size={36} className="text-slate-700 mb-3" />
          <p className="text-slate-500 text-sm">No calls yet</p>
          <Link
            href="/app/dialer"
            className="mt-4 flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            <Phone size={14} /> Start your first call
          </Link>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-5 py-3">
                  Number
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-5 py-3">
                  Status
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-5 py-3">
                  Duration
                </th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-5 py-3">
                  Started
                </th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
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
                    <span
                      className={
                        'text-xs px-1.5 py-0.5 rounded font-medium ' +
                        (STATUS_BADGE[call.status] ?? 'bg-slate-700 text-slate-400')
                      }
                    >
                      {call.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-slate-400 text-xs tabular-nums">
                    {duration(call.startedAt, call.endedAt)}
                  </td>
                  <td className="px-5 py-3.5 text-slate-500 text-xs">
                    {call.startedAt ? new Date(call.startedAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {call.status === 'IN_PROGRESS' && (
                      <Link
                        href={`/app/calls/${call.id}/live`}
                        className="text-xs px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
                      >
                        Rejoin
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
