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

    // Load org sales context and products so the prospect AI knows what is being sold
    const [ctxRow, productRows] = await Promise.all([
      this.db
        .select({
          companyName: schema.salesContext.companyName,
          whatWeSell: schema.salesContext.whatWeSell,
          targetCustomer: schema.salesContext.targetCustomer,
          targetRoles: schema.salesContext.targetRoles,
          industries: schema.salesContext.industries,
          globalValueProps: schema.salesContext.globalValueProps,
          proofPoints: schema.salesContext.proofPoints,
          caseStudies: schema.salesContext.caseStudies,
          buyingTriggers: schema.salesContext.buyingTriggers,
        })
        .from(schema.salesContext)
        .where(eq(schema.salesContext.orgId, callRow.orgId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      this.db
        .select({
          name: schema.products.name,
          elevatorPitch: schema.products.elevatorPitch,
          valueProps: schema.products.valueProps,
        })
        .from(schema.products)
        .where(eq(schema.products.orgId, callRow.orgId)),
    ]);

    let prospectPersona: string;
    if (customPersonaPrompt) {
      prospectPersona = this.buildCustomPersona(customPersonaPrompt, callRow.notes ?? null, ctxRow, productRows);
    } else if (practicePersonaId?.startsWith('custom:')) {
      // Load saved custom persona from agents table
      const agentId = practicePersonaId.replace(/^custom:/, '');
      const [agent] = await this.db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, agentId))
        .limit(1);
      prospectPersona = agent
        ? this.buildCustomPersona(agent.prompt, callRow.notes ?? null, ctxRow, productRows)
        : this.buildProspectPersona(null, callRow.notes ?? null, ctxRow, productRows);
    } else {
      prospectPersona = this.buildProspectPersona(practicePersonaId, callRow.notes ?? null, ctxRow, productRows);
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
    let responseActive = false;
    let assistantAudioActive = false;
    let assistantAudioTimer: ReturnType<typeof setTimeout> | null = null;
    let assistantSpeakingBroadcast = false;
    let responseDoneFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let responseWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let lastAssistantAudioAt = 0;
    let lastProspectFinalAt = 0;
    let lastProspectFinalText = '';
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
    const clearAssistantAudioTimer = () => {
      if (!assistantAudioTimer) return;
      clearTimeout(assistantAudioTimer);
      assistantAudioTimer = null;
    };
    const clearResponseDoneFallbackTimer = () => {
      if (!responseDoneFallbackTimer) return;
      clearTimeout(responseDoneFallbackTimer);
      responseDoneFallbackTimer = null;
    };
    const clearResponseWatchdog = () => {
      if (!responseWatchdogTimer) return;
      clearTimeout(responseWatchdogTimer);
      responseWatchdogTimer = null;
    };
    const bumpResponseWatchdog = () => {
      clearResponseWatchdog();
      responseWatchdogTimer = setTimeout(() => {
        responseWatchdogTimer = null;
        if (!responseActive) return;
        this.logger.warn(`Mock response watchdog released stuck response state — call ${callId}`);
        responseActive = false;
        partialAiText = '';
        aiSpeechStartedAt = null;
        assistantAudioActive = false;
        clearAssistantAudioTimer();
        emitAssistantSpeaking(false);
        scheduleResponseKick();
      }, 12_000);
    };
    const emitAssistantSpeaking = (speaking: boolean) => {
      if (assistantSpeakingBroadcast === speaking) return;
      assistantSpeakingBroadcast = speaking;
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(JSON.stringify({ type: 'assistant_speaking', speaking }));
      }
      this.gateway.emitToCall(callId, 'mock.assistant_speaking', {
        speaking,
        tsMs: Date.now(),
      });
    };
    const normalizeFinalText = (value: string) => {
      const cleaned = value.replace(/\s+/g, ' ').trim();
      if (!cleaned) return '';
      return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
    };
    const emitProspectFinal = (rawText: string, tsCandidate: number) => {
      const finalText = normalizeFinalText(rawText);
      aiSpeechStartedAt = null;
      if (!finalText) return;
      const tsMs = nextFinalTs(tsCandidate);
      lastProspectFinalAt = tsMs;
      lastProspectFinalText = finalText;
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
    };
    const markAssistantAudioActive = () => {
      assistantAudioActive = true;
      lastAssistantAudioAt = Date.now();
      emitAssistantSpeaking(true);
      clearAssistantAudioTimer();
      assistantAudioTimer = setTimeout(() => {
        assistantAudioActive = false;
        assistantAudioTimer = null;
        emitAssistantSpeaking(false);
        // Flush audio buffered by OpenAI VAD during AI playback (prevents echo transcription)
        if (openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
        }
      }, 600);
    };
    const normalize = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const isLikelyEchoTranscript = (text: string) => {
      if (Date.now() - lastAssistantAudioAt > 5000) return false;
      const normalizedText = normalize(text);
      const normalizedProspect = normalize(lastProspectFinalText);
      if (!normalizedText || !normalizedProspect) return false;
      const delta = Math.abs(normalizedText.length - normalizedProspect.length);
      if (delta > Math.max(8, Math.floor(normalizedProspect.length * 0.12))) return false;
      if (Date.now() - lastProspectFinalAt > 5000) return false;
      return (
        normalizedText === normalizedProspect ||
        normalizedText.startsWith(normalizedProspect) ||
        normalizedProspect.startsWith(normalizedText)
      );
    };
    const scheduleResponseKick = () => {
      clearResponseKickTimer();
      if (!openaiReady || !repHasSpoken || openaiWs.readyState !== WebSocket.OPEN) return;
      responseKickTimer = setTimeout(() => {
        responseKickTimer = null;
        if (!openaiReady || !repHasSpoken || openaiWs.readyState !== WebSocket.OPEN) return;
        if (responseActive) return;
        if (assistantAudioActive) return;
        if (aiSpeechStartedAt || partialAiText.trim().length > 0) return;
        if (Date.now() - lastProspectFinalAt < 950) return;
        responseActive = true;
        openaiWs.send(
          JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['audio', 'text'],
              temperature: 1.05,
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
          instructions:
            `${prospectPersona}\n` +
            `TURN STYLE:\n` +
            `- Respond naturally as the persona to the rep's latest message.\n` +
            `- Always finish complete sentences before ending your turn.\n` +
            `- Do not cut yourself off mid-thought.\n`,
          temperature: 1.05,
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
          if (assistantAudioActive || responseActive) {
            userSpeechStartedAt = null;
            break;
          }
          userSpeechStartedAt = Date.now();
          clearResponseKickTimer();
          break;
        }

        case 'input_audio_buffer.speech_stopped': {
          if (assistantAudioActive || responseActive) {
            userSpeechStartedAt = null;
            break;
          }
          if (!userSpeechStartedAt) {
            userSpeechStartedAt = Date.now();
          }
          const speechDuration = Date.now() - userSpeechStartedAt;
          if (speechDuration < 320) {
            userSpeechStartedAt = null;
            break;
          }
          repHasSpoken = true;
          scheduleResponseKick();
          break;
        }

        case 'response.created': {
          responseActive = true;
          bumpResponseWatchdog();
          break;
        }

        case 'response.audio.delta': {
          if (!repHasSpoken) {
            break;
          }
          bumpResponseWatchdog();
          markAssistantAudioActive();
          this.engineService.signalSpeaking(callId, 'PROSPECT');
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
          bumpResponseWatchdog();
          markAssistantAudioActive();
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
          clearResponseDoneFallbackTimer();
          const text = event.transcript as string;
          const finalText = text?.trim() || partialAiText.trim();
          partialAiText = '';
          if (finalText) {
            clearResponseKickTimer();
            emitProspectFinal(finalText, aiSpeechStartedAt ?? Date.now());
          }
          break;
        }

        case 'conversation.item.input_audio_transcription.completed': {
          // REP's speech transcribed
          const text = event.transcript as string;
          if (text?.trim()) {
            if (assistantAudioActive || isLikelyEchoTranscript(text)) {
              userSpeechStartedAt = null;
              break;
            }
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

        case 'response.done': {
          responseActive = false;
          clearResponseWatchdog();
          clearResponseDoneFallbackTimer();
          if (partialAiText.trim().length > 0) {
            const fallbackText = partialAiText.trim();
            const fallbackTs = aiSpeechStartedAt ?? Date.now();
            responseDoneFallbackTimer = setTimeout(() => {
              responseDoneFallbackTimer = null;
              if (!partialAiText.trim()) return;
              const textToEmit = partialAiText.trim() || fallbackText;
              partialAiText = '';
              emitProspectFinal(textToEmit, fallbackTs);
            }, 320);
          } else if (!assistantAudioActive) {
            emitAssistantSpeaking(false);
          }
          break;
        }

        case 'error': {
          responseActive = false;
          clearResponseWatchdog();
          assistantAudioActive = false;
          clearAssistantAudioTimer();
          emitAssistantSpeaking(false);
          clearResponseDoneFallbackTimer();
          const errPayload =
            event.error && typeof event.error === 'object'
              ? (event.error as Record<string, unknown>)
              : {};
          const message =
            typeof errPayload['message'] === 'string'
              ? errPayload['message']
              : '';
          const isActiveResponseRace = /active response/i.test(message);
          const isRecoverableSessionState = /invalid_state|already exists|already closed|buffer/i.test(
            message.toLowerCase(),
          );
          if (!isActiveResponseRace && !isRecoverableSessionState) {
            this.logger.error(`OpenAI Realtime error — call ${callId}: ${JSON.stringify(event.error)}`);
          } else {
            this.logger.warn(`OpenAI Realtime recoverable error ignored — call ${callId}: ${message}`);
          }
          break;
        }
      }
    });

    openaiWs.on('error', (err) => {
      this.logger.error(`OpenAI Realtime WS error — call ${callId}: ${err.message}`);
      responseActive = false;
      clearResponseWatchdog();
      assistantAudioActive = false;
      clearAssistantAudioTimer();
      emitAssistantSpeaking(false);
      clearResponseDoneFallbackTimer();
      if (responseKickTimer) {
        clearTimeout(responseKickTimer);
        responseKickTimer = null;
      }
    });

    openaiWs.on('close', () => {
      this.logger.log(`OpenAI Realtime WS closed — call ${callId}`);
      responseActive = false;
      clearResponseWatchdog();
      assistantAudioActive = false;
      clearAssistantAudioTimer();
      emitAssistantSpeaking(false);
      clearResponseDoneFallbackTimer();
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
        if (assistantAudioActive || openaiWs.readyState !== WebSocket.OPEN) {
          return;
        }
        openaiWs.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: msg.data,
        }));
      }
    });

    browserWs.on('close', () => {
      this.logger.log(`Mock stream browser WS closed — call ${callId}`);
      clearResponseKickTimer();
      clearAssistantAudioTimer();
      emitAssistantSpeaking(false);
      clearResponseDoneFallbackTimer();
      clearResponseWatchdog();
      openaiWs.close();
    });

    browserWs.on('error', (err) => {
      this.logger.error(`Mock stream browser WS error — call ${callId}: ${err.message}`);
      clearResponseKickTimer();
      clearAssistantAudioTimer();
      emitAssistantSpeaking(false);
      clearResponseDoneFallbackTimer();
      clearResponseWatchdog();
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

  private buildCompanyContextBlock(
    ctx: {
      companyName?: string | null;
      whatWeSell?: string | null;
      targetCustomer?: string | null;
      targetRoles?: unknown;
      industries?: unknown;
      globalValueProps?: unknown;
      proofPoints?: unknown;
      caseStudies?: unknown;
      buyingTriggers?: unknown;
    } | null,
    products: { name: string; elevatorPitch?: string | null; valueProps?: unknown }[],
  ): string {
    if (!ctx) return '';
    const toList = (val: unknown): string[] => (Array.isArray(val) ? val.filter((v): v is string => typeof v === 'string') : []);
    const companyName = ctx.companyName?.trim() || null;
    const whatWeSell = ctx.whatWeSell?.trim() || null;
    const targetCustomer = ctx.targetCustomer?.trim() || null;
    const targetRoles = toList(ctx.targetRoles);
    const industries = toList(ctx.industries);
    const valueProps = toList(ctx.globalValueProps);
    const proofPoints = toList(ctx.proofPoints);
    const buyingTriggers = toList(ctx.buyingTriggers);

    const productLines = products
      .map((p) => {
        const pitch = p.elevatorPitch?.trim() || '';
        return pitch ? `  - ${p.name}: ${pitch}` : `  - ${p.name}`;
      })
      .join('\n');

    if (!companyName && !whatWeSell && !targetCustomer && products.length === 0) return '';

    const lines: string[] = ['\nCOMPANY CONTEXT — what the sales rep is selling:'];
    if (companyName) lines.push(`- Company: ${companyName}`);
    if (whatWeSell) lines.push(`- Offering: ${whatWeSell}`);
    if (products.length > 0) lines.push(`- Products/services:\n${productLines}`);
    if (targetCustomer) lines.push(`- Target customer (your profile): ${targetCustomer}`);
    if (targetRoles.length > 0) lines.push(`- Target roles: ${targetRoles.join(', ')}`);
    if (industries.length > 0) lines.push(`- Industries: ${industries.join(', ')}`);
    if (buyingTriggers.length > 0) lines.push(`- Typical buying triggers: ${buyingTriggers.slice(0, 3).join('; ')}`);
    if (valueProps.length > 0) lines.push(`- Their value claims: ${valueProps.slice(0, 4).join(' / ')}`);
    if (proofPoints.length > 0) lines.push(`- Proof points they may cite: ${proofPoints.slice(0, 3).join(' / ')}`);
    lines.push(
      `\nYou are a realistic prospect matching the target customer profile above.`,
      `You have a legitimate need in this space but are not yet convinced this rep or company is the right fit.`,
      `React to every specific claim or product name the rep mentions — this is a real company's offering.`,
      `Push the rep to prove their specific value for YOUR situation, not generic benefits.`,
    );
    return lines.join('\n');
  }

  private buildProspectPersona(
    personaId: string | null,
    notes: string | null,
    ctx: Parameters<MockCallService['buildCompanyContextBlock']>[0],
    products: Parameters<MockCallService['buildCompanyContextBlock']>[1],
  ): string {
    const persona = getPersonaById(personaId);
    const variation = this.buildSessionVariation();
    const companyBlock = this.buildCompanyContextBlock(ctx, products);
    return (
      persona.prompt +
      companyBlock +
      `\nSESSION VARIATION:\n${variation}\n` +
      (notes
        ? `\nSCENARIO CONTEXT from the rep: ${notes}\nAdapt your persona to match this scenario while keeping your core personality.\n`
        : '')
    );
  }

  private buildCustomPersona(
    customPrompt: string,
    notes: string | null,
    ctx: Parameters<MockCallService['buildCompanyContextBlock']>[0],
    products: Parameters<MockCallService['buildCompanyContextBlock']>[1],
  ): string {
    const variation = this.buildSessionVariation();
    const companyBlock = this.buildCompanyContextBlock(ctx, products);
    return (
      customPrompt +
      companyBlock +
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
      'You are distracted — you have other things on your mind and are barely paying attention.',
      'You are mildly curious but deeply noncommittal.',
      'You are straightforward and no-nonsense; you dislike small talk.',
      'You are politely dismissive — you would rather end the call quickly than engage.',
    ];
    const openingStyle = [
      'Open defensively — signal that you have limited time without being rude.',
      'Open skeptically — make it clear you get a lot of sales calls and are not excited.',
      'Open distantly — give short answers, offer nothing voluntarily.',
      'Open neutrally — don\'t commit either way; let them do the work.',
      'Open with mild curiosity but keep your guard up immediately after.',
      'Open with a question that puts the rep on the spot.',
      'Open with polite impatience — acknowledge the call but make clear you have other things going on.',
    ];
    const challengeModes = [
      'Press for concrete proof and examples from similar companies.',
      'Test for differentiation versus current alternatives.',
      'Challenge timeline urgency and ask why now matters.',
      'Push on risk, implementation burden, and team adoption.',
      'Push on ROI credibility and total effort required.',
      'Focus on whether this is actually solving a real problem you have right now.',
      'Challenge whether the rep understands your specific situation at all.',
      'Ask probing questions about what happens if this doesn\'t work out.',
    ];
    const styleShifts = [
      'Use short, skeptical follow-up questions.',
      'Interrupt generic answers and ask for specifics.',
      'Avoid agreeing quickly; ask one hard question before softening.',
      'If the rep is vague, become more resistant immediately.',
      'If the rep is specific, soften slightly but keep pressure.',
      'Frequently redirect back to your own priorities rather than their pitch.',
      'Ask the same type of question twice in different ways to test consistency.',
      'Respond with silence-like minimal answers ("mm", "okay", "sure") to make the rep work harder.',
    ];
    const pacing = [
      'Answer in one sentence, then wait for the rep to carry the conversation.',
      'Give brief answers — let the rep fill the silence.',
      'Give a bit more context than usual, but always follow with a skeptical question.',
      'Be economical — only say what is necessary to respond, nothing more.',
    ];
    const sessionSeed = Date.now();
    const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]!;
    return [
      `Session ID: ${sessionSeed} — vary your behavior; do not repeat patterns from any previous session.`,
      pick(tones),
      pick(openingStyle),
      pick(challengeModes),
      pick(styleShifts),
      pick(pacing),
    ].join('\n');
  }
}
