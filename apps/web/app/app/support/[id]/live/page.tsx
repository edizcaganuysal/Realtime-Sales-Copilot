'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  AlertTriangle,
  CheckCircle2,
  Headset,
  Loader2,
  MessageSquare,
  Play,
  X,
  XCircle,
} from 'lucide-react';

const WS_URL =
  process.env['NEXT_PUBLIC_WS_URL'] ??
  process.env['NEXT_PUBLIC_API_URL'] ??
  'http://localhost:3001';

type SessionData = {
  id: string;
  status: string;
  issueCategory: string | null;
  customerJson: Record<string, unknown>;
  notes: string;
  createdAt: string;
};

type TranscriptLine = {
  speaker: string;
  text: string;
  tsMs: number;
};

type SessionStats = {
  agentTurns: number;
  customerTurns: number;
  agentQuestions: number;
  agentWords: number;
  customerWords: number;
  issueType: string | null;
  sentiment: string;
  talkRatioAgent: number;
};

type ActionExecution = {
  executionId: string;
  status: string;
  definition?: { name: string; description: string };
  execution?: { id: string; inputJson: Record<string, unknown> };
  output?: unknown;
  error?: string;
};

export default function LiveSupportPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  // Engine state
  const [primarySuggestion, setPrimarySuggestion] = useState('');
  const [momentTag, setMomentTag] = useState('');
  const [nudges, setNudges] = useState<string[]>([]);
  const [knowledgeCards, setKnowledgeCards] = useState<string[]>([]);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [stageName, setStageName] = useState('Identification');
  const [customerSpeaking, setCustomerSpeaking] = useState(false);
  const [empathyNote, setEmpathyNote] = useState<string | null>(null);
  const [issueType, setIssueType] = useState<string | null>(null);
  const [resolutionStatus, setResolutionStatus] = useState('diagnosing');

  // Actions
  const [actions, setActions] = useState<ActionExecution[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Load session
  useEffect(() => {
    fetch(`/api/support/sessions/${sessionId}`)
      .then((r) => r.json())
      .then((d) => {
        setSession(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [sessionId]);

  // Connect to WebSocket
  useEffect(() => {
    const socket = io(`${WS_URL}/support`, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join', sessionId);
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('engine.suggestions', (data: {
      suggestions: string[];
      nudges: string[];
      knowledgeCards: string[];
      momentTag: string;
      issueType: string | null;
      resolutionStatus: string;
      empathyNote: string | null;
    }) => {
      if (data.suggestions[0]) setPrimarySuggestion(data.suggestions[0]);
      setNudges(data.nudges);
      setKnowledgeCards(data.knowledgeCards);
      setMomentTag(data.momentTag);
      if (data.issueType) setIssueType(data.issueType);
      setResolutionStatus(data.resolutionStatus);
      setEmpathyNote(data.empathyNote);
    });

    socket.on('engine.primary_suggestion', (data: { text: string; momentTag: string }) => {
      setPrimarySuggestion(data.text);
      setMomentTag(data.momentTag);
    });

    socket.on('engine.nudges', (data: { nudges: string[] }) => setNudges(data.nudges));
    socket.on('engine.knowledge_cards', (data: { cards: string[] }) => setKnowledgeCards(data.cards));
    socket.on('engine.moment', (data: { moment: string }) => setMomentTag(data.moment));
    socket.on('engine.stats', (data: { stats: SessionStats }) => setStats(data.stats));
    socket.on('engine.stage', (data: { stageName: string }) => setStageName(data.stageName));
    socket.on('engine.customer_speaking', (data: { speaking: boolean }) => setCustomerSpeaking(data.speaking));

    socket.on('transcript.final', (data: { speaker: string; text: string; tsMs: number }) => {
      setTranscript((prev) => [...prev, data]);
    });
    socket.on('transcript.partial', (data: { speaker: string; text: string; tsMs: number }) => {
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.speaker === data.speaker && Date.now() - last.tsMs < 2000) {
          return [...prev.slice(0, -1), { ...data }];
        }
        return [...prev, data];
      });
    });

    // Action events
    socket.on('engine.action_proposed', (data: ActionExecution) => {
      setActions((prev) => [...prev, { ...data, status: 'PROPOSED' }]);
    });

    socket.on('engine.action_update', (data: { executionId: string; status: string; output?: unknown; error?: string }) => {
      setActions((prev) =>
        prev.map((a) =>
          (a.executionId === data.executionId || a.execution?.id === data.executionId)
            ? { ...a, status: data.status, output: data.output, error: data.error }
            : a,
        ),
      );
    });

    return () => {
      socket.emit('leave', sessionId);
      socket.disconnect();
    };
  }, [sessionId]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  // Start engine
  const handleSessionStart = useCallback(async () => {
    await fetch(`/api/support/sessions/${sessionId}/session-start`, { method: 'POST' });
  }, [sessionId]);

  // Approve/reject actions
  const handleApproveAction = useCallback(async (executionId: string) => {
    await fetch(`/api/support/actions/${executionId}/approve`, { method: 'POST' });
  }, []);

  const handleRejectAction = useCallback(async (executionId: string) => {
    await fetch(`/api/support/actions/${executionId}/reject`, { method: 'POST' });
  }, []);

  // End session
  const handleEndSession = useCallback(async () => {
    await fetch(`/api/support/sessions/${sessionId}/end`, { method: 'POST' });
    router.push('/app/support');
  }, [sessionId, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="animate-spin text-slate-400" size={32} />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-screen text-slate-400">
        Session not found
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
          <div className="flex items-center gap-3">
            <Headset size={18} className="text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-white">Support Session</p>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className={connected ? 'text-emerald-400' : 'text-red-400'}>
                  {connected ? 'Connected' : 'Disconnected'}
                </span>
                <span>|</span>
                <span>{stageName}</span>
                {issueType && (
                  <>
                    <span>|</span>
                    <span className="text-amber-300">{issueType}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSessionStart}
              className="px-3 py-1.5 text-xs border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 rounded-lg hover:border-emerald-500/60 transition-colors"
            >
              Start Engine
            </button>
            <button
              onClick={handleEndSession}
              className="px-3 py-1.5 text-xs border border-red-500/30 bg-red-500/10 text-red-300 rounded-lg hover:border-red-500/60 transition-colors"
            >
              End Session
            </button>
          </div>
        </div>

        {/* Suggestion Card */}
        <div className="border-b border-slate-800 px-6 py-4">
          {momentTag && (
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {momentTag}
              </span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
                {resolutionStatus}
              </span>
            </div>
          )}

          {empathyNote && (
            <p className="text-xs text-amber-300 mb-2 italic">{empathyNote}</p>
          )}

          <div
            className={`text-base font-medium text-white transition-opacity ${customerSpeaking ? 'opacity-40' : 'opacity-100'}`}
          >
            {primarySuggestion || (
              <span className="text-slate-500 italic">Waiting for conversation...</span>
            )}
          </div>

          {/* Nudge pills */}
          {nudges.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {nudges.map((nudge, i) => (
                <span
                  key={i}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700"
                >
                  {nudge}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Stats bar */}
        {stats && (
          <div className="flex items-center gap-4 border-b border-slate-800 px-6 py-2 text-[11px] text-slate-400">
            <span>Agent turns: {stats.agentTurns}</span>
            <span>Customer turns: {stats.customerTurns}</span>
            <span>Talk ratio: {stats.talkRatioAgent}%</span>
            <span>Sentiment: {stats.sentiment}</span>
          </div>
        )}

        {/* Transcript */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {transcript.map((line, i) => (
            <div
              key={i}
              className={`flex gap-3 ${line.speaker === 'AGENT' ? 'justify-end' : ''}`}
            >
              <div
                className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                  line.speaker === 'AGENT'
                    ? 'bg-sky-500/10 border border-sky-500/20 text-sky-100'
                    : 'bg-slate-800 border border-slate-700 text-slate-200'
                }`}
              >
                <span className="text-[10px] uppercase font-medium text-slate-500 block mb-0.5">
                  {line.speaker}
                </span>
                {line.text}
              </div>
            </div>
          ))}
          <div ref={transcriptEndRef} />
        </div>
      </div>

      {/* Right Sidebar: Actions + Knowledge */}
      <div className="w-80 border-l border-slate-800 flex flex-col">
        {/* Actions Panel */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-3 border-b border-slate-800">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Actions
            </h3>
          </div>
          <div className="p-3 space-y-2">
            {actions.length === 0 && (
              <p className="text-xs text-slate-500 italic px-1">No actions proposed yet</p>
            )}
            {actions.map((action, i) => {
              const executionId = action.execution?.id ?? action.executionId;
              return (
                <div
                  key={i}
                  className="rounded-lg border border-slate-700 bg-slate-800/60 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-white">
                      {action.definition?.name ?? 'Action'}
                    </span>
                    {action.status === 'PROPOSED' && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleApproveAction(executionId)}
                          className="p-1 rounded text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                          title="Run"
                        >
                          <Play size={14} />
                        </button>
                        <button
                          onClick={() => handleRejectAction(executionId)}
                          className="p-1 rounded text-red-400 hover:bg-red-500/20 transition-colors"
                          title="Dismiss"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                    {action.status === 'RUNNING' && (
                      <Loader2 size={14} className="animate-spin text-sky-400" />
                    )}
                    {action.status === 'COMPLETED' && (
                      <CheckCircle2 size={14} className="text-emerald-400" />
                    )}
                    {action.status === 'FAILED' && (
                      <XCircle size={14} className="text-red-400" />
                    )}
                    {action.status === 'REJECTED' && (
                      <span className="text-[10px] text-slate-500">dismissed</span>
                    )}
                  </div>

                  {action.status === 'COMPLETED' && action.output && (
                    <pre className="mt-2 text-[10px] text-emerald-300 bg-emerald-500/10 rounded p-2 overflow-x-auto max-h-32">
                      {JSON.stringify(action.output, null, 2).slice(0, 500)}
                    </pre>
                  )}

                  {action.status === 'FAILED' && action.error && (
                    <p className="mt-1 text-[10px] text-red-400">{action.error}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Knowledge Cards */}
        {knowledgeCards.length > 0 && (
          <div className="border-t border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Knowledge
              </h3>
            </div>
            <div className="p-3 space-y-2">
              {knowledgeCards.map((card, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-slate-700 bg-slate-800/40 px-3 py-2 text-xs text-slate-300"
                >
                  {card}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
