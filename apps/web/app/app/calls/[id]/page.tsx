'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, MessageSquare, Brain, BarChart2 } from 'lucide-react';
import { SectionCard } from '@/components/ui/section-card';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';

type CallData = {
  id: string;
  phoneTo: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  notes: string | null;
};

type TranscriptLine = {
  id: string;
  speaker: string;
  text: string;
  tsMs: number;
};

type SummaryData = {
  callId: string;
  summaryJson: { summary: string; keyMoments: string[] };
  coachingJson: {
    talkRatio: { rep: number; prospect: number };
    questionCount: number;
    strengths: string[];
    improvements: string[];
    score: number | null;
    nextActions?: string[];
    nextBestLines?: string[];
    risks?: string[];
  };
} | null;

function formatDuration(start: string | null, end: string | null) {
  if (!start) return '—';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.floor((e - s) / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function formatTime(tsMs: number) {
  return new Date(tsMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <SectionCard title={title} icon={icon}>
      {children}
    </SectionCard>
  );
}

function TalkRatioBar({ rep, prospect }: { rep: number; prospect: number }) {
  const repPct = Math.round(rep * 100);
  const prosPct = Math.round(prospect * 100);
  return (
    <div className="space-y-2">
      <div className="flex h-3 gap-2 overflow-hidden rounded-full">
        <div className="rounded-l-full bg-sky-500" style={{ width: `${repPct}%` }} />
        <div className="rounded-r-full bg-blue-500" style={{ width: `${prosPct}%` }} />
      </div>
      <div className="flex gap-6 text-xs text-slate-400">
        <span>
          <span className="font-medium text-sky-400">{repPct}%</span> Rep
        </span>
        <span>
          <span className="font-medium text-blue-400">{prosPct}%</span> Prospect
        </span>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const color =
    score >= 8
      ? 'text-sky-400 border-sky-500/30 bg-sky-500/10'
      : score >= 6
        ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
        : 'text-red-400 border-red-500/30 bg-red-500/10';
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold ${color}`}>
      {score}/10
    </div>
  );
}

export default function CallReviewPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [call, setCall] = useState<CallData | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [summary, setSummary] = useState<SummaryData>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const fetchJsonSafe = async <T,>(url: string, fallback: T): Promise<T> => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        const text = await res.text();
        if (!text.trim()) return fallback;
        return JSON.parse(text) as T;
      } catch {
        return fallback;
      }
    };

    Promise.all([
      fetchJsonSafe<CallData | null>(`/api/calls/${id}`, null),
      fetchJsonSafe<TranscriptLine[]>(`/api/calls/${id}/transcript`, []),
      fetchJsonSafe<SummaryData>(`/api/calls/${id}/summary`, null),
    ]).then(([callData, txData, sumData]) => {
      if (!active) return;
      setCall(callData);
      setTranscript(Array.isArray(txData) ? txData : []);
      setSummary(sumData ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-4xl space-y-4 p-8">
        <LoadingSkeleton count={3} height="h-32" />
      </div>
    );
  }

  if (!call) {
    return <div className="p-8 text-sm text-slate-500">Call not found.</div>;
  }

  return (
    <div className="max-w-4xl space-y-5 p-8">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/app/calls"
            className="flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-white"
          >
            <ArrowLeft size={14} /> Back
          </Link>
          <span className="text-slate-700">|</span>
          <div>
            <h1 className="font-mono text-lg font-semibold text-white">{call.phoneTo}</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {call.startedAt ? new Date(call.startedAt).toLocaleString() : '—'} {' · '}
              {formatDuration(call.startedAt, call.endedAt)}
              {call.notes && ` · ${call.notes}`}
            </p>
          </div>
        </div>
        {call.status === 'IN_PROGRESS' && (
          <Link
            href={`/app/calls/${id}/live`}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-sky-500"
          >
            Rejoin live
          </Link>
        )}
      </div>

      {summary ? (
        <>
          <Section title="AI Summary" icon={<Brain size={15} />}>
            <p className="mb-4 text-sm leading-relaxed text-slate-300">
              {summary.summaryJson.summary || 'No summary generated.'}
            </p>
            {summary.summaryJson.keyMoments.length > 0 && (
              <div>
                <p className="mb-2 text-xs uppercase tracking-wider text-slate-500">Key moments</p>
                <ul className="space-y-1.5">
                  {summary.summaryJson.keyMoments.map((moment, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-slate-400">
                      <span className="mt-0.5 text-slate-600">•</span>
                      {moment}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          <Section title="Coaching" icon={<BarChart2 size={15} />}>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-5">
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wider text-slate-500">Talk ratio</p>
                  <TalkRatioBar
                    rep={summary.coachingJson.talkRatio.rep}
                    prospect={summary.coachingJson.talkRatio.prospect}
                  />
                </div>
                <div className="flex items-center gap-4">
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">Questions asked</p>
                    <p className="text-2xl font-bold tabular-nums text-white">
                      {summary.coachingJson.questionCount}
                    </p>
                  </div>
                  {summary.coachingJson.score !== null && (
                    <div>
                      <p className="mb-1 text-xs uppercase tracking-wider text-slate-500">Score</p>
                      <ScoreBadge score={summary.coachingJson.score} />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                {summary.coachingJson.strengths.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-wider text-sky-400">Strengths</p>
                    <ul className="space-y-1">
                      {summary.coachingJson.strengths.map((value, index) => (
                        <li key={index} className="flex items-start gap-1.5 text-xs text-slate-400">
                          <span className="mt-0.5 text-sky-500">✓</span>
                          {value}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {summary.coachingJson.improvements.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-wider text-amber-400">Improvements</p>
                    <ul className="space-y-1">
                      {summary.coachingJson.improvements.map((value, index) => (
                        <li key={index} className="flex items-start gap-1.5 text-xs text-slate-400">
                          <span className="mt-0.5 text-amber-500">→</span>
                          {value}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(summary.coachingJson.nextActions?.length ?? 0) > 0 && (
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-wider text-sky-400">Next actions</p>
                    <ul className="space-y-1">
                      {summary.coachingJson.nextActions!.map((value, index) => (
                        <li key={index} className="flex items-start gap-1.5 text-xs text-slate-400">
                          <span className="mt-0.5 text-sky-500">•</span>
                          {value}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(summary.coachingJson.nextBestLines?.length ?? 0) > 0 && (
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-wider text-violet-400">Next best lines</p>
                    <ul className="space-y-1">
                      {summary.coachingJson.nextBestLines!.map((value, index) => (
                        <li key={index} className="flex items-start gap-1.5 text-xs text-slate-300">
                          <span className="mt-0.5 text-violet-500">{index + 1}.</span>
                          &ldquo;{value}&rdquo;
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(summary.coachingJson.risks?.length ?? 0) > 0 && (
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-wider text-rose-400">Risks</p>
                    <ul className="space-y-1">
                      {summary.coachingJson.risks!.map((value, index) => (
                        <li key={index} className="flex items-start gap-1.5 text-xs text-slate-400">
                          <span className="mt-0.5 text-rose-500">!</span>
                          {value}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </Section>
        </>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-center">
          <Brain size={24} className="mx-auto mb-2 text-slate-700" />
          <p className="text-sm text-slate-500">
            {call.status === 'IN_PROGRESS'
              ? 'AI analysis is generated after the call ends.'
              : 'No AI analysis available.'}
          </p>
        </div>
      )}

      <Section title={`Transcript (${transcript.length} lines)`} icon={<MessageSquare size={15} />}>
        {transcript.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-600">No transcript recorded for this call.</p>
        ) : (
          <div className="space-y-3">
            {transcript.map((line) => (
              <div
                key={line.id}
                className={'flex gap-3 ' + (line.speaker === 'REP' ? 'flex-row-reverse' : 'flex-row')}
              >
                <div
                  className={
                    'h-6 w-6 shrink-0 rounded-full text-[9px] font-bold flex items-center justify-center ' +
                    (line.speaker === 'REP'
                      ? 'bg-sky-500/20 text-sky-400'
                      : 'bg-blue-500/20 text-blue-400')
                  }
                >
                  {line.speaker === 'REP' ? 'R' : 'P'}
                </div>
                <div
                  className={
                    'flex max-w-[75%] flex-col gap-0.5 ' +
                    (line.speaker === 'REP' ? 'items-end' : 'items-start')
                  }
                >
                  <div
                    className={
                      'rounded-xl px-3 py-2 text-sm ' +
                      (line.speaker === 'REP'
                        ? 'rounded-tr-sm bg-slate-700 text-slate-200'
                        : 'rounded-tl-sm bg-slate-800 text-slate-300')
                    }
                  >
                    {line.text}
                  </div>
                  <span className="text-[10px] text-slate-600">{formatTime(line.tsMs)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
