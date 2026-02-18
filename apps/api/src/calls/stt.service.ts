import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import WebSocket from 'ws';

export type TranscriptCallback = (text: string, isFinal: boolean, speaker: string) => void;

const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen';

const DEEPGRAM_PARAMS = new URLSearchParams({
  encoding: 'mulaw',
  sample_rate: '8000',
  channels: '1',
  model: 'nova-2',
  language: 'en-US',
  punctuate: 'true',
  interim_results: 'true',
  endpointing: '300',
}).toString();

@Injectable()
export class SttService implements OnModuleInit {
  private readonly logger = new Logger(SttService.name);

  private readonly apiKey = process.env['STT_API_KEY'];
  private readonly provider = (process.env['STT_PROVIDER'] ?? 'deepgram').toLowerCase();
  private readonly useStub = process.env['USE_STUB_TRANSCRIPT'] === 'true';

  onModuleInit() {
    if (this.useStub || !this.apiKey) {
      if (!this.useStub && !this.apiKey) {
        this.logger.warn(
          '\n' +
            '┌──────────────────────────────────────────────────────────┐\n' +
            '│  STT not configured — transcript will be stubbed         │\n' +
            '│  Add to apps/api/.env:                                   │\n' +
            '│    STT_PROVIDER=deepgram                                  │\n' +
            '│    STT_API_KEY=your_deepgram_api_key                     │\n' +
            '│  Get key at: https://console.deepgram.com                │\n' +
            '│  Or set USE_STUB_TRANSCRIPT=true to silence this warning │\n' +
            '└──────────────────────────────────────────────────────────┘',
        );
      } else {
        this.logger.log('STT: using stub transcript (USE_STUB_TRANSCRIPT=true)');
      }
    } else {
      this.logger.log(`STT ready — provider: ${this.provider}`);
    }
  }

  get available(): boolean {
    return !this.useStub && !!this.apiKey;
  }

  /**
   * Opens a Deepgram streaming session for inbound mulaw audio (8 kHz mono).
   * Returns the WebSocket so the caller can send audio chunks and close when done.
   */
  createDeepgramSession(speaker: string, onTranscript: TranscriptCallback): WebSocket {
    const ws = new WebSocket(`${DEEPGRAM_URL}?${DEEPGRAM_PARAMS}`, {
      headers: { Authorization: `Token ${this.apiKey}` },
    });

    ws.on('open', () => {
      this.logger.debug(`Deepgram WS open for speaker ${speaker}`);
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          is_final?: boolean;
          channel?: { alternatives?: { transcript: string }[] };
        };

        if (msg.type !== 'Results') return;
        const transcript = msg.channel?.alternatives?.[0]?.transcript ?? '';
        if (!transcript.trim()) return;

        const isFinal = msg.is_final === true;
        onTranscript(transcript, isFinal, speaker);
      } catch {
        // ignore parse errors
      }
    });

    ws.on('error', (err) => this.logger.error(`Deepgram WS error (${speaker}): ${err.message}`));
    ws.on('close', () => this.logger.debug(`Deepgram WS closed for ${speaker}`));

    return ws;
  }
}
