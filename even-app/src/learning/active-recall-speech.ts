export type ActiveRecallSpeechStatus =
  | 'idle'
  | 'listening'
  | 'unsupported'
  | 'secure_origin_required'
  | 'error';

export interface ActiveRecallSpeechCallbacks {
  onInterim?: (text: string) => void;
  onFinal?: (text: string, confidence?: number) => void;
  onStatus?: (status: ActiveRecallSpeechStatus) => void;
  onError?: (message: string) => void;
}

export interface ActiveRecallSpeechCaptureOptions {
  lang?: string;
  speechRecognitionFactory?: SpeechRecognitionFactory;
  isSecureContext?: boolean;
  hostname?: string;
}

export interface ActiveRecallSpeechStartResult {
  ok: boolean;
  reason?: 'already_active' | 'not_supported' | 'secure_origin_required' | 'start_failed';
}

export type SpeechRecognitionFactory = () => SpeechRecognitionConstructor | null;

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionResultEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
      confidence?: number;
    };
  }>;
}

interface SpeechRecognitionErrorEventLike {
  error?: string;
  message?: string;
}

export class ActiveRecallSpeechCapture {
  private recognition: SpeechRecognitionLike | null = null;
  private active = false;
  private readonly lang: string;
  private readonly callbacks: ActiveRecallSpeechCallbacks;
  private readonly speechRecognitionFactory?: SpeechRecognitionFactory;
  private readonly isSecureContext?: boolean;
  private readonly hostname?: string;

  constructor(
    callbacks: ActiveRecallSpeechCallbacks,
    options: ActiveRecallSpeechCaptureOptions = {},
  ) {
    this.callbacks = callbacks;
    this.lang = options.lang ?? 'en-US';
    this.speechRecognitionFactory = options.speechRecognitionFactory;
    this.isSecureContext = options.isSecureContext;
    this.hostname = options.hostname;
  }

  get isActive(): boolean {
    return this.active;
  }

  start(): ActiveRecallSpeechStartResult {
    if (this.active) return { ok: true, reason: 'already_active' };

    const SpeechRecognitionAPI = (this.speechRecognitionFactory ?? defaultSpeechRecognitionFactory)();
    if (!SpeechRecognitionAPI) {
      const reason = this.requiresSecureOrigin()
        ? 'secure_origin_required'
        : 'not_supported';
      this.updateStatus(reason === 'secure_origin_required' ? 'secure_origin_required' : 'unsupported');
      return { ok: false, reason };
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = this.lang;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      this.active = true;
      this.updateStatus('listening');
    };

    recognition.onresult = (event) => {
      let interim = '';
      let final = '';
      const finalConfidences: number[] = [];
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        const alternative = result?.[0];
        const transcript = alternative?.transcript?.trim() ?? '';
        if (!transcript) continue;
        if (result?.isFinal) {
          final = `${final} ${transcript}`.trim();
          const confidence = normalizeConfidence(alternative?.confidence);
          if (confidence !== undefined) finalConfidences.push(confidence);
        } else {
          interim = `${interim} ${transcript}`.trim();
        }
      }
      if (interim) this.callbacks.onInterim?.(interim);
      if (final) this.callbacks.onFinal?.(final, averageConfidence(finalConfidences));
    };

    recognition.onerror = (event) => {
      const error = event.error ?? event.message ?? 'speech recognition error';
      if (error !== 'no-speech' && error !== 'aborted') {
        this.updateStatus('error');
        this.callbacks.onError?.(error);
      }
    };

    recognition.onend = () => {
      this.active = false;
      this.recognition = null;
      this.updateStatus('idle');
    };

    this.recognition = recognition;

    try {
      recognition.start();
      return { ok: true };
    } catch {
      this.recognition = null;
      this.active = false;
      this.updateStatus('error');
      return { ok: false, reason: 'start_failed' };
    }
  }

  stop(): void {
    const recognition = this.recognition;
    this.recognition = null;
    this.active = false;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // Ignore stop races from Web Speech implementations.
      }
    }
    this.updateStatus('idle');
  }

  private requiresSecureOrigin(): boolean {
    const isSecure = this.isSecureContext ?? defaultIsSecureContext();
    const hostname = this.hostname ?? defaultHostname();
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    return !isSecure && !isLocalhost;
  }

  private updateStatus(status: ActiveRecallSpeechStatus): void {
    this.callbacks.onStatus?.(status);
  }
}

function defaultSpeechRecognitionFactory(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const candidate = (
    (window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition
  );
  return candidate ?? null;
}

function defaultIsSecureContext(): boolean {
  return typeof window !== 'undefined' ? window.isSecureContext : true;
}

function defaultHostname(): string {
  return typeof window !== 'undefined' ? window.location.hostname : 'localhost';
}

function normalizeConfidence(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : undefined;
}

function averageConfidence(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
}
