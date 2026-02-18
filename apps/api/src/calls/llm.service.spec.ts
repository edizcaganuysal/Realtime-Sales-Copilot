import { LlmService } from './llm.service';

describe('LlmService', () => {
  let service: LlmService;

  beforeEach(() => {
    service = new LlmService();
  });

  describe('available', () => {
    const originalProvider = process.env['LLM_PROVIDER'];
    const originalKey = process.env['LLM_API_KEY'];

    afterEach(() => {
      process.env['LLM_PROVIDER'] = originalProvider;
      process.env['LLM_API_KEY'] = originalKey;
    });

    it('returns false when LLM_API_KEY is missing', () => {
      delete process.env['LLM_API_KEY'];
      process.env['LLM_PROVIDER'] = 'openai';
      const s = new LlmService();
      expect(s.available).toBe(false);
    });

    it('returns false when provider is not openai', () => {
      process.env['LLM_API_KEY'] = 'sk-test';
      process.env['LLM_PROVIDER'] = 'anthropic';
      const s = new LlmService();
      expect(s.available).toBe(false);
    });
  });

  describe('parseJson', () => {
    it('parses a plain JSON string', () => {
      const result = service.parseJson<{ stage: string }>(
        '{"stage":"Discovery"}',
        { stage: '' },
      );
      expect(result.stage).toBe('Discovery');
    });

    it('parses JSON inside a markdown code block', () => {
      const result = service.parseJson<{ stage: string }>(
        '```json\n{"stage":"Close"}\n```',
        { stage: '' },
      );
      expect(result.stage).toBe('Close');
    });

    it('parses JSON inside a plain code block (no language tag)', () => {
      const result = service.parseJson<{ suggestion: string }>(
        '```\n{"suggestion":"Ask about budget"}\n```',
        { suggestion: '' },
      );
      expect(result.suggestion).toBe('Ask about budget');
    });

    it('extracts JSON object embedded in surrounding text', () => {
      const result = service.parseJson<{ nudges: string[] }>(
        'Here is my response: {"nudges":["ASK_QUESTION"]} done.',
        { nudges: [] },
      );
      expect(result.nudges).toEqual(['ASK_QUESTION']);
    });

    it('returns the fallback on completely invalid JSON', () => {
      const result = service.parseJson<{ stage: string }>(
        'This is not JSON at all',
        { stage: 'fallback' },
      );
      expect(result.stage).toBe('fallback');
    });

    it('returns the fallback on partial/truncated JSON', () => {
      const result = service.parseJson<{ stage: string }>(
        '{"stage":"Dis',
        { stage: 'fallback' },
      );
      expect(result.stage).toBe('fallback');
    });

    it('handles nested JSON objects', () => {
      const result = service.parseJson<{
        coaching: { score: number; strengths: string[] };
      }>(
        '{"coaching":{"score":8,"strengths":["Good discovery"]}}',
        { coaching: { score: 0, strengths: [] } },
      );
      expect(result.coaching.score).toBe(8);
      expect(result.coaching.strengths[0]).toBe('Good discovery');
    });
  });
});
