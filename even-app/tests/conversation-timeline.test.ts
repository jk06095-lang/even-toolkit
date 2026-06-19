import { describe, expect, it } from 'vitest';
import { ECHO_DOMAIN_V2_SCHEMA_VERSION } from '@toolkit/echo-domain-v2';
import { buildConversationTimelineRows, speakerLabel } from '../src/combat/conversation-timeline';
import type { SessionTranscript } from '../src/combat/transcript-store';

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
      translationKo: '먼저 어떤 문제를 해결하려고 하나요?',
    });
    expect(rows[1]).toMatchObject({
      speaker: 'learner',
      speakerLabel: 'Me',
      sourceLabel: 'G2 Mic',
      confidenceLabel: '91%',
      correctedByUser: false,
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
});
