import { describe, expect, it } from 'vitest';
import { ECHO_DOMAIN_V2_SCHEMA_VERSION } from '@toolkit/echo-domain-v2';
import {
  buildConversationTimelineRows,
  parseImportedConversationTranscript,
  speakerLabel,
} from '../src/combat/conversation-timeline';
import {
  enqueueConversationTurnTranslation,
  markConversationTranslationFailed,
} from '../src/combat/translation-queue';
import type { SessionTranscript } from '../src/combat/transcript-store';

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

describe('conversation timeline rows', () => {
  it('sorts two-speaker turns and exposes Korean translations for debrief display', () => {
    const firstAt = Date.UTC(2026, 5, 19, 10, 0, 5);
    const secondAt = Date.UTC(2026, 5, 19, 10, 0, 14);
    const session: SessionTranscript = {
      sessionId: 'session-a',
      startTime: Date.UTC(2026, 5, 19, 10, 0, 0),
      endTime: Date.UTC(2026, 5, 19, 10, 1, 0),
      week: 1,
      topic: 'Project discussion',
      category: 'business',
      entries: [],
      conversationTurns: [
        {
          schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
          id: 'learner-1',
          sessionId: 'session-a',
          speaker: 'learner',
          startedAt: secondAt,
          endedAt: secondAt + 1_000,
          source: 'g2',
          language: 'en-US',
          transcript: 'I think we can start with the customer problem.',
          confidence: 0.91,
          isFinal: true,
          piiFlags: [],
        },
        {
          schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
          id: 'partner-1',
          sessionId: 'session-a',
          speaker: 'partner',
          startedAt: firstAt,
          endedAt: firstAt + 1_000,
          source: 'phone',
          language: 'en-US',
          transcript: 'What problem are you solving first?',
          translationKo: '먼저 어떤 문제를 해결하려고 하나요?',
          confidence: 0.824,
          isFinal: true,
          correctedByUser: true,
          piiFlags: [],
        },
      ],
    };

    const rows = buildConversationTimelineRows(session);

    expect(rows.map((row) => row.turnId)).toEqual(['partner-1', 'learner-1']);
    expect(rows[0]).toMatchObject({
      speaker: 'partner',
      speakerLabel: 'Partner',
      sourceLabel: 'Phone Mic',
      confidenceLabel: '82%',
      correctedByUser: true,
      transcript: 'What problem are you solving first?',
      translationStatus: 'translated',
      translationKo: '먼저 어떤 문제를 해결하려고 하나요?',
    });
    expect(rows[1]).toMatchObject({
      speaker: 'learner',
      speakerLabel: 'Me',
      sourceLabel: 'G2 Mic',
      confidenceLabel: '91%',
      correctedByUser: false,
      translationStatus: 'pending',
      translationStatusLabel: 'Korean translation pending',
    });
  });

  it('surfaces queued translation failures without removing the saved turn', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true,
    });

    const turn = {
      schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
      id: 'partner-1',
      sessionId: 'session-a',
      speaker: 'partner',
      startedAt: Date.UTC(2026, 5, 19, 10, 0, 5),
      endedAt: Date.UTC(2026, 5, 19, 10, 0, 7),
      source: 'phone',
      language: 'en-US',
      transcript: 'Could you clarify the customer segment?',
      isFinal: true,
      piiFlags: [],
    } as const;
    const session: SessionTranscript = {
      sessionId: 'session-a',
      startTime: Date.UTC(2026, 5, 19, 10, 0, 0),
      endTime: Date.UTC(2026, 5, 19, 10, 1, 0),
      week: 1,
      topic: 'Project discussion',
      category: 'business',
      entries: [],
      conversationTurns: [turn],
    };

    expect(enqueueConversationTurnTranslation(turn, 1_000)).toMatchObject({
      status: 'pending',
      attempts: 0,
    });
    expect(markConversationTranslationFailed('session-a', 'partner-1', '<b>provider timeout</b>', 2_000))
      .toMatchObject({
        status: 'failed',
        attempts: 1,
        error: 'provider timeout',
      });

    expect(buildConversationTimelineRows(session)[0]).toMatchObject({
      turnId: 'partner-1',
      transcript: 'Could you clarify the customer segment?',
      translationStatus: 'failed',
      translationStatusLabel: 'Korean translation unavailable',
    });
  });

  it('limits rows for compact saved-session cards', () => {
    const session: SessionTranscript = {
      sessionId: 'session-a',
      startTime: 0,
      endTime: 0,
      week: 1,
      topic: 'Topic',
      category: 'general',
      entries: [],
      conversationTurns: Array.from({ length: 8 }, (_, index) => ({
        schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
        id: `turn-${index + 1}`,
        sessionId: 'session-a',
        speaker: index % 2 === 0 ? 'partner' : 'learner',
        startedAt: index,
        endedAt: index,
        source: 'import',
        language: 'en-US',
        transcript: `turn ${index + 1}`,
        isFinal: true,
        piiFlags: [],
      })),
    };

    expect(buildConversationTimelineRows(session, 6).map((row) => row.turnId)).toEqual([
      'turn-1',
      'turn-2',
      'turn-3',
      'turn-4',
      'turn-5',
      'turn-6',
    ]);
  });

  it('labels unknown speakers without assuming diarization confidence', () => {
    expect(speakerLabel('unknown')).toBe('Unknown');
  });

  it('builds v2 import turns from speaker-prefixed transcript lines', () => {
    const sessionStartTime = Date.UTC(2026, 5, 19, 10, 0, 0);
    const turns = parseImportedConversationTranscript(
      [
        'Partner: What problem are you solving first?',
        'Me: I think we can start with onboarding.',
        'Unknown: <b>malformed imported line</b>',
        'Customer: Could you clarify the customer segment?',
      ].join('\n'),
      {
        sessionId: 'import-session',
        sessionStartTime,
        defaultTurnDurationMs: 1_500,
      },
    );

    expect(turns.map((turn) => turn.id)).toEqual([
      'import-session:import:1',
      'import-session:import:2',
      'import-session:import:4',
    ]);
    expect(turns.map((turn) => turn.speaker)).toEqual(['partner', 'learner', 'partner']);
    expect(turns.map((turn) => turn.source)).toEqual(['import', 'import', 'import']);
    expect(turns[1]).toMatchObject({
      startedAt: sessionStartTime + 1_500,
      endedAt: sessionStartTime + 3_000,
      transcript: 'I think we can start with onboarding.',
      isFinal: true,
      piiFlags: [],
    });
  });
});
