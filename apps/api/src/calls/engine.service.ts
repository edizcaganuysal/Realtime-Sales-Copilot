import { Injectable } from '@nestjs/common';
import { CallsGateway } from './calls.gateway';

type EngineState = {
  interval: ReturnType<typeof setInterval>;
  tick: number;
};

const STAGES = ['Opening', 'Discovery', 'Solution Fit', 'Objection Handling', 'Close'];

const SUGGESTIONS = [
  "Let's start by understanding your current workflow.",
  'What outcomes matter most to your team this quarter?',
  "I hear you — many customers felt the same way at first.",
  'Would a short pilot make sense before full commitment?',
  "Let's nail down a follow-up with your technical lead.",
];

const NUDGES: string[] = [
  'ASK_QUESTION',
  'CONFIRM_UNDERSTANDING',
  'TOO_MUCH_TALKING',
];

const CHECKLIST_ITEMS = [
  'Introduce yourself',
  'Confirm pain point',
  'Present solution',
  'Handle objections',
  'Agree next step',
];

@Injectable()
export class EngineService {
  private engines = new Map<string, EngineState>();

  constructor(private readonly gateway: CallsGateway) {}

  start(callId: string) {
    if (this.engines.has(callId)) return;

    let tick = 0;
    let stageIdx = 0;

    const interval = setInterval(() => {
      tick++;

      // Partial transcript every 2s
      if (tick % 2 === 1) {
        this.gateway.emitToCall(callId, 'transcript.partial', {
          speaker: tick % 6 < 3 ? 'REP' : 'PROSPECT',
          text: `[Speaking… tick ${tick}]`,
          tsMs: Date.now(),
        });
      }

      // Final transcript every 5 ticks
      if (tick % 5 === 0) {
        this.gateway.emitToCall(callId, 'transcript.final', {
          speaker: tick % 10 < 5 ? 'REP' : 'PROSPECT',
          text: `Completed utterance at tick ${tick}.`,
          tsMs: Date.now(),
          isFinal: true,
        });
      }

      // Stage advancement every 12 ticks
      if (tick % 12 === 0 && stageIdx < STAGES.length - 1) {
        stageIdx++;
        this.gateway.emitToCall(callId, 'engine.stage', {
          stageIdx,
          stageName: STAGES[stageIdx],
        });
      }

      // Primary suggestion every 8 ticks
      if (tick % 8 === 0) {
        this.gateway.emitToCall(callId, 'engine.primary_suggestion', {
          text: SUGGESTIONS[Math.floor(tick / 8) % SUGGESTIONS.length],
          intent: 'DISCOVERY',
          tsMs: Date.now(),
        });
      }

      // Nudges every 15 ticks
      if (tick % 15 === 0) {
        this.gateway.emitToCall(callId, 'engine.nudges', {
          nudges: [NUDGES[Math.floor(tick / 15) % NUDGES.length]],
        });
      }

      // Checklist every 20 ticks
      if (tick % 20 === 0) {
        const doneCount = Math.min(Math.floor(tick / 20), CHECKLIST_ITEMS.length);
        this.gateway.emitToCall(callId, 'engine.checklist', {
          items: CHECKLIST_ITEMS.map((label, i) => ({ label, done: i < doneCount })),
        });
      }
    }, 2000);

    this.engines.set(callId, { interval, tick });
  }

  stop(callId: string) {
    const state = this.engines.get(callId);
    if (state) {
      clearInterval(state.interval);
      this.engines.delete(callId);
    }
  }
}
