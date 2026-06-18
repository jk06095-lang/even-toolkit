/**
 * Calibration Orchestrator — Phase 1 entry point.
 *
 * 1. Request microphone permission
 * 2. Run pitch detection (3s sample)
 * 3. Compute filter config
 * 4. Save to localStorage
 * 5. Return results for HUD display
 */

import { calibratePitch, type PitchResult, type BridgeAudioSource } from './pitch-detector';
import { computeFilterConfig, type FilterConfig } from './voice-filter';
import type { HUDController } from '../hud/hud-controller';

const CALIBRATION_KEY = 'echo_calibration';

export interface CalibrationResult {
  pitch: PitchResult;
  filter: FilterConfig;
  noiseFloorRms: number;
  speechFloorRms: number;
  speechThreshold: number;
  calibratedAt: number;
  timestamp: number;
}

export interface VadCalibration {
  noiseFloorRms: number;
  speechFloorRms: number;
  speechThreshold: number;
  calibratedAt: number;
}

const FALLBACK_VAD_CALIBRATION: VadCalibration = {
  noiseFloorRms: 0.005,
  speechFloorRms: 0.04,
  speechThreshold: 0.015,
  calibratedAt: 0,
};

function percentile(sortedValues: number[], pct: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((sortedValues.length - 1) * pct)),
  );
  return sortedValues[index] ?? 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Convert calibration RMS samples into the threshold scale used by BridgeVAD.
 * Samples are normalized RMS values in the same 0-1 range emitted to the UI.
 */
export function deriveVadCalibration(
  rmsSamples: number[],
  calibratedAt = Date.now(),
): VadCalibration {
  const samples = rmsSamples
    .filter((value) => Number.isFinite(value) && value >= 0)
    .map((value) => clamp(value, 0, 1))
    .sort((a, b) => a - b);

  if (samples.length < 4) {
    return { ...FALLBACK_VAD_CALIBRATION, calibratedAt };
  }

  const noiseFloorRms = percentile(samples, 0.2);
  const speechFloorRms = Math.max(percentile(samples, 0.7), percentile(samples, 0.9) * 0.75);
  const separation = speechFloorRms - noiseFloorRms;

  const speechThreshold =
    separation >= 0.01
      ? noiseFloorRms + separation * 0.35
      : Math.max(FALLBACK_VAD_CALIBRATION.speechThreshold, noiseFloorRms * 2.2);

  return {
    noiseFloorRms: roundRms(noiseFloorRms),
    speechFloorRms: roundRms(speechFloorRms),
    speechThreshold: roundRms(clamp(
      speechThreshold,
      FALLBACK_VAD_CALIBRATION.speechThreshold,
      0.35,
    )),
    calibratedAt,
  };
}

function roundRms(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function normalizeCalibrationResult(input: CalibrationResult): CalibrationResult {
  const calibratedAt = input.calibratedAt ?? input.timestamp ?? Date.now();
  const hasVadCalibration =
    Number.isFinite(input.noiseFloorRms) &&
    Number.isFinite(input.speechFloorRms) &&
    Number.isFinite(input.speechThreshold);

  const vadCalibration = hasVadCalibration
    ? {
        noiseFloorRms: input.noiseFloorRms,
        speechFloorRms: input.speechFloorRms,
        speechThreshold: input.speechThreshold,
        calibratedAt,
      }
    : { ...FALLBACK_VAD_CALIBRATION, calibratedAt };

  return {
    ...input,
    ...vadCalibration,
    timestamp: input.timestamp ?? calibratedAt,
  };
}

/**
 * Convert PCM16 bytes (Uint8Array from G2 mic) to Float32Array.
 */
function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const samples = bytes.length / 2;
  const float32 = new Float32Array(samples);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < samples; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

/**
 * Create a BridgeAudioSource that wraps HUDController's audio capture.
 */
function createBridgeSource(hud: HUDController): BridgeAudioSource {
  return {
    subscribe: (cb: (frame: Float32Array) => void) => {
      return hud.onAudioData((pcm: Uint8Array) => {
        const float32 = pcm16ToFloat32(pcm);
        cb(float32);
      });
    },
    start: () => hud.setAudioCapture(true),
    stop: () => hud.setAudioCapture(false),
  };
}

/**
 * Run the full calibration sequence.
 * If hud is connected, uses G2 glasses microphone instead of browser mic.
 */
export async function runCalibration(
  onProgress?: (pct: number) => void,
  hud?: HUDController,
  onVolume?: (volume: number) => void,
): Promise<CalibrationResult> {
  // Use Bridge mode if HUD is connected
  const bridgeSource = (hud && hud.connected) ? createBridgeSource(hud) : undefined;
  
  if (bridgeSource) {
    console.log('[Calibration] Using G2 glasses microphone via Bridge');
  } else {
    console.log('[Calibration] Using browser/computer microphone');
  }

  const rmsSamples: number[] = [];
  const captureVolume = (volume: number) => {
    rmsSamples.push(volume);
    onVolume?.(volume);
  };

  const pitch = await calibratePitch(onProgress, bridgeSource, captureVolume);
  const filter = computeFilterConfig(pitch.f0, pitch.range);
  const vadCalibration = deriveVadCalibration(rmsSamples);

  const result: CalibrationResult = {
    pitch,
    filter,
    ...vadCalibration,
    timestamp: vadCalibration.calibratedAt,
  };

  console.info(
    `[Calibration] VAD threshold=${result.speechThreshold} noise=${result.noiseFloorRms} speech=${result.speechFloorRms}`,
  );

  // Persist to localStorage (IndexedDB bridge may not be available yet)
  try {
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify(result));
  } catch {
    // Storage full or unavailable
  }

  return result;
}

/**
 * Load previously saved calibration, or null if none exists.
 */
export function loadCalibration(): CalibrationResult | null {
  try {
    const raw = localStorage.getItem(CALIBRATION_KEY);
    if (!raw) return null;
    return normalizeCalibrationResult(JSON.parse(raw) as CalibrationResult);
  } catch {
    return null;
  }
}

/**
 * Generate a default calibration for demo/testing
 * (skips microphone, assumes male low-pitch voice).
 */
export function defaultCalibration(): CalibrationResult {
  const now = Date.now();
  const pitch: PitchResult = {
    f0: 130,
    range: 'low',
    confidence: 0,
    samples: [],
  };
  return {
    pitch,
    filter: computeFilterConfig(pitch.f0, pitch.range),
    ...FALLBACK_VAD_CALIBRATION,
    calibratedAt: now,
    timestamp: now,
  };
}
