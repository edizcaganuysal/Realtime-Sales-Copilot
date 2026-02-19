import { HttpAdapterHost } from '@nestjs/core';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { WebSocketServer as WsServer } from 'ws';
import type WebSocket from 'ws';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CallsGateway } from './calls.gateway';
import { SttService } from './stt.service';
import { EngineService } from './engine.service';

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
    private readonly sttService: SttService,
    private readonly engineService: EngineService,
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
      let deepgramWs: WebSocket | null = null;
      let speaker = 'PROSPECT';
      // Buffer media messages received before the start event
      const earlyMediaBuffer: Buffer[] = [];

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
            // Extract callId from customParameters (set via TwiML <Parameter>)
            callId = msg.start.customParameters?.callId ?? null;

            this.logger.log(
              `Media stream start — callId: ${callId ?? 'MISSING'}, ` +
              `streamSid: ${msg.start.streamSid}, callSid: ${msg.start.callSid}, ` +
              `tracks: [${msg.start.tracks.join(',')}], ` +
              `customParams: ${JSON.stringify(msg.start.customParameters ?? {})}`,
            );

            if (!callId) {
              this.logger.error('Media stream start event has no callId in customParameters — closing');
              ws.close();
              return;
            }

            // "inbound" track = prospect speaking (called party)
            speaker = msg.start.tracks.some((t) => t.includes('inbound')) ? 'PROSPECT' : 'REP';
            this.logger.log(
              `Media stream identified — call ${callId}, speaker: ${speaker}, STT: ${this.sttService.available}`,
            );

            if (this.sttService.available) {
              deepgramWs = this.sttService.createDeepgramSession(
                speaker,
                async (text, isFinal, spk) => {
                  if (!text.trim()) return;
                  const tsMs = Date.now();

                  this.gateway.emitToCall(
                    callId!,
                    isFinal ? 'transcript.final' : 'transcript.partial',
                    { speaker: spk, text, tsMs, isFinal },
                  );

                  if (!isFinal) {
                    // Signal engine that someone is speaking (dims suggestions when prospect talks)
                    this.engineService.signalSpeaking(callId!, spk);
                  }

                  if (isFinal) {
                    this.engineService.pushTranscript(callId!, spk, text);
                    await this.db.insert(schema.callTranscript).values({
                      callId: callId!,
                      tsMs,
                      speaker: spk,
                      text,
                      isFinal: true,
                    });
                  }
                },
              );

              // Flush any buffered media that arrived before start
              for (const buf of earlyMediaBuffer) {
                if (deepgramWs?.readyState === 1) deepgramWs.send(buf);
              }
              earlyMediaBuffer.length = 0;
            }
            break;
          }

          case 'media': {
            if (!callId) {
              // Buffer media until we get the start event
              earlyMediaBuffer.push(Buffer.from(msg.media.payload, 'base64'));
              break;
            }
            if (deepgramWs?.readyState === 1) {
              deepgramWs.send(Buffer.from(msg.media.payload, 'base64'));
            }
            break;
          }

          case 'stop': {
            this.logger.log(`Media stream stopped — call ${callId ?? 'unknown'}`);
            deepgramWs?.close();
            break;
          }
        }
      });

      ws.on('close', () => {
        deepgramWs?.close();
        this.logger.log(`Media stream WS closed — call ${callId ?? 'unknown'}`);
      });

      ws.on('error', (err) =>
        this.logger.error(`Media stream WS error — call ${callId ?? 'unknown'}: ${err.message}`),
      );
    });

    this.logger.log('Twilio Media Stream WS attached at /media-stream');
  }
}
