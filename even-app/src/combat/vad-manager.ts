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
      
      // Trust the Bridge stream exactly like Calibration Mode does, no timeout fallback.
      this.vad = bridgeVad;
      console.log('[VAD] BridgeVAD: Hardware microphone stream initiated.');
      return true;
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
 * Lightweight Energy-based VAD for Bridge PCM stream.
 * Mirrors the robust pure-JS capture used in Calibration mode.
 */
class BridgeVAD {
  private hud: HUDController;
  private callbacks: BridgeVADCallbacks;
  private unsub?: () => void;
  private active = false;

  // Audio data reception tracking
  private receivedData = false;
  private packetCount = 0;
  private totalBytes = 0;
  private firstPacketResolve?: (value: boolean) => void;

  // Energy VAD State
  private isSpeechActive = false;
  private speechFrames: Float32Array[] = [];
  private silenceFrames = 0;
  
  // Tunable Thresholds
  private speechThreshold = 0.015; // RMS threshold for speech
  private minSilenceFrames = 15;   // ~0.5s of silence to finalize chunk

  static async new(hud: HUDController, callbacks: BridgeVADCallbacks): Promise<BridgeVAD> {
    // Skip ONNX model loading entirely to prevent initialization crashes on device.
    return new BridgeVAD(hud, callbacks);
  }

  constructor(hud: HUDController, callbacks: BridgeVADCallbacks) {
    this.hud = hud;
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
    await this.hud.setAudioCapture(false);
  }

  async pause(): Promise<void> {
    // Energy VAD doesn't strictly need a pause, but we can reset state
    this.isSpeechActive = false;
    this.speechFrames = [];
  }

  async resume(): Promise<void> {
    this.isSpeechActive = false;
    this.speechFrames = [];
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

    const samples = pcm16ToFloat32(bytes);
    const volume = calculateRMS(samples);
    
    // Immediately calculate volume and forward PCM for real-time UI/transcription
    if (this.callbacks.onVolumeChange) {
      this.callbacks.onVolumeChange(volume);
    }
    if (this.callbacks.onPCMFrame) {
      this.callbacks.onPCMFrame(samples);
    }

    // Energy VAD Logic
    if (volume > this.speechThreshold) {
      this.silenceFrames = 0;
      if (!this.isSpeechActive) {
        this.isSpeechActive = true;
        this.speechFrames = [];
        this.callbacks.onSpeechStart();
      }
      this.speechFrames.push(samples);
      this.callbacks.onFrameProcessed({ isSpeech: 1.0 }, samples);
    } else {
      if (this.isSpeechActive) {
        this.silenceFrames++;
        this.speechFrames.push(samples); // Append trailing silence

        if (this.silenceFrames >= this.minSilenceFrames) {
          // Finalize speech chunk
          this.isSpeechActive = false;
          
          const totalLength = this.speechFrames.reduce((acc, f) => acc + f.length, 0);
          const combined = new Float32Array(totalLength);
          let offset = 0;
          for (const f of this.speechFrames) {
            combined.set(f, offset);
            offset += f.length;
          }
          
          this.callbacks.onSpeechEnd(combined);
          this.speechFrames = [];
        } else {
          this.callbacks.onFrameProcessed({ isSpeech: 1.0 }, samples); // Still considered active
        }
      } else {
        this.callbacks.onFrameProcessed({ isSpeech: 0.0 }, samples);
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
