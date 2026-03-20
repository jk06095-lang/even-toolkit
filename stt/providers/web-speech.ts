import type {
  STTProvider,
  STTProviderConfig,
  STTMode,
  STTState,
  STTTranscript,
  STTError,
} from '../types';

// ── Inline SpeechRecognition types (not in standard TS lib) ──

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
  readonly resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as SpeechRecognitionConstructor | null;
}

// ── Provider ──

export class WebSpeechProvider implements STTProvider {
  readonly type = 'web-speech' as const;
  readonly supportedModes: STTMode[] = ['streaming'];

  private _state: STTState = 'idle';
  private recognition: SpeechRecognitionInstance | null = null;
  private config: STTProviderConfig = {};
  private stopping = false;

  private transcriptCbs: Array<(t: STTTranscript) => void> = [];
  private stateCbs: Array<(s: STTState) => void> = [];
  private errorCbs: Array<(e: STTError) => void> = [];

  get state(): STTState {
    return this._state;
  }

  async init(config: STTProviderConfig): Promise<void> {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      this.emitError({ code: 'unsupported', message: 'SpeechRecognition not available in this browser', provider: this.type });
      throw new Error('SpeechRecognition not supported');
    }
    this.config = config;
  }

  start(): void {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      this.emitError({ code: 'unsupported', message: 'SpeechRecognition not available', provider: this.type });
      return;
    }

    // Tear down previous instance if any
    if (this.recognition) {
      try { this.recognition.abort(); } catch { /* ignore */ }
    }

    this.stopping = false;
    const recognition = new Ctor();
    recognition.continuous = this.config.continuous ?? true;
    recognition.interimResults = true;
    recognition.lang = this.config.language ?? 'en-US';

    recognition.onstart = () => {
      this.setState('listening');
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result?.[0]) continue;

        const transcript: STTTranscript = {
          text: result[0].transcript,
          isFinal: result.isFinal,
          confidence: result[0].confidence ?? 0,
          timestamp: Date.now(),
        };
        this.emitTranscript(transcript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // Suppress no-speech and aborted-while-stopping
      if (event.error === 'no-speech') return;
      if (event.error === 'aborted' && this.stopping) return;

      const code = mapErrorCode(event.error);
      this.emitError({ code, message: event.message || event.error, provider: this.type });

      if (code !== 'no-speech') {
        this.setState('error');
      }
    };

    recognition.onend = () => {
      this.recognition = null;
      this.setState('idle');
    };

    this.recognition = recognition;
    recognition.start();
  }

  stop(): void {
    this.stopping = true;
    if (this.recognition) {
      this.recognition.stop();
    }
  }

  abort(): void {
    this.stopping = true;
    if (this.recognition) {
      this.recognition.abort();
    }
  }

  dispose(): void {
    this.abort();
    this.transcriptCbs = [];
    this.stateCbs = [];
    this.errorCbs = [];
  }

  onTranscript(cb: (t: STTTranscript) => void): () => void {
    this.transcriptCbs.push(cb);
    return () => {
      this.transcriptCbs = this.transcriptCbs.filter((c) => c !== cb);
    };
  }

  onStateChange(cb: (s: STTState) => void): () => void {
    this.stateCbs.push(cb);
    return () => {
      this.stateCbs = this.stateCbs.filter((c) => c !== cb);
    };
  }

  onError(cb: (e: STTError) => void): () => void {
    this.errorCbs.push(cb);
    return () => {
      this.errorCbs = this.errorCbs.filter((c) => c !== cb);
    };
  }

  // ── Private helpers ──

  private setState(s: STTState): void {
    if (this._state === s) return;
    this._state = s;
    for (const cb of this.stateCbs) cb(s);
  }

  private emitTranscript(t: STTTranscript): void {
    for (const cb of this.transcriptCbs) cb(t);
  }

  private emitError(e: STTError): void {
    for (const cb of this.errorCbs) cb(e);
  }
}

function mapErrorCode(error: string): STTError['code'] {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'not-allowed';
    case 'no-speech':
      return 'no-speech';
    case 'network':
      return 'network';
    case 'aborted':
      return 'aborted';
    default:
      return 'unknown';
  }
}
