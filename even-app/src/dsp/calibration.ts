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
  timestamp: number;
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
): Promise<CalibrationResult> {
  // Use Bridge mode if HUD is connected
  const bridgeSource = (hud && hud.connected) ? createBridgeSource(hud) : undefined;
  
  if (bridgeSource) {
    console.log('[Calibration] Using G2 glasses microphone via Bridge');
  } else {
    console.log('[Calibration] Using browser/computer microphone');
  }

  const pitch = await calibratePitch(onProgress, bridgeSource);
  const filter = computeFilterConfig(pitch.f0, pitch.range);

  const result: CalibrationResult = {
    pitch,
    filter,
    timestamp: Date.now(),
  };

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
    return JSON.parse(raw) as CalibrationResult;
  } catch {
    return null;
  }
}

/**
 * Generate a default calibration for demo/testing
 * (skips microphone, assumes male low-pitch voice).
 */
export function defaultCalibration(): CalibrationResult {
  const pitch: PitchResult = {
    f0: 130,
    range: 'low',
    confidence: 0,
    samples: [],
  };
  return {
    pitch,
    filter: computeFilterConfig(pitch.f0, pitch.range),
    timestamp: Date.now(),
  };
}
