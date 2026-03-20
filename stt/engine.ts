import type {
  STTEngineConfig,
  STTProvider,
  STTState,
  STTTranscript,
  STTError,
  AudioSource,
} from './types';
import { createProvider } from './registry';
import { MicrophoneSource } from './sources/microphone';
import { resample } from './audio/resample';
import { createVAD } from './audio/vad';
import { createAudioBuffer } from './audio/buffer';

/**
 * STTEngine orchestrates source -> processing -> provider.
 *
 * For `web-speech` provider: skips audio source (it handles its own mic).
 * For other providers: starts audio source, pipes through optional resample
 * and VAD, buffers audio, and calls provider.transcribe() on speech end.
 */
export class STTEngine {
  private config: STTEngineConfig;
  private provider: STTProvider | null = null;
  private source: AudioSource | null = null;
  private sourceUnsub: (() => void) | null = null;

  private transcriptListeners: Array<(t: STTTranscript) => void> = [];
  private stateListeners: Array<(s: STTState) => void> = [];
  private errorListeners: Array<(e: STTError) => void> = [];

  private providerUnsubs: Array<() => void> = [];

  private vad: ReturnType<typeof createVAD> | null = null;
  private buffer: ReturnType<typeof createAudioBuffer> | null = null;
  private targetSampleRate: number;

  constructor(config: STTEngineConfig) {
    this.config = config;
    this.targetSampleRate = config.sampleRate ?? 16000;
  }

  // ── Event subscriptions ──

  onTranscript(cb: (t: STTTranscript) => void): () => void {
    this.transcriptListeners.push(cb);
    return () => {
      const idx = this.transcriptListeners.indexOf(cb);
      if (idx >= 0) this.transcriptListeners.splice(idx, 1);
    };
  }

  onStateChange(cb: (s: STTState) => void): () => void {
    this.stateListeners.push(cb);
    return () => {
      const idx = this.stateListeners.indexOf(cb);
      if (idx >= 0) this.stateListeners.splice(idx, 1);
    };
  }

  onError(cb: (e: STTError) => void): () => void {
    this.errorListeners.push(cb);
    return () => {
      const idx = this.errorListeners.indexOf(cb);
      if (idx >= 0) this.errorListeners.splice(idx, 1);
    };
  }

  private emitTranscript(t: STTTranscript): void {
    for (const cb of this.transcriptListeners) cb(t);
  }

  private emitState(s: STTState): void {
    for (const cb of this.stateListeners) cb(s);
  }

  private emitError(e: STTError): void {
    for (const cb of this.errorListeners) cb(e);
  }

  // ── Lifecycle ──

  async start(): Promise<void> {
    this.emitState('loading');

    try {
      // Create and init provider
      this.provider = await createProvider(this.config.provider);
      this.subscribeProvider(this.provider);

      await this.provider.init({
        language: this.config.language,
        mode: this.config.mode,
        apiKey: this.config.apiKey,
        modelId: this.config.modelId,
        continuous: this.config.continuous,
        vadEnabled: typeof this.config.vad === 'boolean' ? this.config.vad : !!this.config.vad,
        vadSilenceMs: typeof this.config.vad === 'object' ? this.config.vad.silenceMs : undefined,
        sampleRate: this.targetSampleRate,
      });

      // web-speech handles its own microphone
      if (this.config.provider === 'web-speech') {
        this.provider.start();
        return;
      }

      // Set up audio source
      this.source = this.resolveSource();
      await this.source.start();

      // Set up VAD if enabled
      if (this.config.vad) {
        const vadConfig = typeof this.config.vad === 'object' ? {
          silenceThresholdMs: this.config.vad.silenceMs,
          speechThresholdDb: this.config.vad.thresholdDb,
        } : undefined;
        this.vad = createVAD(vadConfig);
      }

      // Set up audio buffer for batch mode
      this.buffer = createAudioBuffer({ sampleRate: this.targetSampleRate });

      // Wire audio pipeline
      this.sourceUnsub = this.source.onAudioData((pcm, sampleRate) => {
        this.processAudio(pcm, sampleRate);
      });

      this.provider.start();
    } catch (err) {
      const error: STTError = {
        code: 'unknown',
        message: err instanceof Error ? err.message : String(err),
        provider: this.config.provider,
      };
      this.emitError(error);
      this.emitState('error');

      // Attempt fallback
      if (this.config.fallback) {
        await this.switchToFallback();
      }
    }
  }

  stop(): void {
    this.provider?.stop();
    this.sourceUnsub?.();
    this.sourceUnsub = null;
    this.source?.stop();
    this.vad?.reset();
    this.buffer?.clear();
  }

  abort(): void {
    this.provider?.abort();
    this.sourceUnsub?.();
    this.sourceUnsub = null;
    this.source?.stop();
    this.vad?.reset();
    this.buffer?.clear();
  }

  dispose(): void {
    this.abort();
    for (const unsub of this.providerUnsubs) unsub();
    this.providerUnsubs.length = 0;
    this.provider?.dispose();
    this.provider = null;
    this.source?.dispose();
    this.source = null;
    this.transcriptListeners.length = 0;
    this.stateListeners.length = 0;
    this.errorListeners.length = 0;
  }

  // ── Internal ──

  private resolveSource(): AudioSource {
    const src = this.config.source;
    if (!src || src === 'microphone') {
      return new MicrophoneSource();
    }
    if (src === 'glass-bridge') {
      throw new Error(
        'glass-bridge source requires a GlassBridgeSource instance. ' +
        'Pass an AudioSource object directly via config.source.'
      );
    }
    // Custom AudioSource instance
    return src;
  }

  private processAudio(pcm: Float32Array, sampleRate: number): void {
    // Resample if needed
    let samples = sampleRate !== this.targetSampleRate
      ? resample(pcm, sampleRate, this.targetSampleRate)
      : pcm;

    if (!this.buffer) return;

    // If VAD is enabled, check for speech boundaries
    if (this.vad) {
      const result = this.vad.process(samples);

      if (result.isSpeech || result.speechEnded) {
        this.buffer.append(samples);
      }

      if (result.speechEnded) {
        this.flushBuffer();
      }
    } else {
      // No VAD: accumulate everything, provider handles streaming
      this.buffer.append(samples);
    }
  }

  private async flushBuffer(): Promise<void> {
    if (!this.buffer || !this.provider) return;

    const audio = this.buffer.getAll();
    this.buffer.clear();

    if (audio.length === 0) return;

    // If provider supports batch transcription
    if (this.provider.transcribe) {
      try {
        const transcript = await this.provider.transcribe(audio, this.targetSampleRate);
        this.emitTranscript(transcript);
      } catch (err) {
        this.emitError({
          code: 'unknown',
          message: err instanceof Error ? err.message : String(err),
          provider: this.config.provider,
        });
      }
    }
  }

  private subscribeProvider(provider: STTProvider): void {
    this.providerUnsubs.push(
      provider.onTranscript((t) => this.emitTranscript(t)),
      provider.onStateChange((s) => this.emitState(s)),
      provider.onError((e) => {
        this.emitError(e);
        if (this.config.fallback) {
          this.switchToFallback();
        }
      }),
    );
  }

  private async switchToFallback(): Promise<void> {
    if (!this.config.fallback) return;

    // Clean up current provider
    for (const unsub of this.providerUnsubs) unsub();
    this.providerUnsubs.length = 0;
    this.provider?.dispose();
    this.provider = null;

    // Switch to fallback
    const fallbackType = this.config.fallback;
    this.config = { ...this.config, provider: fallbackType, fallback: undefined };

    try {
      await this.start();
    } catch {
      // Fallback also failed — nothing more to do
    }
  }
}
