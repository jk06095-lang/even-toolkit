import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

import {
  createCustomGptHandoffDownloadFiles,
  downloadCustomGptHandoffFiles,
  generateExportJSON,
} from '../src/combat/transcript-export';

describe('transcript export session-analysis guards', () => {
  const originalDocument = globalThis.document;
  const originalUrl = globalThis.URL;

  beforeEach(() => {
    echoApiMock.configured = true;
    echoApiMock.requests = [];
    echoApiMock.resolve = null;
    echoApiMock.reject = null;
    echoApiMock.rejectOnAbort = true;
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', {
      value: originalDocument,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'URL', {
      value: originalUrl,
      configurable: true,
    });
    vi.restoreAllMocks();
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
      speaker: 'unknown',
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

  it('counts self-response rate only for cue-free recovery after silence', async () => {
    echoApiMock.configured = false;
    const session = makeSession();
    session.entries = [
      {
        t: Date.UTC(2026, 5, 19, 10, 0, 4),
        type: 'user_speech',
        text: 'Opening speech should not count as silence recovery.',
        source: 'live_final',
      },
      {
        t: Date.UTC(2026, 5, 19, 10, 0, 10),
        type: 'silence_event',
        text: '2200ms',
      },
      {
        t: Date.UTC(2026, 5, 19, 10, 0, 13),
        type: 'user_speech',
        text: 'I can answer after thinking.',
        source: 'live_final',
      },
      {
        t: Date.UTC(2026, 5, 19, 10, 0, 20),
        type: 'silence_event',
        text: '2500ms',
      },
      {
        t: Date.UTC(2026, 5, 19, 10, 0, 21),
        type: 'hint_given',
        text: 'Could you say that again?',
        source: 'fallback',
      },
      {
        t: Date.UTC(2026, 5, 19, 10, 0, 24),
        type: 'user_speech',
        text: 'Sorry, can you repeat that?',
        source: 'live_final',
      },
    ];

    const exportJson = await generateExportJSON(session, {
      allowCloudProcessing: false,
    });

    expect(exportJson.stage_2_analysis.speech_count).toBe(3);
    expect(exportJson.stage_2_analysis.self_response_rate).toBe(33);
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

  it('creates privacy-safe Custom GPT handoff download files', () => {
    const session = makeSession();
    session.assistEpisodes![0]!.userAttempt = 'Reach me at test@example.com or +1 555 123 4567';
    const files = createCustomGptHandoffDownloadFiles(session);

    expect(files.map((file) => file.fileName)).toEqual([
      'echo_learner_profile.json',
      'echo_tutor_instructions.md',
    ]);
    expect(files[0]?.mimeType).toBe('application/json');
    expect(files[1]?.mimeType).toBe('text/markdown');

    const profile = JSON.parse(files[0]!.content);
    expect(profile.schemaVersion).toBe(ECHO_DOMAIN_V2_SCHEMA_VERSION);
    expect(profile.privacyMode).toBe('local_only');
    expect(files[1]?.content).toContain('Project ECHO Tutor Instructions');
    expect(`${files[0]?.content}\n${files[1]?.content}`).not.toContain('test@example.com');
    expect(`${files[0]?.content}\n${files[1]?.content}`).not.toContain('+1 555');
  });

  it('downloads the two manual Custom GPT files for a saved session handoff', () => {
    const clickedDownloads: string[] = [];
    const appended: unknown[] = [];

    Object.defineProperty(globalThis, 'document', {
      value: {
        body: {
          appendChild: (element: unknown) => appended.push(element),
          removeChild: () => undefined,
        },
        createElement: () => ({
          href: '',
          download: '',
          click() {
            clickedDownloads.push(this.download);
          },
        }),
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'URL', {
      value: {
        createObjectURL: vi.fn(() => 'blob:echo-custom-gpt'),
        revokeObjectURL: vi.fn(),
      },
      configurable: true,
    });

    downloadCustomGptHandoffFiles(makeSession());

    expect(clickedDownloads).toEqual([
      'echo_learner_profile.json',
      'echo_tutor_instructions.md',
    ]);
    expect(appended).toHaveLength(2);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
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
