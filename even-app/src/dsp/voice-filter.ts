/**
 * Voice Filter — DSP pipeline using Web Audio API BiquadFilterNode
 * to isolate the user's voice and remove the PC AI voice band.
 *
 * Strategy:
 * - User is LOW pitch  → AI assigned HIGH pitch → apply LOW-PASS filter
 * - User is HIGH pitch → AI assigned LOW pitch  → apply HIGH-PASS filter
 *
 * The cutoff frequency is placed between the user's F0 and the AI's F0
 * so that AI voice from the PC speaker (picked up by the G2 mic) is
 * attenuated while user voice passes through to the VAD.
 */

export type VoiceRange = 'low' | 'high';
export type PersonaType = 'SPARK' | 'SHADOW';

export interface FilterConfig {
  userF0: number;
  userRange: VoiceRange;
  persona: PersonaType;
  filterType: BiquadFilterType;
  cutoffHz: number;
  qFactor: number;
}

/**
 * Compute the optimal filter configuration based on user's F0.
 */
export function computeFilterConfig(userF0: number, userRange: VoiceRange): FilterConfig {
  // Place cutoff midway between expected user and AI fundamental ranges
  if (userRange === 'low') {
    // User ~85-170Hz, AI should be high-pitched (SPARK, ~250-400Hz)
    // Low-pass: keep user's low frequencies, cut AI's high frequencies
    return {
      userF0,
      userRange,
      persona: 'SPARK',
      filterType: 'lowpass',
      cutoffHz: Math.min(userF0 * 1.8, 300), // ~1.8× user F0
      qFactor: 1.0,
    };
  } else {
    // User ~180-350Hz, AI should be low-pitched (SHADOW, ~85-150Hz)
    // High-pass: keep user's high frequencies, cut AI's low frequencies
    return {
      userF0,
      userRange,
      persona: 'SHADOW',
      filterType: 'highpass',
      cutoffHz: Math.max(userF0 * 0.6, 130), // ~0.6× user F0
      qFactor: 1.0,
    };
  }
}

/**
 * Create a filtered audio stream from a source MediaStream.
 * Returns both the AudioContext and filtered output stream.
 */
export function createFilteredStream(
  inputStream: MediaStream,
  config: FilterConfig,
): {
  audioCtx: AudioContext;
  filteredStream: MediaStream;
  filterNode: BiquadFilterNode;
  analyserNode: AnalyserNode;
} {
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(inputStream);

  // Primary bandpass via BiquadFilter
  const filter = audioCtx.createBiquadFilter();
  filter.type = config.filterType;
  filter.frequency.value = config.cutoffHz;
  filter.Q.value = config.qFactor;

  // Analyser for VAD amplitude monitoring
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.3;

  // Destination that produces a MediaStream for VAD consumption
  const dest = audioCtx.createMediaStreamDestination();

  // Wire: Source → Filter → Analyser → Destination
  source.connect(filter);
  filter.connect(analyser);
  analyser.connect(dest);

  return {
    audioCtx,
    filteredStream: dest.stream,
    filterNode: filter,
    analyserNode: analyser,
  };
}

/**
 * Destroy the filter pipeline and release resources.
 */
export function destroyFilterPipeline(ctx: {
  audioCtx: AudioContext;
  filteredStream: MediaStream;
}): void {
  ctx.filteredStream.getTracks().forEach((t) => t.stop());
  ctx.audioCtx.close().catch(() => {});
}
