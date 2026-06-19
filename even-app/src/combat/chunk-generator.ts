/**
 * Chunk Generator.
 *
 * The browser app never talks to Gemini directly. It calls the ECHO API proxy
 * and falls back to local cue templates when the proxy is unavailable.
 */

import { float32ToWav } from '@toolkit/stt/audio/pcm-utils';
import {
  isEchoApiConfigured,
  requestCue,
  requestSessionAnalysis,
  requestTranscription,
} from '../services/echo-api';
import { getRandomFallbackChunk, type ChunkCategory } from './fallback-chunks';
import {
  ECHO_DOMAIN_V2_SCHEMA_VERSION,
  isCue,
  type Cue,
  type CueLevel,
  type SpeechAct,
} from '@toolkit/echo-domain-v2';

export interface ChunkRequest {
  topic: string;
  week: number;
  category?: ChunkCategory;
  allowCloudProcessing?: boolean;
  clientSessionId?: string;
  requestId?: string;
  lastUtterance?: string;
  usedHints?: string[];
  scenarioContext?: string;
  conversationContext?: string;
  adaptiveDifficulty?: number;
  missedHint?: string;
  targetTurnId?: string;
  cueId?: string;
  expiresAfterMs?: number;
}

export interface ChunkResult {
  chunk: string;
  source: 'gemini' | 'fallback';
  latencyMs: number;
  networkLatencyMs?: number;
  generationLatencyMs?: number | null;
  cue?: Cue;
}

export interface SpeechEvaluationResult {
  transcript: string;
  chunk: string | null;
  source: 'gemini';
  latencyMs: number;
  networkLatencyMs?: number;
  generationLatencyMs?: number | null;
}

export async function generateChunk(req: ChunkRequest, signal?: AbortSignal): Promise<ChunkResult> {
  const start = Date.now();
  const fallback = (): ChunkResult => {
    const chunk = getRandomFallbackChunk(req.category ?? 'general');
    return {
      chunk,
      source: 'fallback' as const,
      latencyMs: Date.now() - start,
      networkLatencyMs: 0,
      generationLatencyMs: 0,
      cue: createCueFromResponse(undefined, chunk, req),
    };
  };

  if (req.allowCloudProcessing === false || !isEchoApiConfigured()) {
    return fallback();
  }

  try {
    const result = await requestCue({
      topic: req.topic,
      difficulty: req.adaptiveDifficulty ?? req.week,
      category: req.category,
      clientSessionId: req.clientSessionId,
      requestId: req.requestId,
      recentTranscript: req.conversationContext,
      lastUtterance: req.lastUtterance,
      usedHints: req.usedHints,
      scenarioContext: req.scenarioContext,
      missedHint: req.missedHint,
      intent: req.missedHint ? 'simplify' : 'cue',
    }, signal);

    const networkLatencyMs = Date.now() - start;
    const generationLatencyMs = extractLatency(result);
    let chunk = cleanChunk(extractText(result, ['chunk', 'cue', 'text']));
    let source: ChunkResult['source'] = 'gemini';

    if (chunk && req.usedHints?.some((hint) => hint.toLowerCase() === chunk.toLowerCase())) {
      chunk = getRandomFallbackChunk(req.category ?? 'general');
      source = 'fallback';
    }

    if (!chunk) {
      return fallback();
    }

    return {
      chunk,
      source,
      latencyMs: networkLatencyMs,
      networkLatencyMs,
      generationLatencyMs,
      cue: createCueFromResponse(result, chunk, req),
    };
  } catch (err) {
    if (!signal?.aborted) {
      console.warn('[ChunkGen] ECHO API cue failed, using fallback:', err);
    }
    return fallback();
  }
}

export async function evaluateSpeech(
  audio: Float32Array,
  req: ChunkRequest,
  signal?: AbortSignal,
): Promise<SpeechEvaluationResult | null> {
  if (audio.length < 16_000 * 0.5) return null;
  if (req.allowCloudProcessing === false) return null;
  if (!isEchoApiConfigured()) return null;

  const start = Date.now();
  const wavBlob = float32ToWav(audio, 16_000);
  const base64 = await blobToBase64(wavBlob);

  try {
    const result = await requestTranscription({
      task: 'speech_evaluation',
      topic: req.topic,
      difficulty: req.adaptiveDifficulty ?? req.week,
      clientSessionId: req.clientSessionId,
      requestId: req.requestId,
      language: 'en-US',
      audio: {
        mimeType: 'audio/wav',
        data: base64,
      },
      lastUtterance: req.lastUtterance,
      usedHints: req.usedHints,
      scenarioContext: req.scenarioContext,
    }, signal);

    const networkLatencyMs = Date.now() - start;
    const generationLatencyMs = extractLatency(result);
    const transcript = cleanTranscript(extractText(result, ['transcript', 'text']));
    let hint = cleanChunk(extractText(result, ['hint', 'chunk', 'cue']));

    if (!transcript && !hint) return null;

    if (hint && req.usedHints?.some((used) => used.toLowerCase() === hint.toLowerCase())) {
      const fresh = await generateChunk(req, signal);
      hint = fresh.chunk || '';
    }

    return {
      transcript,
      chunk: hint || null,
      source: 'gemini',
      latencyMs: networkLatencyMs,
      networkLatencyMs,
      generationLatencyMs,
    };
  } catch (err) {
    if (!signal?.aborted) {
      console.warn('[ChunkGen] Speech evaluation failed:', err);
    }
    return null;
  }
}

export async function evaluateGrammar(
  transcript: string,
  topic: string,
  metadata?: { clientSessionId?: string; requestId?: string; allowCloudProcessing?: boolean },
  signal?: AbortSignal,
): Promise<string | null> {
  if (!transcript || transcript.trim().length < 5) return null;
  if (metadata?.allowCloudProcessing === false) return null;
  if (!isEchoApiConfigured()) return null;

  try {
    const result = await requestSessionAnalysis<any>({
      task: 'grammar',
      topic,
      clientSessionId: metadata?.clientSessionId,
      requestId: metadata?.requestId,
      transcript,
    }, signal);

    const correction = cleanChunk(extractText(result, ['correction', 'text', 'result']));
    if (!correction || correction.toLowerCase() === 'null') {
      return null;
    }

    if (
      !correction.toLowerCase().startsWith('try:') &&
      !correction.toLowerCase().startsWith('use:')
    ) {
      return `Try: ${correction}`;
    }

    return correction;
  } catch (err) {
    if (!signal?.aborted) {
      console.warn('[ChunkGen] Grammar evaluation failed:', err);
    }
    return null;
  }
}

export async function simplifyHint(
  hint: string,
  topic: string,
  metadata?: { clientSessionId?: string; requestId?: string; allowCloudProcessing?: boolean },
  signal?: AbortSignal,
): Promise<string | null> {
  if (metadata?.allowCloudProcessing === false) return null;
  if (!isEchoApiConfigured()) return null;

  try {
    const result = await requestCue({
      topic,
      difficulty: 1,
      clientSessionId: metadata?.clientSessionId,
      requestId: metadata?.requestId,
      missedHint: hint,
      intent: 'simplify',
    }, signal);

    const simplified = cleanChunk(extractText(result, ['chunk', 'cue', 'text']));
    if (!simplified || simplified.length < 2) return null;
    return simplified;
  } catch (err) {
    if (!signal?.aborted) {
      console.warn('[ChunkGen] Simplification failed:', err);
    }
    return null;
  }
}

function extractText(input: unknown, keys: string[]): string {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return '';

  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }

  return '';
}

function extractLatency(input: unknown): number | null {
  if (!input || typeof input !== 'object') return null;
  const value = (input as Record<string, unknown>).latencyMs;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cleanChunk(raw: string): string {
  return stripHtmlTags(raw)
    .replace(/^["'\[\(]+/, '')
    .replace(/["'\]\)]+$/, '')
    .replace(/\n/g, ' ')
    .trim()
    .slice(0, 50);
}

function createCueFromResponse(input: unknown, phrase: string, req: ChunkRequest): Cue | undefined {
  if (!req.targetTurnId || !phrase) return undefined;
  const record = isRecord(input) ? input : {};
  const cue: Cue = {
    schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
    cueId: cleanId(
      extractText(input, ['cueId', 'cue_id', 'id']) ||
      req.cueId ||
      req.requestId ||
      `cue-${Date.now()}`,
    ),
    speechAct: readSpeechAct(record.speechAct) ?? inferSpeechAct(phrase),
    level: readCueLevel(record.level) ?? clampCueLevel(req.adaptiveDifficulty ?? req.week),
    phrase,
    meaningKo: cleanPlainText(
      extractText(input, ['meaningKo', 'meaning_ko', 'meaning', 'translationKo', 'translation']) ||
      'Meaning unavailable',
      240,
    ),
    alternatives: cleanAlternatives(record.alternatives, phrase),
    expiresAfterMs: readExpiresAfterMs(record.expiresAfterMs) ?? readExpiresAfterMs(req.expiresAfterMs) ?? 8000,
    targetTurnId: cleanId(req.targetTurnId),
  };

  return isCue(cue) ? cue : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanId(value: string): string {
  return value.trim().slice(0, 128) || `cue-${Date.now()}`;
}

function cleanPlainText(value: string, maxLength: number): string {
  return stripHtmlTags(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanAlternatives(value: unknown, phrase: string): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set([phrase.toLowerCase()]);
  const alternatives: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const cleaned = cleanPlainText(item, 160);
    if (!cleaned || seen.has(cleaned.toLowerCase())) continue;
    seen.add(cleaned.toLowerCase());
    alternatives.push(cleaned);
    if (alternatives.length >= 5) break;
  }
  return alternatives;
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, '');
}

function readCueLevel(value: unknown): CueLevel | null {
  if (value === 1 || value === 2 || value === 3) return value;
  return null;
}

function clampCueLevel(value: number): CueLevel {
  const level = Math.max(1, Math.min(3, Math.round(value)));
  return level as CueLevel;
}

function readSpeechAct(value: unknown): SpeechAct | null {
  return value === 'answer' ||
    value === 'clarify' ||
    value === 'ask_repeat' ||
    value === 'buy_time' ||
    value === 'repair'
    ? value
    : null;
}

function inferSpeechAct(phrase: string): SpeechAct {
  const lower = phrase.toLowerCase();
  if (lower.includes('repeat') || lower.includes('say that again') || lower.includes('pardon')) {
    return 'ask_repeat';
  }
  if (lower.includes('moment') || lower.includes('second') || lower.includes('let me think')) {
    return 'buy_time';
  }
  if (lower.includes('sorry') || lower.includes('mean')) {
    return 'repair';
  }
  if (/^(could|can|would|what|when|where|how|why)\b/.test(lower)) {
    return 'clarify';
  }
  return 'answer';
}

function readExpiresAfterMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 100 && value <= 30_000
    ? Math.round(value)
    : null;
}

function cleanTranscript(raw: string): string {
  return raw
    .replace(/^(Transcript|Here is|The speaker said|The audio says)[:\s]*/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      resolve(base64 || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
