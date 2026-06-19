import type { LearningItem } from '@toolkit/echo-domain-v2';
import { buildLearningItems } from '../combat/learner-profile';
import type { SessionTranscript } from '../combat/transcript-store';

export type ActiveRecallGrade = 'again' | 'hard' | 'good' | 'easy';
export type ActiveRecallPromptMode = 'meaning_to_expression' | 'transfer';

export interface ActiveRecallReviewState {
  itemId: string;
  reps: number;
  lapses: number;
  difficulty: number;
  stability: number;
  dueAt: string;
  updatedAt: string;
  lastGrade?: ActiveRecallGrade;
  lastAttemptAt?: string;
  transferSuccessCount: number;
}

export interface ActiveRecallPrompt {
  mode: ActiveRecallPromptMode;
  prompt: string;
  answer: string;
  meaningKo: string;
  scenarioTag: string;
}

export interface ActiveRecallQueueItem {
  learningItem: LearningItem;
  prompt: ActiveRecallPrompt;
  state: ActiveRecallReviewState;
  dueAt: string;
  timeUntilMs: number;
  isDue: boolean;
}

export interface ActiveRecallAttempt {
  id: string;
  itemId: string;
  mode: ActiveRecallPromptMode;
  grade: ActiveRecallGrade;
  prompt: string;
  expectedExpression: string;
  userAttempt?: string;
  attemptedAt: string;
  dueAtBefore: string;
  dueAtAfter: string;
  evaluation?: ActiveRecallAttemptEvaluation;
}

export interface ActiveRecallAttemptEvaluation {
  semanticScore: number;
  coverage: number;
  precision: number;
  recommendedGrade: ActiveRecallGrade;
  matchedKeywords: string[];
  missingKeywords: string[];
  note: string;
}

export interface ActiveRecallStoreSnapshot {
  version: '1.0.0';
  states: Record<string, ActiveRecallReviewState>;
  attempts: ActiveRecallAttempt[];
}

export interface ActiveRecallQueueOptions {
  now?: () => Date;
  includeFuture?: boolean;
}

export interface RecordActiveRecallAttemptOptions {
  now?: () => Date;
  mode?: ActiveRecallPromptMode;
}

const STORAGE_KEY = 'echo_active_recall_reviews';
const MAX_ATTEMPTS = 200;

export function buildActiveRecallQueue(
  sessions: SessionTranscript[],
  options: ActiveRecallQueueOptions = {},
): ActiveRecallQueueItem[] {
  const now = options.now?.() ?? new Date();
  const nowMs = now.getTime();
  const snapshot = loadActiveRecallSnapshot();
  const itemsById = new Map<string, LearningItem>();

  for (const session of sessions) {
    for (const item of buildLearningItems(session, { now: () => now })) {
      itemsById.set(item.id, item);
    }
  }

  return Array.from(itemsById.values())
    .map((item) => {
      const state = snapshot.states[item.id] ?? createInitialReviewState(item);
      const dueMs = Date.parse(state.dueAt);
      const timeUntilMs = Number.isFinite(dueMs) ? dueMs - nowMs : 0;
      const prompt = createActiveRecallPrompt(item, state);
      return {
        learningItem: item,
        prompt,
        state,
        dueAt: state.dueAt,
        timeUntilMs,
        isDue: timeUntilMs <= 0,
      };
    })
    .filter((item) => options.includeFuture === true || item.isDue)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

export function createActiveRecallPrompt(
  item: LearningItem,
  state: ActiveRecallReviewState = createInitialReviewState(item),
): ActiveRecallPrompt {
  const scenarioTag = item.examples[0]?.scenarioTag || item.scenarioTags[0] || 'conversation';
  const readyForTransfer = state.reps >= 2 && state.transferSuccessCount < 2;
  const mode: ActiveRecallPromptMode = readyForTransfer ? 'transfer' : 'meaning_to_expression';
  const prompt = mode === 'transfer'
    ? `New situation (${scenarioTag}): ${item.meaningKo}. Say a natural English response without looking at the saved phrase.`
    : `Recall this in English: ${item.meaningKo}. Say it before revealing the answer.`;

  return {
    mode,
    prompt,
    answer: item.canonicalExpression,
    meaningKo: item.meaningKo,
    scenarioTag,
  };
}

export function recordActiveRecallAttempt(
  item: LearningItem,
  grade: ActiveRecallGrade,
  userAttempt: string,
  options: RecordActiveRecallAttemptOptions = {},
): ActiveRecallAttempt {
  const now = options.now?.() ?? new Date();
  const snapshot = loadActiveRecallSnapshot();
  const current = snapshot.states[item.id] ?? createInitialReviewState(item);
  const prompt = createActiveRecallPrompt(item, current);
  const mode = options.mode ?? prompt.mode;
  const nextState = advanceActiveRecallState(current, grade, now, mode);
  const evaluation = evaluateActiveRecallAttempt(item, userAttempt);
  const attempt: ActiveRecallAttempt = {
    id: `${item.id}:attempt:${now.getTime()}`,
    itemId: item.id,
    mode,
    grade,
    prompt: prompt.prompt,
    expectedExpression: sanitizePlainText(item.canonicalExpression, 240),
    userAttempt: sanitizeOptional(userAttempt, 1000),
    attemptedAt: now.toISOString(),
    dueAtBefore: current.dueAt,
    dueAtAfter: nextState.dueAt,
    evaluation,
  };

  snapshot.states[item.id] = nextState;
  snapshot.attempts.push(attempt);
  while (snapshot.attempts.length > MAX_ATTEMPTS) {
    snapshot.attempts.shift();
  }
  saveActiveRecallSnapshot(snapshot);
  return attempt;
}

export function evaluateActiveRecallAttempt(
  item: LearningItem,
  userAttempt: string,
): ActiveRecallAttemptEvaluation {
  const expectedKeywords = keywordSet([
    item.canonicalExpression,
    item.naturalRecast ?? '',
    ...item.examples.map((example) => example.targetExpression),
  ].join(' '));
  const attemptKeywords = keywordSet(sanitizePlainText(userAttempt, 1000));

  if (attemptKeywords.length === 0) {
    return {
      semanticScore: 0,
      coverage: 0,
      precision: 0,
      recommendedGrade: 'again',
      matchedKeywords: [],
      missingKeywords: expectedKeywords,
      note: 'No attempt captured.',
    };
  }

  const matchedKeywords = expectedKeywords.filter((expected) => (
    attemptKeywords.some((attempt) => tokensMatch(expected, attempt))
  ));
  const matchedAttemptKeywords = attemptKeywords.filter((attempt) => (
    expectedKeywords.some((expected) => tokensMatch(expected, attempt))
  ));
  const missingKeywords = expectedKeywords.filter((expected) => !matchedKeywords.includes(expected));
  const coverage = ratio(matchedKeywords.length, expectedKeywords.length);
  const precision = ratio(matchedAttemptKeywords.length, attemptKeywords.length);
  const semanticScore = round(coverage * 0.7 + precision * 0.3);
  const recommendedGrade = recommendGrade(semanticScore, missingKeywords.length, userAttempt, item.canonicalExpression);

  return {
    semanticScore,
    coverage,
    precision,
    recommendedGrade,
    matchedKeywords,
    missingKeywords,
    note: evaluationNote(recommendedGrade, semanticScore),
  };
}

export function advanceActiveRecallState(
  current: ActiveRecallReviewState,
  grade: ActiveRecallGrade,
  now: Date,
  mode: ActiveRecallPromptMode = 'meaning_to_expression',
): ActiveRecallReviewState {
  const currentStability = Math.max(0.1, current.stability);
  const nextReps = grade === 'again' ? current.reps : current.reps + 1;
  const nextLapses = grade === 'again' ? current.lapses + 1 : current.lapses;
  const nextDifficulty = clamp(
    current.difficulty +
      (grade === 'again' ? 0.12 : grade === 'hard' ? 0.04 : grade === 'good' ? -0.03 : -0.08),
    0.05,
    0.95,
  );
  const nextStability = clamp(
    grade === 'again'
      ? currentStability * 0.55
      : grade === 'hard'
        ? currentStability * 1.2
        : grade === 'good'
          ? currentStability * 2.2
          : currentStability * 3.5,
    0.1,
    60,
  );
  const nextDueAt = new Date(now.getTime() + intervalMsForGrade(grade, nextStability)).toISOString();
  const transferSuccessCount = mode === 'transfer' && (grade === 'good' || grade === 'easy')
    ? current.transferSuccessCount + 1
    : current.transferSuccessCount;

  return {
    itemId: current.itemId,
    reps: nextReps,
    lapses: nextLapses,
    difficulty: round(nextDifficulty),
    stability: round(nextStability),
    dueAt: nextDueAt,
    updatedAt: now.toISOString(),
    lastGrade: grade,
    lastAttemptAt: now.toISOString(),
    transferSuccessCount,
  };
}

export function loadActiveRecallSnapshot(): ActiveRecallStoreSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySnapshot();
    const parsed = JSON.parse(raw);
    return normalizeSnapshot(parsed);
  } catch {
    return emptySnapshot();
  }
}

export function clearActiveRecallSnapshot(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage is best-effort.
  }
}

function saveActiveRecallSnapshot(snapshot: ActiveRecallStoreSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Active recall state can be rebuilt from session evidence if storage fails.
  }
}

function createInitialReviewState(item: LearningItem): ActiveRecallReviewState {
  return {
    itemId: item.id,
    reps: item.scheduling.reps,
    lapses: item.scheduling.lapses,
    difficulty: item.scheduling.difficulty,
    stability: item.scheduling.stability,
    dueAt: item.scheduling.dueAt,
    updatedAt: item.scheduling.dueAt,
    transferSuccessCount: 0,
  };
}

function intervalMsForGrade(grade: ActiveRecallGrade, stability: number): number {
  if (grade === 'again') return 10 * 60 * 1000;
  if (grade === 'hard') return 24 * 60 * 60 * 1000;
  const days = grade === 'good'
    ? Math.max(2, stability)
    : Math.max(4, stability * 1.5);
  return Math.round(days * 24 * 60 * 60 * 1000);
}

function normalizeSnapshot(value: unknown): ActiveRecallStoreSnapshot {
  if (!isRecord(value)) return emptySnapshot();
  const states: Record<string, ActiveRecallReviewState> = {};
  const rawStates = isRecord(value.states) ? value.states : {};
  for (const [key, state] of Object.entries(rawStates)) {
    if (isReviewState(state)) {
      states[key] = state;
    }
  }

  return {
    version: '1.0.0',
    states,
    attempts: Array.isArray(value.attempts)
      ? value.attempts.filter(isActiveRecallAttempt).slice(-MAX_ATTEMPTS)
      : [],
  };
}

function emptySnapshot(): ActiveRecallStoreSnapshot {
  return {
    version: '1.0.0',
    states: {},
    attempts: [],
  };
}

function isReviewState(value: unknown): value is ActiveRecallReviewState {
  return isRecord(value) &&
    typeof value.itemId === 'string' &&
    typeof value.reps === 'number' &&
    typeof value.lapses === 'number' &&
    typeof value.difficulty === 'number' &&
    typeof value.stability === 'number' &&
    typeof value.dueAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.transferSuccessCount === 'number';
}

function isActiveRecallAttempt(value: unknown): value is ActiveRecallAttempt {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.itemId === 'string' &&
    isPromptMode(value.mode) &&
    isGrade(value.grade) &&
    typeof value.prompt === 'string' &&
    typeof value.expectedExpression === 'string' &&
    typeof value.attemptedAt === 'string' &&
    typeof value.dueAtBefore === 'string' &&
    typeof value.dueAtAfter === 'string' &&
    (value.evaluation === undefined || isAttemptEvaluation(value.evaluation));
}

function isAttemptEvaluation(value: unknown): value is ActiveRecallAttemptEvaluation {
  return isRecord(value) &&
    typeof value.semanticScore === 'number' &&
    typeof value.coverage === 'number' &&
    typeof value.precision === 'number' &&
    isGrade(value.recommendedGrade) &&
    Array.isArray(value.matchedKeywords) &&
    Array.isArray(value.missingKeywords) &&
    typeof value.note === 'string';
}

function isPromptMode(value: unknown): value is ActiveRecallPromptMode {
  return value === 'meaning_to_expression' || value === 'transfer';
}

function isGrade(value: unknown): value is ActiveRecallGrade {
  return value === 'again' || value === 'hard' || value === 'good' || value === 'easy';
}

function sanitizeOptional(value: string, maxLength: number): string | undefined {
  const cleaned = sanitizePlainText(value, maxLength);
  return cleaned || undefined;
}

function sanitizePlainText(value: string, maxLength: number): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-phone]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function keywordSet(value: string): string[] {
  const tokens = value
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token && !STOP_WORDS.has(token));
  return Array.from(new Set(tokens));
}

function normalizeToken(value: string): string {
  const token = value.replace(/^'+|'+$/g, '');
  if (token.endsWith("'s")) return token.slice(0, -2);
  if (token.endsWith('ing') && token.length > 5) return token.slice(0, -3);
  if (token.endsWith('ed') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') && token.length > 3) return token.slice(0, -1);
  return token;
}

function tokensMatch(expected: string, attempt: string): boolean {
  if (expected === attempt) return true;
  const expectedSynonyms = SYNONYMS[expected] ?? [];
  const attemptSynonyms = SYNONYMS[attempt] ?? [];
  return expectedSynonyms.includes(attempt) ||
    attemptSynonyms.includes(expected) ||
    expectedSynonyms.some((synonym) => attemptSynonyms.includes(synonym));
}

function recommendGrade(
  semanticScore: number,
  missingCount: number,
  userAttempt: string,
  canonicalExpression: string,
): ActiveRecallGrade {
  if (semanticScore >= 0.9 && missingCount === 0) {
    return normalizedPhrase(userAttempt) === normalizedPhrase(canonicalExpression) ? 'easy' : 'good';
  }
  if (semanticScore >= 0.6) return 'hard';
  return 'again';
}

function evaluationNote(grade: ActiveRecallGrade, semanticScore: number): string {
  if (grade === 'easy') return 'Near-exact recall.';
  if (grade === 'good') return 'Meaning is covered in a natural variant.';
  if (grade === 'hard') return `Partial match (${Math.round(semanticScore * 100)}%).`;
  return 'Try again before counting this review.';
}

function normalizedPhrase(value: string): string {
  return keywordSet(value).join(' ');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return round(numerator / denominator);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'be',
  'can',
  'could',
  'do',
  'does',
  'for',
  'i',
  'it',
  'me',
  'please',
  'sorry',
  'that',
  'the',
  'this',
  'to',
  'we',
  'you',
]);

const SYNONYMS: Record<string, string[]> = {
  again: ['repeat', 'say'],
  ask: ['request'],
  clarify: ['explain'],
  customer: ['client'],
  issue: ['problem'],
  problem: ['issue'],
  repeat: ['again', 'say'],
  request: ['ask'],
  say: ['again', 'repeat', 'tell'],
  tell: ['say'],
};
