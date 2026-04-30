/**
 * Speech Recognizer — Real-time speech-to-text using Web Speech API.
 *
 * Runs in parallel with VAD to provide:
 * - Instant interim transcription (< 100ms latency)
 * - Final transcription on sentence boundaries
 * - Language: English (en-US)
 *
 * This does NOT replace the VAD or Gemini evaluation pipeline.
 * It only provides real-time visual feedback for what the user is saying.
 */

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

export class SpeechRecognizer {
  private recognition: any = null;
  private callbacks: SpeechRecognizerCallbacks;
  private _active = false;
  private restartTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(callbacks: SpeechRecognizerCallbacks) {
    this.callbacks = callbacks;
  }

  get active(): boolean {
    return this._active;
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
   * Start continuous speech recognition.
   */
  start(): boolean {
    if (this._active) return true;

    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      console.warn('[SpeechRecognizer] Web Speech API not supported');
      this.callbacks.onError?.('Web Speech API not supported in this browser');
      return false;
    }

    this.recognition = new SpeechRecognitionAPI();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      console.log('[SpeechRecognizer] Started');
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
   * Stop speech recognition.
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

    console.log('[SpeechRecognizer] Stopped');
  }
}
