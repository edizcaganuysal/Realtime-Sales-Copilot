import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);

  private readonly provider = (process.env['LLM_PROVIDER'] ?? '').toLowerCase();
  private readonly apiKey = process.env['LLM_API_KEY'] ?? '';
  readonly model = process.env['LLM_MODEL'] ?? 'gpt-4o';
  private readonly baseUrl = process.env['LLM_BASE_URL'] || undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;

  onModuleInit() {
    if (!this.available) {
      this.logger.warn(
        '\n' +
          '┌──────────────────────────────────────────────────────────┐\n' +
          '│  LLM not configured — AI outputs will be stubbed         │\n' +
          '│  Add to apps/api/.env:                                   │\n' +
          '│    LLM_PROVIDER=openai                                   │\n' +
          '│    LLM_API_KEY=sk-...                                    │\n' +
          '│    LLM_MODEL=gpt-4o                                      │\n' +
          '│  Get key at: https://platform.openai.com/api-keys        │\n' +
          '└──────────────────────────────────────────────────────────┘',
      );
    } else {
      this.logger.log(`LLM ready — provider: ${this.provider}, model: ${this.model}`);
    }
  }

  get available(): boolean {
    return !!this.apiKey && this.provider === 'openai';
  }

  private getClient() {
    if (this.client) return this.client;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { default: OpenAI } = require('openai') as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      default: new (opts: { apiKey: string; baseURL?: string }) => any;
    };
    this.client = new OpenAI({
      apiKey: this.apiKey,
      ...(this.baseUrl ? { baseURL: this.baseUrl } : {}),
    });
    return this.client;
  }

  async chat(systemPrompt: string, userPrompt: string): Promise<string> {
    const client = this.getClient();
    const resp = await client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 512,
    });
    return ((resp.choices[0]?.message?.content as string | null | undefined) ?? '').trim();
  }

  parseJson<T>(text: string, fallback: T): T {
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = codeBlock ? codeBlock[1] : text.match(/\{[\s\S]*\}/)?.[0] ?? text;
    try {
      return JSON.parse(raw) as T;
    } catch {
      this.logger.warn(`LLM JSON parse failed: ${raw.slice(0, 120)}`);
      return fallback;
    }
  }
}
