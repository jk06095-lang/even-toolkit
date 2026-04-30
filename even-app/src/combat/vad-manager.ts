/**
 * VAD Manager — wraps @ricky0123/vad-web for silence detection.
 *
 * Monitors the filtered audio stream (post-DSP) and emits events
 * when the user starts/stops speaking. Tracks silence duration
 * and fires a threshold callback when the user has been silent
 * for too long (Week-specific threshold).
 *
 * AUDIO SOURCE PRIORITY:
 * 1. G2 Bridge (glasses mic) — if HUD connected
 * 2. Browser MicVAD — automatic fallback if Bridge fails
 *
 * The Bridge→MicVAD fallback ensures audio ALWAYS works even when
 * the glasses are connected for display but mic data isn't flowing.
 *
 * HARDWARE MIC NOTES:
 * - audioControl(true) must be called AFTER createStartUpPageContainer
 * - Audio data arrives as Uint8Array via onEvenHubEvent → audioEvent.audioPcm
 * - PCM format: 16-bit signed LE, mono, 16kHz
 * - First audio packet may take 1-2s to arrive after audioControl(true)
 * - We normalize all incoming data to Uint8Array (may arrive as number[])
 */

import { MicVAD, FrameProcessor, Message } from '@ricky0123/vad-web';
import * as ort from 'onnxruntime-web';
import { HUDController } from '../hud/hud-controller';

// These are needed for manual VAD loading
import { SileroLegacy } from '@ricky0123/vad-web/dist/models';
import { defaultModelFetcher } from '@ricky0123/vad-web/dist/default-model-fetcher';

ort.env.wasm.wasmPaths = '/';

export type VADState = 'idle' | 'loading' | 'listening' | 'error';

export interface VADConfig {
  /** Silence threshold in ms before triggering hint. Default: 3000 */
  silenceThresholdMs: number;
  /** Callback when silence exceeds threshold */
  onSilenceThreshold: () => void;
  /** Callback when speech is detected (resets timer) */
  onSpeechDetected: () => void;
  /** Callback on speech segment end */
  onSpeechEnd: (audio: Float32Array) => void;
  /** State change callback */
  onStateChange?: (state: VADState) => void;
  /** Real-time volume callback (RMS, 0.0 to 1.0) */
  onVolumeChange?: (volume: number) => void;
  /** G2 HUD Controller for hardware mode */
  hud?: HUDController;
}

export class VADManager {
  private vad: MicVAD | BridgeVAD | null = null;
  private config: VADConfig;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private _state: VADState = 'idle';
  private _lastSpeechTime = 0;
  private _audioSource: 'bridge' | 'browser' | 'none' = 'none';

  constructor(config: VADConfig) {
    this.config = config;
  }

  get state(): VADState {
    return this._state;
  }

  get lastSpeechTime(): number {
    return this._lastSpeechTime;
  }

  get silenceDurationMs(): number {
    if (this._lastSpeechTime === 0) return 0;
    return Date.now() - this._lastSpeechTime;
  }

  get audioSource(): string {
    return this._audioSource;
  }

  private setState(state: VADState): void {
    this._state = state;
    this.config.onStateChange?.(state);
  }

  /**
   * Start VAD — tries Bridge first (if G2 connected), falls back to browser mic.
   */
  async start(): Promise<void> {
    if (this.vad) return;

    this.setState('loading');

    // Check if we should try Bridge Mode first (Glasses Hardware)
    const tryBridge = !!(this.config.hud && this.config.hud.connected);
    
    if (tryBridge) {
      console.log('[VAD] G2 connected — trying Bridge mode first, will fallback to browser mic if needed');
      const bridgeSuccess = await this.tryBridgeMode();
      if (bridgeSuccess) {
        this.finishStart('bridge');
        return;
      }
      console.warn('[VAD] Bridge mode failed — falling back to browser microphone');
    }

    // Browser MicVAD (primary or fallback)
    const micSuccess = await this.tryMicMode();
    if (micSuccess) {
      this.finishStart('browser');
      return;
    }

    console.error('[VAD] All audio sources failed — no microphone available');
    this.setState('error');
  }

  /**
   * Try to initialize BridgeVAD with G2 glasses mic.
   * Returns true if audio data starts flowing within timeout.
   */
  private async tryBridgeMode(): Promise<boolean> {
    if (!this.config.hud) return false;

    try {
      console.log('[VAD] Initializing BridgeVAD — hardware mode');
      const bridgeVad = await BridgeVAD.new(this.config.hud, {
        onFrameProcessed: (probs, frame) => {
          if (this.config.onVolumeChange) {
            this.config.onVolumeChange(calculateRMS(frame));
          }
        },
        onSpeechStart: () => {
          this._lastSpeechTime = Date.now();
          this.clearSilenceTimer();
          this.config.onSpeechDetected();
        },
        onSpeechEnd: (audio) => {
          this._lastSpeechTime = Date.now();
          this.startSilenceTimer();
          this.config.onSpeechEnd(audio);
        },
        onVADMisfire: () => {
          this.startSilenceTimer();
        }
      });
      
      await bridgeVad.start();

      // Wait up to 8 seconds for first audio packet (hardware can be slow)
      const gotAudio = await bridgeVad.waitForFirstPacket(8000);
      
      if (gotAudio) {
        this.vad = bridgeVad;
        console.log('[VAD] BridgeVAD: Audio confirmed from glasses mic!');
        return true;
      } else {
        // No audio data — clean up and fallback
        console.warn('[VAD] BridgeVAD: No audio data received within timeout');
        await bridgeVad.stop();
        return false;
      }
    } catch (err) {
      console.error('[VAD] BridgeVAD initialization failed:', err);
      return false;
    }
  }

  /**
   * Initialize MicVAD with browser microphone.
   */
  private async tryMicMode(): Promise<boolean> {
    try {
      console.log('[VAD] Initializing MicVAD — browser microphone');
      const micVad = await Promise.race([
        MicVAD.new({
          baseAssetPath: '/',
          onnxWASMBasePath: '/',
          onFrameProcessed: (probs, frame) => {
            if (this.config.onVolumeChange) {
              this.config.onVolumeChange(calculateRMS(frame));
            }
          },
          onSpeechStart: () => {
            this._lastSpeechTime = Date.now();
            this.clearSilenceTimer();
            this.config.onSpeechDetected();
          },
          onSpeechEnd: (audio: Float32Array) => {
            this._lastSpeechTime = Date.now();
            this.startSilenceTimer();
            this.config.onSpeechEnd(audio);
          },
          onVADMisfire: () => {
            this.startSilenceTimer();
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('VAD initialization timeout (15s)')), 15000)
        )
      ]);
      micVad.start();
      this.vad = micVad;
      console.log('[VAD] MicVAD initialized — browser microphone active');
      return true;
    } catch (err) {
      console.error('[VAD] MicVAD failed:', err);
      return false;
    }
  }

  private finishStart(source: 'bridge' | 'browser'): void {
    this._audioSource = source;
    this._lastSpeechTime = Date.now();
    this.startSilenceTimer();
    this.setState('listening');
    console.log(`[VAD] ✓ VAD active — audio source: ${source === 'bridge' ? 'G2 Glasses Mic' : 'Browser/Computer Mic'}`);
  }

  /**
   * Stop VAD and clean up resources.
   */
  async stop(): Promise<void> {
    this.clearSilenceTimer();
    
    if (this.vad) {
      console.log('[VAD] Stopping VAD instance...');
      try {
        if ('destroy' in this.vad) {
          await this.vad.destroy();
        } else if ('stop' in this.vad) {
          await this.vad.stop();
        }
      } catch (e) {
        console.warn('[VAD] Error stopping VAD:', e);
      }
      this.vad = null;
    }

    this._audioSource = 'none';
    this.setState('idle');
  }

  /**
   * Update the silence threshold (for Week progression).
   */
  updateThreshold(ms: number): void {
    this.config.silenceThresholdMs = ms;
  }

  /**
   * Restart the silence timer externally (used after hint flash ends).
   */
  simulateSilenceRestart(): void {
    this._lastSpeechTime = Date.now();
    this.startSilenceTimer();
  }

  private startSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      this.config.onSilenceThreshold();
      // Don't restart — wait for next speech event
    }, this.config.silenceThresholdMs);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }
}

// ── Bridge VAD Implementation ──

interface BridgeVADCallbacks {
  onFrameProcessed: (probs: { isSpeech: number }, frame: Float32Array) => void;
  onSpeechStart: () => void;
  onSpeechEnd: (audio: Float32Array) => void;
  onVADMisfire: () => void;
}

/**
 * Manual VAD implementation for Bridge PCM stream.
 * Does not use browser AudioContext/getUserMedia.
 *
 * HARDWARE AUDIO FORMAT:
 * - PCM 16-bit signed little-endian
 * - Mono channel
 * - 16000 Hz sample rate
 * - Packets vary in size (typically 320-640 bytes per chunk)
 */
class BridgeVAD {
  private processor: FrameProcessor;
  private hud: HUDController;
  private callbacks: BridgeVADCallbacks;
  private unsub?: () => void;
  private active = false;

  // Buffer to accumulate frames of exactly 1536 samples for Silero
  private ringBuffer = new Float32Array(1536);
  private bufferIdx = 0;

  // Audio data reception tracking
  private receivedData = false;
  private packetCount = 0;
  private totalBytes = 0;
  private totalSamples = 0;
  private firstPacketResolve?: (value: boolean) => void;
  private firstPacketTime = 0;

  static async new(hud: HUDController, callbacks: BridgeVADCallbacks): Promise<BridgeVAD> {
    const modelURL = '/silero_vad_legacy.onnx';
    
    // 1. Load model
    console.log('[VAD] BridgeVAD: Loading Silero model...');
    const model = await SileroLegacy.new(ort, () => defaultModelFetcher(modelURL));
    console.log('[VAD] BridgeVAD: Model loaded');
    
    // 2. Create FrameProcessor
    const processor = new FrameProcessor(model.process, model.reset_state, {
      frameSamples: 1536,
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35,
      redemptionFrames: 8,
      preSpeechPadFrames: 1,
      minSpeechFrames: 3,
      submitUserSpeechOnPause: false,
    });

    return new BridgeVAD(hud, processor, callbacks);
  }

  constructor(hud: HUDController, processor: FrameProcessor, callbacks: BridgeVADCallbacks) {
    this.hud = hud;
    this.processor = processor;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.packetCount = 0;
    this.totalBytes = 0;
    this.totalSamples = 0;
    this.receivedData = false;
    this.firstPacketTime = 0;

    console.log('[VAD] BridgeVAD: Starting audio stream from glasses...');

    // 1. Subscribe to audio events BEFORE opening the mic
    this.unsub = this.hud.onAudioData(this.handlePcm.bind(this));

    // 2. Open audio stream on glasses (with retry logic inside HUDController)
    await this.hud.setAudioCapture(true);

    console.log('[VAD] BridgeVAD: audioControl(true) sent, waiting for data...');
  }

  /**
   * Wait for the first audio packet to arrive.
   * Returns true if data was received, false on timeout.
   */
  waitForFirstPacket(timeoutMs: number): Promise<boolean> {
    if (this.receivedData) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      this.firstPacketResolve = resolve;

      setTimeout(() => {
        if (!this.receivedData) {
          this.firstPacketResolve = undefined;
          console.warn(`[VAD] BridgeVAD: No audio packet received after ${timeoutMs}ms`);
          resolve(false);
        }
      }, timeoutMs);
    });
  }

  async stop(): Promise<void> {
    this.active = false;
    this.unsub?.();
    this.processor.pause();
    await this.hud.setAudioCapture(false);

    console.log(
      `[VAD] BridgeVAD stopped. Stats: ${this.packetCount} packets, ` +
      `${(this.totalBytes / 1024).toFixed(1)} KB, ${this.totalSamples} samples`
    );
  }

  private async handlePcm(bytes: Uint8Array): Promise<void> {
    // Skip empty packets
    if (!bytes || bytes.length === 0) return;

    // Ensure we have proper Uint8Array (HUDController should handle this,
    // but double-check for safety)
    let safeBytes = bytes;
    if (!(bytes instanceof Uint8Array)) {
      if (Array.isArray(bytes)) {
        safeBytes = new Uint8Array(bytes as any);
      } else {
        console.warn('[VAD] BridgeVAD: Unexpected audio data type:', typeof bytes);
        return;
      }
    }

    if (!this.receivedData) {
      this.receivedData = true;
      this.firstPacketTime = Date.now();
      console.log(
        `[VAD] BridgeVAD: ✓ First audio packet received! ` +
        `Size: ${safeBytes.length} bytes, Type: ${safeBytes.constructor.name}`
      );
      // Resolve the waitForFirstPacket promise
      this.firstPacketResolve?.(true);
      this.firstPacketResolve = undefined;
    }

    this.packetCount++;
    this.totalBytes += safeBytes.length;

    // Periodic diagnostics (every 100 packets)
    if (this.packetCount % 100 === 0) {
      const elapsed = (Date.now() - this.firstPacketTime) / 1000;
      console.log(
        `[VAD] BridgeVAD stats: ${this.packetCount} packets, ` +
        `${(this.totalBytes / 1024).toFixed(1)} KB total, ` +
        `${this.totalSamples} samples, ${elapsed.toFixed(1)}s elapsed`
      );
    }

    const samples = pcm16ToFloat32(safeBytes);
    this.totalSamples += samples.length;
    
    for (let i = 0; i < samples.length; i++) {
      this.ringBuffer[this.bufferIdx++] = samples[i];
      
      if (this.bufferIdx >= 1536) {
        // Frame complete — process it
        const frame = new Float32Array(this.ringBuffer);
        this.bufferIdx = 0;

        try {
          const result = await this.processor.process(frame);
          
          if (result.probs) {
            this.callbacks.onFrameProcessed(result.probs, frame);
          }

          switch (result.msg) {
            case Message.SpeechStart:
              this.callbacks.onSpeechStart();
              break;
            case Message.SpeechEnd:
              if (result.audio) this.callbacks.onSpeechEnd(result.audio);
              break;
            case Message.VADMisfire:
              this.callbacks.onVADMisfire();
              break;
          }
        } catch (err) {
          // Don't let a single frame processing error kill the entire pipeline
          if (this.packetCount <= 5) {
            console.warn('[VAD] BridgeVAD: Frame processing error:', err);
          }
        }
      }
    }
  }
}

// ── Helpers ──

function calculateRMS(frame: Float32Array): number {
  let sumSquares = 0;
  for (let i = 0; i < frame.length; i++) {
    sumSquares += frame[i] * frame[i];
  }
  const rms = Math.sqrt(sumSquares / frame.length);
  return Math.min(1, Math.max(0, rms * 10));
}

function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const samples = bytes.length / 2;
  const float32 = new Float32Array(samples);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < samples; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}
