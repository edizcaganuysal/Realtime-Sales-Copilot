import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from './llm.service';

/**
 * ProspectSimulatorService — generates prospect responses for mock calls.
 *
 * ISOLATION RULES:
 * - Uses a BASE model (never fine-tuned) — simulates a prospect, not a sales rep.
 * - Its output NEVER contaminates Engine's prompt or memory.
 * - Has its own billing ledger type: USAGE_LLM_MOCK_PROSPECT.
 * - This is a SEPARATE service from CopilotEngine — they must never share state.
 */

export interface ProspectPersona {
  name: string;
  title: string;
  company: string;
  personality: string;
  painPoints: string[];
  objections: string[];
  budget: string;
  timeline: string;
}

export interface ProspectTurn {
  speaker: 'REP' | 'PROSPECT';
  text: string;
}

const DEFAULT_PROSPECT_MODEL = 'gpt-4o-mini';

@Injectable()
export class ProspectSimulatorService {
  private readonly logger = new Logger(ProspectSimulatorService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Generate a prospect response given the conversation history and persona.
   *
   * This is a TEXT-ONLY generation (no audio). The caller is responsible for TTS.
   * Uses base model — never the fine-tuned copilot model.
   */
  async generateResponse(
    orgId: string,
    callId: string,
    persona: ProspectPersona,
    transcript: ProspectTurn[],
    companyContext: string,
    notes?: string,
  ): Promise<string> {
    const systemPrompt = this.buildProspectSystemPrompt(persona, companyContext, notes);
    const userPrompt = this.buildConversationPrompt(transcript);

    try {
      const result = await this.llm.chatFast(systemPrompt, userPrompt, {
        model: DEFAULT_PROSPECT_MODEL,
        temperature: 1.0,
        billing: {
          orgId,
          ledgerType: 'USAGE_LLM_MOCK_PROSPECT',
          metadata: { call_id: callId, persona: persona.name },
        },
      });
      return result.text.trim();
    } catch (err) {
      this.logger.error(`Prospect simulation failed (${callId}): ${(err as Error).message}`);
      return "I'm sorry, can you repeat that? I got distracted for a moment.";
    }
  }

  private buildProspectSystemPrompt(
    persona: ProspectPersona,
    companyContext: string,
    notes?: string,
  ): string {
    const parts: string[] = [
      `You are ${persona.name}, ${persona.title} at ${persona.company}.`,
      `Personality: ${persona.personality}`,
      '',
      'ROLE: You are a prospect being called by a sales rep. Respond naturally as this prospect would.',
      '',
      'RULES:',
      '- Keep responses under 3 sentences unless asked a detailed question.',
      '- Be realistic — real prospects are busy, skeptical, and protective of their time.',
      '- If the rep makes a good point, acknowledge it naturally but do not become a pushover.',
      '- Never break character. You ARE this prospect.',
      '- Use natural speech patterns (uh, um, well, etc.) occasionally.',
      '- Do NOT reveal your internal objections upfront — let the rep discover them.',
      '',
      `PAIN POINTS (only reveal when asked or relevant):`,
      ...persona.painPoints.map((p) => `- ${p}`),
      '',
      `OBJECTIONS (raise naturally during the conversation):`,
      ...persona.objections.map((o) => `- ${o}`),
      '',
      `BUDGET: ${persona.budget}`,
      `TIMELINE: ${persona.timeline}`,
    ];

    if (companyContext) {
      parts.push('', 'THE REP IS SELLING:', companyContext);
    }

    if (notes) {
      parts.push('', 'SCENARIO NOTES:', notes);
    }

    return parts.join('\n');
  }

  private buildConversationPrompt(transcript: ProspectTurn[]): string {
    if (transcript.length === 0) {
      return 'The rep just called you. Say hello and ask what this is about. Keep it brief.';
    }

    const formatted = transcript
      .slice(-10)
      .map((t) => `${t.speaker === 'REP' ? 'Sales Rep' : 'You'}: ${t.text}`)
      .join('\n');

    return `Conversation so far:\n${formatted}\n\nRespond as the prospect. Keep it natural and brief.`;
  }
}
