/**
 * Hybrid Recognizer — Fastest-possible transcription for Combat Mode.
 *
 * Three operating modes:
 * 1. **browser** — Web Speech API only (phone/computer mic).
 * 2. **bridge**  — PCM → ECHO API transcription only (G2 glasses mic).
 * 3. **hybrid**  — Web Speech API for instant text *and* PCM buffer
 *    accumulation (for downstream `evaluateSpeech`), but proxy interim
 *    transcription is skipped because Web Speech already provides text.
 *
 * Language: English (en-US)
 */

import { float32ToWav } from '@toolkit/stt/audio/pcm-utils';
import { isEchoApiConfigured, requestTranscription } from '../services/echo-api';

// ── Helpers ──

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      resolve(base64!);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Public types ──

export interface HybridRecognizerCallbacks {
  /** Partial / interim transcription text. */
  onInterimResult: (text: string, confidence?: number) => void;
  /** Finalized transcription text. */
  onFinalResult: (text: string, confidence?: number) => void;
  /** Speech energy detected. */
  onSpeechStart: () => void;
  /** Speech pause detected. */
  onSpeechEnd: () => void;
  /** Optional error handler. */
  onError?: (error: string) => void;
}

export type HybridMode = 'browser' | 'bridge' | 'hybrid';

export interface HybridRecognizerOptions {
  cloudProcessingEnabled?: boolean;
  clientSessionId?: string;
  createRequestId?: (kind: 'transcription') => string;
}

// ── HybridRecognizer ──

/**
 * Wraps Web Speech API and Bridge PCM → ECHO API transcription into a single
 * recognizer that can run in browser-only, bridge-only, or hybrid mode.
 */
export class HybridRecognizer {
  // ── Mode tracking ──
  private _mode: HybridMode = 'browser';
  private _active = false;

  // ── Callbacks ──
  private callbacks: HybridRecognizerCallbacks;

  // ── Web Speech API (browser & hybrid modes) ──
  private recognition: any = null;
  private restartTimeout: ReturnType<typeof setTimeout> | null = null;

  // ── Bridge PCM buffer (bridge & hybrid modes) ──
  private pcmBuffer: Float32Array[] = [];
  private pcmBufferLength = 0;
  private isSpeaking = false;
  private bridgeTranscribing = false;
  private lastInterimSampleCount = 0;
  private interimTranscribing = false;
  private requestControllers = new Set<AbortController>();
  private readonly cloudProcessingEnabled: boolean;
  private readonly clientSessionId?: string;
  private readonly createRequestId?: (kind: 'transcription') => string;

  constructor(callbacks: HybridRecognizerCallbacks, options: HybridRecognizerOptions = {}) {
    this.callbacks = callbacks;
    this.cloudProcessingEnabled = options.cloudProcessingEnabled ?? true;
    this.clientSessionId = options.clientSessionId;
    this.createRequestId = options.createRequestId;
  }

  private beginRequest(): AbortController {
    const controller = new AbortController();
    this.requestControllers.add(controller);
    return controller;
  }

  private finishRequest(controller: AbortController): void {
    this.requestControllers.delete(controller);
  }

  private abortRequests(): void {
    for (const controller of this.requestControllers) {
      controller.abort();
    }
    this.requestControllers.clear();
  }

  // ── Accessors ──

  get active(): boolean {
    return this._active;
  }

  get mode(): HybridMode {
    return this._mode;
  }

  /** Check if the Web Speech API is available in this browser. */
  static isWebSpeechSupported(): boolean {
    return !!(
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition
    );
  }

  // ── Start methods ──

  /**
   * Start in **browser-only** mode (Web Speech API).
   * @returns `true` if started successfully.
   */
  start(): boolean {
    if (!this.cloudProcessingEnabled) {
      this.callbacks.onError?.('CLOUD_PROCESSING_DISABLED');
      return false;
    }
    this._mode = 'browser';
    return this.startWebSpeech();
  }

  /**
   * Start in **hybrid** mode:
   * - Web Speech API supplies fast interim/final text.
   * - PCM buffer still accumulates via {@link feedPCM} for downstream use.
   * - Proxy interim transcription is **not** run (Web Speech covers it).
   *
   * Falls back to bridge-only mode if Web Speech API is unavailable.
   * @returns `true` if started successfully.
   */
  startHybrid(): boolean {
    if (!this.cloudProcessingEnabled) {
      this.callbacks.onError?.('CLOUD_PROCESSING_DISABLED');
      return false;
    }

    if (HybridRecognizer.isWebSpeechSupported()) {
      this._mode = 'hybrid';
      // Initialise PCM state so feedPCM() accepts data
      this.pcmBuffer = [];
      this.pcmBufferLength = 0;
      this.isSpeaking = false;
      this.bridgeTranscribing = false;
      this.lastInterimSampleCount = 0;
      this.interimTranscribing = false;
      return this.startWebSpeech();
    }

    // Fallback — no Web Speech API available
    console.warn(
      '[HybridRecognizer] Web Speech API unavailable — falling back to bridge-only mode',
    );
    return this.startBridge();
  }

  /**
   * Start in **bridge-only** mode (PCM → ECHO API transcription).
   * Call {@link feedPCM} to supply audio from the G2 glasses mic.
   * @returns `true` if started successfully.
   */
  startBridge(): boolean {
    this._mode = 'bridge';
    this.pcmBuffer = [];
    this.pcmBufferLength = 0;
    this.isSpeaking = false;
    this.bridgeTranscribing = false;
    this.lastInterimSampleCount = 0;
    this.interimTranscribing = false;

    if (!this.cloudProcessingEnabled) {
      console.warn('[HybridRecognizer] Cloud processing is disabled');
      this._active = false;
      this.callbacks.onError?.('CLOUD_PROCESSING_DISABLED');
      return false;
    }

    if (!isEchoApiConfigured()) {
      console.warn('[HybridRecognizer] ECHO API proxy is not configured');
      this._active = false;
      this.callbacks.onError?.('ECHO_API_NOT_CONFIGURED');
      return false;
    }

    this._active = true;
    console.log('[HybridRecognizer] Started in BRIDGE mode (PCM via ECHO API proxy)');
    return true;
  }

  // ── PCM feeding ──

  /**
   * Feed raw PCM audio data from the G2 glasses mic.
   * Audio is accepted in **bridge** and **hybrid** modes.
   *
   * In bridge-only mode interim proxy transcriptions fire every ~1.0 s.
   * In hybrid mode the buffer accumulates silently (Web Speech handles text).
   */
  feedPCM(samples: Float32Array): void {
    if (!this._active) return;
    if (this._mode === 'browser') return; // browser mode doesn't use PCM

    this.pcmBuffer.push(new Float32Array(samples));
    this.pcmBufferLength += samples.length;

    // Detect speech energy for the "speaking" flag
    if (!this.isSpeaking && this.pcmBufferLength > 0) {
      let energy = 0;
      for (let i = 0; i < samples.length; i++) {
        energy += samples[i] * samples[i];
      }
      const rms = Math.sqrt(energy / samples.length);
      if (rms > 0.01) {
        this.isSpeaking = true;
        this.callbacks.onSpeechStart();
      }
    }

    // Bridge-only: trigger interim proxy transcription every 16 000 samples (1.0 s)
    if (this._mode === 'bridge') {
      const samplesSinceLast = this.pcmBufferLength - this.lastInterimSampleCount;
      if (this.isSpeaking && !this.interimTranscribing && samplesSinceLast >= 16_000) {
        this.lastInterimSampleCount = this.pcmBufferLength;

        const merged = this.mergePcmBuffer(this.pcmBufferLength);
        this.transcribeInterim(merged);
      }
    }
    // hybrid mode: no proxy interim — Web Speech API provides text
  }

  // ── VAD notifications ──

  /**
   * Notify that VAD detected speech start.
   * Resets the PCM buffer for a fresh speech segment (bridge & hybrid).
   */
  notifySpeechStart(): void {
    if (this._mode === 'browser') return;

    this.pcmBuffer = [];
    this.pcmBufferLength = 0;
    this.isSpeaking = true;
    this.lastInterimSampleCount = 0;
    this.interimTranscribing = false;

    // Only show the bridge "listening" indicator if Web Speech isn't active
    if (this._mode === 'bridge') {
      this.callbacks.onInterimResult('🎤 ...');
    }
  }

  /**
   * Notify that VAD detected speech end.
   *
     * - **bridge mode**: triggers final proxy transcription of the accumulated
   *   PCM segment.
   * - **hybrid mode**: no-op (Web Speech API already delivered final text).
   */
  async notifySpeechEnd(): Promise<void> {
    if (this._mode === 'browser') return;

    this.isSpeaking = false;
    this.callbacks.onSpeechEnd();

    // Only run proxy final transcription in bridge-only mode
    if (this._mode === 'bridge') {
      if (this.pcmBufferLength < 1600) {
        // < 0.1 s at 16 kHz — too short
        this.pcmBuffer = [];
        this.pcmBufferLength = 0;
        return;
      }

      const merged = this.mergePcmBuffer(this.pcmBufferLength);
      this.pcmBuffer = [];
      this.pcmBufferLength = 0;
      await this.transcribeWithGemini(merged);
    }
    // hybrid: Web Speech handles final transcription; PCM buffer preserved
    // for downstream evaluateSpeech if needed.
  }

  // ── Stop ──

  /** Stop all recognition (all modes). */
  stop(): void {
    this._active = false;

    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore — may already be stopped
      }
      this.recognition = null;
    }

    // Clear bridge / hybrid PCM state
    this.pcmBuffer = [];
    this.pcmBufferLength = 0;
    this.isSpeaking = false;
    this.bridgeTranscribing = false;
    this.interimTranscribing = false;
    this.abortRequests();

    console.log('[HybridRecognizer] Stopped');
  }

  // ── Private: Web Speech API ──

  private startWebSpeech(): boolean {
    if (this._active) return true;

    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      console.warn('[HybridRecognizer] Web Speech API not supported');
      const isSecure = window.isSecureContext;
      const isLocalhost =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';

      if (!isSecure && !isLocalhost) {
        this.callbacks.onError?.('SECURE_ORIGIN_REQUIRED');
      } else {
        this.callbacks.onError?.('Web Speech API not supported in this browser');
      }
      return false;
    }

    this.recognition = new SpeechRecognitionAPI();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      console.log(`[HybridRecognizer] Started (${this._mode} mode)`);
      this._active = true;
    };

    this.recognition.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';
      const interimConfidences: number[] = [];
      const finalConfidences: number[] = [];

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const alternative = result[0];
        const transcript: string = alternative?.transcript ?? '';
        const confidence = readConfidence(alternative?.confidence);

        if (result.isFinal) {
          finalTranscript += transcript;
          if (confidence !== undefined) finalConfidences.push(confidence);
        } else {
          interimTranscript += transcript;
          if (confidence !== undefined) interimConfidences.push(confidence);
        }
      }

      if (interimTranscript) {
        this.callbacks.onInterimResult(interimTranscript, averageConfidence(interimConfidences));
      }
      if (finalTranscript) {
        this.callbacks.onFinalResult(finalTranscript, averageConfidence(finalConfidences));
      }
    };

    this.recognition.onspeechstart = () => {
      this.callbacks.onSpeechStart();
    };

    this.recognition.onspeechend = () => {
      this.callbacks.onSpeechEnd();
    };

    this.recognition.onerror = (event: any) => {
      const error: string = event.error;
      console.warn('[HybridRecognizer] Error:', error);

      if (error === 'no-speech' || error === 'aborted') {
        return;
      }

      this.callbacks.onError?.(error);
    };

    this.recognition.onend = () => {
      // Auto-restart while still active (speech recognition auto-stops after silence)
      if (this._active) {
        this.restartTimeout = setTimeout(() => {
          if (this._active && this.recognition) {
            try {
              this.recognition.start();
            } catch {
              // Already started — ignore
            }
          }
        }, 100);
      }
    };

    try {
      this.recognition.start();
      return true;
    } catch (err) {
      console.error('[HybridRecognizer] Failed to start:', err);
      return false;
    }
  }

  // ── Private: PCM helpers ──

  /** Merge the internal PCM buffer into a single Float32Array. */
  private mergePcmBuffer(length: number): Float32Array {
    const merged = new Float32Array(length);
    let offset = 0;
    for (const chunk of this.pcmBuffer) {
      merged.set(chunk, offset);
      offset += chunk.length;
      if (offset >= length) break;
    }
    return merged;
  }

  // ── Private: proxy transcription (bridge mode only) ──

  /** Final transcription of a complete speech segment. */
  private async transcribeWithGemini(audio: Float32Array): Promise<void> {
    if (this.bridgeTranscribing) return;
    if (audio.length < 16_000 * 0.3) return; // < 0.3 s

    this.bridgeTranscribing = true;
    const controller = this.beginRequest();

    try {
      const wavBlob = float32ToWav(audio, 16_000);
      const base64 = await blobToBase64(wavBlob);

      const response = await requestTranscription({
        task: 'transcribe',
        clientSessionId: this.clientSessionId,
        requestId: this.createRequestId?.('transcription'),
        language: 'en-US',
        audio: {
          mimeType: 'audio/wav',
          data: base64,
        },
      }, controller.signal);

      const transcript = extractTranscription(response);
      if (!this._active || this._mode !== 'bridge') return;
      if (transcript.text && transcript.text.length > 1) {
        const clean = transcript.text
          .replace(/^(Transcript|Here is|The speaker said|The audio says)[:\s]*/i, '')
          .replace(/^["']|["']$/g, '')
          .trim();

        if (clean.length > 1) {
          this.callbacks.onFinalResult(clean, transcript.confidence);
          console.log(`[HybridRecognizer] Bridge transcript received (${clean.length} chars)`);
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        console.warn('[HybridRecognizer] ECHO API transcription failed:', err);
      }
    } finally {
      this.finishRequest(controller);
      this.bridgeTranscribing = false;
    }
  }

  /** Interim transcription fired periodically while the user is speaking. */
  private async transcribeInterim(audio: Float32Array): Promise<void> {
    if (audio.length < 16_000 * 0.5) return; // Need at least 0.5 s

    this.interimTranscribing = true;
    const controller = this.beginRequest();

    try {
      const wavBlob = float32ToWav(audio, 16_000);
      const base64 = await blobToBase64(wavBlob);

      const response = await requestTranscription({
        task: 'transcribe',
        clientSessionId: this.clientSessionId,
        requestId: this.createRequestId?.('transcription'),
        language: 'en-US',
        audio: {
          mimeType: 'audio/wav',
          data: base64,
        },
      }, controller.signal);

      const transcript = extractTranscription(response);
      if (!this._active || this._mode !== 'bridge') return;
      if (transcript.text && transcript.text.length > 1) {
        const clean = transcript.text
          .replace(/^(Transcript|Here is|The speaker said|The audio says)[:\s]*/i, '')
          .replace(/^["']|["']$/g, '')
          .trim();

        if (clean.length > 1 && this.isSpeaking) {
          this.callbacks.onInterimResult(clean + '...', transcript.confidence);
          console.log(`[HybridRecognizer] Bridge interim transcript received (${clean.length} chars)`);
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        console.warn('[HybridRecognizer] ECHO API interim transcription failed:', err);
      }
    } finally {
      this.finishRequest(controller);
      this.interimTranscribing = false;
    }
  }
}

function extractTranscription(response: unknown): { text: string; confidence?: number } {
  if (typeof response === 'string') return { text: response.trim() };
  if (!response || typeof response !== 'object') return { text: '' };

  const record = response as Record<string, unknown>;
  const value = record.transcript ?? record.text;
  return {
    text: typeof value === 'string' ? value.trim() : '',
    confidence: readConfidence(record.confidence),
  };
}

function readConfidence(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : undefined;
}

function averageConfidence(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
