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

type TwilioMsg =
  | { event: 'connected' }
  | {
      event: 'start';
      start: { callSid: string; streamSid: string; tracks: string[]; mediaFormat: object };
    }
  | { event: 'media'; media: { track: string; payload: string; timestamp: string } }
  | { event: 'stop' };

/**
 * Attaches a raw WebSocket server at /media-stream on the shared HTTP server.
 * Twilio Media Streams connect here, audio is forwarded to Deepgram, and
 * transcripts are emitted via socket.io and persisted to the DB.
 *
 * Coexists with socket.io (IoAdapter) because ws filters by path and
 * engine.io ignores paths it doesn't own.
 */
@Injectable()
export class MediaStreamService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MediaStreamService.name);

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly gateway: CallsGateway,
    private readonly sttService: SttService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  onApplicationBootstrap() {
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();

    // Use noServer mode + manual upgrade interception so we don't interfere
    // with engine.io's own upgrade handler for /socket.io paths.
    const wss = new WsServer({ noServer: true });

    httpServer.on('upgrade', (req: { url?: string }, socket: unknown, head: unknown) => {
      const pathname = req.url?.split('?')[0] ?? '';
      if (pathname !== '/media-stream') return;
      (wss as WsServer).handleUpgrade(
        req as Parameters<WsServer['handleUpgrade']>[0],
        socket as Parameters<WsServer['handleUpgrade']>[1],
        head as Parameters<WsServer['handleUpgrade']>[2],
        (ws) => wss.emit('connection', ws, req),
      );
    });

    wss.on('connection', (ws, req) => {
      // Extract callId from query string: /media-stream?callId=uuid
      const params = new URLSearchParams((req as { url?: string }).url?.split('?')[1] ?? '');
      const callId = params.get('callId');

      if (!callId) {
        this.logger.warn('Media stream connected without callId — closing');
        ws.close();
        return;
      }

      this.logger.log(`Media stream connected for call ${callId}`);

      // One Deepgram session per WS connection. track name (inbound/outbound)
      // is mapped to speaker after the start event.
      let deepgramWs: WebSocket | null = null;
      let speaker = 'PROSPECT';

      ws.on('message', (rawData) => {
        const msg = JSON.parse(rawData.toString()) as TwilioMsg;

        switch (msg.event) {
          case 'start': {
            // "inbound" track  = prospect speaking (called party)
            // "outbound" track = rep speaking (goes to called party)
            speaker = msg.start.tracks.includes('inbound') ? 'PROSPECT' : 'REP';
            this.logger.log(`Stream started — call ${callId}, speaker: ${speaker}`);

            if (this.sttService.available) {
              deepgramWs = this.sttService.createDeepgramSession(
                speaker,
                async (text, isFinal, spk) => {
                  if (!text.trim()) return;
                  const tsMs = Date.now();

                  this.gateway.emitToCall(
                    callId,
                    isFinal ? 'transcript.final' : 'transcript.partial',
                    { speaker: spk, text, tsMs, isFinal },
                  );

                  if (isFinal) {
                    await this.db.insert(schema.callTranscript).values({
                      callId,
                      tsMs,
                      speaker: spk,
                      text,
                      isFinal: true,
                    });
                  }
                },
              );
            }
            break;
          }

          case 'media': {
            if (deepgramWs?.readyState === 1 /* OPEN */) {
              const audio = Buffer.from(msg.media.payload, 'base64');
              deepgramWs.send(audio);
            }
            break;
          }

          case 'stop': {
            this.logger.log(`Stream stopped — call ${callId}`);
            deepgramWs?.close();
            break;
          }
        }
      });

      ws.on('close', () => {
        deepgramWs?.close();
        this.logger.log(`Media stream WS closed — call ${callId}`);
      });

      ws.on('error', (err) =>
        this.logger.error(`Media stream WS error — call ${callId}: ${err.message}`),
      );
    });

    this.logger.log('Twilio Media Stream WS attached at /media-stream');
  }
}
