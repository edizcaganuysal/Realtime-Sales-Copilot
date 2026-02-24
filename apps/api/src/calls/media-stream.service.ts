import { HttpAdapterHost } from '@nestjs/core';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { WebSocketServer as WsServer } from 'ws';
import type WebSocket from 'ws';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CallsGateway } from './calls.gateway';
import { SttService } from './stt.service';
import { EngineService } from './engine.service';
import { AiCallService } from './ai-call.service';
import { SupportEngineService } from '../support/support-engine.service';
import { SupportGateway } from '../support/support.gateway';

type TwilioMsg =
  | { event: 'connected' }
  | {
      event: 'start';
      start: {
        callSid: string;
        streamSid: string;
        tracks: string[];
        mediaFormat: object;
        customParameters?: Record<string, string>;
      };
    }
  | { event: 'media'; media: { track: string; payload: string; timestamp: string } }
  | { event: 'stop' };

/**
 * Attaches a raw WebSocket server at /media-stream on the shared HTTP server.
 * Twilio Media Streams connect here, audio is forwarded to Deepgram, and
 * transcripts are emitted via socket.io and persisted to the DB.
 *
 * callId is extracted from the TwiML <Parameter name="callId"> which arrives
 * in the `start.customParameters` object (NOT the URL query string — Twilio
 * strips query params from WebSocket URLs).
 */
@Injectable()
export class MediaStreamService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MediaStreamService.name);

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly gateway: CallsGateway,
    private readonly supportGateway: SupportGateway,
    private readonly sttService: SttService,
    private readonly engineService: EngineService,
    private readonly aiCallService: AiCallService,
    private readonly supportEngine: SupportEngineService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  onApplicationBootstrap() {
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();

    const wss = new WsServer({ noServer: true });

    // prependListener ensures our handler fires BEFORE engine.io's upgrade
    // handler, which would otherwise destroy non-socket.io sockets.
    httpServer.prependListener('upgrade', (req: { url?: string }, socket: unknown, head: unknown) => {
      const pathname = req.url?.split('?')[0] ?? '';
      if (pathname !== '/media-stream') return;
      this.logger.log(`WS upgrade intercepted for /media-stream (url: ${req.url})`);
      (wss as WsServer).handleUpgrade(
        req as Parameters<WsServer['handleUpgrade']>[0],
        socket as Parameters<WsServer['handleUpgrade']>[1],
        head as Parameters<WsServer['handleUpgrade']>[2],
        (ws) => wss.emit('connection', ws, req),
      );
    });

    wss.on('connection', (ws) => {
      this.logger.log('Media stream WS connected — waiting for start event to get callId');

      let callId: string | null = null;
      // 'pending' = mode check in-flight; 'ai' = handed to AiCallService; 'outbound' = regular; 'support' = support copilot
      let callMode: 'pending' | 'ai' | 'outbound' | 'support' = 'outbound';
      let supportSessionId: string | null = null;
      const deepgramByTrack = new Map<string, WebSocket>();
      const earlyMediaBuffer: Array<{ track: string; audio: Buffer }> = [];

      const normalizeTrack = (rawTrack: string) => {
        const value = rawTrack.toLowerCase();
        if (value.includes('outbound')) return 'outbound';
        if (value.includes('inbound')) return 'inbound';
        return 'inbound';
      };

      const speakerForTrack = (rawTrack: string) => {
        if (callMode === 'support') {
          return normalizeTrack(rawTrack) === 'outbound' ? 'AGENT' : 'CUSTOMER';
        }
        return normalizeTrack(rawTrack) === 'outbound' ? 'REP' : 'PROSPECT';
      };

      const closeSessions = () => {
        for (const session of deepgramByTrack.values()) {
          session.close();
        }
        deepgramByTrack.clear();
      };

      const ensureDeepgramSession = (rawTrack: string) => {
        if (!this.sttService.available) return null;
        const trackKey = normalizeTrack(rawTrack);
        const existing = deepgramByTrack.get(trackKey);
        if (existing) return existing;
        const speaker = speakerForTrack(trackKey);
        const session = this.sttService.createDeepgramSession(
          speaker,
          async (text, isFinal, spk) => {
            const callRef = callId;
            if (!callRef) return;
            if (!text.trim()) return;
            const tsMs = Date.now();

            if (callMode === 'support' && supportSessionId) {
              // Route to support engine + support gateway
              this.supportGateway.emitToSession(
                supportSessionId,
                isFinal ? 'transcript.final' : 'transcript.partial',
                { speaker: spk, text, tsMs, isFinal },
              );

              if (!isFinal) {
                this.supportEngine.signalSpeaking(supportSessionId, spk, text);
              }

              if (isFinal) {
                this.supportEngine.pushTranscript(supportSessionId, spk, text);
                await this.db.insert(schema.supportTranscript).values({
                  sessionId: supportSessionId,
                  tsMs,
                  speaker: spk,
                  text,
                  isFinal: true,
                });
              }
            } else {
              // Regular outbound call
              this.gateway.emitToCall(
                callRef,
                isFinal ? 'transcript.final' : 'transcript.partial',
                { speaker: spk, text, tsMs, isFinal },
              );

              if (!isFinal) {
                this.engineService.signalSpeaking(callRef, spk, text);
              }

              if (isFinal) {
                this.engineService.pushTranscript(callRef, spk, text);
                await this.db.insert(schema.callTranscript).values({
                  callId: callRef,
                  tsMs,
                  speaker: spk,
                  text,
                  isFinal: true,
                });
              }
            }
          },
        );
        deepgramByTrack.set(trackKey, session);
        return session;
      };

      ws.on('message', (rawData) => {
        let msg: TwilioMsg;
        try {
          msg = JSON.parse(rawData.toString()) as TwilioMsg;
        } catch {
          this.logger.warn('Media stream: failed to parse message');
          return;
        }

        switch (msg.event) {
          case 'connected': {
            this.logger.log('Media stream: Twilio "connected" event received');
            break;
          }

          case 'start': {
            callId = msg.start.customParameters?.callId ?? null;
            const tracks = Array.isArray(msg.start.tracks) && msg.start.tracks.length > 0
              ? msg.start.tracks
              : ['inbound_track'];

            this.logger.log(
              `Media stream start — callId: ${callId ?? 'MISSING'}, ` +
              `streamSid: ${msg.start.streamSid}, callSid: ${msg.start.callSid}, ` +
              `tracks: [${tracks.join(',')}], ` +
              `customParams: ${JSON.stringify(msg.start.customParameters ?? {})}`,
            );

            if (!callId) {
              this.logger.error('Media stream start event has no callId in customParameters — closing');
              ws.close();
              return;
            }

            // Check call mode — AI_CALLER streams are handed off to AiCallService
            callMode = 'pending';
            const resolvedCallId = callId;
            const resolvedStreamSid = msg.start.streamSid;

            void (async () => {
              try {
                const [callRow] = await this.db
                  .select({ mode: schema.calls.mode })
                  .from(schema.calls)
                  .where(eq(schema.calls.id, resolvedCallId))
                  .limit(1);

                if (callRow?.mode === 'AI_CALLER') {
                  this.logger.log(`AI_CALLER detected on /media-stream — handing off to AiCallService (callId=${resolvedCallId})`);
                  callMode = 'ai';
                  closeSessions(); // clean up any Deepgram sessions created so far
                  ws.removeAllListeners('message');
                  ws.removeAllListeners('error');
                  ws.removeAllListeners('close');
                  this.aiCallService.startFromHandover(ws, resolvedCallId, resolvedStreamSid ?? null);
                  return;
                }

                if (callRow?.mode === 'SUPPORT') {
                  // Support call — find the session linked to this call
                  const [session] = await this.db
                    .select({ id: schema.supportSessions.id })
                    .from(schema.supportSessions)
                    .where(eq(schema.supportSessions.callId, resolvedCallId))
                    .limit(1);
                  if (session) {
                    this.logger.log(`SUPPORT detected on /media-stream — routing to SupportEngine (callId=${resolvedCallId}, sessionId=${session.id})`);
                    callMode = 'support';
                    supportSessionId = session.id;
                  } else {
                    this.logger.warn(`SUPPORT call ${resolvedCallId} — no session found, treating as OUTBOUND`);
                  }
                }
              } catch (err) {
                this.logger.warn(`Call mode check error: ${(err as Error).message} — treating as OUTBOUND`);
              }

              // Regular outbound or support call: set up Deepgram
              if (callMode !== 'support') callMode = 'outbound';
              this.logger.log(
                `Media stream identified — call ${resolvedCallId}, tracks=${tracks.join(',')}, STT: ${this.sttService.available}`,
              );

              if (this.sttService.available) {
                for (const track of tracks) {
                  ensureDeepgramSession(track);
                }
                if (deepgramByTrack.size === 0) {
                  ensureDeepgramSession('inbound');
                }

                for (const buffered of earlyMediaBuffer) {
                  const session = ensureDeepgramSession(buffered.track);
                  if (session?.readyState === 1) session.send(buffered.audio);
                }
                earlyMediaBuffer.length = 0;
              }
            })();

            break;
          }

          case 'media': {
            // While mode check is pending or once handed to AiCallService, buffer/ignore
            if (callMode === 'ai') break;
            const track = normalizeTrack(msg.media.track || '');
            const audio = Buffer.from(msg.media.payload, 'base64');
            if (!callId || callMode === 'pending') {
              earlyMediaBuffer.push({ track, audio });
              break;
            }
            const session = ensureDeepgramSession(track);
            if (session?.readyState === 1) {
              session.send(audio);
            }
            break;
          }

          case 'stop': {
            this.logger.log(`Media stream stopped — call ${callId ?? 'unknown'}`);
            closeSessions();
            break;
          }
        }
      });

      ws.on('close', () => {
        closeSessions();
        this.logger.log(`Media stream WS closed — call ${callId ?? 'unknown'}`);
      });

      ws.on('error', (err) =>
        this.logger.error(`Media stream WS error — call ${callId ?? 'unknown'}: ${err.message}`),
      );
    });

    this.logger.log('Twilio Media Stream WS attached at /media-stream');
  }
}
