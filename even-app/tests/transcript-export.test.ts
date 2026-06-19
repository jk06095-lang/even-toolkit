import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionTranscript } from '../src/combat/transcript-store';
import { ECHO_DOMAIN_V2_SCHEMA_VERSION } from '@toolkit/echo-domain-v2';

const echoApiMock = vi.hoisted(() => ({
  configured: true,
  requests: [] as Array<{ input: Record<string, unknown>; signal?: AbortSignal }>,
  resolve: null as ((value: unknown) => void) | null,
  reject: null as ((reason?: unknown) => void) | null,
  rejectOnAbort: true,
}));

vi.mock('../src/services/echo-api', () => ({
  isEchoApiConfigured: () => echoApiMock.configured,
  requestSessionAnalysis: vi.fn((input: Record<string, unknown>, signal?: AbortSignal) => {
    echoApiMock.requests.push({ input, signal });
    return new Promise((resolve, reject) => {
      echoApiMock.resolve = resolve;
      echoApiMock.reject = reject;
      if (signal?.aborted) {
        reject(new Error('aborted session analysis'));
        return;
      }
      signal?.addEventListener('abort', () => {
        if (echoApiMock.rejectOnAbort) {
          reject(new Error('aborted session analysis'));
        }
      }, { once: true });
    });
  }),
}));

import { generateExportJSON } from '../src/combat/transcript-export';

describe('transcript export session-analysis guards', () => {
  beforeEach(() => {
    echoApiMock.configured = true;
    echoApiMock.requests = [];
    echoApiMock.resolve = null;
    echoApiMock.reject = null;
    echoApiMock.rejectOnAbort = true;
  });

  it('adds scoped request metadata to session-analysis proxy calls', async () => {
    const exportPromise = generateExportJSON(makeSession(), {
      requestScopeId: 'echo-1000-test-scope',
      requestId: 'echo-1000-test-scope:session-analysis:1',
    });
    await Promise.resolve();

    expect(echoApiMock.requests).toHaveLength(1);
    expect(echoApiMock.requests[0]?.input).toMatchObject({
      task: 'session_handoff',
      clientSessionId: 'echo-1000-test-scope',
      requestId: 'echo-1000-test-scope:session-analysis:1',
    });

    echoApiMock.resolve?.({
      weak_areas: ['opening answers'],
      recommended_chunks: ['Could you say more?'],
      difficulty_assessment: 'Week 2 ready',
      next_session_focus: 'Practice one follow-up question.',
      gem_instruction: 'Keep the next practice short.',
    });

    const exportJson = await exportPromise;
    expect(exportJson.stage_3_handoff.weak_areas).toEqual(['opening answers']);
  });

  it('does not start session-analysis when the request is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const exportJson = await generateExportJSON(makeSession(), {
      signal: controller.signal,
      requestScopeId: 'echo-1000-test-scope',
    });

    expect(echoApiMock.requests).toHaveLength(0);
    expect(exportJson.stage_3_handoff).toMatchObject({
      weak_areas: [],
      recommended_chunks: [],
      next_session_focus: 'Continue current topic practice.',
    });
  });

  it('exports ECHO domain v2 conversation turns in stage 1', async () => {
    echoApiMock.configured = false;

    const exportJson = await generateExportJSON(makeSession(), {
      allowCloudProcessing: false,
    });

    expect(exportJson.stage_1_raw.conversation_turns).toHaveLength(1);
    expect(exportJson.stage_1_raw.conversation_turns[0]).toMatchObject({
      schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
      id: 'session-a:turn:1',
      sessionId: 'session-a',
      speaker: 'learner',
      source: 'g2',
      language: 'en-US',
      transcript: 'I think we should start with the customer problem.',
      isFinal: true,
      piiFlags: [],
    });
    expect(exportJson.stage_1_raw.cues[0]).toMatchObject({
      schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
      cueId: 'cue-session-a-1',
      targetTurnId: 'session-a:turn:1',
      phrase: 'Could you say that again?',
    });
    expect(exportJson.stage_1_raw.assist_episodes[0]).toMatchObject({
      schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
      id: 'episode-session-a-1',
      cueId: 'cue-session-a-1',
      outcome: 'assisted_adapted',
    });
    expect(exportJson.learner_profile).toMatchObject({
      schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
      privacyMode: 'local_only',
      metrics: {
        conversationRecoveryRate: 1,
        activeRecallDueCount: 1,
      },
    });
    expect(exportJson.learner_profile.learningItems[0]).toMatchObject({
      canonicalExpression: 'Could you say that again?',
      sourceTurnIds: ['session-a:turn:1'],
      lastOutcome: 'assisted',
    });
  });

  it('preserves two-speaker turn corrections and Korean translations in stage 1 export', async () => {
    echoApiMock.configured = false;
    const session = makeSession();
    session.conversationTurns = [
      {
        schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
        id: 'session-a:turn:1',
        sessionId: 'session-a',
        speaker: 'learner',
        startedAt: Date.UTC(2026, 5, 19, 10, 0, 10),
        endedAt: Date.UTC(2026, 5, 19, 10, 0, 11),
        source: 'g2',
        language: 'en-US',
        transcript: 'I think we should start with the customer problem.',
        confidence: 0.9,
        isFinal: true,
        piiFlags: [],
      },
      {
        schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
        id: 'session-a:turn:2',
        sessionId: 'session-a',
        speaker: 'partner',
        startedAt: Date.UTC(2026, 5, 19, 10, 0, 20),
        endedAt: Date.UTC(2026, 5, 19, 10, 0, 22),
        source: 'phone',
        language: 'en-US',
        transcript: 'What customer problem matters most?',
        translationKo: '가장 중요한 고객 문제는 무엇인가요?',
        confidence: 0.84,
        isFinal: true,
        correctedByUser: true,
        piiFlags: [],
      },
    ];

    const exportJson = await generateExportJSON(session, {
      allowCloudProcessing: false,
    });

    expect(exportJson.stage_1_raw.conversation_turns).toHaveLength(2);
    expect(exportJson.stage_1_raw.conversation_turns[1]).toMatchObject({
      id: 'session-a:turn:2',
      speaker: 'partner',
      source: 'phone',
      transcript: 'What customer problem matters most?',
      translationKo: '가장 중요한 고객 문제는 무엇인가요?',
      confidence: 0.84,
      correctedByUser: true,
    });
  });

  it('ignores aborted delayed session-analysis responses and returns fallback handoff', async () => {
    const controller = new AbortController();
    const exportPromise = generateExportJSON(makeSession(), {
      signal: controller.signal,
      requestScopeId: 'echo-1000-test-scope',
      requestId: 'echo-1000-test-scope:session-analysis:2',
    });
    await Promise.resolve();

    expect(echoApiMock.requests).toHaveLength(1);
    expect(echoApiMock.requests[0]?.signal?.aborted).toBe(false);

    controller.abort();
    const exportJson = await exportPromise;

    expect(echoApiMock.requests[0]?.signal?.aborted).toBe(true);
    expect(exportJson.stage_3_handoff).toMatchObject({
      weak_areas: [],
      recommended_chunks: [],
      next_session_focus: 'Continue current topic practice.',
    });
  });

  it('ignores late resolved session-analysis data after abort', async () => {
    echoApiMock.rejectOnAbort = false;
    const controller = new AbortController();
    const exportPromise = generateExportJSON(makeSession(), {
      signal: controller.signal,
      requestScopeId: 'echo-1000-test-scope',
      requestId: 'echo-1000-test-scope:session-analysis:3',
    });
    await Promise.resolve();

    controller.abort();
    echoApiMock.resolve?.({
      weak_areas: ['late result should not appear'],
      recommended_chunks: ['late chunk'],
      difficulty_assessment: 'late assessment',
      next_session_focus: 'late focus',
      gem_instruction: 'late instruction',
    });

    const exportJson = await exportPromise;
    expect(exportJson.stage_3_handoff).toMatchObject({
      weak_areas: [],
      recommended_chunks: [],
      next_session_focus: 'Continue current topic practice.',
    });
  });
});

function makeSession(): SessionTranscript {
  return {
    sessionId: 'session-a',
    startTime: Date.UTC(2026, 5, 19, 10, 0, 0),
    endTime: Date.UTC(2026, 5, 19, 10, 1, 0),
    week: 1,
    topic: 'Project discussion',
    category: 'general',
    entries: [
      {
        t: Date.UTC(2026, 5, 19, 10, 0, 10),
        type: 'user_speech',
        text: 'I think we should start with the customer problem.',
        source: 'live_final',
      },
    ],
    cues: [
      {
        schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
        cueId: 'cue-session-a-1',
        speechAct: 'ask_repeat',
        level: 2,
        phrase: 'Could you say that again?',
        meaningKo: 'Meaning unavailable',
        alternatives: ['Can you repeat it?'],
        expiresAfterMs: 2000,
        targetTurnId: 'session-a:turn:1',
      },
    ],
    assistEpisodes: [
      {
        schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
        id: 'episode-session-a-1',
        sessionId: 'session-a',
        targetTurnId: 'session-a:turn:1',
        trigger: 'manual',
        decision: {
          action: 'show',
          confidence: 1,
          trigger: 'manual',
          maxCueLevel: 2,
        },
        cueId: 'cue-session-a-1',
        cueLevelUsed: 2,
        speechAct: 'ask_repeat',
        requestedAt: Date.UTC(2026, 5, 19, 10, 0, 20),
        shownAt: Date.UTC(2026, 5, 19, 10, 0, 21),
        resolvedAt: Date.UTC(2026, 5, 19, 10, 0, 30),
        acknowledgedAt: Date.UTC(2026, 5, 19, 10, 0, 30),
        outcome: 'assisted_adapted',
        userAttempt: 'Sorry, can you repeat it?',
      },
    ],
  };
}
