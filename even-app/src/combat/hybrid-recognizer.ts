/**
 * Hybrid Recognizer — Fastest-possible transcription for Combat Mode.
 *
 * Three operating modes:
 * 1. **browser** — Web Speech API only (phone/computer mic).
 * 2. **bridge**  — PCM → Gemini transcription only (G2 glasses mic).
 * 3. **hybrid**  — Web Speech API for instant text *and* PCM buffer
 *    accumulation (for downstream `evaluateSpeech`), but Gemini interim
 *    transcription is skipped because Web Speech already provides text.
 *
 * Language: English (en-US)
 */

import { GoogleGenAI } from '@google/genai';
import { float32ToWav } from '@toolkit/stt/audio/pcm-utils';

// ── Gemini setup ──

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;

let sharedAI: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!sharedAI) sharedAI = new GoogleGenAI({ apiKey: API_KEY });
  return sharedAI;
}

/**
 * Call Gemini with automatic model fallback.
 * Tries each model in order; falls through on any error.
 */
async function callGeminiWithFallback(
  contents: any,
  config: any,
  models: string[] = [
    'gemini-flash-lite-latest',
    'gemini-2.5-flash',
    'gemini-3.1-flash-lite',
  ],
): Promise<any> {
  const genai = getAI();
  let lastError: unknown = null;

  for (const model of models) {
    try {
      console.log(`[HybridRecognizer Gemini] Attempting call with model: ${model}`);
      const response = await genai.models.generateContent({
        model,
        contents,
        config,
      });
      console.log(`[HybridRecognizer Gemini] Success with model: ${model}`);
      return response;
    } catch (err: any) {
      console.warn(
        `[HybridRecognizer Gemini] Model ${model} failed:`,
        err.message || err,
      );
      lastError = err;
      continue;
    }
  }

  throw lastError ?? new Error('All models failed');
}

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
  onInterimResult: (text: string) => void;
  /** Finalized transcription text. */
  onFinalResult: (text: string) => void;
  /** Speech energy detected. */
  onSpeechStart: () => void;
  /** Speech pause detected. */
  onSpeechEnd: () => void;
  /** Optional error handler. */
  onError?: (error: string) => void;
}

export type HybridMode = 'browser' | 'bridge' | 'hybrid';

// ── HybridRecognizer ──

/**
 * Wraps Web Speech API and Bridge PCM → Gemini transcription into a single
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

  constructor(callbacks: HybridRecognizerCallbacks) {
    this.callbacks = callbacks;
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
    this._mode = 'browser';
    return this.startWebSpeech();
  }

  /**
   * Start in **hybrid** mode:
   * - Web Speech API supplies fast interim/final text.
   * - PCM buffer still accumulates via {@link feedPCM} for downstream use.
   * - Gemini interim transcription is **not** run (Web Speech covers it).
   *
   * Falls back to bridge-only mode if Web Speech API is unavailable.
   * @returns `true` if started successfully.
   */
  startHybrid(): boolean {
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
   * Start in **bridge-only** mode (PCM → Gemini transcription).
   * Call {@link feedPCM} to supply audio from the G2 glasses mic.
   * @returns `true` if started successfully.
   */
  startBridge(): boolean {
    this._mode = 'bridge';
    this._active = true;
    this.pcmBuffer = [];
    this.pcmBufferLength = 0;
    this.isSpeaking = false;
    this.bridgeTranscribing = false;
    this.lastInterimSampleCount = 0;
    this.interimTranscribing = false;

    if (!API_KEY) {
      console.warn('[HybridRecognizer] No Gemini API key — bridge transcription disabled');
      this.callbacks.onError?.('No API key for bridge transcription');
      return false;
    }

    console.log('[HybridRecognizer] Started in BRIDGE mode (PCM → Gemini)');
    return true;
  }

  // ── PCM feeding ──

  /**
   * Feed raw PCM audio data from the G2 glasses mic.
   * Audio is accepted in **bridge** and **hybrid** modes.
   *
   * In bridge-only mode interim Gemini transcriptions fire every ~1.0 s.
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

    // Bridge-only: trigger interim Gemini transcription every 16 000 samples (1.0 s)
    if (this._mode === 'bridge') {
      const samplesSinceLast = this.pcmBufferLength - this.lastInterimSampleCount;
      if (this.isSpeaking && !this.interimTranscribing && samplesSinceLast >= 16_000) {
        this.lastInterimSampleCount = this.pcmBufferLength;

        const merged = this.mergePcmBuffer(this.pcmBufferLength);
        this.transcribeInterim(merged);
      }
    }
    // hybrid mode: no Gemini interim — Web Speech API provides text
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
   * - **bridge mode**: triggers final Gemini transcription of the accumulated
   *   PCM segment.
   * - **hybrid mode**: no-op (Web Speech API already delivered final text).
   */
  async notifySpeechEnd(): Promise<void> {
    if (this._mode === 'browser') return;

    this.isSpeaking = false;
    this.callbacks.onSpeechEnd();

    // Only run Gemini final transcription in bridge-only mode
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

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript: string = result[0].transcript;

        if (result.isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (interimTranscript) {
        this.callbacks.onInterimResult(interimTranscript);
      }
      if (finalTranscript) {
        this.callbacks.onFinalResult(finalTranscript);
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

  // ── Private: Gemini transcription (bridge mode only) ──

  /** Final transcription of a complete speech segment. */
  private async transcribeWithGemini(audio: Float32Array): Promise<void> {
    if (this.bridgeTranscribing) return;
    if (audio.length < 16_000 * 0.3) return; // < 0.3 s

    this.bridgeTranscribing = true;

    try {
      const wavBlob = float32ToWav(audio, 16_000);
      const base64 = await blobToBase64(wavBlob);

      const response = await callGeminiWithFallback(
        [
          {
            text: 'Transcribe the following English speech audio. Return ONLY the transcript text, nothing else.',
          },
          { inlineData: { mimeType: 'audio/wav', data: base64 } },
        ],
        { maxOutputTokens: 100, temperature: 0.1 },
      );

      const text: string = (response.text?.trim() ?? '') as string;
      if (text && text.length > 1) {
        const clean = text
          .replace(/^(Transcript|Here is|The speaker said|The audio says)[:\s]*/i, '')
          .replace(/^["']|["']$/g, '')
          .trim();

        if (clean.length > 1) {
          this.callbacks.onFinalResult(clean);
          console.log(`[HybridRecognizer] Bridge transcript: "${clean}"`);
        }
      }
    } catch (err) {
      console.warn('[HybridRecognizer] Gemini transcription failed:', err);
    } finally {
      this.bridgeTranscribing = false;
    }
  }

  /** Interim transcription fired periodically while the user is speaking. */
  private async transcribeInterim(audio: Float32Array): Promise<void> {
    if (audio.length < 16_000 * 0.5) return; // Need at least 0.5 s

    this.interimTranscribing = true;

    try {
      const wavBlob = float32ToWav(audio, 16_000);
      const base64 = await blobToBase64(wavBlob);

      const response = await callGeminiWithFallback(
        [
          {
            text: 'Transcribe the following spoken English audio so far. Return ONLY the transcribed text, nothing else. If there is no speech, return an empty string.',
          },
          { inlineData: { mimeType: 'audio/wav', data: base64 } },
        ],
        { maxOutputTokens: 100, temperature: 0.1 },
      );

      const text: string = (response.text?.trim() ?? '') as string;
      if (text && text.length > 1) {
        const clean = text
          .replace(/^(Transcript|Here is|The speaker said|The audio says)[:\s]*/i, '')
          .replace(/^["']|["']$/g, '')
          .trim();

        if (clean.length > 1 && this.isSpeaking) {
          this.callbacks.onInterimResult(clean + '...');
          console.log(`[HybridRecognizer] Bridge interim transcript: "${clean}"`);
        }
      }
    } catch (err) {
      console.warn('[HybridRecognizer] Gemini interim transcription failed:', err);
    } finally {
      this.interimTranscribing = false;
    }
  }
}
