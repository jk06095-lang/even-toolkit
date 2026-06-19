import type { HUDController } from '../hud/hud-controller';
import { HybridRecognizer, type HybridRecognizerCallbacks } from '../combat/hybrid-recognizer';
import { isEchoApiConfigured } from '../services/echo-api';

export type ActiveRecallSpeechStatus =
  | 'idle'
  | 'listening'
  | 'unsupported'
  | 'secure_origin_required'
  | 'g2_unavailable'
  | 'proxy_unconfigured'
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
  reason?:
    | 'already_active'
    | 'not_supported'
    | 'secure_origin_required'
    | 'g2_unavailable'
    | 'proxy_unconfigured'
    | 'start_failed';
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

export type ActiveRecallBridgeHud = Pick<HUDController, 'connected' | 'onAudioData' | 'setAudioCapture'>;

export interface ActiveRecallBridgeRecognizerDriver {
  startBridge: () => boolean;
  feedPCM: (samples: Float32Array) => void;
  notifySpeechStart: () => void;
  notifySpeechEnd: () => void | Promise<void>;
  stop: () => void;
}

export type ActiveRecallBridgeRecognizerFactory = (
  callbacks: HybridRecognizerCallbacks,
) => ActiveRecallBridgeRecognizerDriver;

export interface ActiveRecallBridgeSpeechCaptureOptions {
  hud: ActiveRecallBridgeHud | null;
  recognizerFactory?: ActiveRecallBridgeRecognizerFactory;
  isEchoApiConfigured?: () => boolean;
  speechThreshold?: number;
  minSilenceFrames?: number;
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

export class ActiveRecallBridgeSpeechCapture {
  private readonly callbacks: ActiveRecallSpeechCallbacks;
  private readonly hud: ActiveRecallBridgeHud | null;
  private readonly recognizerFactory: ActiveRecallBridgeRecognizerFactory;
  private readonly isProxyConfigured: () => boolean;
  private readonly speechThreshold: number;
  private readonly minSilenceFrames: number;
  private recognizer: ActiveRecallBridgeRecognizerDriver | null = null;
  private unsubscribeAudio?: () => void;
  private active = false;
  private speechActive = false;
  private silenceFrames = 0;
  private requestCounter = 0;

  constructor(
    callbacks: ActiveRecallSpeechCallbacks,
    options: ActiveRecallBridgeSpeechCaptureOptions,
  ) {
    this.callbacks = callbacks;
    this.hud = options.hud;
    this.recognizerFactory = options.recognizerFactory ?? this.defaultRecognizerFactory.bind(this);
    this.isProxyConfigured = options.isEchoApiConfigured ?? isEchoApiConfigured;
    this.speechThreshold = options.speechThreshold ?? 0.015;
    this.minSilenceFrames = Math.max(1, Math.round(options.minSilenceFrames ?? 15));
  }

  get isActive(): boolean {
    return this.active;
  }

  async start(): Promise<ActiveRecallSpeechStartResult> {
    if (this.active) return { ok: true, reason: 'already_active' };
    if (!this.hud?.connected) {
      this.updateStatus('g2_unavailable');
      return { ok: false, reason: 'g2_unavailable' };
    }
    if (!this.isProxyConfigured()) {
      this.updateStatus('proxy_unconfigured');
      return { ok: false, reason: 'proxy_unconfigured' };
    }

    const recognizer = this.recognizerFactory({
      onInterimResult: (text) => this.callbacks.onInterim?.(text),
      onFinalResult: (text, confidence) => this.callbacks.onFinal?.(text, confidence),
      onSpeechStart: () => undefined,
      onSpeechEnd: () => undefined,
      onError: (message) => {
        this.updateStatus('error');
        this.callbacks.onError?.(message);
      },
    });

    if (!recognizer.startBridge()) {
      this.updateStatus('error');
      return { ok: false, reason: 'start_failed' };
    }

    this.recognizer = recognizer;
    this.active = true;
    this.speechActive = false;
    this.silenceFrames = 0;

    try {
      this.unsubscribeAudio = this.hud.onAudioData((pcm) => this.handlePcm(pcm));
      await this.hud.setAudioCapture(true);
      this.updateStatus('listening');
      return { ok: true };
    } catch {
      await this.stop();
      this.updateStatus('error');
      return { ok: false, reason: 'start_failed' };
    }
  }

  async stop(): Promise<void> {
    const recognizer = this.recognizer;
    this.recognizer = null;
    this.active = false;
    this.speechActive = false;
    this.silenceFrames = 0;

    this.unsubscribeAudio?.();
    this.unsubscribeAudio = undefined;

    recognizer?.stop();

    if (this.hud) {
      try {
        await this.hud.setAudioCapture(false);
      } catch {
        // Ignore stop races from the bridge.
      }
    }

    this.updateStatus('idle');
  }

  private handlePcm(bytes: Uint8Array): void {
    if (!this.active || !this.recognizer || !bytes || bytes.byteLength < 2) return;

    const samples = pcm16ToFloat32(bytes);
    const rms = calculateRms(samples);
    const speechLike = rms > this.speechThreshold;

    if (speechLike && !this.speechActive) {
      this.speechActive = true;
      this.silenceFrames = 0;
      this.recognizer.notifySpeechStart();
    }

    this.recognizer.feedPCM(samples);

    if (speechLike) {
      this.silenceFrames = 0;
      return;
    }

    if (!this.speechActive) return;

    this.silenceFrames += 1;
    if (this.silenceFrames >= this.minSilenceFrames) {
      this.speechActive = false;
      this.silenceFrames = 0;
      void Promise.resolve(this.recognizer.notifySpeechEnd()).catch((error) => {
        this.updateStatus('error');
        this.callbacks.onError?.(error instanceof Error ? error.message : 'G2 bridge transcription failed');
      });
    }
  }

  private defaultRecognizerFactory(callbacks: HybridRecognizerCallbacks): ActiveRecallBridgeRecognizerDriver {
    const sessionId = `active-recall-${Date.now()}`;
    return new HybridRecognizer(callbacks, {
      cloudProcessingEnabled: true,
      clientSessionId: sessionId,
      createRequestId: () => `${sessionId}:transcription:${++this.requestCounter}`,
    });
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

function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const samples = Math.floor(bytes.byteLength / 2);
  const output = new Float32Array(samples);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < samples; index += 1) {
    output[index] = view.getInt16(index * 2, true) / 32768;
  }
  return output;
}

function calculateRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    sumSquares += samples[index] * samples[index];
  }
  return Math.sqrt(sumSquares / samples.length);
}
