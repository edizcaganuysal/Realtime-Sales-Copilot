import { HttpAdapterHost } from '@nestjs/core';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { WebSocketServer as WsServer } from 'ws';
import WebSocket from 'ws';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CallsGateway } from './calls.gateway';
import { EngineService } from './engine.service';
import { getPersonaById, PRACTICE_PERSONAS } from './practice-personas';

@Injectable()
export class MockCallService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MockCallService.name);
  private readonly apiKey = process.env['LLM_API_KEY'] ?? '';

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly gateway: CallsGateway,
    private readonly engineService: EngineService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  get available(): boolean {
    return !!this.apiKey;
  }

  onApplicationBootstrap() {
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();
    const wss = new WsServer({ noServer: true });

    httpServer.prependListener('upgrade', (req: { url?: string }, socket: unknown, head: unknown) => {
      const pathname = req.url?.split('?')[0] ?? '';
      if (pathname !== '/mock-stream') return;
      this.logger.log('WS upgrade intercepted for /mock-stream');
      (wss as WsServer).handleUpgrade(
        req as Parameters<WsServer['handleUpgrade']>[0],
        socket as Parameters<WsServer['handleUpgrade']>[1],
        head as Parameters<WsServer['handleUpgrade']>[2],
        (ws) => wss.emit('connection', ws, req),
      );
    });

    wss.on('connection', (browserWs, req) => {
      const params = new URLSearchParams((req as { url?: string }).url?.split('?')[1] ?? '');
      const callId = params.get('callId');

      if (!callId) {
        this.logger.warn('Mock stream connected without callId — closing');
        browserWs.send(JSON.stringify({ type: 'error', message: 'Missing callId' }));
        browserWs.close();
        return;
      }

      this.logger.log(`Mock stream connected — call ${callId}`);
      this.handleMockSession(browserWs, callId);
    });

    this.logger.log('Mock Call WS attached at /mock-stream');
  }

  private async handleMockSession(browserWs: WebSocket, callId: string) {
    if (!this.available) {
      browserWs.send(JSON.stringify({ type: 'error', message: 'LLM_API_KEY not configured' }));
      browserWs.close();
      return;
    }

    const [callRow] = await this.db
      .select()
      .from(schema.calls)
      .where(eq(schema.calls.id, callId))
      .limit(1);

    if (!callRow) {
      browserWs.send(JSON.stringify({ type: 'error', message: 'Call not found' }));
      browserWs.close();
      return;
    }

    const contactJson = (callRow.contactJson ?? {}) as Record<string, unknown>;
    const practicePersonaId = (contactJson.practicePersonaId as string) ?? null;
    const customPersonaPrompt = (contactJson.customPersonaPrompt as string) ?? null;

    let prospectPersona: string;
    if (customPersonaPrompt) {
      prospectPersona = this.buildCustomPersona(customPersonaPrompt, callRow.notes ?? null);
    } else if (practicePersonaId?.startsWith('custom:')) {
      // Load saved custom persona from agents table
      const agentId = practicePersonaId.replace(/^custom:/, '');
      const [agent] = await this.db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, agentId))
        .limit(1);
      prospectPersona = agent
        ? this.buildCustomPersona(agent.prompt, callRow.notes ?? null)
        : this.buildProspectPersona(null, callRow.notes ?? null);
    } else {
      prospectPersona = this.buildProspectPersona(practicePersonaId, callRow.notes ?? null);
    }

    const openaiWs = new WebSocket(
      'wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview',
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      },
    );

    let openaiReady = false;
    // Accumulate partial AI transcript text for a single response
    let partialAiText = '';
    let userSpeechStartedAt: number | null = null;
    let aiSpeechStartedAt: number | null = null;
    let repHasSpoken = false;
    let responseKickTimer: ReturnType<typeof setTimeout> | null = null;
    let lastFinalTsMs = 0;
    const nextFinalTs = (candidate: number) => {
      const normalized = Math.max(candidate, Date.now());
      if (normalized <= lastFinalTsMs) {
        lastFinalTsMs += 1;
      } else {
        lastFinalTsMs = normalized;
      }
      return lastFinalTsMs;
    };
    const clearResponseKickTimer = () => {
      if (!responseKickTimer) return;
      clearTimeout(responseKickTimer);
      responseKickTimer = null;
    };
    const scheduleResponseKick = () => {
      clearResponseKickTimer();
      if (!openaiReady || !repHasSpoken || openaiWs.readyState !== WebSocket.OPEN) return;
      responseKickTimer = setTimeout(() => {
        responseKickTimer = null;
        if (!openaiReady || !repHasSpoken || openaiWs.readyState !== WebSocket.OPEN) return;
        if (aiSpeechStartedAt || partialAiText.trim().length > 0) return;
        openaiWs.send(
          JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['audio', 'text'],
              temperature: 1.15,
            },
          }),
        );
      }, 650);
    };

    openaiWs.on('open', () => {
      this.logger.log(`OpenAI Realtime WS connected — call ${callId}`);

      openaiWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: prospectPersona,
          temperature: 1.15,
          voice: 'shimmer',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: {
            model: 'whisper-1',
            language: 'en',
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.6,
            prefix_padding_ms: 400,
            silence_duration_ms: 1000,
          },
        },
      }));
    });

    openaiWs.on('message', (rawData) => {
      let event: { type: string; [key: string]: unknown };
      try {
        event = JSON.parse(rawData.toString());
      } catch {
        return;
      }

      switch (event.type) {
        case 'session.created':
        case 'session.updated': {
          openaiReady = true;
          browserWs.send(JSON.stringify({ type: 'ready' }));
          this.logger.log(`OpenAI Realtime session ready — call ${callId}`);
          break;
        }

        case 'input_audio_buffer.speech_started': {
          repHasSpoken = true;
          userSpeechStartedAt = Date.now();
          clearResponseKickTimer();
          break;
        }

        case 'input_audio_buffer.speech_stopped': {
          repHasSpoken = true;
          if (!userSpeechStartedAt) {
            userSpeechStartedAt = Date.now();
          }
          scheduleResponseKick();
          break;
        }

        case 'response.audio.delta': {
          if (!repHasSpoken) {
            break;
          }
          // Stream AI audio back to browser
          const delta = event.delta as string;
          if (delta && browserWs.readyState === WebSocket.OPEN) {
            clearResponseKickTimer();
            browserWs.send(JSON.stringify({ type: 'audio', data: delta }));
          }
          break;
        }

        case 'response.audio_transcript.delta': {
          if (!repHasSpoken) {
            partialAiText = '';
            aiSpeechStartedAt = null;
            break;
          }
          // Accumulate partial AI transcript
          const text = event.delta as string;
          if (text) {
            if (!aiSpeechStartedAt) aiSpeechStartedAt = Date.now();
            partialAiText += text;
            clearResponseKickTimer();
            this.engineService.signalSpeaking(callId, 'PROSPECT');
            this.gateway.emitToCall(callId, 'transcript.partial', {
              speaker: 'PROSPECT',
              text: partialAiText,
              tsMs: aiSpeechStartedAt ?? Date.now(),
              isFinal: false,
            });
          }
          break;
        }

        case 'response.audio_transcript.done': {
          if (!repHasSpoken) {
            partialAiText = '';
            aiSpeechStartedAt = null;
            break;
          }
          // Final AI transcript
          const text = event.transcript as string;
          const finalText = (text?.trim() || partialAiText.trim());
          partialAiText = '';
          if (finalText) {
            clearResponseKickTimer();
            const tsMs = nextFinalTs(aiSpeechStartedAt ?? Date.now());
            aiSpeechStartedAt = null;
            this.gateway.emitToCall(callId, 'transcript.final', {
              speaker: 'PROSPECT',
              text: finalText,
              tsMs,
              isFinal: true,
            });
            this.engineService.pushTranscript(callId, 'PROSPECT', finalText);
            this.db.insert(schema.callTranscript).values({
              callId,
              tsMs,
              speaker: 'PROSPECT',
              text: finalText,
              isFinal: true,
            }).catch((err: Error) =>
              this.logger.error(`Failed to persist AI transcript: ${err.message}`),
            );
          }
          break;
        }

        case 'conversation.item.input_audio_transcription.completed': {
          // REP's speech transcribed
          const text = event.transcript as string;
          if (text?.trim()) {
            repHasSpoken = true;
            const tsMs = nextFinalTs(userSpeechStartedAt ?? Date.now());
            userSpeechStartedAt = null;
            this.gateway.emitToCall(callId, 'transcript.final', {
              speaker: 'REP',
              text,
              tsMs,
              isFinal: true,
            });
            this.engineService.pushTranscript(callId, 'REP', text);
            this.db.insert(schema.callTranscript).values({
              callId,
              tsMs,
              speaker: 'REP',
              text,
              isFinal: true,
            }).catch((err: Error) =>
              this.logger.error(`Failed to persist REP transcript: ${err.message}`),
            );
            scheduleResponseKick();
          }
          break;
        }

        case 'error': {
          this.logger.error(`OpenAI Realtime error — call ${callId}: ${JSON.stringify(event.error)}`);
          browserWs.send(JSON.stringify({ type: 'error', message: 'AI error occurred' }));
          break;
        }
      }
    });

    openaiWs.on('error', (err) => {
      this.logger.error(`OpenAI Realtime WS error — call ${callId}: ${err.message}`);
      if (responseKickTimer) {
        clearTimeout(responseKickTimer);
        responseKickTimer = null;
      }
      browserWs.send(JSON.stringify({ type: 'error', message: 'AI connection error' }));
    });

    openaiWs.on('close', () => {
      this.logger.log(`OpenAI Realtime WS closed — call ${callId}`);
      if (responseKickTimer) {
        clearTimeout(responseKickTimer);
        responseKickTimer = null;
      }
    });

    browserWs.on('message', (rawData) => {
      let msg: { type: string; data?: string };
      try {
        msg = JSON.parse(rawData.toString());
      } catch {
        return;
      }

      if (msg.type === 'audio' && msg.data && openaiReady) {
        openaiWs.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: msg.data,
        }));
      }
    });

    browserWs.on('close', () => {
      this.logger.log(`Mock stream browser WS closed — call ${callId}`);
      clearResponseKickTimer();
      openaiWs.close();
    });

    browserWs.on('error', (err) => {
      this.logger.error(`Mock stream browser WS error — call ${callId}: ${err.message}`);
      clearResponseKickTimer();
      openaiWs.close();
    });
  }

  getAvailablePersonas() {
    return PRACTICE_PERSONAS.map((p) => ({
      id: p.id,
      name: p.name,
      title: p.title,
      description: p.description,
      difficulty: p.difficulty,
      color: p.color,
    }));
  }

  private buildProspectPersona(personaId: string | null, notes: string | null): string {
    const persona = getPersonaById(personaId);
    const variation = this.buildSessionVariation();
    return (
      persona.prompt +
      `\nSESSION VARIATION:\n${variation}\n` +
      (notes
        ? `\nSCENARIO CONTEXT from the rep: ${notes}\nAdapt your persona to match this scenario while keeping your core personality.\n`
        : '')
    );
  }

  private buildCustomPersona(customPrompt: string, notes: string | null): string {
    const variation = this.buildSessionVariation();
    return (
      customPrompt +
      `\nSESSION VARIATION:\n${variation}\n` +
      (notes
        ? `\nSCENARIO CONTEXT from the rep: ${notes}\nAdapt your persona to match this scenario.\n`
        : '')
    );
  }

  private buildSessionVariation() {
    const tones = [
      'You are impatient and concise.',
      'You are skeptical and blunt.',
      'You are cautious and analytical.',
      'You are polite but resistant.',
      'You are direct and time-constrained.',
    ];
    const firstPushbacks = [
      "We're fine as is right now.",
      "Not a priority for us today.",
      "We already have something in place.",
      "I don't see a strong reason to switch.",
      "Honestly, this sounds like what everyone says.",
    ];
    const challengeModes = [
      'Press for concrete proof and examples from similar companies.',
      'Test for differentiation versus current alternatives.',
      'Challenge timeline urgency and ask why now matters.',
      'Push on risk, implementation burden, and team adoption.',
      'Push on ROI credibility and total effort required.',
    ];
    const styleShifts = [
      'Use short, skeptical follow-up questions.',
      'Interrupt generic answers and ask for specifics.',
      'Avoid agreeing quickly; ask one hard question before softening.',
      'If the rep is vague, become more resistant immediately.',
      'If the rep is specific, soften slightly but keep pressure.',
    ];
    const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]!;
    return [
      pick(tones),
      `First response style: "${pick(firstPushbacks)}"`,
      pick(challengeModes),
      pick(styleShifts),
    ].join('\n');
  }
}
