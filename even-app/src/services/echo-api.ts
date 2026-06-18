const API_BASE =
  (import.meta.env.VITE_ECHO_API_BASE_URL as string | undefined) ||
  (import.meta.env.VITE_ECHO_API_BASE as string | undefined) ||
  '';

function normalizedApiBase(): string {
  return API_BASE.trim().replace(/\/+$/, '');
}

export class EchoApiUnavailableError extends Error {
  constructor() {
    super('ECHO API proxy is not configured');
    this.name = 'EchoApiUnavailableError';
  }
}

export function isEchoApiConfigured(): boolean {
  return normalizedApiBase().length > 0;
}

async function postEcho<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const base = normalizedApiBase();
  if (!base) {
    throw new EchoApiUnavailableError();
  }

  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new Error(`ECHO API ${path} failed with ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json() as Promise<T>;
  }

  return response.text() as Promise<T>;
}

export interface CueApiRequest {
  topic: string;
  difficulty: number;
  category?: string;
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
  hint?: string | null;
  chunk?: string | null;
  cue?: string | null;
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
