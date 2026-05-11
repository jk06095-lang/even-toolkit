/**
 * Speech Recognizer — Real-time speech-to-text.
 *
 * Two modes:
 * 1. BROWSER MODE (Web Speech API) — Uses phone/computer microphone directly.
 *    Provides instant interim transcription.
 * 2. BRIDGE MODE (PCM → Gemini) — Receives raw PCM from G2 glasses mic,
 *    accumulates audio segments, and sends to Gemini for transcription.
 *    Provides near-real-time transcription when speech segments end.
 *
 * Language: English (en-US)
 */

import { GoogleGenAI } from '@google/genai';
import { float32ToWav } from '@toolkit/stt/audio/pcm-utils';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;

let sharedAI: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!sharedAI) sharedAI = new GoogleGenAI({ apiKey: API_KEY });
  return sharedAI;
}

export interface SpeechRecognizerCallbacks {
  /** Fired continuously as user speaks — partial/interim text */
  onInterimResult: (text: string) => void;
  /** Fired when a sentence is finalized */
  onFinalResult: (text: string) => void;
  /** Fired when speech starts (browser detects audio) */
  onSpeechStart: () => void;
  /** Fired when speech ends (pause detected) */
  onSpeechEnd: () => void;
  /** Error handler */
  onError?: (error: string) => void;
}

export type RecognizerMode = 'browser' | 'bridge';

export class SpeechRecognizer {
  private recognition: any = null;
  private callbacks: SpeechRecognizerCallbacks;
  private _active = false;
  private _mode: RecognizerMode = 'browser';
  private restartTimeout: ReturnType<typeof setTimeout> | null = null;

  // Bridge mode state
  private pcmBuffer: Float32Array[] = [];
  private pcmBufferLength = 0;
  private isSpeaking = false;
  private bridgeTranscribing = false;

  constructor(callbacks: SpeechRecognizerCallbacks) {
    this.callbacks = callbacks;
  }

  get active(): boolean {
    return this._active;
  }

  get mode(): RecognizerMode {
    return this._mode;
  }

  /**
   * Check if Web Speech API is available in this browser.
   */
  static isSupported(): boolean {
    return !!(
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition
    );
  }

  /**
   * Start in browser mode (Web Speech API).
   */
  start(): boolean {
    this._mode = 'browser';
    return this.startBrowserMode();
  }

  /**
   * Start in bridge mode (PCM → Gemini transcription).
   * Call feedPCM() to feed audio data from the G2 glasses mic.
   */
  startBridge(): boolean {
    this._mode = 'bridge';
    this._active = true;
    this.pcmBuffer = [];
    this.pcmBufferLength = 0;
    this.isSpeaking = false;
    this.bridgeTranscribing = false;

    if (!API_KEY) {
      console.warn('[SpeechRecognizer] No Gemini API key — bridge transcription disabled');
      this.callbacks.onError?.('No API key for bridge transcription');
      return false;
    }

    console.log('[SpeechRecognizer] Started in BRIDGE mode (PCM → Gemini)');
    return true;
  }

  /**
   * Feed raw PCM audio data from G2 glasses mic (Bridge mode only).
   * Audio is accumulated and transcribed when speech segments are detected.
   */
  feedPCM(samples: Float32Array): void {
    if (!this._active || this._mode !== 'bridge') return;

    this.pcmBuffer.push(new Float32Array(samples));
    this.pcmBufferLength += samples.length;

    // Show interim "listening" indicator when receiving audio
    if (!this.isSpeaking && this.pcmBufferLength > 0) {
      // Detect if there's actually audio energy
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
  }

  /**
   * Notify that VAD detected speech start (Bridge mode).
   * Clears the buffer to start fresh for this speech segment.
   */
  notifySpeechStart(): void {
    if (this._mode !== 'bridge') return;
    this.pcmBuffer = [];
    this.pcmBufferLength = 0;
    this.isSpeaking = true;
    this.callbacks.onInterimResult('🎤 ...');
  }

  /**
   * Notify that VAD detected speech end (Bridge mode).
   * Triggers Gemini transcription of the accumulated audio.
   */
  async notifySpeechEnd(): Promise<void> {
    if (this._mode !== 'bridge') return;
    this.isSpeaking = false;
    this.callbacks.onSpeechEnd();

    // Gather accumulated audio
    if (this.pcmBufferLength < 1600) {
      // Less than 0.1s of audio at 16kHz — too short to transcribe
      this.pcmBuffer = [];
      this.pcmBufferLength = 0;
      return;
    }

    // Merge buffer into single Float32Array
    const merged = new Float32Array(this.pcmBufferLength);
    let offset = 0;
    for (const chunk of this.pcmBuffer) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.pcmBuffer = [];
    this.pcmBufferLength = 0;

    // Send to Gemini for transcription
    await this.transcribeWithGemini(merged);
  }

  /**
   * Transcribe audio via Gemini API.
   */
  private async transcribeWithGemini(audio: Float32Array): Promise<void> {
    if (this.bridgeTranscribing) return; // Don't overlap
    if (audio.length < 16000 * 0.3) return; // Less than 0.3s

    this.bridgeTranscribing = true;

    try {
      const wavBlob = float32ToWav(audio, 16000);
      const base64 = await blobToBase64(wavBlob);

      const genai = getAI();
      const response = await genai.models.generateContent({
        model: 'gemini-3.1-flash-lite-preview',
        contents: [
          { text: 'Transcribe the following English speech audio. Return ONLY the transcript text, nothing else.' },
          { inlineData: { mimeType: 'audio/wav', data: base64 } },
        ],
        config: {
          maxOutputTokens: 100,
          temperature: 0.1,
        },
      });

      const text = response.text?.trim() ?? '';
      if (text && text.length > 1) {
        // Filter out meta-commentary from Gemini
        const clean = text
          .replace(/^(Transcript|Here is|The speaker said|The audio says)[:\s]*/i, '')
          .replace(/^["']|["']$/g, '')
          .trim();

        if (clean.length > 1) {
          this.callbacks.onFinalResult(clean);
          console.log(`[SpeechRecognizer] Bridge transcript: "${clean}"`);
        }
      }
    } catch (err) {
      console.warn('[SpeechRecognizer] Gemini transcription failed:', err);
    } finally {
      this.bridgeTranscribing = false;
    }
  }

  /**
   * Start browser-based speech recognition (Web Speech API).
   */
  private startBrowserMode(): boolean {
    if (this._active) return true;

    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      console.warn('[SpeechRecognizer] Web Speech API not supported');
      const isSecure = window.isSecureContext;
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

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
      console.log('[SpeechRecognizer] Started (browser mode)');
      this._active = true;
    };

    this.recognition.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;

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
      const error = event.error;
      console.warn('[SpeechRecognizer] Error:', error);

      // 'no-speech' is normal — just restart
      // 'aborted' happens on stop() — ignore
      if (error === 'no-speech' || error === 'aborted') {
        return;
      }

      this.callbacks.onError?.(error);
    };

    this.recognition.onend = () => {
      // Auto-restart if still active (speech recognition auto-stops after silence)
      if (this._active) {
        this.restartTimeout = setTimeout(() => {
          if (this._active && this.recognition) {
            try {
              this.recognition.start();
            } catch {
              // Already started, ignore
            }
          }
        }, 100);
      }
    };

    try {
      this.recognition.start();
      return true;
    } catch (err) {
      console.error('[SpeechRecognizer] Failed to start:', err);
      return false;
    }
  }

  /**
   * Stop speech recognition (all modes).
   */
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
        // Ignore
      }
      this.recognition = null;
    }

    // Clear bridge state
    this.pcmBuffer = [];
    this.pcmBufferLength = 0;
    this.isSpeaking = false;

    console.log('[SpeechRecognizer] Stopped');
  }
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
