import { describe, expect, it } from 'vitest';
import { TranscriptAnalyzer } from '../src/combat/transcript-analyzer';

describe('TranscriptAnalyzer outcome records', () => {
  it('records echo-domain-v2 assisted outcomes on resolved hints', () => {
    const analyzer = new TranscriptAnalyzer(2);
    analyzer.setActiveHint('Could you say that again?', 2);

    const evaluation = analyzer.evaluateActiveHintUsage('Sorry, can you repeat it?');
    expect(evaluation).toMatchObject({
      outcome: 'assisted_adapted',
      status: 'used',
      speechAct: 'ask_repeat',
      cueLevelUsed: 2,
    });

    analyzer.resolveActiveHint('used', 'Sorry, can you repeat it?', evaluation ?? undefined);

    expect(analyzer.getHintHistory()).toEqual([
      expect.objectContaining({
        hint: 'Could you say that again?',
        status: 'used',
        userResponse: 'Sorry, can you repeat it?',
        outcome: 'assisted_adapted',
        cueLevelUsed: 2,
        speechAct: 'ask_repeat',
      }),
    ]);
  });

  it('records failed outcomes without increasing hint success', () => {
    const analyzer = new TranscriptAnalyzer(2);
    analyzer.setActiveHint('Could you say that again?', 2);

    const evaluation = analyzer.evaluateActiveHintUsage('I maybe tomorrow');
    expect(evaluation).toMatchObject({
      outcome: 'failed',
      status: 'missed',
    });

    analyzer.resolveActiveHint('missed', 'I maybe tomorrow', evaluation ?? undefined);

    expect(analyzer.getHintHistory()[0]).toMatchObject({
      status: 'missed',
      outcome: 'failed',
    });
    expect(analyzer.getSessionAnalysis()).toMatchObject({
      totalHints: 1,
      hintsUsed: 0,
      hintsMissed: 1,
      successRate: 0,
    });
  });

  it('uses the shared outcome evaluator for compatibility hint checks', () => {
    const analyzer = new TranscriptAnalyzer(2);
    analyzer.setActiveHint('Could you say that again?', 2);

    expect(analyzer.checkHintUsage('Sorry, can you repeat it?')).toMatchObject({
      used: true,
    });

    expect(analyzer.evaluateActiveHintUsage('Sorry, can you repeat it?')).toMatchObject({
      status: 'used',
      outcome: 'assisted_adapted',
      speechAct: 'ask_repeat',
    });
  });

  it('does not treat unrelated short speech as a used hint', () => {
    const analyzer = new TranscriptAnalyzer(2);
    analyzer.setActiveHint('Could you say that again?', 2);

    expect(analyzer.checkHintUsage('I maybe tomorrow')).toMatchObject({
      used: false,
    });

    expect(analyzer.evaluateActiveHintUsage('I maybe tomorrow')).toMatchObject({
      status: 'missed',
      outcome: 'failed',
    });
  });
});
