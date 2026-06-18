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

export interface ChunkRequest {
  topic: string;
  week: number;
  category?: ChunkCategory;
  lastUtterance?: string;
  usedHints?: string[];
  scenarioContext?: string;
  conversationContext?: string;
  adaptiveDifficulty?: number;
  missedHint?: string;
}

export interface ChunkResult {
  chunk: string;
  source: 'gemini' | 'fallback';
  latencyMs: number;
}

export interface SpeechEvaluationResult {
  transcript: string;
  chunk: string | null;
  source: 'gemini';
  latencyMs: number;
}

export async function generateChunk(req: ChunkRequest, signal?: AbortSignal): Promise<ChunkResult> {
  const start = Date.now();
  const fallback = () => ({
    chunk: getRandomFallbackChunk(req.category ?? 'general'),
    source: 'fallback' as const,
    latencyMs: Date.now() - start,
  });

  if (!isEchoApiConfigured()) {
    return fallback();
  }

  try {
    const result = await requestCue({
      topic: req.topic,
      difficulty: req.adaptiveDifficulty ?? req.week,
      category: req.category,
      recentTranscript: req.conversationContext,
      lastUtterance: req.lastUtterance,
      usedHints: req.usedHints,
      scenarioContext: req.scenarioContext,
      missedHint: req.missedHint,
      intent: req.missedHint ? 'simplify' : 'cue',
    }, signal);

    let chunk = cleanChunk(extractText(result, ['chunk', 'cue', 'text']));

    if (chunk && req.usedHints?.some((hint) => hint.toLowerCase() === chunk.toLowerCase())) {
      chunk = getRandomFallbackChunk(req.category ?? 'general');
    }

    if (!chunk) {
      return fallback();
    }

    return {
      chunk,
      source: 'gemini',
      latencyMs: Date.now() - start,
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
  if (!isEchoApiConfigured()) return null;

  const start = Date.now();
  const wavBlob = float32ToWav(audio, 16_000);
  const base64 = await blobToBase64(wavBlob);

  try {
    const result = await requestTranscription({
      task: 'speech_evaluation',
      topic: req.topic,
      difficulty: req.adaptiveDifficulty ?? req.week,
      language: 'en-US',
      audio: {
        mimeType: 'audio/wav',
        data: base64,
      },
      lastUtterance: req.lastUtterance,
      usedHints: req.usedHints,
      scenarioContext: req.scenarioContext,
    }, signal);

    const transcript = cleanTranscript(extractText(result, ['transcript', 'text']));
    let hint = cleanChunk(extractText(result, ['hint', 'chunk', 'cue']));

    if (!transcript && !hint) return null;

    if (hint && transcript) {
      const englishWordCount = (transcript.match(/[a-zA-Z]{2,}/g) || []).length;
      if (englishWordCount >= 3) {
        hint = '';
      }
    }

    if (hint && req.usedHints?.some((used) => used.toLowerCase() === hint.toLowerCase())) {
      const fresh = await generateChunk(req, signal);
      hint = fresh.chunk || '';
    }

    return {
      transcript,
      chunk: hint || null,
      source: 'gemini',
      latencyMs: Date.now() - start,
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
  signal?: AbortSignal,
): Promise<string | null> {
  if (!transcript || transcript.trim().length < 5) return null;
  if (!isEchoApiConfigured()) return null;

  try {
    const result = await requestSessionAnalysis<any>({
      task: 'grammar',
      topic,
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
  signal?: AbortSignal,
): Promise<string | null> {
  if (!isEchoApiConfigured()) return null;

  try {
    const result = await requestCue({
      topic,
      difficulty: 1,
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

function cleanChunk(raw: string): string {
  return raw
    .replace(/^["'\[\(]+/, '')
    .replace(/["'\]\)]+$/, '')
    .replace(/\n/g, ' ')
    .trim()
    .slice(0, 50);
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
