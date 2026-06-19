import { beforeEach, describe, expect, it } from 'vitest';
import { ECHO_DOMAIN_V2_SCHEMA_VERSION, type AssistOutcome, type CueLevel } from '@toolkit/echo-domain-v2';
import type { SessionTranscript } from '../src/combat/transcript-store';
import {
  clearImportedLearningItemsForRecall,
  saveImportedLearningItemsForRecall,
} from '../src/debrief/json-parser';
import {
  buildTransferScenarios,
  buildActiveRecallQueue,
  clearActiveRecallSnapshot,
  createActiveRecallPrompt,
  evaluateActiveRecallAttempt,
  loadActiveRecallSnapshot,
  recordActiveRecallAttempt,
} from '../src/learning/active-recall';

const sessionEnd = Date.UTC(2026, 5, 19, 10, 1, 0);
const dueNow = new Date(Date.UTC(2026, 5, 21, 10, 1, 0));

class MemoryStorage {
  private data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

describe('active recall learning loop', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true,
    });
    clearActiveRecallSnapshot();
    clearImportedLearningItemsForRecall();
  });

  it('builds due recall prompts without revealing the saved expression', () => {
    const queue = buildActiveRecallQueue([makeSession([['assisted_adapted', 2, 'Sorry, can you repeat it?']])], {
      now: () => dueNow,
    });

    expect(queue).toHaveLength(1);
    expect(queue[0]?.prompt.mode).toBe('meaning_to_expression');
    expect(queue[0]?.prompt.prompt).toContain('다시 말해 달라고 요청하기');
    expect(queue[0]?.prompt.prompt).not.toContain('Could you say that again?');
    expect(queue[0]?.prompt.answer).toBe('Could you say that again?');
  });

  it('records attempts after reveal and reschedules Again quickly', () => {
    const [item] = buildActiveRecallQueue([makeSession([['failed', 3, 'I do not know']])], {
      now: () => dueNow,
    });
    expect(item).toBeDefined();

    const attempt = recordActiveRecallAttempt(
      item!.learningItem,
      'again',
      '<b>I maybe tomorrow</b> test@example.com',
      { now: () => dueNow },
    );

    expect(attempt).toMatchObject({
      grade: 'again',
      captureSource: 'typed',
      userAttempt: 'I maybe tomorrow [redacted-email]',
      dueAtBefore: item!.dueAt,
      evaluation: {
        recommendedGrade: 'again',
      },
    });
    expect(Date.parse(attempt.dueAtAfter) - dueNow.getTime()).toBe(10 * 60 * 1000);

    const snapshot = loadActiveRecallSnapshot();
    expect(snapshot.states[item!.learningItem.id]).toMatchObject({
      reps: 0,
      lapses: 2,
      lastGrade: 'again',
    });
    expect(JSON.stringify(snapshot)).not.toContain('<b>');
    expect(JSON.stringify(snapshot)).not.toContain('test@example.com');
  });

  it('does not count answer reveal without a captured attempt as mastery', () => {
    const [item] = buildActiveRecallQueue([makeSession([['assisted_exact', 2, 'Could you say that again?']])], {
      now: () => dueNow,
    });
    expect(item).toBeDefined();

    const attempt = recordActiveRecallAttempt(
      item!.learningItem,
      'easy',
      '   <b></b>   ',
      { now: () => dueNow },
    );

    expect(attempt).toMatchObject({
      grade: 'again',
      userAttempt: undefined,
      evaluation: {
        recommendedGrade: 'again',
        note: 'No attempt captured.',
      },
    });
    expect(Date.parse(attempt.dueAtAfter) - dueNow.getTime()).toBe(10 * 60 * 1000);
    expect(loadActiveRecallSnapshot().states[item!.learningItem.id]).toMatchObject({
      reps: 0,
      lapses: 1,
      lastGrade: 'again',
      transferSuccessCount: 0,
    });
  });

  it('suggests a grade from local semantic coverage without requiring exact copy', () => {
    const [item] = buildActiveRecallQueue([makeSession([['assisted_exact', 2, 'Could you say that again?']])], {
      now: () => dueNow,
    });
    expect(item).toBeDefined();

    const adapted = evaluateActiveRecallAttempt(item!.learningItem, 'Sorry, can you repeat that?');
    expect(adapted).toMatchObject({
      recommendedGrade: 'good',
      missingKeywords: [],
    });
    expect(adapted.semanticScore).toBeGreaterThanOrEqual(0.9);

    const exact = evaluateActiveRecallAttempt(item!.learningItem, 'Could you say that again?');
    expect(exact.recommendedGrade).toBe('easy');
    expect(exact.pronunciationScore).toBeUndefined();

    const spoken = evaluateActiveRecallAttempt(item!.learningItem, 'Could you say that again?', {
      pronunciationConfidence: 0.8732,
    });
    expect(spoken).toMatchObject({
      recommendedGrade: 'easy',
      pronunciationScore: 0.873,
      pronunciationSource: 'web_speech_confidence',
      pronunciationNote: 'Browser speech confidence only; not a full pronunciation assessment.',
    });

    const empty = evaluateActiveRecallAttempt(item!.learningItem, '');
    expect(empty).toMatchObject({
      semanticScore: 0,
      recommendedGrade: 'again',
      note: 'No attempt captured.',
    });
  });

  it('moves successful mature items into transfer checks', () => {
    const [item] = buildActiveRecallQueue([makeSession([['assisted_exact', 2, 'Could you say that again?']])], {
      now: () => dueNow,
    });
    expect(item).toBeDefined();

    recordActiveRecallAttempt(item!.learningItem, 'good', 'Could you say that again?', {
      now: () => dueNow,
    });
    const secondDue = new Date(Date.parse(loadActiveRecallSnapshot().states[item!.learningItem.id]!.dueAt));
    recordActiveRecallAttempt(item!.learningItem, 'good', 'Could you say that again?', {
      now: () => secondDue,
    });

    const matureState = loadActiveRecallSnapshot().states[item!.learningItem.id]!;
    const prompt = createActiveRecallPrompt(item!.learningItem, matureState);
    expect(prompt.mode).toBe('transfer');
    expect(prompt.prompt).toContain('New situation');
    expect(prompt.transferScenario?.instruction).toContain('Ask the other person to repeat it naturally');
    expect(prompt.prompt).not.toContain(item!.learningItem.canonicalExpression);

    recordActiveRecallAttempt(item!.learningItem, 'easy', 'Sorry, can you repeat that?', {
      now: () => new Date(Date.parse(matureState.dueAt)),
      mode: 'transfer',
      pronunciationConfidence: 0.76,
    });

    expect(loadActiveRecallSnapshot().states[item!.learningItem.id]).toMatchObject({
      reps: 3,
      transferSuccessCount: 1,
      lastGrade: 'easy',
    });
    expect(loadActiveRecallSnapshot().attempts.at(-1)?.evaluation).toMatchObject({
      pronunciationScore: 0.76,
      pronunciationSource: 'web_speech_confidence',
    });
    expect(loadActiveRecallSnapshot().attempts.at(-1)?.captureSource).toBe('phone_web_speech');

    const nextTransferPrompt = createActiveRecallPrompt(
      item!.learningItem,
      loadActiveRecallSnapshot().states[item!.learningItem.id]!,
    );
    expect(nextTransferPrompt.transferScenario?.id).not.toBe(prompt.transferScenario?.id);
    expect(nextTransferPrompt.prompt).not.toContain(item!.learningItem.canonicalExpression);
  });

  it('records G2 bridge recall attempts without browser pronunciation scores', () => {
    const [item] = buildActiveRecallQueue([makeSession([['assisted_exact', 2, 'Could you say that again?']])], {
      now: () => dueNow,
    });
    expect(item).toBeDefined();

    const attempt = recordActiveRecallAttempt(
      item!.learningItem,
      'good',
      'Could you repeat that?',
      {
        now: () => dueNow,
        captureSource: 'g2_bridge',
      },
    );

    expect(attempt.captureSource).toBe('g2_bridge');
    expect(attempt.evaluation?.pronunciationScore).toBeUndefined();
    expect(attempt.evaluation?.pronunciationSource).toBeUndefined();
    expect(loadActiveRecallSnapshot().attempts.at(-1)).toMatchObject({
      captureSource: 'g2_bridge',
      grade: 'good',
    });
  });

  it('builds source-remix transfer scenarios when partner context exists', () => {
    const [item] = buildActiveRecallQueue([makeSession([['assisted_exact', 2, 'Could you say that again?']])], {
      now: () => dueNow,
    });
    const learningItem = {
      ...item!.learningItem,
      examples: [
        {
          ...item!.learningItem.examples[0]!,
          partnerTurn: 'The platform changed at the last minute.',
        },
      ],
    };

    const scenarios = buildTransferScenarios(learningItem);

    expect(scenarios[0]).toMatchObject({
      scenarioTag: 'Train station source remix',
      partnerTurn: 'The platform changed at the last minute.',
    });
    expect(scenarios[0]?.instruction).not.toContain(learningItem.canonicalExpression);
  });

  it('adds imported ECHO review learning items to the active recall queue', () => {
    saveImportedLearningItemsForRecall([
      {
        schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
        id: 'imported-repeat-01',
        canonicalExpression: 'Could you repeat that?',
        meaningKo: '다시 말해 달라고 요청하기',
        speechAct: 'ask_repeat',
        scenarioTags: ['travel'],
        breakdownType: 'listening_gap',
        sourceTurnIds: ['imported-repeat-01:import'],
        naturalRecast: 'Could you repeat that?',
        cueLevelUsed: 0,
        lastOutcome: 'failed',
        examples: [
          {
            id: 'imported-repeat-01:example:1',
            scenarioTag: 'travel',
            learnerTurn: 'Imported review item.',
            meaningKo: '다시 말해 달라고 요청하기',
            targetExpression: 'Could you repeat that?',
            sourceTurnIds: ['imported-repeat-01:import'],
          },
        ],
        scheduling: {
          reps: 0,
          lapses: 0,
          difficulty: 0.6,
          stability: 0.2,
          dueAt: dueNow.toISOString(),
        },
      },
    ]);

    const queue = buildActiveRecallQueue([], {
      now: () => dueNow,
    });

    expect(queue).toHaveLength(1);
    expect(queue[0]?.learningItem).toMatchObject({
      id: 'imported-repeat-01',
      canonicalExpression: 'Could you repeat that?',
      speechAct: 'ask_repeat',
    });
    expect(queue[0]?.prompt.prompt).toContain('다시 말해 달라고 요청하기');
    expect(queue[0]?.prompt.prompt).not.toContain('Could you repeat that?');
  });

  it('migrates legacy active-recall attempts to explicit capture sources', () => {
    localStorage.setItem('echo_active_recall_reviews', JSON.stringify({
      version: '1.0.0',
      states: {},
      attempts: [
        {
          id: 'typed-legacy',
          itemId: 'item-1',
          mode: 'meaning_to_expression',
          grade: 'good',
          prompt: 'Recall this in English.',
          expectedExpression: 'Could you repeat that?',
          userAttempt: 'Could you repeat that?',
          attemptedAt: dueNow.toISOString(),
          dueAtBefore: dueNow.toISOString(),
          dueAtAfter: dueNow.toISOString(),
        },
        {
          id: 'voice-legacy',
          itemId: 'item-1',
          mode: 'meaning_to_expression',
          grade: 'easy',
          prompt: 'Recall this in English.',
          expectedExpression: 'Could you repeat that?',
          userAttempt: 'Could you repeat that?',
          attemptedAt: dueNow.toISOString(),
          dueAtBefore: dueNow.toISOString(),
          dueAtAfter: dueNow.toISOString(),
          evaluation: {
            semanticScore: 1,
            coverage: 1,
            precision: 1,
            recommendedGrade: 'easy',
            matchedKeywords: ['repeat'],
            missingKeywords: [],
            note: 'Near-exact recall.',
            pronunciationScore: 0.84,
            pronunciationSource: 'web_speech_confidence',
            pronunciationNote: 'Browser speech confidence only; not a full pronunciation assessment.',
          },
        },
      ],
    }));

    expect(loadActiveRecallSnapshot().attempts.map((attempt) => ({
      id: attempt.id,
      captureSource: attempt.captureSource,
    }))).toEqual([
      { id: 'typed-legacy', captureSource: 'typed' },
      { id: 'voice-legacy', captureSource: 'phone_web_speech' },
    ]);
  });
});

function makeSession(
  outcomes: Array<[AssistOutcome, CueLevel, string]>,
): SessionTranscript {
  return {
    sessionId: 'session-active-recall',
    startTime: sessionEnd - 60_000,
    endTime: sessionEnd,
    week: 2,
    topic: 'Train station',
    category: 'travel',
    entries: [],
    conversationTurns: [
      {
        schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
        id: 'turn-1',
        sessionId: 'session-active-recall',
        speaker: 'learner',
        startedAt: sessionEnd - 30_000,
        endedAt: sessionEnd - 29_000,
        source: 'g2',
        language: 'en-US',
        transcript: 'Sorry, can you repeat it?',
        isFinal: true,
        piiFlags: [],
      },
    ],
    cues: outcomes.map(([, level], index) => ({
      schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
      cueId: `cue-${index + 1}`,
      speechAct: 'ask_repeat',
      level,
      phrase: 'Could you say that again?',
      meaningKo: '다시 말해 달라고 요청하기',
      alternatives: ['Can you repeat it?'],
      expiresAfterMs: 2000,
      targetTurnId: 'turn-1',
    })),
    assistEpisodes: outcomes.map(([outcome, level, userAttempt], index) => ({
      schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
      id: `episode-${index + 1}`,
      sessionId: 'session-active-recall',
      targetTurnId: 'turn-1',
      trigger: 'manual',
      decision: {
        action: 'show',
        confidence: 1,
        trigger: 'manual',
        maxCueLevel: level,
      },
      cueId: `cue-${index + 1}`,
      cueLevelUsed: level,
      speechAct: 'ask_repeat',
      requestedAt: sessionEnd - 20_000 + index * 1000,
      shownAt: sessionEnd - 19_900 + index * 1000,
      resolvedAt: sessionEnd - 10_000 + index * 1000,
      outcome,
      userAttempt,
    })),
  };
}
