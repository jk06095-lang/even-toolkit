import { describe, expect, it } from 'vitest';
import { evaluateCueOutcome } from '../src/combat/outcome-evaluator';

describe('speech-act outcome evaluator', () => {
  it('marks exact cue reuse as assisted_exact', () => {
    const result = evaluateCueOutcome({
      phrase: 'Could you say that again?',
      userAttempt: 'Could you say that again?',
      speechAct: 'ask_repeat',
      level: 2,
    });

    expect(result).toMatchObject({
      outcome: 'assisted_exact',
      status: 'used',
      cueLevelUsed: 2,
      speechAct: 'ask_repeat',
    });
  });

  it('marks same speech-act variants as assisted_adapted', () => {
    const result = evaluateCueOutcome({
      phrase: 'Could you say that again?',
      userAttempt: 'Sorry, can you repeat it?',
      speechAct: 'ask_repeat',
      level: 2,
    });

    expect(result).toMatchObject({
      outcome: 'assisted_adapted',
      status: 'used',
    });
  });

  it('does not treat unrelated three-word speech as recovery', () => {
    const result = evaluateCueOutcome({
      phrase: 'Could you say that again?',
      userAttempt: 'I maybe tomorrow',
      speechAct: 'ask_repeat',
      level: 2,
    });

    expect(result).toMatchObject({
      outcome: 'failed',
      status: 'missed',
    });
  });

  it('marks incomplete related attempts as partial, not used', () => {
    const result = evaluateCueOutcome({
      phrase: 'I would like a ticket.',
      userAttempt: 'ticket',
      speechAct: 'answer',
      level: 2,
    });

    expect(result).toMatchObject({
      outcome: 'partial',
      status: 'missed',
    });
  });

  it('marks silence or no attempt as failed', () => {
    const result = evaluateCueOutcome({
      phrase: 'Let me think for a second.',
      userAttempt: '   ',
      speechAct: 'buy_time',
      level: 1,
    });

    expect(result).toMatchObject({
      outcome: 'failed',
      status: 'missed',
    });
  });
});
