import { describe, expect, it } from 'vitest';
import {
  FALLBACK_VAD_SPEECH_THRESHOLD,
  MAX_VAD_SPEECH_THRESHOLD,
  deriveVadCalibration,
  resolveVadSpeechThreshold,
} from '../src/dsp/calibration';

const capturedAt = new Date('2026-06-18T00:00:00Z').getTime();

describe('calibration-derived VAD thresholds', () => {
  it.each([
    {
      name: 'quiet room',
      samples: [
        0.002, 0.003, 0.003, 0.004, 0.004, 0.006,
        0.08, 0.11, 0.14, 0.18, 0.19, 0.2,
      ],
    },
    {
      name: 'cafe background',
      samples: [
        0.018, 0.02, 0.024, 0.028, 0.032, 0.036,
        0.12, 0.16, 0.2, 0.24, 0.27, 0.3,
      ],
    },
    {
      name: 'air conditioner',
      samples: [
        0.01, 0.012, 0.014, 0.016, 0.018, 0.02,
        0.09, 0.12, 0.15, 0.17, 0.19, 0.21,
      ],
    },
    {
      name: 'outdoor stationary wind',
      samples: [
        0.035, 0.04, 0.048, 0.052, 0.06, 0.07,
        0.16, 0.21, 0.24, 0.28, 0.31, 0.34,
      ],
    },
  ])('places $name threshold between noise and speech floors', ({ samples }) => {
    const result = deriveVadCalibration(samples, capturedAt);

    expect(result.calibratedAt).toBe(capturedAt);
    expect(result.noiseFloorRms).toBeGreaterThanOrEqual(0);
    expect(result.speechFloorRms).toBeGreaterThan(result.noiseFloorRms);
    expect(result.speechThreshold).toBeGreaterThan(result.noiseFloorRms);
    expect(result.speechThreshold).toBeLessThan(result.speechFloorRms);
  });

  it('keeps a conservative fallback for sparse calibration samples', () => {
    const result = deriveVadCalibration([0.003, 0.004], capturedAt);

    expect(result.speechThreshold).toBe(0.015);
    expect(result.noiseFloorRms).toBe(0.005);
    expect(result.speechFloorRms).toBe(0.04);
  });

  it('raises threshold as the measured noise floor increases', () => {
    const quiet = deriveVadCalibration([
      0.002, 0.003, 0.004, 0.006, 0.08, 0.1, 0.12, 0.14,
    ], capturedAt);
    const noisy = deriveVadCalibration([
      0.04, 0.045, 0.05, 0.06, 0.16, 0.19, 0.22, 0.25,
    ], capturedAt);

    expect(noisy.speechThreshold).toBeGreaterThan(quiet.speechThreshold);
  });

  it('normalizes saved thresholds before they reach bridge audio paths', () => {
    expect(resolveVadSpeechThreshold(null)).toBe(FALLBACK_VAD_SPEECH_THRESHOLD);
    expect(resolveVadSpeechThreshold({ speechThreshold: Number.NaN })).toBe(FALLBACK_VAD_SPEECH_THRESHOLD);
    expect(resolveVadSpeechThreshold({ speechThreshold: 0.001 })).toBe(FALLBACK_VAD_SPEECH_THRESHOLD);
    expect(resolveVadSpeechThreshold({ speechThreshold: 0.07 })).toBe(0.07);
    expect(resolveVadSpeechThreshold({ speechThreshold: 0.9 })).toBe(MAX_VAD_SPEECH_THRESHOLD);
  });
});
