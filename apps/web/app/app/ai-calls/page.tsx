'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Bot, Phone, PhoneOff, Clock, Volume2, Square } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { INPUT_BASE } from '@/components/ui/form-field';
import { AI_CALLER_VOICES, AI_CALLER_MODELS, type AiCallerVoice, type AiCallerModel } from '@live-sales-coach/shared';

const WS_URL =
  process.env['NEXT_PUBLIC_WS_URL'] ??
  process.env['NEXT_PUBLIC_API_URL'] ??
  'http://localhost:3001';

type Agent = { id: string; name: string };

type TranscriptLine = {
  speaker: 'REP' | 'PROSPECT';
  text: string;
  tsMs: number;
  isFinal: boolean;
};

type CallStatus = 'idle' | 'connecting' | 'in_progress' | 'ended' | 'failed';

const VOICE_INFO: Record<AiCallerVoice, { label: string; desc: string }> = {
  marin: { label: 'Marin', desc: 'Professional, clear' },
  cedar: { label: 'Cedar', desc: 'Natural, conversational' },
  ash: { label: 'Ash', desc: 'Confident, direct' },
  ballad: { label: 'Ballad', desc: 'Warm, expressive' },
  coral: { label: 'Coral', desc: 'Warm, friendly' },
  sage: { label: 'Sage', desc: 'Calm, balanced' },
  verse: { label: 'Verse', desc: 'Energetic, bright' },
  alloy: { label: 'Alloy', desc: 'Neutral, versatile' },
  echo: { label: 'Echo', desc: 'Deep, resonant' },
  shimmer: { label: 'Shimmer', desc: 'Clear, articulate' },
};

const AI_MODEL_LABELS: Record<AiCallerModel, string> = {
  'gpt-4o-mini-realtime-preview': 'GPT-4o Mini Realtime (Faster, lower cost)',
  'gpt-4o-realtime-preview': 'GPT-4o Realtime (Higher quality)',
};

function useElapsed(startedAt: number | null) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) { setElapsed(0); return; }
    setElapsed(Date.now() - startedAt);
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const s = Math.floor(elapsed / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function AiCallsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [phoneTo, setPhoneTo] = useState('');
  const [agentId, setAgentId] = useState('');
  const [aiVoice, setAiVoice] = useState<AiCallerVoice>('marin');
  const [aiModel, setAiModel] = useState<AiCallerModel>('gpt-4o-mini-realtime-preview');
  const [status, setStatus] = useState<CallStatus>('idle');
  const [callId, setCallId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [partial, setPartial] = useState<{ speaker: 'REP' | 'PROSPECT'; text: string } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const elapsed = useElapsed(startedAt);

  useEffect(() => {
    fetch('/api/agents', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setAgents(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, partial]);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
    };
  }, []);

  async function previewVoice(voice: string) {
    // Stop any currently playing preview
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }

    if (previewingVoice === voice) {
      setPreviewingVoice(null);
      return;
    }

    setPreviewingVoice(voice);
    try {
      const res = await fetch(`/api/calls/voice-preview?voice=${encodeURIComponent(voice)}`);
      if (!res.ok) {
        setPreviewingVoice(null);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        setPreviewingVoice(null);
        previewAudioRef.current = null;
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setPreviewingVoice(null);
        previewAudioRef.current = null;
        URL.revokeObjectURL(url);
      };
      await audio.play();
    } catch {
      setPreviewingVoice(null);
    }
  }

  function connectSocket(cId: string) {
    const socket = io(WS_URL, {
      transports: ['websocket'],
      path: '/socket.io',
    });

    socket.emit('join:call', cId);

    socket.on('transcript.final', (data: TranscriptLine) => {
      setTranscript((prev) => [...prev, { ...data, isFinal: true }]);
      setPartial(null);
    });

    socket.on('transcript.partial', (data: { speaker: 'REP' | 'PROSPECT'; text: string }) => {
      setPartial(data);
    });

    socket.on('call.status', (data: { status: string; startedAt?: string }) => {
      if (data.status === 'IN_PROGRESS') {
        setStatus('in_progress');
        setStartedAt(data.startedAt ? new Date(data.startedAt).getTime() : Date.now());
      } else if (data.status === 'COMPLETED' || data.status === 'FAILED') {
        setStatus(data.status === 'COMPLETED' ? 'ended' : 'failed');
        setPartial(null);
      }
    });

    socket.on('call.ended', () => {
      setStatus('ended');
      setPartial(null);
    });

    socketRef.current = socket;
  }

  async function handleStart() {
    if (!phoneTo.trim()) { setError('Enter a phone number.'); return; }
    setError('');
    setStatus('connecting');
    setTranscript([]);
    setPartial(null);
    setStartedAt(null);

    const body: Record<string, unknown> = {
      mode: 'AI_CALLER',
      phoneTo: phoneTo.trim(),
      ai_voice: aiVoice,
      ai_model: aiModel,
    };
    if (agentId) body.agentId = agentId;

    const res = await fetch('/api/calls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Failed to start call'));
      setStatus('idle');
      return;
    }

    const cId = data.id as string;
    setCallId(cId);
    connectSocket(cId);
  }

  async function handleEnd() {
    if (!callId) return;
    socketRef.current?.disconnect();
    socketRef.current = null;
    await fetch(`/api/calls/${callId}/end`, { method: 'POST' }).catch(() => {});
    setStatus('ended');
    setPartial(null);
  }

  const isActive = status === 'connecting' || status === 'in_progress';
  const isDone = status === 'ended' || status === 'failed';

  const statusLabel: Record<CallStatus, string> = {
    idle: '',
    connecting: 'Placing call…',
    in_progress: 'In progress',
    ended: 'Call ended',
    failed: 'Call failed',
  };

  const statusColor: Record<CallStatus, string> = {
    idle: 'text-slate-400',
    connecting: 'text-amber-400',
    in_progress: 'text-emerald-400',
    ended: 'text-slate-400',
    failed: 'text-red-400',
  };

  return (
    <div className="p-8 max-w-3xl">
      <PageHeader
        title="AI Calls"
        description="Let the AI make the call for you. It dials the prospect, conducts the conversation as your sales rep, and you watch the live transcript."
      />

      {/* Setup form */}
      {!isActive && !isDone && (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-5">
          <div>
            <label className="mb-1.5 block text-xs text-slate-400">Phone number</label>
            <input
              className={INPUT_BASE}
              type="tel"
              placeholder="+1 555 000 0000"
              value={phoneTo}
              onChange={(e) => setPhoneTo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleStart(); }}
            />
          </div>

          {/* Voice selection */}
          <div>
            <label className="mb-2 block text-xs text-slate-400">Voice</label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {AI_CALLER_VOICES.map((v) => {
                const info = VOICE_INFO[v];
                const isSelected = aiVoice === v;
                const isPreviewing = previewingVoice === v;
                return (
                  <div
                    key={v}
                    className={`relative rounded-lg border text-center transition-all cursor-pointer ${
                      isSelected
                        ? 'border-sky-500/50 bg-sky-500/10 ring-1 ring-sky-500/20'
                        : 'border-slate-700 bg-slate-800/60 hover:border-slate-500'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setAiVoice(v)}
                      className="w-full px-2 pt-2.5 pb-1"
                    >
                      <span className={`text-xs font-medium block ${isSelected ? 'text-sky-300' : 'text-white'}`}>
                        {info.label}
                      </span>
                      <span className="text-[10px] text-slate-500 block mt-0.5">{info.desc}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void previewVoice(v)}
                      className={`w-full flex items-center justify-center gap-1 py-1.5 text-[10px] transition-colors border-t ${
                        isSelected ? 'border-sky-500/20' : 'border-slate-700/50'
                      } ${isPreviewing ? 'text-sky-300' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      {isPreviewing ? <Square size={9} /> : <Volume2 size={10} />}
                      {isPreviewing ? 'Stop' : 'Preview'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* AI Model selection */}
          <div>
            <label className="mb-1.5 block text-xs text-slate-400">AI model</label>
            <select
              className={INPUT_BASE}
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value as AiCallerModel)}
            >
              {AI_CALLER_MODELS.map((m) => (
                <option key={m} value={m}>{AI_MODEL_LABELS[m]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-slate-400">Strategy (optional)</label>
            <select
              className={INPUT_BASE}
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="">Default strategy</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={() => void handleStart()}
            disabled={!phoneTo.trim()}
            className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-50"
          >
            <Bot size={15} />
            Start AI Call
          </button>
        </div>
      )}

      {/* Active call view */}
      {(isActive || isDone) && (
        <div className="mt-6 space-y-4">
          {/* Status bar */}
          <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-5 py-3">
            <div className="flex items-center gap-3">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                status === 'in_progress' ? 'bg-emerald-500/20' :
                status === 'connecting' ? 'bg-amber-500/20' : 'bg-slate-800'
              }`}>
                {status === 'in_progress' ? (
                  <Phone size={15} className="text-emerald-400" />
                ) : (
                  <Bot size={15} className={statusColor[status]} />
                )}
              </div>
              <div>
                <p className={`text-sm font-medium ${statusColor[status]}`}>{statusLabel[status]}</p>
                {phoneTo && <p className="text-xs text-slate-500">{phoneTo}</p>}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {status === 'in_progress' && (
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Clock size={12} />
                  {elapsed}
                </div>
              )}
              {isActive && (
                <button
                  onClick={() => void handleEnd()}
                  className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/10"
                >
                  <PhoneOff size={12} />
                  End call
                </button>
              )}
              {isDone && (
                <button
                  onClick={() => { setStatus('idle'); setCallId(null); setTranscript([]); setPhoneTo(''); }}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-500"
                >
                  New call
                </button>
              )}
            </div>
          </div>

          {/* Live transcript */}
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 min-h-[320px] max-h-[500px] overflow-y-auto space-y-3">
            {transcript.length === 0 && !partial && (
              <p className="text-center text-xs text-slate-600 py-8">
                {status === 'connecting' ? 'Waiting for the call to connect…' : 'Transcript will appear here'}
              </p>
            )}

            {transcript.map((line, i) => (
              <div key={i} className={`flex gap-2.5 ${line.speaker === 'REP' ? 'flex-row-reverse' : ''}`}>
                <div className={`shrink-0 rounded-full h-6 w-6 flex items-center justify-center text-[10px] font-semibold ${
                  line.speaker === 'REP'
                    ? 'bg-sky-500/20 text-sky-300'
                    : 'bg-slate-700 text-slate-300'
                }`}>
                  {line.speaker === 'REP' ? 'AI' : 'P'}
                </div>
                <div className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                  line.speaker === 'REP'
                    ? 'bg-sky-500/15 text-sky-100'
                    : 'bg-slate-800 text-slate-200'
                }`}>
                  {line.text}
                </div>
              </div>
            ))}

            {partial && (
              <div className={`flex gap-2.5 opacity-60 ${partial.speaker === 'REP' ? 'flex-row-reverse' : ''}`}>
                <div className={`shrink-0 rounded-full h-6 w-6 flex items-center justify-center text-[10px] font-semibold ${
                  partial.speaker === 'REP'
                    ? 'bg-sky-500/20 text-sky-300'
                    : 'bg-slate-700 text-slate-300'
                }`}>
                  {partial.speaker === 'REP' ? 'AI' : 'P'}
                </div>
                <div className={`max-w-[75%] rounded-xl px-3 py-2 text-sm italic ${
                  partial.speaker === 'REP'
                    ? 'bg-sky-500/10 text-sky-200'
                    : 'bg-slate-800/60 text-slate-300'
                }`}>
                  {partial.text}
                </div>
              </div>
            )}

            <div ref={transcriptEndRef} />
          </div>

          <p className="text-[11px] text-slate-600">
            AI Rep = <span className="text-sky-400">AI</span> · Prospect = <span className="text-slate-400">P</span>
          </p>
        </div>
      )}
    </div>
  );
}
