import type {
  STTProvider,
  STTProviderConfig,
  STTMode,
  STTState,
  STTTranscript,
  STTError,
} from '../types';
import { float32ToWav } from '../audio/pcm-utils';

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

export class WhisperApiProvider implements STTProvider {
  readonly type = 'whisper-api' as const;
  readonly supportedModes: STTMode[] = ['batch'];

  private _state: STTState = 'idle';
  private apiKey = '';
  private language = 'en';
  private modelId = 'whisper-1';

  private transcriptCbs: Array<(t: STTTranscript) => void> = [];
  private stateCbs: Array<(s: STTState) => void> = [];
  private errorCbs: Array<(e: STTError) => void> = [];

  get state(): STTState {
    return this._state;
  }

  async init(config: STTProviderConfig): Promise<void> {
    this.apiKey = config.apiKey ?? '';
    this.language = config.language ?? 'en';
    this.modelId = config.modelId ?? 'whisper-1';

    if (!this.apiKey) {
      const err: STTError = { code: 'not-allowed', message: 'API key is required', provider: this.type };
      this.emitError(err);
      throw new Error(err.message);
    }
  }

  start(): void {
    // Batch mode — no-op; audio is fed via transcribe()
  }

  stop(): void {
    this.setState('idle');
  }

  abort(): void {
    this.setState('idle');
  }

  dispose(): void {
    this.transcriptCbs = [];
    this.stateCbs = [];
    this.errorCbs = [];
    this.setState('idle');
  }

  async transcribe(audio: Float32Array, sampleRate: number): Promise<STTTranscript> {
    this.setState('processing');

    try {
      const wavBlob = float32ToWav(audio, sampleRate);

      const formData = new FormData();
      formData.append('file', wavBlob, 'audio.wav');
      formData.append('model', this.modelId);
      formData.append('language', this.language);

      const response = await fetch(WHISPER_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const code: STTError['code'] = response.status === 401 ? 'not-allowed' : 'network';
        const message = `Whisper API error: ${response.status} ${response.statusText}`;
        const err: STTError = { code, message, provider: this.type };
        this.emitError(err);
        this.setState('error');
        throw new Error(message);
      }

      const json = (await response.json()) as { text: string };

      const transcript: STTTranscript = {
        text: json.text,
        isFinal: true,
        confidence: 1,
        timestamp: Date.now(),
      };

      this.emitTranscript(transcript);
      this.setState('idle');
      return transcript;
    } catch (err: any) {
      // If already handled (HTTP error), just rethrow
      if (this._state === 'error') throw err;

      const sttError: STTError = {
        code: 'network',
        message: err?.message ?? 'Network error',
        provider: this.type,
      };
      this.emitError(sttError);
      this.setState('error');
      throw err;
    }
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
