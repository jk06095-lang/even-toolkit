import type { ConversationTurn } from '@toolkit/echo-domain-v2';
import { getConversationTurns, TranscriptStore, type SessionTranscript } from './transcript-store';
import { requestTranslation, type TranslationApiResponse } from '../services/echo-api';

const STORAGE_KEY = 'echo_conversation_translation_jobs';
const TARGET_LANGUAGE = 'ko-KR';
const MAX_JOBS = 200;
const MAX_ERROR_LENGTH = 300;
const MAX_TRANSLATION_LENGTH = 1000;

export type ConversationTranslationStatus =
  | 'not_needed'
  | 'pending'
  | 'translated'
  | 'failed';

export interface ConversationTranslationJob {
  id: string;
  sessionId: string;
  turnId: string;
  sourceLanguage: string;
  targetLanguage: typeof TARGET_LANGUAGE;
  status: Exclude<ConversationTranslationStatus, 'not_needed'>;
  requestedAt: number;
  updatedAt: number;
  attempts: number;
  translationKo?: string;
  error?: string;
}

export interface ConversationTranslationState {
  status: ConversationTranslationStatus;
  label?: string;
  job?: ConversationTranslationJob;
}

export interface ConversationTranslationCompleteResult {
  job: ConversationTranslationJob;
  turn: ConversationTurn;
}

export interface ProcessConversationTranslationOptions {
  allowCloudProcessing: boolean;
  signal?: AbortSignal;
  now?: () => number;
  translate?: typeof requestTranslation;
}

export interface ConversationTranslationProcessResult {
  job: ConversationTranslationJob;
  turnId: string;
  status: 'translated' | 'failed';
}

export function shouldQueueKoreanTranslation(turn: ConversationTurn): boolean {
  return (
    turn.isFinal === true &&
    turn.transcript.trim().length > 0 &&
    !turn.translationKo &&
    !isKoreanLanguage(turn.language)
  );
}

export function queuePendingConversationTranslations(
  session: SessionTranscript,
  now = Date.now(),
): ConversationTranslationJob[] {
  return getConversationTurns(session)
    .map((turn) => enqueueConversationTurnTranslation(turn, now))
    .filter((job): job is ConversationTranslationJob => job !== null);
}

export function enqueueConversationTurnTranslation(
  turn: ConversationTurn,
  now = Date.now(),
): ConversationTranslationJob | null {
  if (!shouldQueueKoreanTranslation(turn)) return null;

  const jobs = loadConversationTranslationJobs();
  const id = translationJobId(turn.sessionId, turn.id);
  const existing = jobs.find((job) => job.id === id);
  if (existing) return existing;

  const job: ConversationTranslationJob = {
    id,
    sessionId: turn.sessionId,
    turnId: turn.id,
    sourceLanguage: normalizeLanguage(turn.language),
    targetLanguage: TARGET_LANGUAGE,
    status: 'pending',
    requestedAt: now,
    updatedAt: now,
    attempts: 0,
  };

  saveConversationTranslationJobs([...jobs, job]);
  return job;
}

export function getConversationTranslationState(turn: ConversationTurn): ConversationTranslationState {
  if (turn.translationKo) {
    return {
      status: 'translated',
      label: 'Korean translation ready',
    };
  }

  if (!shouldQueueKoreanTranslation(turn)) {
    return { status: 'not_needed' };
  }

  const job = getConversationTranslationJob(turn.sessionId, turn.id);
  if (job?.status === 'failed') {
    return {
      status: 'failed',
      label: 'Korean translation unavailable',
      job,
    };
  }

  if (job?.status === 'translated') {
    return {
      status: 'translated',
      label: 'Korean translation ready',
      job,
    };
  }

  return {
    status: 'pending',
    label: 'Korean translation pending',
    job: job ?? undefined,
  };
}

export function getConversationTranslationJob(
  sessionId: string,
  turnId: string,
): ConversationTranslationJob | null {
  const id = translationJobId(sessionId, turnId);
  return loadConversationTranslationJobs().find((job) => job.id === id) ?? null;
}

export async function processPendingConversationTranslations(
  session: SessionTranscript,
  options: ProcessConversationTranslationOptions,
): Promise<ConversationTranslationProcessResult[]> {
  if (!options.allowCloudProcessing || options.signal?.aborted) return [];

  const now = options.now ?? (() => Date.now());
  const translate = options.translate ?? requestTranslation;
  const turns = getConversationTurns(session);
  const turnsById = new Map(turns.map((turn) => [turn.id, turn]));
  const jobs = queuePendingConversationTranslations(session, now())
    .filter((job) => job.status === 'pending');
  const results: ConversationTranslationProcessResult[] = [];

  for (const job of jobs) {
    if (options.signal?.aborted) break;

    const turn = turnsById.get(job.turnId);
    if (!turn || !shouldQueueKoreanTranslation(turn)) continue;

    try {
      const response = await translate({
        clientSessionId: session.sessionId,
        requestId: `${job.id}:attempt:${job.attempts + 1}`,
        turnId: job.turnId,
        sourceLanguage: turn.language,
        targetLanguage: TARGET_LANGUAGE,
        text: turn.transcript,
      }, options.signal);
      if (options.signal?.aborted) break;

      const translationKo = extractTranslationKo(response);
      const completed = translationKo
        ? markConversationTranslationComplete(job.sessionId, job.turnId, translationKo, now())
        : null;
      if (completed) {
        results.push({
          job: completed.job,
          turnId: job.turnId,
          status: 'translated',
        });
        continue;
      }

      const failed = markConversationTranslationFailed(
        job.sessionId,
        job.turnId,
        'Translation response was empty.',
        now(),
      );
      if (failed) {
        results.push({
          job: failed,
          turnId: job.turnId,
          status: 'failed',
        });
      }
    } catch (err) {
      if (options.signal?.aborted) break;
      const failed = markConversationTranslationFailed(
        job.sessionId,
        job.turnId,
        err instanceof Error ? err.message : 'Translation failed.',
        now(),
      );
      if (failed) {
        results.push({
          job: failed,
          turnId: job.turnId,
          status: 'failed',
        });
      }
    }
  }

  return results;
}

export function loadConversationTranslationJobs(): ConversationTranslationJob[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map(normalizeTranslationJob).filter((job): job is ConversationTranslationJob => job !== null)
      : [];
  } catch {
    return [];
  }
}

export function markConversationTranslationComplete(
  sessionId: string,
  turnId: string,
  translationKo: string,
  now = Date.now(),
): ConversationTranslationCompleteResult | null {
  const cleaned = cleanPlainText(translationKo, MAX_TRANSLATION_LENGTH);
  if (!cleaned) return null;

  const jobs = loadConversationTranslationJobs();
  const index = jobs.findIndex((job) => job.id === translationJobId(sessionId, turnId));
  if (index < 0) return null;

  const turn = TranscriptStore.updateConversationTurn(sessionId, turnId, {
    translationKo: cleaned,
  });
  if (!turn) {
    markConversationTranslationFailed(
      sessionId,
      turnId,
      'Conversation turn is no longer available.',
      now,
    );
    return null;
  }

  const job: ConversationTranslationJob = {
    ...jobs[index]!,
    status: 'translated',
    updatedAt: now,
    translationKo: cleaned,
  };
  delete job.error;

  jobs[index] = job;
  saveConversationTranslationJobs(jobs);
  return { job, turn };
}

export function markConversationTranslationFailed(
  sessionId: string,
  turnId: string,
  error: string,
  now = Date.now(),
): ConversationTranslationJob | null {
  const jobs = loadConversationTranslationJobs();
  const index = jobs.findIndex((job) => job.id === translationJobId(sessionId, turnId));
  if (index < 0) return null;

  const job: ConversationTranslationJob = {
    ...jobs[index]!,
    status: 'failed',
    updatedAt: now,
    attempts: jobs[index]!.attempts + 1,
    error: cleanPlainText(error, MAX_ERROR_LENGTH) || 'Translation failed.',
  };
  delete job.translationKo;

  jobs[index] = job;
  saveConversationTranslationJobs(jobs);
  return job;
}

export function clearConversationTranslationJobs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage is best-effort.
  }
}

function saveConversationTranslationJobs(jobs: ConversationTranslationJob[]): void {
  const bounded = jobs
    .filter(isTranslationJob)
    .slice(-MAX_JOBS);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // Translation jobs are recoverable from saved ConversationTurn records.
  }
}

function normalizeTranslationJob(value: unknown): ConversationTranslationJob | null {
  if (!isRecord(value)) return null;
  const job: ConversationTranslationJob = {
    id: coerceString(value.id),
    sessionId: coerceString(value.sessionId),
    turnId: coerceString(value.turnId),
    sourceLanguage: normalizeLanguage(coerceString(value.sourceLanguage)),
    targetLanguage: TARGET_LANGUAGE,
    status: isStoredStatus(value.status) ? value.status : 'pending',
    requestedAt: coerceTimestamp(value.requestedAt),
    updatedAt: coerceTimestamp(value.updatedAt),
    attempts: coerceNonNegativeInteger(value.attempts),
    translationKo: cleanPlainText(value.translationKo, MAX_TRANSLATION_LENGTH),
    error: cleanPlainText(value.error, MAX_ERROR_LENGTH),
  };
  return isTranslationJob(job) ? job : null;
}

function isTranslationJob(value: unknown): value is ConversationTranslationJob {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.sessionId === 'string' &&
    value.sessionId.length > 0 &&
    typeof value.turnId === 'string' &&
    value.turnId.length > 0 &&
    typeof value.sourceLanguage === 'string' &&
    value.sourceLanguage.length > 0 &&
    value.targetLanguage === TARGET_LANGUAGE &&
    isStoredStatus(value.status) &&
    typeof value.requestedAt === 'number' &&
    Number.isFinite(value.requestedAt) &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) &&
    typeof value.attempts === 'number' &&
    Number.isInteger(value.attempts) &&
    value.attempts >= 0
  );
}

function isStoredStatus(value: unknown): value is ConversationTranslationJob['status'] {
  return value === 'pending' || value === 'translated' || value === 'failed';
}

function translationJobId(sessionId: string, turnId: string): string {
  return `${sessionId}:${turnId}:${TARGET_LANGUAGE}`;
}

function isKoreanLanguage(language: string): boolean {
  return normalizeLanguage(language).toLowerCase().startsWith('ko');
}

function normalizeLanguage(language: string): string {
  const cleaned = language.trim();
  return cleaned || 'und';
}

function cleanPlainText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return cleaned || undefined;
}

function extractTranslationKo(response: TranslationApiResponse | string): string | undefined {
  if (typeof response === 'string') return cleanPlainText(response, MAX_TRANSLATION_LENGTH);
  return (
    cleanPlainText(response.translationKo, MAX_TRANSLATION_LENGTH) ||
    cleanPlainText(response.text, MAX_TRANSLATION_LENGTH)
  );
}

function coerceString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function coerceTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : Date.now();
}

function coerceNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
