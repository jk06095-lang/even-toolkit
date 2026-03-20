import type {
  STTProvider,
  STTProviderConfig,
  STTMode,
  STTState,
  STTTranscript,
  STTError,
} from '../../types';

interface WorkerMessage {
  type: 'init' | 'transcribe';
  modelId?: string;
  language?: string;
  audio?: Float32Array;
}

interface WorkerResponse {
  type: 'ready' | 'progress' | 'result' | 'error';
  loaded?: number;
  total?: number;
  text?: string;
  confidence?: number;
  message?: string;
}

export class WhisperLocalProvider implements STTProvider {
  readonly type = 'whisper-local' as const;
  readonly supportedModes: STTMode[] = ['batch'];

  private _state: STTState = 'idle';
  private worker: Worker | null = null;
  private config: STTProviderConfig = {};
  private ready = false;

  private transcriptCbs: Array<(t: STTTranscript) => void> = [];
  private stateCbs: Array<(s: STTState) => void> = [];
  private errorCbs: Array<(e: STTError) => void> = [];

  private pendingResolve: ((t: STTTranscript) => void) | null = null;
  private pendingReject: ((e: Error) => void) | null = null;
  private initResolve: (() => void) | null = null;
  private initReject: ((e: Error) => void) | null = null;

  get state(): STTState {
    return this._state;
  }

  async init(config: STTProviderConfig): Promise<void> {
    this.config = config;
    this.setState('loading');

    return new Promise<void>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;

      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        this.handleWorkerMessage(e.data);
      };

      this.worker.onerror = (err) => {
        const sttError: STTError = {
          code: 'model-load',
          message: err.message || 'Worker error',
          provider: this.type,
        };
        this.emitError(sttError);
        this.setState('error');
        if (this.initReject) {
          this.initReject(new Error(sttError.message));
          this.initResolve = null;
          this.initReject = null;
        }
      };

      const msg: WorkerMessage = {
        type: 'init',
        modelId: config.modelId,
        language: config.language,
      };
      this.worker.postMessage(msg);
    });
  }

  start(): void {
    // Batch mode: start is a no-op; audio is fed via transcribe()
    if (this.ready) {
      this.setState('listening');
    }
  }

  stop(): void {
    if (this._state === 'listening' || this._state === 'processing') {
      this.setState('idle');
    }
  }

  abort(): void {
    if (this.pendingReject) {
      this.pendingReject(new Error('Aborted'));
      this.pendingResolve = null;
      this.pendingReject = null;
    }
    this.setState('idle');
  }

  dispose(): void {
    this.abort();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.ready = false;
    this.transcriptCbs = [];
    this.stateCbs = [];
    this.errorCbs = [];
  }

  async transcribe(audio: Float32Array, sampleRate: number): Promise<STTTranscript> {
    if (!this.worker || !this.ready) {
      throw new Error('Provider not initialized');
    }

    this.setState('processing');

    return new Promise<STTTranscript>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;

      this.worker!.postMessage(
        { type: 'transcribe', audio, language: this.config.language ?? 'en', sampleRate },
        [audio.buffer],
      );
    });
  }

  onTranscript(cb: (t: STTTranscript) => void): () => void {
    this.transcriptCbs.push(cb);
    return () => { this.transcriptCbs = this.transcriptCbs.filter((c) => c !== cb); };
  }

  onStateChange(cb: (s: STTState) => void): () => void {
    this.stateCbs.push(cb);
    return () => { this.stateCbs = this.stateCbs.filter((c) => c !== cb); };
  }

  onError(cb: (e: STTError) => void): () => void {
    this.errorCbs.push(cb);
    return () => { this.errorCbs = this.errorCbs.filter((c) => c !== cb); };
  }

  // ── Private ──

  private handleWorkerMessage(data: WorkerResponse): void {
    switch (data.type) {
      case 'ready':
        this.ready = true;
        this.setState('idle');
        if (this.initResolve) {
          this.initResolve();
          this.initResolve = null;
          this.initReject = null;
        }
        break;

      case 'progress':
        // Model download progress — stay in loading state
        break;

      case 'result': {
        const transcript: STTTranscript = {
          text: data.text ?? '',
          isFinal: true,
          confidence: data.confidence ?? 0.95,
          timestamp: Date.now(),
        };
        this.emitTranscript(transcript);
        this.setState('listening');

        if (this.pendingResolve) {
          this.pendingResolve(transcript);
          this.pendingResolve = null;
          this.pendingReject = null;
        }
        break;
      }

      case 'error': {
        const sttError: STTError = {
          code: 'model-load',
          message: data.message ?? 'Worker error',
          provider: this.type,
        };
        this.emitError(sttError);
        this.setState('error');

        if (this.pendingReject) {
          this.pendingReject(new Error(sttError.message));
          this.pendingResolve = null;
          this.pendingReject = null;
        }
        if (this.initReject) {
          this.initReject(new Error(sttError.message));
          this.initResolve = null;
          this.initReject = null;
        }
        break;
      }
    }
  }

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
