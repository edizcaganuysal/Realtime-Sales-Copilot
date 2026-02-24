import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FAST_CALL_MODELS, type FastCallModel } from '@live-sales-coach/shared';

type ChatOptions = {
  model?: string;
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
};

/**
 * Result of an LLM call, including token usage for cost-based credit billing.
 * Every caller receives this so it can pass usage to CreditsService.debitForAiUsage().
 */
export type LlmResult = {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
};

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private readonly fastModelSet = new Set<string>(FAST_CALL_MODELS);
  private readonly unavailableFastModels = new Set<FastCallModel>();

  private readonly provider = (
    process.env['LLM_PROVIDER'] ??
    (process.env['OPENAI_API_KEY'] ? 'openai' : '')
  ).toLowerCase();
  private readonly apiKey = process.env['LLM_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? '';
  readonly model = process.env['LLM_MODEL'] ?? 'gpt-4o';
  readonly defaultFastModel: FastCallModel = this.fastModelSet.has(
    process.env['LLM_MODEL'] ?? '',
  )
    ? (process.env['LLM_MODEL'] as FastCallModel)
    : 'gpt-5-mini';
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

  private resolveFastModel(candidate?: string): FastCallModel {
    const ordered: FastCallModel[] = [];
    if (candidate && this.fastModelSet.has(candidate)) {
      ordered.push(candidate as FastCallModel);
    }
    if (!ordered.includes(this.defaultFastModel)) {
      ordered.push(this.defaultFastModel);
    }
    for (const model of FAST_CALL_MODELS) {
      if (!ordered.includes(model)) {
        ordered.push(model);
      }
    }
    const available = ordered.find((model) => !this.unavailableFastModels.has(model));
    if (available) {
      return available;
    }
    return this.defaultFastModel;
  }

  private isModelSelectionError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const error = err as {
      code?: string;
      message?: string;
      error?: { code?: string; message?: string };
    };
    const code = `${error.code ?? error.error?.code ?? ''}`.toLowerCase();
    const message = `${error.message ?? error.error?.message ?? ''}`.toLowerCase();
    if (code === 'model_not_found') return true;
    if (message.includes('model') && (message.includes('not found') || message.includes('not available'))) {
      return true;
    }
    if (message.includes('access') && message.includes('model')) {
      return true;
    }
    return false;
  }

  private async runFastCompletion(
    model: FastCallModel,
    systemPrompt: string,
    userPrompt: string,
    options: ChatOptions,
  ): Promise<LlmResult> {
    const client = this.getClient();
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: options.temperature ?? 0.35,
      max_completion_tokens: options.maxTokens ?? 512,
      ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    });
    const text = ((resp.choices[0]?.message?.content as string | null | undefined) ?? '').trim();
    return {
      text,
      model,
      promptTokens: Number(resp.usage?.prompt_tokens ?? 0),
      completionTokens: Number(resp.usage?.completion_tokens ?? 0),
    };
  }

  /**
   * Fast chat completion using mini-class GPT models for real-time coaching.
   * Returns LlmResult with token usage for cost-based credit billing.
   */
  async chatFast(
    systemPrompt: string,
    userPrompt: string,
    options: ChatOptions = {},
  ): Promise<LlmResult> {
    const selected = this.resolveFastModel(options.model);
    try {
      return await this.runFastCompletion(selected, systemPrompt, userPrompt, options);
    } catch (err) {
      if (!this.isModelSelectionError(err)) throw err;
      this.unavailableFastModels.add(selected);
      const fallback = this.resolveFastModel(undefined);
      if (fallback === selected) throw err;
      this.logger.warn(
        `Fast model "${selected}" unavailable. Retrying with "${fallback}".`,
      );
      return this.runFastCompletion(fallback, systemPrompt, userPrompt, options);
    }
  }

  async chat(
    systemPrompt: string,
    userPrompt: string,
    options: ChatOptions = {},
  ): Promise<LlmResult> {
    const client = this.getClient();
    const usedModel = options.model ?? this.model;
    const resp = await client.chat.completions.create({
      model: usedModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: options.temperature ?? 0.4,
      max_completion_tokens: options.maxTokens ?? 512,
      ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    });
    const text = ((resp.choices[0]?.message?.content as string | null | undefined) ?? '').trim();
    return {
      text,
      model: usedModel,
      promptTokens: Number(resp.usage?.prompt_tokens ?? 0),
      completionTokens: Number(resp.usage?.completion_tokens ?? 0),
    };
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
