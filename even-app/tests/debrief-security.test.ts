import { describe, expect, it } from 'vitest';

import { getDebriefImportSourceLabel, normalizeStoredDebrief, parseDebriefJSON } from '../src/debrief/json-parser';

describe('debrief import safety', () => {
  it('accepts markdown-wrapped JSON after validating safe text fields', () => {
    const report = parseDebriefJSON(`\`\`\`json
{
  "session_date": "2026-06-19",
  "fsi_stress_level": "Medium",
  "bottleneck_chunks": [
    {
      "target": "Could you repeat that?",
      "interval": [10, 60, 240]
    }
  ]
}
\`\`\``);

    expect(report.bottleneck_chunks).toEqual([
      {
        target: 'Could you repeat that?',
        interval: [10, 60, 240],
      },
    ]);
    expect(report).toMatchObject({
      schemaVersion: '2.0.0',
      importKind: 'legacy_debrief',
    });
    expect(getDebriefImportSourceLabel(report)).toBe('Legacy FSI Import');
    expect(report.learningItems[0]).toMatchObject({
      canonicalExpression: 'Could you repeat that?',
      speechAct: 'answer',
      breakdownType: 'recall_gap',
    });
    expect(report.learningItems[0]?.meaningKo).not.toContain('Could you repeat that?');
  });

  it('accepts schema-versioned ECHO review imports as active-recall learning items', () => {
    const report = parseDebriefJSON(JSON.stringify({
      schemaVersion: '2.0.0',
      importKind: 'echo_review_items',
      sessionDate: '2026-06-19',
      items: [
        {
          id: 'travel-repeat-01',
          canonicalExpression: 'Could you repeat that?',
          meaningKo: '다시 말해 달라고 요청하기',
          speechAct: 'ask_repeat',
          scenarioTags: ['travel'],
          breakdownType: 'listening_gap',
          dueAt: '2026-06-20T00:00:00.000Z',
        },
      ],
    }));

    expect(report).toMatchObject({
      schemaVersion: '2.0.0',
      importKind: 'echo_review_items',
      session_date: '2026-06-19',
      bottleneck_chunks: [
        {
          target: 'Could you repeat that?',
          interval: [],
        },
      ],
    });
    expect(getDebriefImportSourceLabel(report)).toBe('ECHO Review Items');
    expect(report.learningItems[0]).toMatchObject({
      id: 'travel-repeat-01',
      canonicalExpression: 'Could you repeat that?',
      meaningKo: '다시 말해 달라고 요청하기',
      speechAct: 'ask_repeat',
      breakdownType: 'listening_gap',
      scheduling: {
        dueAt: '2026-06-20T00:00:00.000Z',
      },
    });
  });

  it('rejects hostile HTML-like learner-facing chunk targets', () => {
    expect(() => parseDebriefJSON(JSON.stringify({
      session_date: '2026-06-19',
      fsi_stress_level: 'Low',
      bottleneck_chunks: [
        {
          target: '<img src=x onerror=alert(1)>',
          interval: [10],
        },
      ],
    }))).toThrow(/must not contain HTML tags/);
  });

  it('rejects direct contact identifiers before storing imported review phrases', () => {
    for (const target of [
      'Email me at learner@example.com',
      'Call me at +1 415 555 0199',
    ]) {
      expect(() => parseDebriefJSON(JSON.stringify({
        session_date: '2026-06-19',
        fsi_stress_level: 'Low',
        bottleneck_chunks: [
          {
            target,
            interval: [10],
          },
        ],
      }))).toThrow(/direct contact identifiers/);
    }
  });

  it('rejects direct contact identifiers in schema-versioned review imports', () => {
    expect(() => parseDebriefJSON(JSON.stringify({
      schemaVersion: '2.0.0',
      importKind: 'echo_review_items',
      items: [
        {
          id: 'bad-contact-01',
          canonicalExpression: 'Email me at learner@example.com',
          meaningKo: '연락처 공유',
        },
      ],
    }))).toThrow(/direct contact identifiers/);
  });

  it('rejects unknown fields on schema-versioned domain review items', () => {
    expect(() => parseDebriefJSON(JSON.stringify({
      schemaVersion: '2.0.0',
      importKind: 'echo_review_items',
      learningItems: [
        makeDomainLearningItem({
          rawSessionExcerpt: 'This source text is outside the LearningItem contract.',
        }),
      ],
    }))).toThrow(/Invalid learningItems\[0\] domain item/);
  });

  it('rejects invalid ids, enums, and oversized schema-versioned review imports', () => {
    expect(() => parseDebriefJSON(JSON.stringify({
      schemaVersion: '2.0.0',
      importKind: 'echo_review_items',
      items: [
        {
          id: '잘못된-id',
          canonicalExpression: 'Could you repeat that?',
          meaningKo: '다시 말해 달라고 요청하기',
        },
      ],
    }))).toThrow(/stable ASCII id/);

    expect(() => parseDebriefJSON(JSON.stringify({
      schemaVersion: '2.0.0',
      importKind: 'echo_review_items',
      items: [
        {
          id: 'bad-speech-act',
          canonicalExpression: 'Could you repeat that?',
          meaningKo: '다시 말해 달라고 요청하기',
          speechAct: 'translate_everything',
        },
      ],
    }))).toThrow(/speechAct/);

    expect(() => parseDebriefJSON(JSON.stringify({
      schemaVersion: '2.0.0',
      importKind: 'echo_review_items',
      items: Array.from({ length: 101 }, (_, index) => ({
        id: `review-${index}`,
        canonicalExpression: `Review phrase ${index}`,
        meaningKo: `복습 문구 ${index}`,
      })),
    }))).toThrow(/Too many learningItems/);
  });

  it('rejects executable URL schemes and control characters in imported phrases', () => {
    for (const target of [
      'javascript:alert(1)',
      'Safe phrase\u0007with bell',
    ]) {
      expect(() => parseDebriefJSON(JSON.stringify({
        session_date: '2026-06-19',
        fsi_stress_level: 'Medium',
        bottleneck_chunks: [
          {
            target,
            interval: [10],
          },
        ],
      }))).toThrow(/executable URL schemes|control characters/);
    }
  });

  it('rejects unsafe schema-versioned debriefs already present in storage', () => {
    expect(normalizeStoredDebrief({
      report: {
        schemaVersion: '2.0.0',
        importKind: 'echo_review_items',
        session_date: '2026-06-19',
        bottleneck_chunks: [],
        learningItems: [
          makeDomainLearningItem({
            canonicalExpression: 'Email me at learner@example.com',
          }),
        ],
      },
      importedAt: 1,
      scheduledPushes: [],
    })).toBeNull();

    expect(normalizeStoredDebrief({
      report: {
        schemaVersion: '2.0.0',
        importKind: 'echo_review_items',
        session_date: '2026-06-19',
        bottleneck_chunks: [
          {
            target: '<img src=x onerror=alert(1)>',
            interval: [],
          },
        ],
        learningItems: [makeDomainLearningItem()],
      },
      importedAt: 1,
      scheduledPushes: [],
    })).toBeNull();
  });

  it('normalizes safe stored debriefs without keeping stale unsafe scheduled text', () => {
    const stored = normalizeStoredDebrief({
      report: {
        schemaVersion: '2.0.0',
        importKind: 'echo_review_items',
        session_date: '2026-06-19',
        bottleneck_chunks: [],
        learningItems: [makeDomainLearningItem()],
      },
      importedAt: 1,
      scheduledPushes: [
        {
          chunk: '<script>alert(1)</script>',
          scheduledTime: Date.parse('2026-06-20T00:00:00.000Z'),
          pushed: true,
          learningItemId: 'domain-review-01',
        },
      ],
    });

    expect(stored).not.toBeNull();
    expect(stored?.scheduledPushes).toEqual([
      {
        chunk: 'Could you repeat that?',
        scheduledTime: Date.parse('2026-06-20T00:00:00.000Z'),
        pushed: true,
        learningItemId: 'domain-review-01',
      },
    ]);
  });

  it('rejects unsafe legacy debriefs already present in storage', () => {
    expect(normalizeStoredDebrief({
      report: {
        session_date: '2026-06-19',
        fsi_stress_level: 'Medium',
        bottleneck_chunks: [
          {
            target: 'javascript:alert(1)',
            interval: [10],
          },
        ],
      },
      importedAt: 1,
      scheduledPushes: [],
    } as Parameters<typeof normalizeStoredDebrief>[0])).toBeNull();
  });

  it('normalizes legacy stored debrief reminders from validated chunks', () => {
    const stored = normalizeStoredDebrief({
      report: {
        session_date: '2026-06-19',
        fsi_stress_level: 'Medium',
        bottleneck_chunks: [
          {
            target: 'Could you repeat that?',
            interval: [10],
          },
        ],
      },
      importedAt: 1,
      scheduledPushes: [
        {
          chunk: '<script>alert(1)</script>',
          scheduledTime: 123,
          pushed: true,
        },
      ],
    } as Parameters<typeof normalizeStoredDebrief>[0]);

    expect(stored).not.toBeNull();
    expect(stored?.report).toMatchObject({
      schemaVersion: '2.0.0',
      importKind: 'legacy_debrief',
      fsi_stress_level: 'Medium',
    });
    expect(stored?.scheduledPushes).toHaveLength(1);
    expect(stored?.scheduledPushes[0]).toMatchObject({
      chunk: 'Could you repeat that?',
      pushed: false,
    });
  });

  it('rejects overlarge import arrays before scheduling reminders', () => {
    expect(() => parseDebriefJSON(JSON.stringify({
      session_date: '2026-06-19',
      fsi_stress_level: 'High',
      bottleneck_chunks: Array.from({ length: 101 }, (_, index) => ({
        target: `Phrase ${index}`,
        interval: [10],
      })),
    }))).toThrow(/Too many bottleneck_chunks/);
  });

  it('filters invalid interval values and requires at least one valid chunk', () => {
    expect(() => parseDebriefJSON(JSON.stringify({
      session_date: '2026-06-19',
      fsi_stress_level: 'Medium',
      bottleneck_chunks: [
        {
          target: 'Safe phrase',
          interval: [-1, 0, 1.5, Number.MAX_SAFE_INTEGER],
        },
      ],
    }))).toThrow(/No valid bottleneck_chunks/);
  });
});

function makeDomainLearningItem(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: '2.0.0',
    id: 'domain-review-01',
    canonicalExpression: 'Could you repeat that?',
    meaningKo: 'Ask someone to repeat.',
    speechAct: 'ask_repeat',
    scenarioTags: ['travel'],
    breakdownType: 'listening_gap',
    sourceTurnIds: ['turn-1'],
    cueLevelUsed: 1,
    lastOutcome: 'assisted',
    examples: [
      {
        id: 'domain-review-01:example:1',
        scenarioTag: 'travel',
        learnerTurn: 'Could you repeat that?',
        targetExpression: 'Could you repeat that?',
        sourceTurnIds: ['turn-1'],
      },
    ],
    scheduling: {
      reps: 0,
      lapses: 0,
      difficulty: 0.5,
      stability: 1,
      dueAt: '2026-06-20T00:00:00.000Z',
    },
    ...extra,
  };
}
