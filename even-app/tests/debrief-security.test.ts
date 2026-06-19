import { describe, expect, it } from 'vitest';

import { parseDebriefJSON } from '../src/debrief/json-parser';

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
