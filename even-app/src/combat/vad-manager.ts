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
 */

import { MicVAD, FrameProcessor, Message } from '@ricky0123/vad-web';
import * as ort from 'onnxruntime-web';
import { HUDController } from '../hud/hud-controller';

// These are needed for manual VAD loading
import { SileroLegacy } from '@ricky0123/vad-web/dist/models';
import { defaultModelFetcher } from '@ricky0123/vad-web/dist/default-model-fetcher';

ort.env.wasm.wasmPaths = '/';

export type VADState = 'idle' | 'loading' | 'listening' | 'paused' | 'error';

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
  /** Raw PCM frame callback for bridge transcription */
  onPCMFrame?: (frame: Float32Array) => void;
  /** Bridge speech start (for forwarding to recognizer) */
  onBridgeSpeechStart?: () => void;
  /** Bridge speech end (for forwarding to recognizer) */
  onBridgeSpeechEnd?: () => void;
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
    const hasHUD = !!this.config.hud;
    const isHUDConnected = hasHUD && this.config.hud!.connected;
    
    if (hasHUD && isHUDConnected) {
      console.log('[VAD] G2 hardware detected & connected — trying Bridge mode');
      const bridgeSuccess = await this.tryBridgeMode();
      if (bridgeSuccess) {
        this.finishStart('bridge');
        return;
      }
      console.warn('[VAD] Bridge mode failed to stream audio — falling back to browser microphone');
    } else {
      const reason = !hasHUD ? 'no HUD controller' : 'glasses not Bluetooth connected';
      console.log(`[VAD] Skipping Bridge mode (${reason}) — using browser microphone`);
    }

    // Browser MicVAD (primary or fallback)
    const micSuccess = await this.tryMicMode();
    if (micSuccess) {
      this.finishStart('browser');
      return;
    }

    // Check for HTTPS/Secure Origin issues which block microphones on mobile
    const isSecure = window.isSecureContext;
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    if (!isSecure && !isLocalhost) {
      console.error('[VAD] Browser blocked microphone due to insecure origin (HTTP).');
      this.config.onStateChange?.('error');
      // We'll throw a specific message that main.ts can catch and show a UI warning for
      throw new Error('SECURE_ORIGIN_REQUIRED');
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
        onVolumeChange: (volume) => {
          if (this.config.onVolumeChange) {
            this.config.onVolumeChange(volume);
          }
        },
        onPCMFrame: (frame) => {
          this.config.onPCMFrame?.(frame);
        },
        onFrameProcessed: (probs, frame) => {
          // VAD probabilities update (UI uses volume mostly, but VAD uses this internally)
        },
        onSpeechStart: () => {
          this._lastSpeechTime = Date.now();
          this.clearSilenceTimer();
          this.config.onSpeechDetected();
          this.config.onBridgeSpeechStart?.();
        },
        onSpeechEnd: (audio) => {
          this._lastSpeechTime = Date.now();
          this.startSilenceTimer();
          this.config.onSpeechEnd(audio);
          this.config.onBridgeSpeechEnd?.();
        },
        onVADMisfire: () => {
          this.startSilenceTimer();
        }
      });
      
      await bridgeVad.start();

      // Wait up to 5 seconds for first audio packet
      const gotAudio = await bridgeVad.waitForFirstPacket(5000);
      
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
            const volume = calculateRMS(frame);
            if (this.config.onVolumeChange) {
              this.config.onVolumeChange(volume);
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
   * Pause VAD processing without fully stopping.
   */
  async pause(): Promise<void> {
    this.clearSilenceTimer();
    if (this.vad) {
      console.log('[VAD] Pausing VAD instance...');
      if ('pause' in this.vad) {
        await (this.vad as any).pause();
      }
    }
    this.setState('paused');
  }

  /**
   * Resume VAD processing after being paused.
   */
  async resume(): Promise<void> {
    if (this.vad) {
      console.log('[VAD] Resuming VAD instance...');
      if ('resume' in this.vad) {
        await (this.vad as any).resume();
      } else if ('start' in this.vad) {
        await (this.vad as any).start(); // MicVAD uses start()
      }
    }
    this._lastSpeechTime = Date.now();
    this.startSilenceTimer();
    this.setState('listening');
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
  onVolumeChange?: (volume: number) => void;
  onPCMFrame?: (frame: Float32Array) => void;
}

/**
 * Manual VAD implementation for Bridge PCM stream.
 * Does not use browser AudioContext/getUserMedia.
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
  private firstPacketResolve?: (value: boolean) => void;

  static async new(hud: HUDController, callbacks: BridgeVADCallbacks): Promise<BridgeVAD> {
    const modelURL = '/silero_vad_legacy.onnx';
    
    // 1. Load model
    const model = await SileroLegacy.new(ort, () => defaultModelFetcher(modelURL));
    
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
    this.receivedData = false;

    console.log('[VAD] BridgeVAD: Starting audio stream from glasses...');

    // 1. Subscribe to audio events
    this.unsub = this.hud.onAudioData(this.handlePcm.bind(this));

    // 2. Open audio stream on glasses
    await this.hud.setAudioCapture(true);
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
  }

  async pause(): Promise<void> {
    this.processor.pause();
  }

  async resume(): Promise<void> {
    this.processor.resume();
  }

  private async handlePcm(bytes: Uint8Array): Promise<void> {
    // Skip empty packets
    if (!bytes || bytes.length === 0) return;

    if (!this.receivedData) {
      this.receivedData = true;
      console.log('[VAD] BridgeVAD: First audio packet received from glasses!');
      // Resolve the waitForFirstPacket promise
      this.firstPacketResolve?.(true);
      this.firstPacketResolve = undefined;
    }

    this.packetCount++;
    this.totalBytes += bytes.length;

    // Periodic diagnostics (every 100 packets)
    if (this.packetCount % 100 === 0) {
      console.log(`[VAD] BridgeVAD stats: ${this.packetCount} packets, ${(this.totalBytes / 1024).toFixed(1)} KB total`);
    }

    const samples = pcm16ToFloat32(bytes);
    
    // Immediately calculate volume and forward PCM for real-time UI/transcription
    if (this.callbacks.onVolumeChange) {
      this.callbacks.onVolumeChange(calculateRMS(samples));
    }
    if (this.callbacks.onPCMFrame) {
      this.callbacks.onPCMFrame(samples);
    }
    
    for (let i = 0; i < samples.length; i++) {
      this.ringBuffer[this.bufferIdx++] = samples[i];
      
      if (this.bufferIdx >= 1536) {
        // Frame complete — process it
        const frame = new Float32Array(this.ringBuffer);
        this.bufferIdx = 0;

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
