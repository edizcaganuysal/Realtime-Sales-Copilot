'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ArrowLeft, MessageSquare, Brain, BarChart2, CheckSquare } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type CallData = {
  id: string;
  phoneTo: string;
  status: string;
  guidanceLevel: string;
  startedAt: string | null;
  endedAt: string | null;
  notes: string | null;
  playbookId: string | null;
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
  };
  checklistResultsJson: Record<string, boolean>;
} | null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(start: string | null, end: string | null) {
  if (!start) return '—';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.floor((e - s) / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function formatTime(tsMs: number) {
  return new Date(tsMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-800">
        <span className="text-slate-400">{icon}</span>
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function TalkRatioBar({ rep, prospect }: { rep: number; prospect: number }) {
  const repPct = Math.round(rep * 100);
  const prosPct = Math.round(prospect * 100);
  return (
    <div className="space-y-2">
      <div className="flex gap-2 h-3 rounded-full overflow-hidden">
        <div className="bg-emerald-500 rounded-l-full" style={{ width: `${repPct}%` }} />
        <div className="bg-blue-500 rounded-r-full" style={{ width: `${prosPct}%` }} />
      </div>
      <div className="flex gap-6 text-xs text-slate-400">
        <span><span className="text-emerald-400 font-medium">{repPct}%</span> Rep</span>
        <span><span className="text-blue-400 font-medium">{prosPct}%</span> Prospect</span>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const color =
    score >= 8 ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' :
    score >= 6 ? 'text-amber-400 border-amber-500/30 bg-amber-500/10' :
    'text-red-400 border-red-500/30 bg-red-500/10';
  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-semibold ${color}`}>
      {score}/10
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CallReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [call, setCall] = useState<CallData | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [summary, setSummary] = useState<SummaryData>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/calls/${id}`).then((r) => r.json()),
      fetch(`/api/calls/${id}/transcript`).then((r) => r.json()),
      fetch(`/api/calls/${id}/summary`).then((r) => r.json()),
    ]).then(([callData, txData, sumData]) => {
      setCall(callData);
      setTranscript(Array.isArray(txData) ? txData : []);
      setSummary(sumData ?? null);
      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return (
      <div className="p-8 space-y-4 max-w-4xl">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 bg-slate-900 border border-slate-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (!call) {
    return (
      <div className="p-8 text-slate-500 text-sm">Call not found.</div>
    );
  }

  const checklistEntries = summary ? Object.entries(summary.checklistResultsJson) : [];

  return (
    <div className="p-8 max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/app/calls"
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white transition-colors"
          >
            <ArrowLeft size={14} /> Back
          </Link>
          <span className="text-slate-700">|</span>
          <div>
            <h1 className="text-white font-semibold font-mono text-lg">{call.phoneTo}</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              {call.startedAt ? new Date(call.startedAt).toLocaleString() : '—'}
              {' · '}
              {formatDuration(call.startedAt, call.endedAt)}
              {call.notes && ` · ${call.notes}`}
            </p>
          </div>
        </div>
        {call.status === 'IN_PROGRESS' && (
          <Link
            href={`/app/calls/${id}/live`}
            className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
          >
            Rejoin live
          </Link>
        )}
      </div>

      {/* AI Summary + Coaching */}
      {summary ? (
        <>
          <Section title="AI Summary" icon={<Brain size={15} />}>
            <p className="text-slate-300 text-sm leading-relaxed mb-4">
              {summary.summaryJson.summary || 'No summary generated.'}
            </p>
            {summary.summaryJson.keyMoments.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Key moments</p>
                <ul className="space-y-1.5">
                  {summary.summaryJson.keyMoments.map((m, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
                      <span className="text-slate-600 mt-0.5">•</span> {m}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          <Section title="Coaching" icon={<BarChart2 size={15} />}>
            <div className="grid grid-cols-2 gap-6">
              {/* Left: metrics */}
              <div className="space-y-5">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Talk ratio</p>
                  <TalkRatioBar
                    rep={summary.coachingJson.talkRatio.rep}
                    prospect={summary.coachingJson.talkRatio.prospect}
                  />
                </div>
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Questions asked</p>
                    <p className="text-2xl font-bold text-white tabular-nums">
                      {summary.coachingJson.questionCount}
                    </p>
                  </div>
                  {summary.coachingJson.score !== null && (
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Score</p>
                      <ScoreBadge score={summary.coachingJson.score} />
                    </div>
                  )}
                </div>
              </div>

              {/* Right: strengths + improvements */}
              <div className="space-y-4">
                {summary.coachingJson.strengths.length > 0 && (
                  <div>
                    <p className="text-xs text-emerald-400 uppercase tracking-wider mb-2">Strengths</p>
                    <ul className="space-y-1">
                      {summary.coachingJson.strengths.map((s, i) => (
                        <li key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
                          <span className="text-emerald-500 mt-0.5">✓</span> {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {summary.coachingJson.improvements.length > 0 && (
                  <div>
                    <p className="text-xs text-amber-400 uppercase tracking-wider mb-2">Improvements</p>
                    <ul className="space-y-1">
                      {summary.coachingJson.improvements.map((imp, i) => (
                        <li key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
                          <span className="text-amber-500 mt-0.5">→</span> {imp}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </Section>

          {/* Checklist results (only if populated) */}
          {checklistEntries.length > 0 && (
            <Section title="Checklist Results" icon={<CheckSquare size={15} />}>
              <div className="space-y-2">
                {checklistEntries.map(([label, done]) => (
                  <div key={label} className="flex items-center gap-3">
                    <span
                      className={
                        'w-4 h-4 rounded border flex items-center justify-center shrink-0 text-[10px] ' +
                        (done
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                          : 'border-slate-600 text-slate-600')
                      }
                    >
                      {done ? '✓' : ''}
                    </span>
                    <span className={'text-sm ' + (done ? 'text-slate-400 line-through' : 'text-slate-300')}>
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-center">
          <Brain size={24} className="text-slate-700 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">
            {call.status === 'IN_PROGRESS'
              ? 'AI analysis is generated after the call ends.'
              : 'No AI analysis available — call may have been too short, or LLM is not configured.'}
          </p>
        </div>
      )}

      {/* Transcript */}
      <Section title={`Transcript (${transcript.length} lines)`} icon={<MessageSquare size={15} />}>
        {transcript.length === 0 ? (
          <p className="text-slate-600 text-sm text-center py-4">No transcript recorded for this call.</p>
        ) : (
          <div className="space-y-3">
            {transcript.map((line) => (
              <div
                key={line.id}
                className={'flex gap-3 ' + (line.speaker === 'REP' ? 'flex-row-reverse' : 'flex-row')}
              >
                <div
                  className={
                    'shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold ' +
                    (line.speaker === 'REP'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-blue-500/20 text-blue-400')
                  }
                >
                  {line.speaker === 'REP' ? 'R' : 'P'}
                </div>
                <div className={'max-w-[75%] ' + (line.speaker === 'REP' ? 'items-end' : 'items-start') + ' flex flex-col gap-0.5'}>
                  <div
                    className={
                      'px-3 py-2 rounded-xl text-sm ' +
                      (line.speaker === 'REP'
                        ? 'bg-slate-700 text-slate-200 rounded-tr-sm'
                        : 'bg-slate-800 text-slate-300 rounded-tl-sm')
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
