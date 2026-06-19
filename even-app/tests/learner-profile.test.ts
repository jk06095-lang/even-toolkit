import { describe, expect, it } from 'vitest';
import {
  isLearnerProfile,
  isLearningItem,
  type AssistOutcome,
  type CueLevel,
} from '@toolkit/echo-domain-v2';
import type { SessionTranscript } from '../src/combat/transcript-store';
import {
  buildCustomGptHandoffFiles,
  buildLearnerProfile,
  buildLearningItems,
} from '../src/combat/learner-profile';

describe('ECHO learner profile mining', () => {
  it('mines at most three learning items from cue and assist evidence', () => {
    const session = makeSession([
      ['failed', 3, 'I need your email test@example.com and phone +1 555 123 4567'],
      ['partial', 2, '<b>I maybe tomorrow</b>'],
      ['assisted_exact', 2, 'Could you say that again?'],
      ['assisted_adapted', 1, 'Sorry, can you repeat it?'],
    ]);

    const items = buildLearningItems(session);

    expect(items).toHaveLength(3);
    expect(items.every(isLearningItem)).toBe(true);
    expect(items[0]).toMatchObject({
      canonicalExpression: 'Could you say that again?',
      breakdownType: 'listening_gap',
      cueLevelUsed: 3,
      lastOutcome: 'failed',
    });
    expect(JSON.stringify(items)).not.toContain('test@example.com');
    expect(JSON.stringify(items)).not.toContain('+1 555');
    expect(JSON.stringify(items)).not.toContain('<b>');
    expect(items[0]?.userAttempt).toContain('[redacted-email]');
    expect(items[0]?.userAttempt).toContain('[redacted-phone]');
  });

  it('builds a schema-valid local learner profile with evidence-derived metrics', () => {
    const session = makeSession([
      ['failed', 3, 'I do not know'],
      ['assisted_exact', 2, 'Could you say that again?'],
      ['assisted_adapted', 1, 'Sorry, can you repeat it?'],
    ]);

    const profile = buildLearnerProfile(session, {
      learnerId: 'learner-1',
      now: () => new Date(Date.UTC(2026, 5, 19, 10, 10, 0)),
    });

    expect(isLearnerProfile(profile)).toBe(true);
    expect(profile.privacyMode).toBe('local_only');
    expect(profile.metrics).toMatchObject({
      conversationRecoveryRate: 0.667,
      assistedExactRate: 0.333,
      activeRecallDueCount: 3,
      totalSessions: 1,
    });
    expect(profile.learningItems[0]?.scheduling.reps).toBe(0);
    expect(profile.recentAssistEpisodeIds).toEqual([
      'episode-1',
      'episode-2',
      'episode-3',
    ]);
  });

  it('creates the two-file Custom GPT handoff without full raw transcript export', () => {
    const session = makeSession([
      ['assisted_adapted', 2, 'Sorry, can you repeat it?'],
    ]);

    const files = buildCustomGptHandoffFiles(session);

    expect(files.profileFileName).toBe('echo_learner_profile.json');
    expect(files.instructionsFileName).toBe('echo_tutor_instructions.md');
    expect(files.instructionsMarkdown).toContain('Project ECHO Tutor Instructions');
    expect(files.instructionsMarkdown).toContain('Could you say that again?');
    expect(JSON.stringify(files.profileJson)).not.toContain('full private transcript');
    expect(isLearnerProfile(files.profileJson)).toBe(true);
  });
});

function makeSession(
  outcomes: Array<[AssistOutcome, CueLevel, string]>,
): SessionTranscript {
  const start = Date.UTC(2026, 5, 19, 10, 0, 0);
  return {
    sessionId: 'session-learning',
    startTime: start,
    endTime: start + 60_000,
    week: 2,
    topic: 'Train station',
    category: 'travel',
    entries: [
      {
        t: start + 5_000,
        type: 'user_speech',
        text: 'full private transcript should stay out of profile export',
        source: 'live_final',
      },
    ],
    conversationTurns: [
      {
        schemaVersion: '2.0.0',
        id: 'turn-1',
        sessionId: 'session-learning',
        speaker: 'learner',
        startedAt: start + 5_000,
        endedAt: start + 6_000,
        source: 'g2',
        language: 'en-US',
        transcript: 'full private transcript should stay out of profile export',
        isFinal: true,
        piiFlags: [],
      },
    ],
    cues: outcomes.map(([, level], index) => ({
      schemaVersion: '2.0.0',
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
      schemaVersion: '2.0.0',
      id: `episode-${index + 1}`,
      sessionId: 'session-learning',
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
      requestedAt: start + 10_000 + index * 1000,
      shownAt: start + 10_100 + index * 1000,
      resolvedAt: start + 20_000 + index * 1000,
      outcome,
      userAttempt,
    })),
  };
}
