/**
 * Pitch Detector — Extracts user's fundamental frequency (F0)
 * using autocorrelation on time-domain audio data.
 *
 * Used in Phase 1 (Calibration) to determine the user's voice range
 * and set up the BiquadFilter for speaker isolation.
 */

const MIN_F0 = 60;   // lowest expected human pitch (Hz)
const MAX_F0 = 500;  // highest expected human pitch (Hz)
const SAMPLE_DURATION_MS = 3000;
const ANALYSIS_INTERVAL_MS = 50;

export interface PitchResult {
  f0: number;           // median fundamental frequency (Hz)
  range: 'low' | 'high'; // low = male-typical, high = female-typical
  confidence: number;   // 0-1
  samples: number[];    // raw F0 readings
}

/**
 * Detect pitch using autocorrelation (YIN-lite).
 * Operates on float time-domain PCM data.
 */
function detectPitch(buffer: Float32Array, sampleRate: number): number | null {
  const minLag = Math.floor(sampleRate / MAX_F0);
  const maxLag = Math.floor(sampleRate / MIN_F0);

  if (buffer.length < maxLag * 2) return null;

  // Compute difference function (YIN step 2)
  const diff = new Float32Array(maxLag);
  for (let lag = minLag; lag < maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < buffer.length - maxLag; i++) {
      const d = buffer[i]! - buffer[i + lag]!;
      sum += d * d;
    }
    diff[lag] = sum;
  }

  // Cumulative mean normalized difference (YIN step 3)
  const cmnd = new Float32Array(maxLag);
  cmnd[minLag] = 1;
  let runningSum = 0;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    runningSum += diff[lag]!;
    cmnd[lag] = diff[lag]! * (lag - minLag) / runningSum;
  }

  // Absolute threshold (YIN step 4)
  const threshold = 0.15;
  let bestLag = -1;
  for (let lag = minLag; lag < maxLag - 1; lag++) {
    if (cmnd[lag]! < threshold) {
      // Find the local minimum
      while (lag + 1 < maxLag && cmnd[lag + 1]! < cmnd[lag]!) {
        lag++;
      }
      bestLag = lag;
      break;
    }
  }

  if (bestLag === -1) {
    // Fallback: find global minimum
    let minVal = Infinity;
    for (let lag = minLag; lag < maxLag; lag++) {
      if (cmnd[lag]! < minVal) {
        minVal = cmnd[lag]!;
        bestLag = lag;
      }
    }
    if (minVal > 0.5) return null; // too noisy
  }

  // Parabolic interpolation for sub-sample accuracy
  if (bestLag > minLag && bestLag < maxLag - 1) {
    const s0 = cmnd[bestLag - 1]!;
    const s1 = cmnd[bestLag]!;
    const s2 = cmnd[bestLag + 1]!;
    const shift = (s0 - s2) / (2 * (s0 - 2 * s1 + s2));
    if (Math.abs(shift) < 1) {
      return sampleRate / (bestLag + shift);
    }
  }

  return sampleRate / bestLag;
}

/**
 * Callback that provides PCM Float32 frames from an external source (e.g. G2 glasses).
 * subscribe: register a callback to receive frames; returns an unsubscribe function.
 */
export interface BridgeAudioSource {
  subscribe: (cb: (frame: Float32Array) => void) => (() => void);
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Run a full calibration capture: records from the microphone for
 * SAMPLE_DURATION_MS, collects F0 samples, returns the median result.
 *
 * If bridgeSource is provided, uses that instead of browser getUserMedia.
 */
export async function calibratePitch(
  onProgress?: (pct: number) => void,
  bridgeSource?: BridgeAudioSource,
): Promise<PitchResult> {
  if (bridgeSource) {
    return calibratePitchFromBridge(bridgeSource, onProgress);
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });

  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 4096;

  source.connect(analyser);

  const buffer = new Float32Array(analyser.fftSize);
  const f0Samples: number[] = [];
  const startTime = Date.now();

  return new Promise<PitchResult>((resolve) => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      onProgress?.(Math.min(1, elapsed / SAMPLE_DURATION_MS));

      analyser.getFloatTimeDomainData(buffer);
      const pitch = detectPitch(buffer, audioCtx.sampleRate);
      if (pitch !== null && pitch >= MIN_F0 && pitch <= MAX_F0) {
        f0Samples.push(pitch);
      }

      if (elapsed >= SAMPLE_DURATION_MS) {
        clearInterval(interval);
        stream.getTracks().forEach((t) => t.stop());
        audioCtx.close();

        if (f0Samples.length === 0) {
          resolve({
            f0: 150,
            range: 'low',
            confidence: 0,
            samples: [],
          });
          return;
        }

        const sorted = [...f0Samples].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)]!;
        const confidence = Math.min(1, f0Samples.length / 30);

        resolve({
          f0: Math.round(median),
          range: median < 180 ? 'low' : 'high',
          confidence,
          samples: f0Samples,
        });
      }
    }, ANALYSIS_INTERVAL_MS);
  });
}

/**
 * Calibrate pitch from Bridge PCM data (G2 glasses mic).
 * Collects 3 seconds of audio frames, analyzes pitch from each frame.
 */
async function calibratePitchFromBridge(
  source: BridgeAudioSource,
  onProgress?: (pct: number) => void,
): Promise<PitchResult> {
  const BRIDGE_SAMPLE_RATE = 16000; // G2 mic is 16kHz PCM
  const f0Samples: number[] = [];
  const startTime = Date.now();
  // Accumulate frames into a buffer large enough for pitch detection
  let accBuffer = new Float32Array(0);

  return new Promise<PitchResult>(async (resolve) => {
    const unsub = source.subscribe((frame: Float32Array) => {
      // Append frame to accumulation buffer
      const newBuf = new Float32Array(accBuffer.length + frame.length);
      newBuf.set(accBuffer);
      newBuf.set(frame, accBuffer.length);
      accBuffer = newBuf;

      // Analyze when we have at least 4096 samples
      if (accBuffer.length >= 4096) {
        const analyzeChunk = accBuffer.slice(0, 4096);
        accBuffer = accBuffer.slice(2048); // overlap

        const pitch = detectPitch(analyzeChunk, BRIDGE_SAMPLE_RATE);
        if (pitch !== null && pitch >= MIN_F0 && pitch <= MAX_F0) {
          f0Samples.push(pitch);
        }
      }

      const elapsed = Date.now() - startTime;
      onProgress?.(Math.min(1, elapsed / SAMPLE_DURATION_MS));
    });

    await source.start();

    // Wait for sample duration
    setTimeout(async () => {
      unsub();
      await source.stop();

      if (f0Samples.length === 0) {
        resolve({
          f0: 150,
          range: 'low',
          confidence: 0,
          samples: [],
        });
        return;
      }

      const sorted = [...f0Samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)]!;
      const confidence = Math.min(1, f0Samples.length / 30);

      resolve({
        f0: Math.round(median),
        range: median < 180 ? 'low' : 'high',
        confidence,
        samples: f0Samples,
      });
    }, SAMPLE_DURATION_MS);
  });
}

