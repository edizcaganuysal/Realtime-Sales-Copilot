'use client';

import { useEffect, useRef, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { GuidanceLevel } from '@live-sales-coach/shared';
import {
  Phone,
  PhoneOff,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  AlignLeft,
  PhoneCall,
} from 'lucide-react';

const WS_URL = process.env['NEXT_PUBLIC_WS_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

// ─── Types ────────────────────────────────────────────────────────────────────

type CallData = {
  id: string;
  phoneTo: string;
  status: string;
  guidanceLevel: GuidanceLevel;
  layoutPreset: 'MINIMAL' | 'STANDARD' | 'TRANSCRIPT';
  startedAt: string | null;
};

type TranscriptLine = {
  speaker: string;
  text: string;
  tsMs: number;
  isFinal?: boolean;
};

type ChecklistItem = { label: string; done: boolean };

type NudgeType =
  | 'ASK_QUESTION'
  | 'ADDRESS_OBJECTION'
  | 'TOO_MUCH_TALKING'
  | 'MISSING_NEXT_STEP'
  | 'SOFTEN_TONE'
  | 'SLOW_DOWN'
  | 'CONFIRM_UNDERSTANDING';

const NUDGE_LABELS: Record<string, string> = {
  ASK_QUESTION: "Ask a question",
  ADDRESS_OBJECTION: 'Address objection',
  TOO_MUCH_TALKING: 'Too much talking',
  MISSING_NEXT_STEP: 'Missing next step',
  SOFTEN_TONE: 'Soften tone',
  SLOW_DOWN: 'Slow down',
  CONFIRM_UNDERSTANDING: 'Check understanding',
};

// ─── Timer ────────────────────────────────────────────────────────────────────

function useTimer(startedAt: string | null) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const base = Date.now() - new Date(startedAt).getTime();
    setElapsed(base);
    const id = setInterval(() => setElapsed(Date.now() - new Date(startedAt).getTime()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const s = Math.floor(elapsed / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function NudgeChips({ nudges }: { nudges: string[] }) {
  if (!nudges.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {nudges.map((n) => (
        <span
          key={n}
          className="text-xs px-2 py-1 rounded-full bg-amber-500/15 text-amber-400 font-medium border border-amber-500/20"
        >
          {NUDGE_LABELS[n] ?? n}
        </span>
      ))}
    </div>
  );
}

function SuggestionCard({
  text,
  onMore,
  loadingMore,
}: {
  text: string;
  onMore: () => void;
  loadingMore: boolean;
}) {
  return (
    <div className="bg-emerald-950/40 border border-emerald-500/20 rounded-xl p-4">
      <p className="text-xs text-emerald-400 font-medium uppercase tracking-wider mb-2">
        Suggestion
      </p>
      <p className="text-white text-sm leading-relaxed">{text}</p>
      <button
        onClick={onMore}
        disabled={loadingMore}
        className="mt-3 flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-40"
      >
        <RefreshCw size={11} className={loadingMore ? 'animate-spin' : ''} />
        {loadingMore ? 'Loading…' : 'More suggestions'}
      </button>
    </div>
  );
}

function TranscriptPanel({ lines }: { lines: TranscriptLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <div ref={ref} className="flex-1 overflow-y-auto space-y-2 text-sm">
      {lines.length === 0 ? (
        <p className="text-slate-600 text-xs text-center py-4">Transcript will appear here…</p>
      ) : (
        lines.map((l, i) => (
          <div key={i} className={l.speaker === 'REP' ? 'text-right' : 'text-left'}>
            <span
              className={
                'inline-block max-w-[85%] px-3 py-1.5 rounded-lg text-xs ' +
                (l.speaker === 'REP'
                  ? 'bg-slate-700 text-slate-200'
                  : 'bg-slate-800 text-slate-300')
              }
            >
              {l.text}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function Checklist({ items }: { items: ChecklistItem[] }) {
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className={
              'w-4 h-4 rounded border flex items-center justify-center shrink-0 text-[10px] ' +
              (item.done
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                : 'border-slate-600 text-slate-600')
            }
          >
            {item.done ? '✓' : ''}
          </span>
          <span className={'text-xs ' + (item.done ? 'text-slate-500 line-through' : 'text-slate-300')}>
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Layout: MINIMAL ─────────────────────────────────────────────────────────
// Big suggestion + nudge chips. Transcript in a slide-up drawer.

function MinimalLayout({
  suggestion,
  nudges,
  transcript,
  onMore,
  loadingMore,
}: {
  suggestion: string;
  nudges: string[];
  transcript: TranscriptLine[];
  onMore: () => void;
  loadingMore: boolean;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex-1 flex flex-col gap-4 p-6 relative overflow-hidden">
      {suggestion ? (
        <SuggestionCard text={suggestion} onMore={onMore} loadingMore={loadingMore} />
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
          <p className="text-slate-600 text-sm">Waiting for first suggestion…</p>
        </div>
      )}

      <NudgeChips nudges={nudges} />

      {/* Transcript drawer */}
      <div
        className={
          'absolute inset-x-0 bottom-0 bg-slate-950 border-t border-slate-800 transition-all duration-300 ' +
          (drawerOpen ? 'h-64' : 'h-12')
        }
      >
        <button
          onClick={() => setDrawerOpen((o) => !o)}
          className="w-full h-12 flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-white transition-colors"
        >
          <AlignLeft size={13} />
          Transcript
          {drawerOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
        {drawerOpen && (
          <div className="px-4 pb-4 h-52 flex flex-col">
            <TranscriptPanel lines={transcript} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Layout: STANDARD ────────────────────────────────────────────────────────
// Stage pill + suggestion + nudges. Checklist collapsible for GUIDED.

function StandardLayout({
  suggestion,
  nudges,
  stageName,
  checklist,
  guidanceLevel,
  onMore,
  loadingMore,
}: {
  suggestion: string;
  nudges: string[];
  stageName: string;
  checklist: ChecklistItem[];
  guidanceLevel: GuidanceLevel;
  onMore: () => void;
  loadingMore: boolean;
}) {
  const [checklistOpen, setChecklistOpen] = useState(false);

  return (
    <div className="flex-1 flex flex-col gap-4 p-6">
      {/* Stage pill */}
      {stageName && (
        <div className="flex items-center gap-2">
          <span className="text-xs px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/20 font-medium">
            {stageName}
          </span>
        </div>
      )}

      {/* Main suggestion */}
      {suggestion ? (
        <SuggestionCard text={suggestion} onMore={onMore} loadingMore={loadingMore} />
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
          <p className="text-slate-600 text-sm">Listening…</p>
        </div>
      )}

      {/* Nudges */}
      <NudgeChips nudges={nudges} />

      {/* Collapsible checklist for GUIDED */}
      {guidanceLevel === GuidanceLevel.GUIDED && checklist.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <button
            onClick={() => setChecklistOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <span className="font-medium">
              Checklist ({checklist.filter((i) => i.done).length}/{checklist.length})
            </span>
            {checklistOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {checklistOpen && (
            <div className="px-4 pb-4">
              <Checklist items={checklist} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Layout: TRANSCRIPT ───────────────────────────────────────────────────────
// Transcript center + floating suggestion card (no separate suggestion column).

function TranscriptLayout({
  suggestion,
  transcript,
  stageName,
  onMore,
  loadingMore,
}: {
  suggestion: string;
  transcript: TranscriptLine[];
  stageName: string;
  onMore: () => void;
  loadingMore: boolean;
}) {
  return (
    <div className="flex-1 flex flex-col gap-4 p-6 min-h-0">
      {stageName && (
        <div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/20 font-medium">
            {stageName}
          </span>
        </div>
      )}

      {/* Transcript takes the center */}
      <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col min-h-0">
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">Transcript</p>
        <TranscriptPanel lines={transcript} />
      </div>

      {/* Floating suggestion — compact, not full-width suggestion block */}
      {suggestion && (
        <div className="bg-emerald-950/40 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-start justify-between gap-4">
          <p className="text-sm text-white leading-relaxed flex-1">{suggestion}</p>
          <button
            onClick={onMore}
            disabled={loadingMore}
            className="shrink-0 text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-40 mt-0.5"
            title="More suggestions"
          >
            <RefreshCw size={12} className={loadingMore ? 'animate-spin' : ''} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LiveCallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [call, setCall] = useState<CallData | null>(null);
  const [callStatus, setCallStatus] = useState<string>('INITIATED');
  const [connected, setConnected] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [suggestion, setSuggestion] = useState('');
  const [nudges, setNudges] = useState<string[]>([]);
  const [stageName, setStageName] = useState('Opening');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [ending, setEnding] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const timer = useTimer(call?.startedAt ?? null);

  // Fetch call data
  useEffect(() => {
    fetch(`/api/calls/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setCall(d);
        setCallStatus(d.status ?? 'INITIATED');
      });
  }, [id]);

  // WebSocket connection
  useEffect(() => {
    const socket = io(`${WS_URL}/calls`, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join', id);
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('transcript.partial', (data: TranscriptLine) => {
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        if (last && !last.isFinal && last.speaker === data.speaker) {
          return [...prev.slice(0, -1), data];
        }
        return [...prev, data];
      });
    });

    socket.on('transcript.final', (data: TranscriptLine) => {
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        if (last && !last.isFinal && last.speaker === data.speaker) {
          return [...prev.slice(0, -1), { ...data, isFinal: true }];
        }
        return [...prev, { ...data, isFinal: true }];
      });
    });

    socket.on('engine.stage', (data: { stageName: string }) => {
      setStageName(data.stageName);
    });

    socket.on('engine.primary_suggestion', (data: { text: string }) => {
      setSuggestion(data.text);
    });

    socket.on('engine.nudges', (data: { nudges: string[] }) => {
      setNudges(data.nudges);
    });

    socket.on('engine.checklist', (data: { items: ChecklistItem[] }) => {
      setChecklist(data.items);
    });

    socket.on('call.status', (data: { status: string; startedAt: string | null }) => {
      setCallStatus(data.status);
      if (data.startedAt) {
        setCall((prev) => prev ? { ...prev, status: data.status, startedAt: data.startedAt } : prev);
      } else {
        setCall((prev) => prev ? { ...prev, status: data.status } : prev);
      }
    });

    return () => {
      socket.emit('leave', id);
      socket.disconnect();
    };
  }, [id]);

  async function handleEnd() {
    setEnding(true);
    socketRef.current?.emit('leave', id);
    await fetch(`/api/calls/${id}/end`, { method: 'POST' });
    router.push('/app/calls');
  }

  async function handleMore() {
    setLoadingMore(true);
    await fetch(`/api/calls/${id}/suggestions/more`, { method: 'POST' });
    setLoadingMore(false);
  }

  if (!call) {
    return (
      <div className="p-8 space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 bg-slate-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  const layout = call.layoutPreset ?? 'STANDARD';

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Top bar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-slate-900">
        <div className="flex items-center gap-3">
          <div
            className={
              'w-2 h-2 rounded-full ' + (connected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600')
            }
          />
          <span className="text-white font-mono text-sm">{call.phoneTo}</span>
          <span className="text-slate-500 text-xs tabular-nums">{timer}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-600 uppercase tracking-wider">{layout}</span>
          <button
            onClick={handleEnd}
            disabled={ending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <PhoneOff size={13} />
            {ending ? 'Ending…' : 'End call'}
          </button>
        </div>
      </div>

      {/* Connecting overlay — shown while call is not yet answered */}
      {callStatus === 'INITIATED' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 bg-slate-950">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center">
              <PhoneCall size={32} className="text-emerald-400" />
            </div>
            <span className="absolute inset-0 rounded-full border-2 border-emerald-400/40 animate-ping" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-white font-medium text-lg">Calling {call.phoneTo}…</p>
            <p className="text-slate-500 text-sm">Ringing — waiting for prospect to answer</p>
          </div>
          <button
            onClick={handleEnd}
            disabled={ending}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <PhoneOff size={15} />
            {ending ? 'Ending…' : 'Cancel call'}
          </button>
        </div>
      )}

      {/* Layout body — only when call is active */}
      {callStatus !== 'INITIATED' && layout === 'MINIMAL' && (
        <MinimalLayout
          suggestion={suggestion}
          nudges={nudges}
          transcript={transcript}
          onMore={handleMore}
          loadingMore={loadingMore}
        />
      )}

      {callStatus !== 'INITIATED' && layout === 'STANDARD' && (
        <StandardLayout
          suggestion={suggestion}
          nudges={nudges}
          stageName={stageName}
          checklist={checklist}
          guidanceLevel={call.guidanceLevel}
          onMore={handleMore}
          loadingMore={loadingMore}
        />
      )}

      {callStatus !== 'INITIATED' && layout === 'TRANSCRIPT' && (
        <TranscriptLayout
          suggestion={suggestion}
          transcript={transcript}
          stageName={stageName}
          onMore={handleMore}
          loadingMore={loadingMore}
        />
      )}
    </div>
  );
}
