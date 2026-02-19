import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

@Injectable()
export class TwilioService implements OnModuleInit {
  private readonly logger = new Logger(TwilioService.name);

  private readonly accountSid = process.env['TWILIO_ACCOUNT_SID'];
  private readonly authToken = process.env['TWILIO_AUTH_TOKEN'];
  // Support both TWILIO_FROM_NUMBER and TWILIO_PHONE_NUMBER for backwards compat
  private readonly fromNumber =
    process.env['TWILIO_FROM_NUMBER'] ?? process.env['TWILIO_PHONE_NUMBER'];
  private readonly webhookBase = process.env['TWILIO_WEBHOOK_BASE_URL'];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;

  onModuleInit() {
    if (!this.available) {
      this.logger.warn(
        '\n' +
          '┌─────────────────────────────────────────────────────────┐\n' +
          '│  Twilio not configured — using STUB mode (no real calls) │\n' +
          '│  Add to apps/api/.env:                                   │\n' +
          '│    TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxx                 │\n' +
          '│    TWILIO_AUTH_TOKEN=your_auth_token                     │\n' +
          '│    TWILIO_FROM_NUMBER=+1xxxxxxxxxx                       │\n' +
          '│    TWILIO_WEBHOOK_BASE_URL=https://your-ngrok-url        │\n' +
          '│  Get credentials at: https://console.twilio.com          │\n' +
          '└─────────────────────────────────────────────────────────┘',
      );
    } else {
      const base = this.webhookBase!.replace(/\/$/, '');
      this.logger.log(`Twilio ready — from: ${this.fromNumber}`);
      this.logger.log(`TwiML URL  : GET  ${base}/calls/twiml?callId=<callId>`);
      this.logger.log(`Status URL : POST ${base}/calls/webhook/status`);
      this.logger.log(`Media WS   : wss${base.slice(5)}/media-stream?callId=<callId>`);
    }
  }

  get available(): boolean {
    return !!(this.accountSid && this.authToken && this.fromNumber && this.webhookBase);
  }

  private getClient() {
    if (this.client) return this.client;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const twilio = require('twilio');
    this.client = twilio(this.accountSid, this.authToken);
    return this.client;
  }

  async initiateCall(callId: string, phoneTo: string): Promise<string> {
    const baseUrl = this.webhookBase!.replace(/\/$/, '');
    const twimlUrl = `${baseUrl}/calls/twiml?callId=${callId}`;
    const statusCallback = `${baseUrl}/calls/webhook/status`;

    const call = await this.getClient().calls.create({
      to: phoneTo,
      from: this.fromNumber,
      url: twimlUrl,
      method: 'GET',          // must match @Get('twiml') handler
      statusCallback,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    });

    this.logger.log(`Twilio call initiated: ${call.sid} → ${phoneTo}`);
    return call.sid as string;
  }
}
