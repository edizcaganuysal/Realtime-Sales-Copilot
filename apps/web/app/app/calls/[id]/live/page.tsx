'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  AlertTriangle,
  Bot,
  MessageSquare,
  Mic,
  MicOff,
  MoreHorizontal,
  PhoneCall,
  PhoneOff,
} from 'lucide-react';
import { Modal } from '@/components/ui/modal';

const WS_URL =
  process.env['NEXT_PUBLIC_WS_URL'] ??
  process.env['NEXT_PUBLIC_API_URL'] ??
  'http://localhost:3001';
const API_WS_URL = WS_URL.replace(/^http/, 'ws');

type ProductRef = {
  id: string;
  name: string;
};

type CallData = {
  id: string;
  phoneTo: string;
  mode: string;
  status: string;
  callType?: string;
  preparedOpenerText?: string | null;
  startedAt: string | null;
  productsMode?: 'ALL' | 'SELECTED';
  selectedProducts?: ProductRef[];
  availableProducts?: ProductRef[];
};

type TranscriptLine = {
  speaker: string;
  text: string;
  tsMs: number;
  isFinal?: boolean;
  _seq?: number;
};

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

type DebugPayload = {
  reason: string;
  lastProspectUtterance: string;
  momentTag: string;
  suggestionUpdated: boolean;
};

type ContextToast = {
  cards: string[];
  objection: string | null;
  tsMs: number;
};

function useTimer(startedAt: string | null) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    setElapsed(Date.now() - new Date(startedAt).getTime());
    const id = setInterval(() => {
      setElapsed(Date.now() - new Date(startedAt).getTime());
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

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
    const chunk = audioQueueRef.current.shift();
    if (!chunk) {
      isPlayingRef.current = false;
      return;
    }

    const buffer = ctx.createBuffer(1, chunk.length, 24000);
    buffer.copyToChannel(new Float32Array(chunk), 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => playNextChunk();
    source.start();
  }, []);

  const enqueueAudio = useCallback(
    (base64: string) => {
      const bytes = atob(base64);
      const samples = new Int16Array(bytes.length / 2);
      for (let i = 0; i < samples.length; i += 1) {
        samples[i] = bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8);
      }
      const float32 = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i += 1) {
        float32[i] = samples[i]! / 32768;
      }
      audioQueueRef.current.push(float32);
      if (!isPlayingRef.current) {
        playNextChunk();
      }
    },
    [playNextChunk],
  );

  useEffect(() => {
    if (!isMock || !isActive) return;

    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 24000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

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
            const msg = JSON.parse(event.data as string) as {
              type: 'ready' | 'audio' | 'error';
              data?: string;
              message?: string;
            };
            if (msg.type === 'ready') {
              setMockReady(true);
              return;
            }
            if (msg.type === 'audio' && msg.data) {
              enqueueAudio(msg.data);
              return;
            }
            if (msg.type === 'error') {
              console.error(msg.message ?? 'Mock stream error');
            }
          } catch {
            return;
          }
        };

        ws.onerror = () => {
          console.error('Mock stream websocket error');
        };

        ws.onclose = () => {
          setMockReady(false);
        };

        processor.onaudioprocess = (event) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const input = event.inputBuffer.getChannelData(0);
          const pcm16 = new Int16Array(input.length);
          for (let i = 0; i < input.length; i += 1) {
            const sample = Math.max(-1, Math.min(1, input[i]!));
            pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
          }
          const bytes = new Uint8Array(pcm16.buffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i += 1) {
            binary += String.fromCharCode(bytes[i]!);
          }
          ws.send(JSON.stringify({ type: 'audio', data: btoa(binary) }));
        };
      } catch (error) {
        console.error('Unable to initialize practice audio', error);
        setMicActive(false);
      }
    }

    void start();

    return () => {
      cancelled = true;
      processorRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void ctxRef.current?.close();
      wsRef.current?.close();
      audioQueueRef.current = [];
      isPlayingRef.current = false;
      setMicActive(false);
      setMockReady(false);
    };
  }, [callId, enqueueAudio, isActive, isMock]);

  return { micActive, mockReady };
}

const NUDGE_LABELS: Record<string, string> = {
  ASK_QUESTION: 'Ask one question',
  ADDRESS_OBJECTION: 'Address concern',
  TOO_MUCH_TALKING: 'Let them speak',
  MISSING_NEXT_STEP: 'Push next step',
  SOFTEN_TONE: 'Soften tone',
  SLOW_DOWN: 'Slow down',
  CONFIRM_UNDERSTANDING: 'Confirm understanding',
};

function parseNudges(raw: string[]): string[] {
  const picked: string[] = [];
  for (const item of raw) {
    const label = NUDGE_LABELS[item] ?? item.trim();
    if (!label) continue;
    if (picked.includes(label)) continue;
    picked.push(label);
    if (picked.length === 3) break;
  }
  return picked;
}

function formatCredits(value: number | null) {
  if (value === null) return '--';
  return new Intl.NumberFormat('en-US').format(value);
}

function speakerLabel(speaker: string) {
  return speaker === 'REP' ? 'YOU' : 'PROSPECT';
}

export default function LiveCallPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const searchParams = useSearchParams();

  const [call, setCall] = useState<CallData | null>(null);
  const [callStatus, setCallStatus] = useState('INITIATED');
  const [connected, setConnected] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [partialProspectText, setPartialProspectText] = useState('');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [listeningMode, setListeningMode] = useState(false);
  const [nudges, setNudges] = useState<string[]>([]);
  const [momentTag, setMomentTag] = useState('Opening');
  const [prospectSpeaking, setProspectSpeaking] = useState(false);
  const [ending, setEnding] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [moreOptionsLoading, setMoreOptionsLoading] = useState(false);
  const [moreOptions, setMoreOptions] = useState<string[]>([]);
  const [contextToast, setContextToast] = useState<ContextToast | null>(null);
  const [contextPanelData, setContextPanelData] = useState<ContextToast | null>(null);
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [stats, setStats] = useState<CallStats>({
    repTurns: 0,
    prospectTurns: 0,
    repQuestions: 0,
    repWords: 0,
    prospectWords: 0,
    objectionDetected: null,
    sentiment: 'neutral',
    talkRatioRep: 50,
  });
  const [creditsBalance, setCreditsBalance] = useState<number | null>(null);
  const [productDrawerOpen, setProductDrawerOpen] = useState(false);
  const [productsModeDraft, setProductsModeDraft] = useState<'ALL' | 'SELECTED'>('ALL');
  const [selectedProductIdsDraft, setSelectedProductIdsDraft] = useState<string[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [productsSaving, setProductsSaving] = useState(false);
  const [productsError, setProductsError] = useState('');
  const [debugPayload, setDebugPayload] = useState<DebugPayload | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const seqRef = useRef(0);
  const pendingPrimaryRef = useRef<string | null>(null);
  const prospectSpeakingRef = useRef(false);
  const suggestionRef = useRef<string | null>(null);

  const timer = useTimer(call?.startedAt ?? null);
  const isMock = call?.mode === 'MOCK';
  const isActive = callStatus !== 'INITIATED';
  const debugEnabled = searchParams.get('debug') === '1';
  const { micActive, mockReady } = useMockAudio(id, isMock, isActive);

  const availableProducts = call?.availableProducts ?? [];
  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return availableProducts;
    return availableProducts.filter((product) =>
      product.name.toLowerCase().includes(q),
    );
  }, [availableProducts, productSearch]);

  const selectedProducts =
    call?.productsMode === 'SELECTED' && Array.isArray(call.selectedProducts)
      ? call.selectedProducts
      : [];
  const productPills =
    call?.productsMode === 'SELECTED' && selectedProducts.length > 0
      ? selectedProducts.map((product) => product.name)
      : ['All offerings'];

  const topNudges = nudges.slice(0, 3);
  const isListening = prospectSpeaking || listeningMode;

  useEffect(() => {
    suggestionRef.current = suggestion;
  }, [suggestion]);

  useEffect(() => {
    let active = true;

    async function loadCall() {
      const response = await fetch(`/api/calls/${id}`, { cache: 'no-store' });
      if (!response.ok || !active) return;
      const data = (await response.json()) as CallData;
      if (!active) return;
      setCall(data);
      setCallStatus(data.status ?? 'INITIATED');
      if (typeof data.preparedOpenerText === 'string' && data.preparedOpenerText.trim().length > 0) {
        setSuggestion(data.preparedOpenerText.trim());
        setListeningMode(false);
      }
      const mode = data.productsMode === 'SELECTED' ? 'SELECTED' : 'ALL';
      setProductsModeDraft(mode);
      setSelectedProductIdsDraft(
        Array.isArray(data.selectedProducts)
          ? data.selectedProducts.map((item) => item.id)
          : [],
      );
    }

    void loadCall();

    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    let active = true;

    async function loadCredits() {
      const res = await fetch('/api/org/credits', { cache: 'no-store' });
      if (!res.ok || !active) return;
      const data = await res.json().catch(() => null);
      if (!active) return;
      if (typeof data?.balance === 'number') {
        setCreditsBalance(data.balance);
      }
    }

    void loadCredits();
    const intervalId = setInterval(() => {
      void loadCredits();
    }, 10000);
    const refreshListener = () => {
      void loadCredits();
    };
    window.addEventListener('credits:refresh', refreshListener);

    return () => {
      active = false;
      clearInterval(intervalId);
      window.removeEventListener('credits:refresh', refreshListener);
    };
  }, []);

  useEffect(() => {
    if (!contextToast) return;
    const timerId = setTimeout(() => {
      setContextToast((current) =>
        current?.tsMs === contextToast.tsMs ? null : current,
      );
    }, 6000);
    return () => clearTimeout(timerId);
  }, [contextToast]);

  useEffect(() => {
    const socket = io(`${WS_URL}/calls`, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join', id);
      void fetch(`/api/calls/${id}/session-start`, { method: 'POST' });
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('transcript.partial', (data: TranscriptLine) => {
      if (data.speaker === 'PROSPECT') {
        setPartialProspectText(data.text);
        setProspectSpeaking(true);
        prospectSpeakingRef.current = true;
      }
    });

    socket.on('transcript.final', (data: TranscriptLine) => {
      setTranscript((prev) => {
        const seq = ++seqRef.current;
        return [...prev, { ...data, isFinal: true, _seq: seq }];
      });

      if (data.speaker === 'PROSPECT') {
        setPartialProspectText('');
        setProspectSpeaking(false);
        prospectSpeakingRef.current = false;
        if (pendingPrimaryRef.current) {
          setListeningMode(false);
          setSuggestion(pendingPrimaryRef.current);
          pendingPrimaryRef.current = null;
        }
      } else if (data.speaker === 'REP') {
        setListeningMode(true);
        setSuggestion(null);
      }
    });

    socket.on('engine.primary_suggestion', (data: { text: string }) => {
      if (!data.text) return;
      if (prospectSpeakingRef.current) {
        pendingPrimaryRef.current = data.text;
        return;
      }
      setListeningMode(false);
      setSuggestion(data.text);
    });

    socket.on('engine.suggestions', (data: { suggestions: string[] }) => {
      const first = (data.suggestions ?? [])[0];
      if (!first) return;
      if (prospectSpeakingRef.current) {
        pendingPrimaryRef.current = first;
        return;
      }
      if (!suggestionRef.current) {
        setListeningMode(false);
        setSuggestion(first);
      }
    });

    socket.on('engine.nudges', (data: { nudges: string[] }) => {
      setNudges(parseNudges(data.nudges ?? []));
    });

    socket.on('engine.moment', (data: { tag?: string }) => {
      if (!data?.tag) return;
      setMomentTag(data.tag);
    });

    socket.on(
      'engine.context_cards',
      (data: { cards: string[]; objection: string | null }) => {
        const cards = (data.cards ?? []).filter((item) => item.trim().length > 0).slice(0, 4);
        if (cards.length === 0 && !data.objection) return;
        const next = {
          cards,
          objection: data.objection ?? null,
          tsMs: Date.now(),
        };
        setContextToast(next);
        setContextPanelData(next);
      },
    );

    socket.on('engine.stats', (data: { stats: CallStats }) => {
      setStats(data.stats);
    });

    socket.on('engine.prospect_speaking', (data: { speaking: boolean }) => {
      setProspectSpeaking(data.speaking);
      prospectSpeakingRef.current = data.speaking;
      if (!data.speaking && pendingPrimaryRef.current) {
        setListeningMode(false);
        setSuggestion(pendingPrimaryRef.current);
        pendingPrimaryRef.current = null;
      }
    });

    socket.on('engine.primary_consumed', () => {
      setListeningMode(true);
      setSuggestion(null);
    });

    socket.on('engine.debug', (data: DebugPayload) => {
      setDebugPayload(data);
    });

    socket.on('call.status', (data: { status: string; startedAt: string | null }) => {
      setCallStatus(data.status);
      setCall((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status: data.status,
          startedAt: data.startedAt ?? prev.startedAt,
        };
      });
    });

    return () => {
      socket.emit('leave', id);
      socket.disconnect();
    };
  }, [id]);

  const handleMoreOptions = useCallback(async () => {
    setMoreOptionsOpen(true);
    setMoreOptionsLoading(true);
    setMoreOptions([]);
    const res = await fetch(`/api/calls/${id}/suggestions/more`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'MORE_OPTIONS', count: 2 }),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { texts?: string[] } | null;
      const next = (data?.texts ?? []).filter((item) => item.trim().length > 0).slice(0, 2);
      setMoreOptions(next);
    }
    setMoreOptionsLoading(false);
  }, [id]);

  const openProductsDrawer = useCallback(() => {
    const mode = call?.productsMode === 'SELECTED' ? 'SELECTED' : 'ALL';
    const selected = Array.isArray(call?.selectedProducts)
      ? call.selectedProducts.map((product) => product.id)
      : [];
    setProductsModeDraft(mode);
    setSelectedProductIdsDraft(selected);
    setProductSearch('');
    setProductsError('');
    setProductDrawerOpen(true);
  }, [call]);

  const toggleDraftProduct = useCallback((productId: string) => {
    setSelectedProductIdsDraft((prev) =>
      prev.includes(productId)
        ? prev.filter((item) => item !== productId)
        : [...prev, productId],
    );
  }, []);

  const saveProducts = useCallback(async () => {
    if (productsModeDraft === 'SELECTED' && selectedProductIdsDraft.length === 0) {
      setProductsError('Select at least one offering or use All offerings.');
      return;
    }

    setProductsSaving(true);
    setProductsError('');
    const res = await fetch(`/api/calls/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        products_mode: productsModeDraft,
        selected_product_ids:
          productsModeDraft === 'SELECTED' ? selectedProductIdsDraft : [],
      }),
    });
    const data = (await res.json().catch(() => null)) as CallData | { message?: string } | null;
    setProductsSaving(false);

    if (!res.ok || !data || !('id' in data)) {
      setProductsError(
        typeof data === 'object' && data && 'message' in data && data.message
          ? data.message
          : 'Failed to save offerings',
      );
      return;
    }

    setCall(data);
    setProductsModeDraft(data.productsMode === 'SELECTED' ? 'SELECTED' : 'ALL');
    setSelectedProductIdsDraft(
      Array.isArray(data.selectedProducts) ? data.selectedProducts.map((item) => item.id) : [],
    );
    setProductDrawerOpen(false);
  }, [id, productsModeDraft, selectedProductIdsDraft]);

  const handleEnd = useCallback(async () => {
    setEnding(true);
    socketRef.current?.emit('leave', id);
    await fetch(`/api/calls/${id}/end`, { method: 'POST' });
    router.push('/app/calls');
  }, [id, router]);

  if (!call) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-slate-950">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800/60 bg-slate-950 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={
              'h-2 w-2 rounded-full ' + (connected ? 'animate-pulse bg-sky-400' : 'bg-slate-600')
            }
          />
          {isMock ? (
            <span className="flex shrink-0 items-center gap-1.5 font-mono text-sm text-violet-400">
              <Bot size={14} />
              Practice
            </span>
          ) : (
            <span className="max-w-[180px] truncate font-mono text-sm text-white">
              {call.phoneTo}
            </span>
          )}
          <span className="shrink-0 tabular-nums text-xs text-slate-600">{timer}</span>
          {isMock && (
            <span
              className={`hidden shrink-0 items-center gap-1 text-xs sm:flex ${
                micActive ? 'text-sky-400' : 'text-red-400'
              }`}
            >
              {micActive ? <Mic size={12} /> : <MicOff size={12} />}
              {micActive ? (mockReady ? 'Live' : 'Connecting...') : 'No mic'}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            {productPills.slice(0, 2).map((name) => (
              <span
                key={name}
                className="max-w-[110px] truncate rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-200 md:max-w-[130px]"
              >
                {name}
              </span>
            ))}
            {productPills.length > 2 && (
              <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">
                +{productPills.length - 2}
              </span>
            )}
            <button
              type="button"
              onClick={openProductsDrawer}
              className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
            >
              Offerings
            </button>
          </div>
          <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-200">
            {momentTag}
          </span>
          <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-200">
            Credits: {formatCredits(creditsBalance)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTranscriptOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
          >
            <MessageSquare size={13} />
            Transcript
          </button>
          <button
            type="button"
            onClick={() => void handleMoreOptions()}
            disabled={prospectSpeaking}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
          >
            <MoreHorizontal size={13} />
            More options
          </button>
          <button
            type="button"
            onClick={() => void handleEnd()}
            disabled={ending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-60"
          >
            <PhoneOff size={13} />
            {ending ? 'Ending...' : 'End call'}
          </button>
        </div>
      </div>

      {callStatus === 'INITIATED' && !isMock ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-slate-950">
          <div className="relative">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-800">
              <PhoneCall size={32} className="text-sky-400" />
            </div>
            <span className="absolute inset-0 animate-ping rounded-full border-2 border-sky-400/40" />
          </div>
          <div className="space-y-1 text-center">
            <p className="text-lg font-medium text-white">Calling {call.phoneTo}...</p>
            <p className="text-sm text-slate-500">Waiting for answer</p>
          </div>
          <button
            type="button"
            onClick={() => void handleEnd()}
            disabled={ending}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-60"
          >
            <PhoneOff size={15} />
            {ending ? 'Ending...' : 'Cancel'}
          </button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-7">
          <div className="w-full max-w-3xl rounded-2xl border border-sky-500/30 bg-gradient-to-br from-slate-900 to-slate-900/80 p-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-sky-400">
                  Primary next line
                </span>
                {isListening && (
                  <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-300">
                    Listening
                  </span>
                )}
              </div>
            </div>
            <p className="min-h-[66px] text-lg font-medium leading-relaxed text-white">
              {isListening ? 'Listening...' : suggestion ?? 'Preparing your opening line...'}
            </p>
          </div>

          <div className="w-full max-w-3xl">
            <div className="flex flex-wrap gap-2">
              {topNudges.length > 0 ? (
                topNudges.map((nudge) => (
                  <span
                    key={nudge}
                    className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300"
                  >
                    {nudge}
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-500">
                  Nudges will appear as the conversation evolves.
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {contextToast && (
        <div className="pointer-events-none absolute bottom-4 right-4 z-30">
          <div className="pointer-events-auto rounded-xl border border-slate-700 bg-slate-900/95 px-3 py-2 shadow-2xl">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-200">Context update available</span>
              <button
                type="button"
                onClick={() => {
                  setContextPanelOpen(true);
                  setContextToast(null);
                }}
                className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
              >
                View
              </button>
            </div>
          </div>
        </div>
      )}

      {transcriptOpen && (
        <div className="absolute inset-y-0 right-0 z-40 w-full max-w-md border-l border-slate-700 bg-slate-950/95 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h3 className="text-sm font-semibold text-white">Transcript</h3>
            <button
              type="button"
              onClick={() => setTranscriptOpen(false)}
              className="text-xs text-slate-400 transition-colors hover:text-white"
            >
              Close
            </button>
          </div>
          <div className="h-[calc(100%-57px)] overflow-y-auto px-4 py-3">
            {partialProspectText ? (
              <div className="mb-3 rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-sky-300">
                  Prospect speaking
                </p>
                <p className="text-xs text-sky-100">{partialProspectText}</p>
              </div>
            ) : null}
            {transcript.length === 0 ? (
              <p className="pt-8 text-center text-xs text-slate-500">
                Transcript will appear here.
              </p>
            ) : (
              <div className="space-y-2">
                {transcript.map((line, index) => (
                  <div
                    key={`${line._seq ?? index}-${line.tsMs}`}
                    className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2"
                  >
                    <p
                      className={`mb-1 text-[10px] font-mono ${
                        line.speaker === 'REP' ? 'text-blue-400' : 'text-slate-400'
                      }`}
                    >
                      {speakerLabel(line.speaker)}
                    </p>
                    <p className="text-xs leading-relaxed text-slate-200">{line.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {productDrawerOpen && (
        <div className="absolute right-4 top-14 z-40 w-80 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <h3 className="text-sm font-semibold text-white">Offerings</h3>
            <button
              type="button"
              onClick={() => setProductDrawerOpen(false)}
              className="text-xs text-slate-400 transition-colors hover:text-white"
            >
              Close
            </button>
          </div>
          <div className="space-y-3 p-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setProductsModeDraft('ALL')}
                className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  productsModeDraft === 'ALL'
                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-200'
                    : 'border-slate-700 bg-slate-800 text-slate-400'
                }`}
              >
                All offerings
              </button>
                <button
                  type="button"
                  onClick={() => setProductsModeDraft('SELECTED')}
                className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  productsModeDraft === 'SELECTED'
                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-200'
                    : 'border-slate-700 bg-slate-800 text-slate-400'
                }`}
                >
                  Selected offerings
                </button>
            </div>

            {productsModeDraft === 'SELECTED' && (
              <div className="space-y-2">
                <input
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-sky-500/50"
                  placeholder="Search offerings..."
                />
                <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                  {filteredProducts.length === 0 ? (
                    <p className="py-2 text-xs text-slate-500">No offerings found.</p>
                  ) : (
                    filteredProducts.map((product) => {
                      const selected = selectedProductIdsDraft.includes(product.id);
                      return (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => toggleDraftProduct(product.id)}
                          className={`w-full rounded-lg border px-2.5 py-2 text-left text-sm transition-colors ${
                            selected
                              ? 'border-sky-500/40 bg-sky-500/10 text-sky-100'
                              : 'border-slate-700 bg-slate-800 text-slate-300'
                          }`}
                        >
                          {product.name}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {productsError ? <p className="text-xs text-red-400">{productsError}</p> : null}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setProductDrawerOpen(false)}
                className="flex-1 rounded-lg border border-slate-700 py-2 text-xs text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveProducts()}
                disabled={productsSaving}
                className="flex-1 rounded-lg bg-sky-600 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-60"
              >
                {productsSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={moreOptionsOpen}
        onClose={() => setMoreOptionsOpen(false)}
        title="More options"
        className="max-w-xl"
      >
        {moreOptionsLoading ? (
          <p className="text-sm text-slate-300">Generating two alternatives...</p>
        ) : moreOptions.length === 0 ? (
          <p className="text-sm text-slate-400">No alternatives available yet.</p>
        ) : (
          <div className="space-y-2">
            {moreOptions.slice(0, 2).map((option, index) => (
              <button
                key={`${option}-${index}`}
                type="button"
                onClick={() => {
                  if (prospectSpeakingRef.current) {
                    pendingPrimaryRef.current = option;
                  } else {
                    setListeningMode(false);
                    setSuggestion(option);
                  }
                  setMoreOptionsOpen(false);
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-left text-sm text-slate-100 transition-colors hover:border-slate-500"
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={contextPanelOpen}
        onClose={() => setContextPanelOpen(false)}
        title="Context cards"
        className="max-w-xl"
      >
        <div className="space-y-2">
          {contextPanelData?.objection ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} />
                <span>{contextPanelData.objection}</span>
              </div>
            </div>
          ) : null}
          {(contextPanelData?.cards ?? []).map((card, index) => (
            <div
              key={`${card}-${index}`}
              className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-sm text-slate-200"
            >
              {card}
            </div>
          ))}
        </div>
      </Modal>

      {debugEnabled && (
        <div className="absolute bottom-4 left-4 z-30 w-[360px] rounded-xl border border-slate-700 bg-slate-900/95 p-3 text-xs text-slate-200 shadow-2xl">
          <p className="mb-2 font-semibold text-slate-100">Prompt debug</p>
          <div className="space-y-1">
            <p>
              <span className="text-slate-400">Reason:</span>{' '}
              {debugPayload?.reason ?? 'n/a'}
            </p>
            <p>
              <span className="text-slate-400">Moment:</span>{' '}
              {debugPayload?.momentTag ?? momentTag}
            </p>
            <p>
              <span className="text-slate-400">Updated:</span>{' '}
              {debugPayload?.suggestionUpdated ? 'yes' : 'no'}
            </p>
            <p className="line-clamp-3">
              <span className="text-slate-400">Last prospect final:</span>{' '}
              {debugPayload?.lastProspectUtterance || 'n/a'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
