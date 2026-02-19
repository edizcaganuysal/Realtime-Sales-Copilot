'use client';

import { useEffect, useRef, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  PhoneOff,
  PhoneCall,
  Mic,
  MicOff,
  Bot,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  Zap,
  MessageSquare,
  Volume2,
} from 'lucide-react';

const WS_URL = process.env['NEXT_PUBLIC_WS_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
const API_WS_URL = WS_URL.replace(/^http/, 'ws');

// ─── Types ────────────────────────────────────────────────────────────────────

type CallData = {
  id: string;
  phoneTo: string;
  mode: string;
  status: string;
  startedAt: string | null;
};

type TranscriptLine = { speaker: string; text: string; tsMs: number; isFinal?: boolean; _seq?: number };

type CallStats = {
  repTurns: number;
  prospectTurns: number;
  repQuestions: number;
  repWords: number;
  prospectWords: number;
  objectionDetected: string | null;
  sentiment: 'positive' | 'neutral' | 'negative';
  talkRatioRep: number;
};

type Nudge = {
  id: string;
  text: string;
  severity: 'info' | 'warn' | 'alert';
  icon: 'pace' | 'talk' | 'question' | 'objection' | 'tone' | 'confirm';
};

type ContextCard = {
  text: string;
  objection: string | null;
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

// ─── Mock call audio hook ────────────────────────────────────────────────────

function useMockAudio(callId: string, isMock: boolean, isActive: boolean) {
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const [micActive, setMicActive] = useState(false);
  const [mockReady, setMockReady] = useState(false);

  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);

  const playNextChunk = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }
    isPlayingRef.current = true;
    const chunk = audioQueueRef.current.shift()!;
    const buffer = ctx.createBuffer(1, chunk.length, 24000);
    buffer.copyToChannel(new Float32Array(chunk), 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => playNextChunk();
    source.start();
  }, []);

  const enqueueAudio = useCallback((base64: string) => {
    const bytes = atob(base64);
    const samples = new Int16Array(bytes.length / 2);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8);
    }
    const float32 = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      float32[i] = samples[i]! / 32768;
    }
    audioQueueRef.current.push(float32);
    if (!isPlayingRef.current) playNextChunk();
  }, [playNextChunk]);

  useEffect(() => {
    if (!isMock || !isActive) return;

    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { sampleRate: 24000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        setMicActive(true);

        const ctx = new AudioContext({ sampleRate: 24000 });
        ctxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        const ws = new WebSocket(`${API_WS_URL}/mock-stream?callId=${callId}`);
        wsRef.current = ws;

        ws.onopen = () => {
          source.connect(processor);
          processor.connect(ctx.destination);
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string);
            if (msg.type === 'ready') {
              setMockReady(true);
            } else if (msg.type === 'audio') {
              enqueueAudio(msg.data);
            } else if (msg.type === 'error') {
              console.error('Mock stream error:', msg.message);
            }
          } catch { /* ignore */ }
        };

        ws.onerror = () => console.error('Mock stream WS error');
        ws.onclose = () => setMockReady(false);

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const input = e.inputBuffer.getChannelData(0);
          const pcm16 = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]!));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          const u8 = new Uint8Array(pcm16.buffer);
          let binary = '';
          for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]!);
          ws.send(JSON.stringify({ type: 'audio', data: btoa(binary) }));
        };
      } catch (err) {
        console.error('Failed to start mock audio:', err);
        setMicActive(false);
      }
    }

    start();

    return () => {
      cancelled = true;
      processorRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      ctxRef.current?.close();
      wsRef.current?.close();
      audioQueueRef.current = [];
      isPlayingRef.current = false;
      setMicActive(false);
      setMockReady(false);
    };
  }, [isMock, isActive, callId, enqueueAudio]);

  return { micActive, mockReady };
}

// ─── Nudge helpers ───────────────────────────────────────────────────────────

const NUDGE_CONFIG: Record<string, { text: string; severity: Nudge['severity']; icon: Nudge['icon'] }> = {
  ASK_QUESTION: { text: 'Ask a question', severity: 'info', icon: 'question' },
  ADDRESS_OBJECTION: { text: 'Address objection', severity: 'alert', icon: 'objection' },
  TOO_MUCH_TALKING: { text: 'You\'re talking too much — ask a question', severity: 'warn', icon: 'talk' },
  MISSING_NEXT_STEP: { text: 'Propose a next step', severity: 'warn', icon: 'confirm' },
  SOFTEN_TONE: { text: 'Soften your tone', severity: 'warn', icon: 'tone' },
  SLOW_DOWN: { text: 'Slow down', severity: 'info', icon: 'pace' },
  CONFIRM_UNDERSTANDING: { text: 'Confirm understanding', severity: 'info', icon: 'confirm' },
};

function parseNudges(raw: string[], stats: CallStats): Nudge[] {
  const nudges: Nudge[] = [];

  // Always add talk ratio nudge if too high
  if (stats.talkRatioRep > 65 && stats.repTurns + stats.prospectTurns > 2) {
    nudges.push({
      id: 'talk_ratio',
      text: `You're at ${stats.talkRatioRep}% talk time — let them speak`,
      severity: stats.talkRatioRep > 75 ? 'alert' : 'warn',
      icon: 'talk',
    });
  }

  // Add LLM-suggested nudges
  for (const key of raw) {
    const cfg = NUDGE_CONFIG[key];
    if (cfg && !nudges.some((n) => n.icon === cfg.icon)) {
      nudges.push({ id: key, ...cfg });
    }
  }

  return nudges.slice(0, 3);
}

function NudgeIcon({ icon }: { icon: Nudge['icon'] }) {
  const size = 13;
  switch (icon) {
    case 'pace': return <Zap size={size} />;
    case 'talk': return <Volume2 size={size} />;
    case 'question': return <MessageSquare size={size} />;
    case 'objection': return <AlertTriangle size={size} />;
    case 'tone': return <Volume2 size={size} />;
    case 'confirm': return <MessageSquare size={size} />;
    default: return <Zap size={size} />;
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function NextLineCard({
  suggestion,
  prospectSpeaking,
  onSwap,
}: {
  suggestion: string | null;
  prospectSpeaking: boolean;
  onSwap: () => void;
}) {
  if (prospectSpeaking) {
    return (
      <div className="bg-slate-900/80 border border-slate-700/50 rounded-2xl p-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-emerald-400 text-xs font-medium uppercase tracking-widest">Prospect speaking</span>
        </div>
        <p className="text-slate-500 text-sm">Listening...</p>
      </div>
    );
  }

  if (!suggestion) {
    return (
      <div className="bg-slate-900/80 border border-slate-700/50 rounded-2xl p-6 text-center">
        <p className="text-slate-600 text-sm">Waiting for conversation to start...</p>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-emerald-950/60 to-slate-900/80 border border-emerald-500/30 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-emerald-400 text-[11px] font-semibold uppercase tracking-widest">Say this</span>
        <button
          onClick={onSwap}
          className="text-[10px] text-slate-500 hover:text-slate-300 px-2 py-0.5 rounded border border-slate-700 hover:border-slate-500 transition-colors"
        >
          Swap
        </button>
      </div>
      <p className="text-white text-base leading-relaxed font-medium">{suggestion}</p>
    </div>
  );
}

function MicroNudges({ nudges }: { nudges: Nudge[] }) {
  if (nudges.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {nudges.map((nudge) => (
        <div
          key={nudge.id}
          className={`
            flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium
            ${nudge.severity === 'alert'
              ? 'bg-red-950/60 text-red-400 border border-red-500/30'
              : nudge.severity === 'warn'
                ? 'bg-amber-950/60 text-amber-400 border border-amber-500/30'
                : 'bg-slate-800/60 text-slate-400 border border-slate-700/50'
            }
          `}
        >
          <NudgeIcon icon={nudge.icon} />
          {nudge.text}
        </div>
      ))}
    </div>
  );
}

function ContextCards({ cards, objection }: { cards: string[]; objection: string | null }) {
  if (cards.length === 0 && !objection) return null;

  const objectionLabels: Record<string, { label: string; tip: string }> = {
    BUDGET: { label: 'Pricing objection', tip: 'Acknowledge cost, then quantify value or offer a smaller pilot.' },
    COMPETITOR: { label: 'Competitor raised', tip: 'Ask what works and what doesn\'t, then differentiate on specifics.' },
    TIMING: { label: 'Timing concern', tip: 'Align to their timeline. Offer a low-commitment next step.' },
    NO_NEED: { label: 'No-need objection', tip: 'Ask one diagnostic question to uncover a hidden pain point.' },
    AUTHORITY: { label: 'Authority blocker', tip: 'Help them build an internal case. Offer materials they can share.' },
  };

  const obj = objection ? objectionLabels[objection] : null;

  return (
    <div className="space-y-2">
      {obj && (
        <div className="px-4 py-3 rounded-xl bg-amber-950/40 border border-amber-500/25">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle size={14} className="text-amber-400 shrink-0" />
            <span className="text-amber-300 text-sm font-semibold">{obj.label}</span>
          </div>
          <p className="text-amber-200/70 text-sm leading-relaxed">{obj.tip}</p>
        </div>
      )}
      <div className="flex items-start gap-1.5 flex-wrap">
        <span className="text-[10px] text-slate-600 uppercase tracking-widest font-medium mt-1 mr-1">Data you can use:</span>
      </div>
      <div className="grid gap-2">
        {cards.map((card, i) => (
          <div key={i} className="px-4 py-2.5 rounded-xl bg-slate-800/50 border border-slate-700/40">
            <p className="text-slate-300 text-sm leading-relaxed">{card}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniStats({ stats }: { stats: CallStats }) {
  const repPct = Math.max(0, Math.min(100, stats.talkRatioRep));
  return (
    <div className="flex items-center gap-3 text-[10px] text-slate-500">
      <span>Talk {repPct}%/{100 - repPct}%</span>
      <span className="text-slate-700">|</span>
      <span>Qs: {stats.repQuestions}</span>
      <span className="text-slate-700">|</span>
      <span className={stats.sentiment === 'positive' ? 'text-emerald-500' : stats.sentiment === 'negative' ? 'text-red-400' : ''}>
        {stats.sentiment === 'positive' ? 'Positive' : stats.sentiment === 'negative' ? 'Negative' : 'Neutral'}
      </span>
    </div>
  );
}

function TranscriptDrawer({ lines, isOpen, onToggle }: {
  lines: TranscriptLine[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  const lastTwo = lines.slice(-4);

  return (
    <div className="border-t border-slate-800 bg-slate-900/50">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="uppercase tracking-wider font-medium">Transcript</span>
          {!isOpen && lastTwo.length > 0 && (
            <span className="text-slate-600 truncate max-w-[300px]">
              {lastTwo[lastTwo.length - 1]?.speaker}: {lastTwo[lastTwo.length - 1]?.text.slice(0, 60)}...
            </span>
          )}
        </div>
        {isOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
      </button>

      {isOpen && (
        <div ref={ref} className="max-h-60 overflow-y-auto px-4 pb-3 space-y-2">
          {lines.length === 0 ? (
            <p className="text-slate-700 text-xs text-center py-2">Transcript will appear here...</p>
          ) : (
            lines.map((l, i) => (
              <div key={`${l._seq ?? i}-${l.tsMs}`} className="flex gap-2">
                <span className={`text-[10px] font-mono shrink-0 w-16 pt-0.5 ${
                  l.speaker === 'REP' ? 'text-blue-400' : 'text-slate-500'
                }`}>
                  {l.speaker === 'REP' ? 'YOU' : 'THEM'}
                </span>
                <span className="text-xs text-slate-300 leading-relaxed">{l.text}</span>
              </div>
            ))
          )}
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
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [contextCards, setContextCards] = useState<string[]>([]);
  const [objection, setObjection] = useState<string | null>(null);
  const [stats, setStats] = useState<CallStats>({
    repTurns: 0, prospectTurns: 0, repQuestions: 0, repWords: 0, prospectWords: 0,
    objectionDetected: null, sentiment: 'neutral', talkRatioRep: 50,
  });
  const [prospectSpeaking, setProspectSpeaking] = useState(false);
  const [ending, setEnding] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const seqRef = useRef(0);
  const prospectSpeakingRef = useRef(false);
  const hasProspectTurnRef = useRef(false);
  const pendingSuggestionRef = useRef<string | null>(null);
  const suggestionTurnRef = useRef(0);
  const shownSuggestionTurnRef = useRef<number | null>(null);
  const lastSuggestionAtRef = useRef(0);
  const fallbackReqInFlightRef = useRef(false);
  const timer = useTimer(call?.startedAt ?? null);

  const isMock = call?.mode === 'MOCK';
  const isActive = callStatus !== 'INITIATED';

  const { micActive, mockReady } = useMockAudio(id, isMock, isActive);

  const requestSuggestionFallback = useCallback(async () => {
    if (!hasProspectTurnRef.current) return;
    if (fallbackReqInFlightRef.current) return;
    fallbackReqInFlightRef.current = true;
    try {
      await fetch(`/api/calls/${id}/suggestions/more`, { method: 'POST' });
    } catch { /* ignore */ } finally {
      fallbackReqInFlightRef.current = false;
    }
  }, [id]);

  const handleSwap = useCallback(async () => {
    try {
      await fetch(`/api/calls/${id}/suggestions/more`, { method: 'POST' });
    } catch { /* ignore */ }
  }, [id]);

  // Fetch call data
  useEffect(() => {
    fetch(`/api/calls/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setCall(d);
        setCallStatus(d.status ?? 'INITIATED');
      });
  }, [id]);

  // Socket.io for coaching events
  useEffect(() => {
    const socket = io(`${WS_URL}/calls`, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join', id);
    });
    socket.on('disconnect', () => setConnected(false));

    // Partial transcript — just show "prospect speaking" state
    socket.on('transcript.partial', (data: TranscriptLine) => {
      if (data.speaker === 'PROSPECT') {
        setProspectSpeaking(true);
        prospectSpeakingRef.current = true;
        setSuggestion(null);
      }
    });

    // Final transcript — add to transcript list
    socket.on('transcript.final', (data: TranscriptLine) => {
      setTranscript((prev) => {
        const seq = ++seqRef.current;
        return [...prev, { ...data, isFinal: true, _seq: seq }];
      });

      if (data.speaker === 'PROSPECT') {
        hasProspectTurnRef.current = true;
        setProspectSpeaking(false);
        prospectSpeakingRef.current = false;
        suggestionTurnRef.current += 1;
        shownSuggestionTurnRef.current = null;

        // Show pending suggestion if we have one
        if (pendingSuggestionRef.current) {
          const next = pendingSuggestionRef.current;
          pendingSuggestionRef.current = null;
          if (shownSuggestionTurnRef.current !== suggestionTurnRef.current) {
            setSuggestion(next);
            shownSuggestionTurnRef.current = suggestionTurnRef.current;
            lastSuggestionAtRef.current = Date.now();
          }
        }

        // Fallback request if no suggestion came quickly
        setTimeout(() => {
          if (
            !prospectSpeakingRef.current &&
            shownSuggestionTurnRef.current !== suggestionTurnRef.current &&
            Date.now() - lastSuggestionAtRef.current > 700
          ) {
            void requestSuggestionFallback();
          }
        }, 750);
      }
    });

    // Primary suggestion from engine
    socket.on('engine.suggestions', (data: { suggestions: string[] }) => {
      if (!hasProspectTurnRef.current) {
        // Opening suggestion — always show
        const first = data.suggestions?.[0];
        if (first) setSuggestion(first);
        return;
      }
      const next = (data.suggestions ?? []).filter(Boolean);
      if (next.length === 0) return;

      if (prospectSpeakingRef.current) {
        pendingSuggestionRef.current = next[0]!;
        return;
      }
      if (shownSuggestionTurnRef.current === suggestionTurnRef.current) return;

      lastSuggestionAtRef.current = Date.now();
      setSuggestion(next[0]!);
      shownSuggestionTurnRef.current = suggestionTurnRef.current;
    });

    socket.on('engine.primary_suggestion', (data: { text: string }) => {
      if (!hasProspectTurnRef.current) {
        if (data.text) setSuggestion(data.text);
        return;
      }
      if (!data.text) return;
      if (prospectSpeakingRef.current) {
        pendingSuggestionRef.current = data.text;
        return;
      }
      if (shownSuggestionTurnRef.current === suggestionTurnRef.current) return;

      lastSuggestionAtRef.current = Date.now();
      setSuggestion(data.text);
      shownSuggestionTurnRef.current = suggestionTurnRef.current;
    });

    // Nudges from engine
    socket.on('engine.nudges', (data: { nudges: string[] }) => {
      setStats((prev) => {
        setNudges(parseNudges(data.nudges ?? [], prev));
        return prev;
      });
    });

    // Context cards
    socket.on('engine.context_cards', (data: { cards: string[]; objection: string | null }) => {
      setContextCards(data.cards ?? []);
      setObjection(data.objection);
    });

    // Stats
    socket.on('engine.stats', (data: { stats: CallStats }) => setStats(data.stats));

    // Prospect speaking signal
    socket.on('engine.prospect_speaking', (data: { speaking: boolean }) => {
      setProspectSpeaking(data.speaking);
      prospectSpeakingRef.current = data.speaking;
      if (data.speaking) {
        setSuggestion(null);
        return;
      }
      if (pendingSuggestionRef.current) {
        const next = pendingSuggestionRef.current;
        pendingSuggestionRef.current = null;
        if (shownSuggestionTurnRef.current !== suggestionTurnRef.current) {
          setSuggestion(next);
          shownSuggestionTurnRef.current = suggestionTurnRef.current;
          lastSuggestionAtRef.current = Date.now();
        }
      }
    });

    // Call status updates
    socket.on('call.status', (data: { status: string; startedAt: string | null }) => {
      setCallStatus(data.status);
      if (data.startedAt) {
        setCall((prev) => prev ? { ...prev, status: data.status, startedAt: data.startedAt } : prev);
      } else {
        setCall((prev) => prev ? { ...prev, status: data.status } : prev);
      }
    });

    return () => { socket.emit('leave', id); socket.disconnect(); };
  }, [id, requestSuggestionFallback]);

  async function handleEnd() {
    setEnding(true);
    socketRef.current?.emit('leave', id);
    await fetch(`/api/calls/${id}/end`, { method: 'POST' });
    router.push('/app/calls');
  }

  // Loading state
  if (!call) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-950">
        <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* ─── Top bar ─────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between px-5 py-2 border-b border-slate-800/60 bg-slate-950">
        <div className="flex items-center gap-3">
          <div className={'w-2 h-2 rounded-full ' + (connected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600')} />
          {isMock ? (
            <span className="flex items-center gap-1.5 text-violet-400 font-mono text-sm"><Bot size={14} /> Practice</span>
          ) : (
            <span className="text-white font-mono text-sm">{call.phoneTo}</span>
          )}
          <span className="text-slate-600 text-xs tabular-nums">{timer}</span>
          {isMock && (
            <span className={`flex items-center gap-1 text-xs ${micActive ? 'text-emerald-400' : 'text-red-400'}`}>
              {micActive ? <Mic size={12} /> : <MicOff size={12} />}
              {micActive ? (mockReady ? 'Live' : 'Connecting...') : 'No mic'}
            </span>
          )}
          <MiniStats stats={stats} />
        </div>
        <button
          onClick={handleEnd}
          disabled={ending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <PhoneOff size={13} />
          {ending ? 'Ending...' : 'End'}
        </button>
      </div>

      {/* ─── Connecting overlay (outbound only) ──────────────────────── */}
      {callStatus === 'INITIATED' && !isMock && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 bg-slate-950">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center">
              <PhoneCall size={32} className="text-emerald-400" />
            </div>
            <span className="absolute inset-0 rounded-full border-2 border-emerald-400/40 animate-ping" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-white font-medium text-lg">Calling {call.phoneTo}...</p>
            <p className="text-slate-500 text-sm">Ringing</p>
          </div>
          <button onClick={handleEnd} disabled={ending}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            <PhoneOff size={15} />
            {ending ? 'Ending...' : 'Cancel'}
          </button>
        </div>
      )}

      {/* ─── Main coaching area ──────────────────────────────────────── */}
      {(isActive || isMock) && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Center: coaching content */}
          <div className="flex-1 flex flex-col items-center justify-center px-4 py-6 gap-4 overflow-y-auto">
            {/* Primary suggestion card */}
            <div className="w-full max-w-xl">
              <NextLineCard
                suggestion={suggestion}
                prospectSpeaking={prospectSpeaking}
                onSwap={handleSwap}
              />
            </div>

            {/* Micro-nudges */}
            <div className="w-full max-w-xl">
              <MicroNudges nudges={nudges} />
            </div>

            {/* Context cards (collapsed rail) */}
            {(contextCards.length > 0 || objection) && (
              <div className="w-full max-w-xl">
                <ContextCards cards={contextCards} objection={objection} />
              </div>
            )}
          </div>

          {/* Bottom: transcript drawer */}
          <TranscriptDrawer
            lines={transcript}
            isOpen={transcriptOpen}
            onToggle={() => setTranscriptOpen((o) => !o)}
          />
        </div>
      )}
    </div>
  );
}
