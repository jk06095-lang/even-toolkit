import { describe, expect, it } from 'vitest';
import {
  buildQaExportSummary,
  renderQaExportMarkdown,
} from '../scripts/summarize-qa-export.mjs';

describe('QA export summary script', () => {
  it('summarizes eventAnalytics without printing raw utterance or cue text', () => {
    const payload = {
      rawTranscripts: [
        {
          entries: [
            { text: 'private utterance should not appear' },
            { text: 'private cue should not appear' },
          ],
        },
      ],
      eventAnalytics: [
        {
          sessionId: 's1',
          topic: 'Cafe ordering',
          category: 'food',
          audioSource: 'bridge',
          speechCount: 4,
          silenceCount: 2,
          hintCount: 2,
          cueUsedCount: 1,
          cueDismissedCount: 1,
          falseTriggerCount: 0,
          autoAssistSignalEvidenceCount: 2,
          autoAssistInsufficientSignalCount: 1,
          autoAssistPartnerBlockedCount: 0,
          autoAssistDismissBlockedCount: 0,
          autoAssistSessionCapBlockedCount: 0,
          cueLatencyCount: 2,
          cueLatencyP50Ms: 120,
          cueLatencyP95Ms: 240,
          cueLatencyMaxMs: 260,
          avgSilenceDurationMs: 1800,
          selfResponseRate: 50,
          vadSpeechThreshold: 0.032,
          vadNoiseFloorRms: 0.009,
          vadSpeechFloorRms: 0.061,
          vadCalibratedAt: Date.UTC(2026, 5, 20, 9, 30, 0),
        },
        {
          sessionId: 's2',
          topic: 'Hotel check-in',
          category: 'travel',
          audioSource: 'browser',
          speechCount: 3,
          silenceCount: 1,
          hintCount: 1,
          cueUsedCount: 1,
          cueDismissedCount: 0,
          falseTriggerCount: 1,
          autoAssistSignalEvidenceCount: 3,
          autoAssistInsufficientSignalCount: 0,
          autoAssistPartnerBlockedCount: 1,
          autoAssistDismissBlockedCount: 1,
          autoAssistSessionCapBlockedCount: 0,
          cueLatencyCount: 1,
          cueLatencyP50Ms: 300,
          cueLatencyP95Ms: 450,
          cueLatencyMaxMs: 470,
          avgSilenceDurationMs: 2200,
          selfResponseRate: 67,
        },
      ],
    };

    const summary = buildQaExportSummary([payload]);
    const markdown = renderQaExportMarkdown(summary);

    expect(summary.overall.sessionCount).toBe(2);
    expect(summary.overall.g2MicSuccessRate).toBe('50%');
    expect(summary.overall.phoneFallbackRate).toBe('50%');
    expect(summary.overall.cueUsedCount).toBe(2);
    expect(summary.overall.falseTriggerCount).toBe(1);
    expect(summary.overall.autoAssistSignalEvidenceCount).toBe(5);
    expect(summary.overall.autoAssistBlockedCount).toBe(3);
    expect(markdown).toContain('Cafe ordering');
    expect(markdown).toContain('Auto evals');
    expect(markdown).toContain('VAD threshold');
    expect(markdown).toContain('Calibrated at');
    expect(markdown).toContain('180ms');
    expect(markdown).toContain('310ms');
    expect(markdown).toContain('470ms');
    expect(markdown).toContain('| s1 | Cafe ordering | bridge | 0.0320 | 0.0090 | 0.0610 | 2026-06-20T09:30:00.000Z |');
    expect(markdown).not.toContain('private utterance should not appear');
    expect(markdown).not.toContain('private cue should not appear');
  });
});
