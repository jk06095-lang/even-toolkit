import type {
  AssistOutcome,
  Cue,
  CueLevel,
  CueLevelUsed,
  SpeechAct,
} from '@toolkit/echo-domain-v2';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'to', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'me', 'him', 'us', 'them',
  'am', 'do', 'does', 'did', 'have', 'has', 'had',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  'not', 'no', 'and', 'or', 'but', 'if', 'of', 'at', 'by', 'for',
  'with', 'about', 'in', 'on', 'up', 'out', 'off',
  'this', 'that', 'these', 'those',
  'so', 'just', 'please',
]);

export interface CueOutcomeInput {
  phrase: string;
  userAttempt: string;
  speechAct?: SpeechAct;
  level?: CueLevel;
}

export interface CueOutcomeEvaluation {
  outcome: AssistOutcome;
  status: 'used' | 'missed';
  cueLevelUsed: CueLevelUsed;
  speechAct: SpeechAct;
  matchedWords: string[];
  matchRatio: number;
}

export function evaluateCueOutcome(input: CueOutcomeInput): CueOutcomeEvaluation {
  const phrase = normalizeSpokenText(input.phrase);
  const attempt = normalizeSpokenText(input.userAttempt);
  const speechAct = input.speechAct ?? inferSpeechAct(input.phrase);
  const cueLevelUsed = input.level ?? 0;

  if (!attempt) {
    return result('failed', cueLevelUsed, speechAct, [], 0);
  }

  const phraseWords = contentWords(phrase);
  const attemptWords = new Set(contentWords(attempt));
  const matchedWords = phraseWords.filter((word) => attemptWords.has(word) || attempt.includes(word));
  const matchRatio = phraseWords.length > 0 ? matchedWords.length / phraseWords.length : 0;

  if (phrase && (attempt.includes(phrase) || (phrase.includes(attempt) && attempt.length >= 12))) {
    return result('assisted_exact', cueLevelUsed, speechAct, matchedWords, matchRatio);
  }

  if (speechAct !== 'answer' && matchesSpeechAct(attempt, speechAct)) {
    return result('assisted_adapted', cueLevelUsed, speechAct, matchedWords, matchRatio);
  }

  if (matchRatio >= 0.6 && matchedWords.length >= 2) {
    return result('assisted_adapted', cueLevelUsed, speechAct, matchedWords, matchRatio);
  }

  if (matchedWords.length > 0 || countWords(attempt) <= 2) {
    return result('partial', cueLevelUsed, speechAct, matchedWords, matchRatio);
  }

  return result('failed', cueLevelUsed, speechAct, matchedWords, matchRatio);
}

export function evaluateCueObjectOutcome(cue: Cue, userAttempt: string): CueOutcomeEvaluation {
  return evaluateCueOutcome({
    phrase: cue.phrase,
    speechAct: cue.speechAct,
    level: cue.level,
    userAttempt,
  });
}

export function inferSpeechAct(phrase: string): SpeechAct {
  const normalized = normalizeSpokenText(phrase);
  if (matchesSpeechAct(normalized, 'ask_repeat')) return 'ask_repeat';
  if (matchesSpeechAct(normalized, 'buy_time')) return 'buy_time';
  if (matchesSpeechAct(normalized, 'clarify')) return 'clarify';
  if (matchesSpeechAct(normalized, 'repair')) return 'repair';
  return 'answer';
}

function result(
  outcome: AssistOutcome,
  cueLevelUsed: CueLevelUsed,
  speechAct: SpeechAct,
  matchedWords: string[],
  matchRatio: number,
): CueOutcomeEvaluation {
  return {
    outcome,
    status: outcome === 'assisted_exact' || outcome === 'assisted_adapted' ? 'used' : 'missed',
    cueLevelUsed,
    speechAct,
    matchedWords,
    matchRatio,
  };
}

function matchesSpeechAct(attempt: string, speechAct: SpeechAct): boolean {
  switch (speechAct) {
    case 'ask_repeat':
      return /\b(repeat|again|pardon|catch|one more time)\b/.test(attempt) ||
        /\bsay\b.*\bagain\b/.test(attempt);
    case 'buy_time':
      return /\b(second|moment|minute|think|hold on|one sec|give me)\b/.test(attempt);
    case 'clarify':
      return /\b(mean|means|clarify|explain|understand)\b/.test(attempt);
    case 'repair':
      return /\b(sorry|mean|meant|rephrase|actually|let me)\b/.test(attempt);
    case 'answer':
      return false;
  }
}

function normalizeSpokenText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentWords(value: string): string[] {
  return value
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

function countWords(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}
