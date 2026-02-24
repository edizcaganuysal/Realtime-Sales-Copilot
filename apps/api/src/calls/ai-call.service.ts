import { HttpAdapterHost } from '@nestjs/core';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { WebSocketServer as WsServer } from 'ws';
import WebSocket from 'ws';
import { eq, asc, desc } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CallsGateway } from './calls.gateway';
import { buildAiCallerPrompt } from './ai-caller.prompt';
import { twilioToOpenAI, openAIToTwilio } from './audio-utils';
import { CreditsService } from '../credits/credits.service';

@Injectable()
export class AiCallService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiCallService.name);
  private readonly apiKey = process.env['LLM_API_KEY'] ?? '';

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly gateway: CallsGateway,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly creditsService: CreditsService,
  ) {}

  get available(): boolean {
    return !!this.apiKey;
  }

  onApplicationBootstrap() {
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();
    const wss = new WsServer({ noServer: true });

    httpServer.prependListener('upgrade', (req: { url?: string }, socket: unknown, head: unknown) => {
      const pathname = req.url?.split('?')[0] ?? '';
      if (pathname !== '/ai-call-stream') return;
      this.logger.log('WS upgrade intercepted for /ai-call-stream');
      (wss as WsServer).handleUpgrade(
        req as Parameters<WsServer['handleUpgrade']>[0],
        socket as Parameters<WsServer['handleUpgrade']>[1],
        head as Parameters<WsServer['handleUpgrade']>[2],
        (ws) => wss.emit('connection', ws, req),
      );
    });

    wss.on('connection', (twilioWs: WebSocket) => {
      this.logger.log('Twilio Media Stream connected at /ai-call-stream');
      this.handleAiCallSession(twilioWs);
    });

    this.logger.log('AI Call WS attached at /ai-call-stream');
  }

  /**
   * HTTP-based AI call turn handler — used with Twilio <Gather> TwiML.
   * Persists prospect speech, calls OpenAI Chat Completions, returns AI response text.
   * Prefix [HANGUP] in the AI response signals that the call should end.
   */
  async handleGatherWebhook(
    callId: string,
    speechResult: string | null,
  ): Promise<{ aiText: string; shouldHangup: boolean }> {
    const fallback = { aiText: 'Thank you for your time. Have a great day!', shouldHangup: true };
    if (!this.apiKey) return fallback;

    try {
      // 1. Persist prospect speech and load call row in parallel (saves ~80ms vs sequential)
      const prospectText = speechResult?.trim() ?? null;
      const prospectTsMs = prospectText ? Date.now() : 0;

      const persistSpeech = prospectText
        ? this.db
            .insert(schema.callTranscript)
            .values({ callId, tsMs: prospectTsMs, speaker: 'PROSPECT', text: prospectText, isFinal: true })
            .then(() => {
              this.gateway.emitToCall(callId, 'transcript.final', {
                speaker: 'PROSPECT',
                text: prospectText,
                tsMs: prospectTsMs,
                isFinal: true,
              });
            })
            .catch((err: Error) => this.logger.warn(`Speech persist error: ${err.message}`))
        : Promise.resolve();

      const [[callRow]] = await Promise.all([
        this.db
          .select({
            orgId: schema.calls.orgId,
            agentId: schema.calls.agentId,
            preparedOpenerText: schema.calls.preparedOpenerText,
          })
          .from(schema.calls)
          .where(eq(schema.calls.id, callId))
          .limit(1),
        persistSpeech,
      ]);

      if (!callRow) return fallback;

      // 2. Load context + last 16 transcript rows in parallel
      const [ctxRow, productRows, agentRow, transcriptRows] = await Promise.all([
        this.db
          .select({
            companyName: schema.salesContext.companyName,
            whatWeSell: schema.salesContext.whatWeSell,
            targetCustomer: schema.salesContext.targetCustomer,
            globalValueProps: schema.salesContext.globalValueProps,
            proofPoints: schema.salesContext.proofPoints,
          })
          .from(schema.salesContext)
          .where(eq(schema.salesContext.orgId, callRow.orgId))
          .limit(1)
          .then((rows) => rows[0] ?? null),
        this.db
          .select({ name: schema.products.name, elevatorPitch: schema.products.elevatorPitch })
          .from(schema.products)
          .where(eq(schema.products.orgId, callRow.orgId)),
        callRow.agentId
          ? this.db
              .select({
                prompt: schema.agents.prompt,
                promptDelta: schema.agents.promptDelta,
                openers: schema.agents.openers,
              })
              .from(schema.agents)
              .where(eq(schema.agents.id, callRow.agentId))
              .limit(1)
              .then((rows) => rows[0] ?? null)
          : Promise.resolve(null),
        // Fetch last 16 rows (8 turns) newest-first, then reverse for chronological order
        this.db
          .select({ speaker: schema.callTranscript.speaker, text: schema.callTranscript.text })
          .from(schema.callTranscript)
          .where(eq(schema.callTranscript.callId, callId))
          .orderBy(desc(schema.callTranscript.tsMs))
          .limit(16)
          .then((rows) => rows.reverse()),
      ]);

      const toList = (val: unknown): string[] =>
        Array.isArray(val) ? val.filter((v): v is string => typeof v === 'string') : [];

      const openers = toList(agentRow?.openers);
      const opener =
        callRow.preparedOpenerText?.trim() ||
        (openers.length > 0 ? openers[0] : null) ||
        `Hi, this is Alex from ${ctxRow?.companyName || 'our company'}. Quick question — do you have 30 seconds?`;

      const strategy = agentRow?.promptDelta?.trim() || agentRow?.prompt?.trim() || '';

      const systemPrompt = buildAiCallerPrompt({
        companyName: ctxRow?.companyName ?? '',
        whatWeSell: ctxRow?.whatWeSell ?? '',
        targetCustomer: ctxRow?.targetCustomer ?? '',
        globalValueProps: toList(ctxRow?.globalValueProps),
        proofPoints: toList(ctxRow?.proofPoints),
        products: productRows,
        strategy,
        opener,
      });

      // 3. Build Chat Completions message history
      // REP utterances → assistant turns; PROSPECT utterances → user turns
      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        {
          role: 'system',
          content:
            systemPrompt +
            '\n\nIMPORTANT: When you want to end the call, place [HANGUP] anywhere in your response. It will be removed before the prospect hears it.',
        },
      ];

      for (const row of transcriptRows) {
        if (row.speaker === 'REP') {
          messages.push({ role: 'assistant', content: row.text });
        } else {
          messages.push({ role: 'user', content: row.text });
        }
      }

      // First turn — no transcript yet
      if (transcriptRows.length === 0) {
        messages.push({ role: 'user', content: '[Call connected — begin with your opener now]' });
      }

      // 4. Call OpenAI Chat Completions
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages,
          max_completion_tokens: 80,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        this.logger.error(`OpenAI Chat error ${response.status}: ${await response.text()}`);
        return fallback;
      }

      const json = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      let aiText = json.choices[0]?.message?.content?.trim() ?? '';

      // Debit credits based on actual token usage (fire-and-forget)
      const promptTokens = Number(json.usage?.prompt_tokens ?? 0);
      const completionTokens = Number(json.usage?.completion_tokens ?? 0);
      if (promptTokens > 0 || completionTokens > 0) {
        void this.creditsService.debitForAiUsage(
          callRow.orgId, 'gpt-4o-mini', promptTokens, completionTokens,
          'USAGE_LLM_AI_CALLER_HTTP', { call_id: callId },
        );
      }

      // Detect [HANGUP] anywhere in the response, then strip it
      const shouldHangup = /\[HANGUP\]/i.test(aiText);
      if (shouldHangup) aiText = aiText.replace(/\[HANGUP\]\s*/gi, '').trim();

      if (!aiText) {
        return { aiText: 'Thank you, I appreciate your time.', shouldHangup: true };
      }

      // 5. Emit transcript immediately; persist in background (saves ~80ms)
      const aiTsMs = Date.now();
      this.gateway.emitToCall(callId, 'transcript.final', {
        speaker: 'REP',
        text: aiText,
        tsMs: aiTsMs,
        isFinal: true,
      });
      void this.db
        .insert(schema.callTranscript)
        .values({ callId, tsMs: aiTsMs, speaker: 'REP', text: aiText, isFinal: true })
        .catch((err: Error) => this.logger.warn(`AI persist error: ${err.message}`));

      return { aiText, shouldHangup };
    } catch (err) {
      this.logger.error(`handleGatherWebhook error: ${(err as Error).message}`);
      return fallback;
    }
  }

  /**
   * Called by MediaStreamService when it detects an AI_CALLER call on /media-stream.
   * Picks up the already-established Twilio WebSocket and starts the AI session.
   */
  startFromHandover(ws: WebSocket, callId: string, streamSid: string | null): void {
    this.logger.log(`AI call handover received — callId=${callId} streamSid=${streamSid}`);
    this.handleAiCallSession(ws, callId, streamSid);
  }

  private handleAiCallSession(twilioWs: WebSocket, initialCallId: string | null = null, initialStreamSid: string | null = null) {
    let callId: string | null = initialCallId;
    let streamSid: string | null = initialStreamSid;
    let openaiWs: WebSocket | null = null;
    let sessionReady = false;
    let partialAiText = '';
    let aiSpeechStartedAt: number | null = null;
    let lastTsMs = Date.now();

    const nextTs = () => {
      const now = Date.now();
      lastTsMs = now > lastTsMs ? now : lastTsMs + 1;
      return lastTsMs;
    };

    const sendToTwilio = (payload: Record<string, unknown>) => {
      if (twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.send(JSON.stringify(payload));
      }
    };

    const persistTranscript = (speaker: 'REP' | 'PROSPECT', text: string, tsMs: number) => {
      if (!callId) return;
      this.db.insert(schema.callTranscript).values({ callId, tsMs, speaker, text, isFinal: true })
        .catch((err: Error) => this.logger.error(`Transcript persist error: ${err.message}`));
    };

    const emitTranscript = (speaker: 'REP' | 'PROSPECT', text: string) => {
      if (!callId) return;
      const tsMs = nextTs();
      this.gateway.emitToCall(callId, 'transcript.final', { speaker, text, tsMs, isFinal: true });
      persistTranscript(speaker, text, tsMs);
    };

    const closeAll = () => {
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.close();
      }
      if (callId) {
        this.db.update(schema.calls)
          .set({ status: 'COMPLETED' })
          .where(eq(schema.calls.id, callId))
          .catch((err: Error) => this.logger.error(`Call status update error: ${err.message}`));
        this.gateway.emitToCall(callId, 'call.ended', { callId });
      }
    };

    const startOpenAI = async (cId: string) => {
      // Load call row first (need orgId + agentId + contactJson for model/voice)
      const [callRow] = await this.db
        .select()
        .from(schema.calls)
        .where(eq(schema.calls.id, cId))
        .limit(1);

      if (!callRow) {
        this.logger.error(`AI call not found: ${cId}`);
        twilioWs.close();
        return;
      }

      const orgId = callRow.orgId;
      const contactCfg = (callRow.contactJson ?? {}) as Record<string, unknown>;
      const selectedVoice = (typeof contactCfg.aiVoice === 'string' ? contactCfg.aiVoice : 'marin') as string;
      const selectedModel = (typeof contactCfg.aiModel === 'string' ? contactCfg.aiModel : 'gpt-4o-mini-realtime-preview') as string;

      // Start OpenAI WS connection + load context in parallel (saves ~150ms)
      const contextPromise = Promise.all([
        this.db
          .select({
            companyName: schema.salesContext.companyName,
            whatWeSell: schema.salesContext.whatWeSell,
            targetCustomer: schema.salesContext.targetCustomer,
            globalValueProps: schema.salesContext.globalValueProps,
            proofPoints: schema.salesContext.proofPoints,
          })
          .from(schema.salesContext)
          .where(eq(schema.salesContext.orgId, callRow.orgId))
          .limit(1)
          .then((rows) => rows[0] ?? null),
        this.db
          .select({ name: schema.products.name, elevatorPitch: schema.products.elevatorPitch })
          .from(schema.products)
          .where(eq(schema.products.orgId, callRow.orgId)),
        callRow.agentId
          ? this.db
              .select({ prompt: schema.agents.prompt, promptDelta: schema.agents.promptDelta, openers: schema.agents.openers })
              .from(schema.agents)
              .where(eq(schema.agents.id, callRow.agentId))
              .limit(1)
              .then((rows) => rows[0] ?? null)
          : Promise.resolve(null),
      ]);

      openaiWs = new WebSocket(
        `wss://api.openai.com/v1/realtime?model=${selectedModel}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'OpenAI-Beta': 'realtime=v1',
          },
        },
      );

      openaiWs.on('open', async () => {
        this.logger.log(`OpenAI Realtime connected for AI call ${cId} (model=${selectedModel}, voice=${selectedVoice})`);

        // Context is likely already loaded by now; await just in case
        const [ctxRow, productRows, agentRow] = await contextPromise;

        const toList = (val: unknown): string[] =>
          Array.isArray(val) ? val.filter((v): v is string => typeof v === 'string') : [];

        const openers = toList(agentRow?.openers);
        const opener =
          callRow.preparedOpenerText?.trim() ||
          (openers.length > 0 ? openers[0] : null) ||
          `Hi, this is Alex from ${ctxRow?.companyName || 'our company'}. Quick question — do you have 30 seconds?`;

        const strategy = agentRow?.promptDelta?.trim() || agentRow?.prompt?.trim() || '';

        const prompt = buildAiCallerPrompt({
          companyName: ctxRow?.companyName ?? '',
          whatWeSell: ctxRow?.whatWeSell ?? '',
          targetCustomer: ctxRow?.targetCustomer ?? '',
          globalValueProps: toList(ctxRow?.globalValueProps),
          proofPoints: toList(ctxRow?.proofPoints),
          products: productRows,
          strategy,
          opener,
        });

        openaiWs!.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: prompt,
            voice: selectedVoice,
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: 'whisper-1', language: 'en' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 600,
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
          case 'session.updated': {
            // Only trigger opener AFTER config is applied (not on session.created)
            if (!sessionReady) {
              sessionReady = true;
              this.logger.log(`OpenAI session configured for AI call ${cId}`);
              openaiWs!.send(JSON.stringify({ type: 'response.create', response: { modalities: ['audio', 'text'] } }));
            }
            break;
          }

          case 'response.audio.delta': {
            // AI rep speech — send to Twilio (to prospect's phone)
            const delta = event.delta as string;
            if (delta && streamSid) {
              const mulawPayload = openAIToTwilio(delta);
              sendToTwilio({
                event: 'media',
                streamSid,
                media: { payload: mulawPayload },
              });
            }
            break;
          }

          case 'response.audio_transcript.delta': {
            const text = event.delta as string;
            if (text) {
              if (!aiSpeechStartedAt) aiSpeechStartedAt = Date.now();
              partialAiText += text;
              this.gateway.emitToCall(cId, 'transcript.partial', {
                speaker: 'REP',
                text: partialAiText,
                tsMs: aiSpeechStartedAt,
                isFinal: false,
              });
            }
            break;
          }

          case 'response.audio_transcript.done': {
            const text = event.transcript as string;
            const finalText = text?.trim() || partialAiText.trim();
            partialAiText = '';
            if (finalText) {
              emitTranscript('REP', finalText);
            }
            aiSpeechStartedAt = null;
            break;
          }

          case 'conversation.item.input_audio_transcription.completed': {
            const text = event.transcript as string;
            if (text?.trim()) {
              emitTranscript('PROSPECT', text.trim());
            }
            break;
          }

          case 'response.done': {
            const usage = event.usage as {
              input_tokens?: number;
              output_tokens?: number;
              input_token_details?: { audio_tokens?: number; text_tokens?: number };
              output_token_details?: { audio_tokens?: number; text_tokens?: number };
            } | undefined;
            if (usage && orgId) {
              const totalInput = Number(usage.input_tokens ?? 0);
              const totalOutput = Number(usage.output_tokens ?? 0);
              const audioInput = Number(usage.input_token_details?.audio_tokens ?? 0);
              const audioOutput = Number(usage.output_token_details?.audio_tokens ?? 0);
              const textInput = Math.max(0, totalInput - audioInput);
              const textOutput = Math.max(0, totalOutput - audioOutput);
              if (textInput > 0 || textOutput > 0) {
                void this.creditsService.debitForAiUsage(
                  orgId, selectedModel, textInput, textOutput,
                  'USAGE_LLM_AI_CALLER_REALTIME', { call_id: cId },
                );
              }
              if (audioInput > 0 || audioOutput > 0) {
                void this.creditsService.debitForRealtimeAudio(
                  orgId, selectedModel, audioInput, audioOutput,
                  'USAGE_AUDIO_AI_CALLER_REALTIME', { call_id: cId },
                );
              }
            }
            break;
          }

          case 'error': {
            const errPayload = event.error && typeof event.error === 'object'
              ? (event.error as Record<string, unknown>)
              : {};
            const message = typeof errPayload['message'] === 'string' ? errPayload['message'] : '';
            this.logger.error(`OpenAI error for AI call ${cId}: ${message}`);
            break;
          }
        }
      });

      openaiWs.on('error', (err) => {
        this.logger.error(`OpenAI WS error for AI call ${cId}: ${err.message}`);
      });

      openaiWs.on('close', () => {
        this.logger.log(`OpenAI WS closed for AI call ${cId}`);
      });
    };

    // If callId was pre-set via handover from MediaStreamService, start OpenAI immediately
    if (callId) {
      void startOpenAI(callId);
    }

    // Handle Twilio Media Stream messages
    twilioWs.on('message', (rawData) => {
      let msg: { event: string; [key: string]: unknown };
      try {
        msg = JSON.parse(rawData.toString());
      } catch {
        return;
      }

      switch (msg.event) {
        case 'connected':
          this.logger.log('Twilio media stream connected');
          break;

        case 'start': {
          // Skip if already initialized via handover from MediaStreamService
          if (callId) break;

          const startData = msg.start as Record<string, unknown> | undefined;
          streamSid = (msg.streamSid ?? startData?.streamSid) as string | null;
          const customParams = (startData?.customParameters ?? {}) as Record<string, unknown>;
          callId = (customParams['callId'] ?? null) as string | null;

          if (!callId) {
            this.logger.error('AI call stream started without callId in customParameters');
            twilioWs.close();
            return;
          }

          this.logger.log(`AI call stream started — callId=${callId} streamSid=${streamSid}`);
          void startOpenAI(callId);
          break;
        }

        case 'media': {
          if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) break;
          const mediaPayload = msg.media as Record<string, unknown> | undefined;
          const track = mediaPayload?.track as string | undefined;
          // Only process inbound audio (from the prospect)
          if (track !== 'inbound' && track !== undefined) break;
          const payload = mediaPayload?.payload as string | undefined;
          if (!payload) break;

          try {
            const pcm16Payload = twilioToOpenAI(payload);
            openaiWs.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: pcm16Payload,
            }));
          } catch (err) {
            this.logger.warn(`Audio transcoding error: ${(err as Error).message}`);
          }
          break;
        }

        case 'stop':
          this.logger.log(`AI call stream stopped — callId=${callId}`);
          closeAll();
          break;
      }
    });

    twilioWs.on('error', (err) => {
      this.logger.error(`Twilio WS error for AI call ${callId}: ${err.message}`);
      closeAll();
    });

    twilioWs.on('close', () => {
      this.logger.log(`Twilio WS closed for AI call ${callId}`);
      closeAll();
    });
  }
}
