import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ECHO_DOMAIN_V2_SCHEMA_VERSION, type ConversationTurn } from '@toolkit/echo-domain-v2';

const echoApiMock = vi.hoisted(() => ({
  requestTranslation: vi.fn(),
}));

vi.mock('../src/services/echo-api', () => ({
  requestTranslation: echoApiMock.requestTranslation,
}));

import {
  clearConversationTranslationJobs,
  enqueueConversationTurnTranslation,
  getConversationTranslationState,
  loadConversationTranslationJobs,
  markConversationTranslationComplete,
  markConversationTranslationFailed,
  processPendingConversationTranslations,
  queuePendingConversationTranslations,
  shouldQueueKoreanTranslation,
} from '../src/combat/translation-queue';
import { TranscriptStore, type SessionTranscript } from '../src/combat/transcript-store';

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

  clear(): void {
    this.data.clear();
  }
}

describe('conversation translation queue', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: new MemoryStorage(),
      configurable: true,
    });
    clearConversationTranslationJobs();
    echoApiMock.requestTranslation.mockReset();
  });

  it('queues final non-Korean turns once without duplicating raw transcript text', () => {
    const turn = makeTurn({
      id: 'partner-1',
      transcript: '<b>What problem are you solving first?</b>',
      language: 'en-US',
    });

    expect(shouldQueueKoreanTranslation(turn)).toBe(true);
    const first = enqueueConversationTurnTranslation(turn, 1_000);
    const second = enqueueConversationTurnTranslation(turn, 2_000);

    expect(first).toMatchObject({
      id: 'session-a:partner-1:ko-KR',
      sessionId: 'session-a',
      turnId: 'partner-1',
      sourceLanguage: 'en-US',
      targetLanguage: 'ko-KR',
      status: 'pending',
      requestedAt: 1_000,
      updatedAt: 1_000,
      attempts: 0,
    });
    expect(second).toEqual(first);
    expect(JSON.stringify(loadConversationTranslationJobs())).not.toContain('What problem');
    expect(loadConversationTranslationJobs()).toHaveLength(1);
  });

  it('skips Korean, interim, empty, and already translated turns', () => {
    expect(shouldQueueKoreanTranslation(makeTurn({ language: 'ko-KR' }))).toBe(false);
    expect(shouldQueueKoreanTranslation(makeTurn({ isFinal: false }))).toBe(false);
    expect(shouldQueueKoreanTranslation(makeTurn({ transcript: '   ' }))).toBe(false);
    expect(shouldQueueKoreanTranslation(makeTurn({ translationKo: 'already translated' }))).toBe(false);
  });

  it('marks provider failures without mutating the saved conversation turn', () => {
    const session = makeSession([makeTurn({ id: 'partner-1' })]);
    localStorage.setItem('echo_transcripts', JSON.stringify([session]));

    queuePendingConversationTranslations(session, 1_000);
    const failed = markConversationTranslationFailed('session-a', 'partner-1', '<script>timeout</script>', 2_000);

    expect(failed).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: 'timeout',
      updatedAt: 2_000,
    });

    const [stored] = TranscriptStore.loadAll();
    expect(stored?.conversationTurns?.[0]).not.toHaveProperty('translationKo');
    expect(getConversationTranslationState(stored!.conversationTurns![0]!)).toMatchObject({
      status: 'failed',
      label: 'Korean translation unavailable',
    });
  });

  it('persists completed Korean translations back onto the v2 ConversationTurn', () => {
    const session = makeSession([makeTurn({ id: 'partner-1' })]);
    localStorage.setItem('echo_transcripts', JSON.stringify([session]));

    queuePendingConversationTranslations(session, 1_000);
    const result = markConversationTranslationComplete(
      'session-a',
      'partner-1',
      '<b>Korean translation</b>',
      2_000,
    );

    expect(result?.job).toMatchObject({
      status: 'translated',
      translationKo: 'Korean translation',
      updatedAt: 2_000,
    });
    expect(result?.turn).toMatchObject({
      id: 'partner-1',
      translationKo: 'Korean translation',
    });

    const [stored] = TranscriptStore.loadAll();
    expect(stored?.conversationTurns?.[0]).toMatchObject({
      id: 'partner-1',
      translationKo: 'Korean translation',
    });
    expect(JSON.stringify(stored)).not.toContain('<b>');
  });

  it('processes pending jobs through the translation proxy when cloud processing is allowed', async () => {
    const session = makeSession([makeTurn({ id: 'partner-1' })]);
    localStorage.setItem('echo_transcripts', JSON.stringify([session]));
    echoApiMock.requestTranslation.mockResolvedValueOnce({
      translationKo: '<b>고객 세그먼트를 명확히 해 주시겠어요?</b>',
      source: 'proxy',
      latencyMs: 42,
    });

    const results = await processPendingConversationTranslations(session, {
      allowCloudProcessing: true,
      now: () => 2_000,
    });

    expect(echoApiMock.requestTranslation).toHaveBeenCalledWith({
      clientSessionId: 'session-a',
      requestId: 'session-a:partner-1:ko-KR:attempt:1',
      turnId: 'partner-1',
      sourceLanguage: 'en-US',
      targetLanguage: 'ko-KR',
      text: 'Could you clarify the customer segment?',
    }, undefined);
    expect(results).toEqual([
      expect.objectContaining({
        turnId: 'partner-1',
        status: 'translated',
      }),
    ]);
    expect(TranscriptStore.loadAll()[0]?.conversationTurns?.[0]).toMatchObject({
      translationKo: '고객 세그먼트를 명확히 해 주시겠어요?',
    });
  });

  it('does not send translation text to the proxy when cloud processing is disabled', async () => {
    const session = makeSession([makeTurn({ id: 'partner-1' })]);
    localStorage.setItem('echo_transcripts', JSON.stringify([session]));

    const results = await processPendingConversationTranslations(session, {
      allowCloudProcessing: false,
      now: () => 2_000,
    });

    expect(results).toEqual([]);
    expect(echoApiMock.requestTranslation).not.toHaveBeenCalled();
    expect(TranscriptStore.loadAll()[0]?.conversationTurns?.[0]).not.toHaveProperty('translationKo');
  });

  it('records proxy translation failures without mutating the saved turn', async () => {
    const session = makeSession([makeTurn({ id: 'partner-1' })]);
    localStorage.setItem('echo_transcripts', JSON.stringify([session]));
    echoApiMock.requestTranslation.mockRejectedValueOnce(new Error('<b>proxy unavailable</b>'));

    const results = await processPendingConversationTranslations(session, {
      allowCloudProcessing: true,
      now: () => 2_000,
    });

    expect(results).toEqual([
      expect.objectContaining({
        turnId: 'partner-1',
        status: 'failed',
        job: expect.objectContaining({
          error: 'proxy unavailable',
        }),
      }),
    ]);
    expect(TranscriptStore.loadAll()[0]?.conversationTurns?.[0]).not.toHaveProperty('translationKo');
  });
});

function makeSession(turns: ConversationTurn[]): SessionTranscript {
  return {
    sessionId: 'session-a',
    startTime: Date.UTC(2026, 5, 19, 10, 0, 0),
    endTime: Date.UTC(2026, 5, 19, 10, 1, 0),
    week: 1,
    topic: 'Project discussion',
    category: 'business',
    entries: [],
    conversationTurns: turns,
  };
}

function makeTurn(overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
    id: 'turn-1',
    sessionId: 'session-a',
    speaker: 'partner',
    startedAt: Date.UTC(2026, 5, 19, 10, 0, 5),
    endedAt: Date.UTC(2026, 5, 19, 10, 0, 7),
    source: 'phone',
    language: 'en-US',
    transcript: 'Could you clarify the customer segment?',
    isFinal: true,
    piiFlags: [],
    ...overrides,
  };
}
