const API_BASE =
  (import.meta.env.VITE_ECHO_API_BASE_URL as string | undefined) ||
  (import.meta.env.VITE_ECHO_API_BASE as string | undefined) ||
  '';
const API_TIMEOUT_MS = Number.parseInt(
  (import.meta.env.VITE_ECHO_API_TIMEOUT_MS as string | undefined) || '',
  10,
);

const DEFAULT_API_TIMEOUT_MS = 12_000;
const RUNTIME_SESSION_TOKEN_GLOBAL = '__PROJECT_ECHO_SESSION_TOKEN__';
const RUNTIME_SESSION_TOKEN_STORAGE_KEY = 'projectEcho.sessionToken';

function normalizedApiBase(): string {
  return API_BASE.trim().replace(/\/+$/, '');
}

function echoApiTimeoutMs(): number {
  if (Number.isFinite(API_TIMEOUT_MS) && API_TIMEOUT_MS > 0) {
    return Math.min(API_TIMEOUT_MS, 30_000);
  }
  return DEFAULT_API_TIMEOUT_MS;
}

function isUnsafeApiBase(base: string): boolean {
  try {
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost';
    const url = new URL(base, origin);
    const host = url.hostname.toLowerCase();
    const directProviderHost = ['generativelanguage', 'googleapis', 'com'].join('.');
    return (
      host === directProviderHost ||
      host.endsWith(`.${directProviderHost}`) ||
      /^192\.168\./.test(host) ||
      host === '0.0.0.0'
    );
  } catch {
    return true;
  }
}

export class EchoApiUnavailableError extends Error {
  constructor() {
    super('ECHO API proxy is not configured');
    this.name = 'EchoApiUnavailableError';
  }
}

export class EchoApiProxyError extends Error {
  constructor(
    public readonly path: string,
    public readonly status: number | null,
    message = 'ECHO API proxy request failed',
  ) {
    super(message);
    this.name = 'EchoApiProxyError';
  }
}

export function isEchoApiConfigured(): boolean {
  const base = normalizedApiBase();
  return base.length > 0 && !isUnsafeApiBase(base);
}

async function postEcho<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const base = normalizedApiBase();
  if (!base || isUnsafeApiBase(base)) {
    throw new EchoApiUnavailableError();
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const sessionToken = readRuntimeSessionToken();
  if (sessionToken) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), echoApiTimeoutMs());
  const abortFromCaller = () => timeoutController.abort();
  if (signal?.aborted) timeoutController.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: timeoutController.signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (timeoutController.signal.aborted) {
      throw new EchoApiProxyError(path, null, 'ECHO API proxy request timed out');
    }
    throw new EchoApiProxyError(path, null);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }

  if (!response.ok) {
    throw new EchoApiProxyError(path, response.status);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json() as Promise<T>;
  }

  return response.text() as Promise<T>;
}

function readRuntimeSessionToken(): string {
  const globalToken = normalizeSessionToken(
    (globalThis as Record<string, unknown>)[RUNTIME_SESSION_TOKEN_GLOBAL],
  );
  if (globalToken) return globalToken;

  try {
    return normalizeSessionToken(globalThis.sessionStorage?.getItem(RUNTIME_SESSION_TOKEN_STORAGE_KEY));
  } catch {
    return '';
  }
}

function normalizeSessionToken(value: unknown): string {
  if (typeof value !== 'string') return '';
  const token = value.trim().replace(/^Bearer\s+/i, '');
  if (
    !token ||
    token.length > 4096 ||
    /\s/.test(token) ||
    /^(?:TBD|TODO|N\/A|placeholder|example)$/i.test(token)
  ) {
    return '';
  }
  return token;
}

export interface CueApiRequest {
  topic: string;
  difficulty: number;
  category?: string;
  clientSessionId?: string;
  requestId?: string;
  recentTranscript?: string;
  lastUtterance?: string;
  usedHints?: string[];
  scenarioContext?: string;
  conversationContext?: string;
  missedHint?: string;
  intent?: 'cue' | 'simplify';
}

export interface CueApiResponse {
  chunk?: string | null;
  cue?: string | null;
  text?: string | null;
  source?: string;
  latencyMs?: number;
}

export interface TranscriptionApiRequest {
  topic?: string;
  difficulty?: number;
  clientSessionId?: string;
  requestId?: string;
  language?: string;
  task?: 'transcribe' | 'speech_evaluation';
  audio: {
    mimeType: string;
    data: string;
  };
  lastUtterance?: string;
  usedHints?: string[];
  scenarioContext?: string;
}

export interface TranscriptionApiResponse {
  transcript?: string | null;
  text?: string | null;
  confidence?: number | null;
  hint?: string | null;
  chunk?: string | null;
  cue?: string | null;
  latencyMs?: number;
}

export interface TranslationApiRequest {
  clientSessionId?: string;
  requestId?: string;
  turnId: string;
  sourceLanguage: string;
  targetLanguage: 'ko-KR';
  text: string;
}

export interface TranslationApiResponse {
  translationKo?: string | null;
  text?: string | null;
  source?: string;
  latencyMs?: number;
}

export function requestCue(input: CueApiRequest, signal?: AbortSignal): Promise<CueApiResponse | string> {
  return postEcho<CueApiResponse | string>('/v1/cue', input, signal);
}

export function requestTranscription(
  input: TranscriptionApiRequest,
  signal?: AbortSignal,
): Promise<TranscriptionApiResponse | string> {
  return postEcho<TranscriptionApiResponse | string>('/v1/transcribe', input, signal);
}

export function requestSessionAnalysis<T = unknown>(input: unknown, signal?: AbortSignal): Promise<T> {
  return postEcho<T>('/v1/session-analysis', input, signal);
}

export function requestTranslation(
  input: TranslationApiRequest,
  signal?: AbortSignal,
): Promise<TranslationApiResponse | string> {
  return postEcho<TranslationApiResponse | string>('/v1/translate', input, signal);
}
