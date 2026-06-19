/**
 * Transcript Analyzer — Combat Mode conversation analysis engine.
 *
 * Tracks the running conversation transcript, manages active expression hints,
 * checks whether the user incorporated suggested expressions, and provides
 * adaptive difficulty progression based on recent performance.
 */

import type { AssistOutcome, Cue, CueLevelUsed, SpeechAct } from '@toolkit/echo-domain-v2';
import {
  evaluateCueObjectOutcome,
  evaluateCueOutcome,
  type CueOutcomeEvaluation,
} from './outcome-evaluator';

// ── Stop-words removed during keyword extraction ──

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'to', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'me', 'him', 'us', 'them',
  'am', 'do', 'does', 'did', 'have', 'has', 'had',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  'not', 'no', 'nor', 'and', 'or', 'but', 'if', 'of', 'at', 'by', 'for',
  'with', 'about', 'between', 'through', 'during', 'before', 'after',
  'in', 'on', 'up', 'out', 'off', 'over', 'under',
  'this', 'that', 'these', 'those',
  'so', 'than', 'too', 'very', 'just',
  'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
]);
const CONTEXT_UTTERANCE_TEXT_LIMIT = 240;

// ── Interfaces ──

/** A hint currently being tracked for user adoption. */
export interface ActiveHint {
  /** The recommended expression (e.g., "I'd like to order…"). */
  text: string;
  /** Core keywords extracted from the hint (stop-words removed). */
  keyWords: string[];
  /** Timestamp (ms) when hint was given. */
  givenAt: number;
  /** Difficulty level 1–4, matching the week. */
  difficulty: number;
  /** Current lifecycle status. */
  status: 'pending' | 'used' | 'missed' | 'simplified';
  /** If this hint was simplified, the original harder hint text. */
  simplifiedFrom?: string;
  /** Structured cue metadata when available. */
  cue?: Cue;
  /** Speech-act inferred or supplied for outcome evaluation. */
  speechAct?: SpeechAct;
}

/** A persisted record of a single hint's outcome. */
export interface HintUsageRecord {
  /** The hint text that was given. */
  hint: string;
  /** Outcome. */
  status: 'used' | 'missed' | 'simplified';
  /** What the user actually said (if captured). */
  userResponse?: string;
  /** Easier replacement shown after this hint was simplified. */
  simplifiedTo?: string;
  /** Timestamp (ms) of resolution. */
  timestamp: number;
  /** Difficulty level of the hint. */
  difficulty: number;
  /** ECHO domain v2 outcome for the assisted turn. */
  outcome: AssistOutcome;
  /** Cue level used for this outcome, or 0 when no cue was used. */
  cueLevelUsed: CueLevelUsed;
  /** Speech act evaluated for this hint. */
  speechAct: SpeechAct;
}

/** Summary of the shared cue outcome evaluation for the active hint. */
export interface HintCheckResult {
  /** Whether the shared evaluator considers the cue successfully used. */
  used: boolean;
  /** Which cue keywords were found by the shared evaluator. */
  matchedWords: string[];
  /** Ratio of matched keywords to total cue keywords (0–1). */
  matchRatio: number;
}

/** End-of-session aggregate statistics. */
export interface SessionAnalysis {
  totalHints: number;
  hintsUsed: number;
  hintsMissed: number;
  hintsSimplified: number;
  /** Success rate as a percentage (0–100). */
  successRate: number;
  /** Difficulty level recorded at each hint (chronological). */
  difficultyProgression: number[];
  /** Recommended difficulty for the next session. */
  recommendedNextDifficulty: number;
  /** Total number of utterances captured. */
  conversationLength: number;
  /** Most commonly missed expressions (up to 5). */
  topMissedExpressions: string[];
}

// ── Helpers ──

/**
 * Extract meaningful content words from a phrase.
 * Removes stop-words, punctuation, and placeholder markers.
 */
function extractKeyWords(phrase: string): string[] {
  const cleaned = phrase
    .toLowerCase()
    // Remove placeholder markers like ___ or (...)
    .replace(/_{2,}/g, '')
    .replace(/\(\.{2,}\)/g, '')
    .replace(/\(\.\.\.\)/g, '')
    // Remove punctuation except apostrophes inside words (e.g. "I'd")
    .replace(/[^\w\s']/g, '')
    .trim();

  return cleaned
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

// ── TranscriptAnalyzer ──

/**
 * Format analyzer-only utterances without inventing a learner speaker role.
 */
function formatLegacyContextUtterance(text: string): string {
  const transcript = sanitizeContextUtterance(text);
  if (!transcript || transcript.toLowerCase() === '[speech detected]') return '';
  return `Unknown speaker: ${transcript}`;
}

function sanitizeContextUtterance(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CONTEXT_UTTERANCE_TEXT_LIMIT);
}

/**
 * Tracks the running Combat Mode transcript, manages hints, and computes
 * adaptive difficulty.
 */
export class TranscriptAnalyzer {
  private utterances: { text: string; timestamp: number; isFinal: boolean }[] = [];
  private activeHint: ActiveHint | null = null;
  private hintHistory: HintUsageRecord[] = [];
  private currentDifficulty: number;
  private initTime: number;

  /**
   * @param baseWeek Starting difficulty level (1–4).
   */
  constructor(baseWeek: number) {
    this.currentDifficulty = Math.max(1, Math.min(4, Math.round(baseWeek)));
    this.initTime = Date.now();
  }

  // ── Utterance tracking ──

  /**
   * Add a new speech utterance to the running transcript.
   *
   * @param text  Recognized text.
   * @param isFinal  Whether the recognition result is final.
   */
  addUtterance(text: string, isFinal: boolean): void {
    this.utterances.push({ text, timestamp: Date.now(), isFinal });
  }

  /**
   * Get the time elapsed (in milliseconds) since the last final utterance was added.
   * If there are no utterances, returns the time since the analyzer was instantiated.
   */
  getTimeSinceLastUtterance(): number {
    const finals = this.utterances.filter((u) => u.isFinal);
    if (finals.length === 0) {
      return Date.now() - this.initTime;
    }
    const last = finals[finals.length - 1]!;
    return Date.now() - last.timestamp;
  }

  // ── Hint lifecycle ──

  /**
   * Set the current active hint being tracked.
   *
   * @param hintText   The expression to suggest to the user.
   * @param difficulty Difficulty level 1–4.
   */
  setActiveHint(hintText: string, difficulty: number, cue?: Cue): void {
    this.activeHint = {
      text: hintText,
      keyWords: extractKeyWords(hintText),
      givenAt: Date.now(),
      difficulty,
      status: 'pending',
      cue,
      speechAct: cue?.speechAct,
    };
  }

  /**
   * Check whether the user's recent speech satisfies the active hint.
   * This is a compatibility wrapper around the shared cue outcome evaluator so
   * the app does not maintain a second success rule for the same cue.
   *
   * @param transcript The user's recent speech to evaluate.
   * @returns {@link HintCheckResult} with match details.
   */
  checkHintUsage(transcript: string): HintCheckResult {
    const evaluation = this.evaluateActiveHintUsage(transcript);
    if (!evaluation) {
      return { used: false, matchedWords: [], matchRatio: 0 };
    }

    return {
      used: evaluation.status === 'used',
      matchedWords: evaluation.matchedWords,
      matchRatio: evaluation.matchRatio,
    };
  }

  evaluateActiveHintUsage(transcript: string): CueOutcomeEvaluation | null {
    if (!this.activeHint) return null;

    if (this.activeHint.cue) {
      return evaluateCueObjectOutcome(this.activeHint.cue, transcript);
    }

    return evaluateCueOutcome({
      phrase: this.activeHint.text,
      userAttempt: transcript,
      speechAct: this.activeHint.speechAct,
      level: clampCueLevel(this.activeHint.difficulty),
    });
  }

  /**
   * Mark the active hint as used/missed and persist the record.
   *
   * @param status       Outcome — 'used' or 'missed'.
   * @param userResponse Optional: what the user actually said.
   */
  resolveActiveHint(
    status: 'used' | 'missed' | 'simplified',
    detail?: string,
    evaluation?: CueOutcomeEvaluation,
  ): void {
    if (!this.activeHint) return;

    this.activeHint.status = status;
    const fallbackEvaluation = evaluateCueOutcome({
      phrase: this.activeHint.text,
      userAttempt: status === 'used' ? detail ?? '' : '',
      speechAct: this.activeHint.speechAct,
      level: clampCueLevel(this.activeHint.difficulty),
    });

    const record: HintUsageRecord = {
      hint: this.activeHint.text,
      status,
      timestamp: Date.now(),
      difficulty: this.activeHint.difficulty,
      outcome: evaluation?.outcome ?? fallbackOutcome(status, fallbackEvaluation.outcome),
      cueLevelUsed: evaluation?.cueLevelUsed ?? fallbackEvaluation.cueLevelUsed,
      speechAct: evaluation?.speechAct ?? fallbackEvaluation.speechAct,
    };

    if (status === 'simplified') {
      record.simplifiedTo = detail;
    } else if (detail) {
      record.userResponse = detail;
    }

    this.hintHistory.push(record);

    this.activeHint = null;
  }

  /**
   * Get the currently active hint, or `null` if none is set.
   */
  getActiveHint(): ActiveHint | null {
    return this.activeHint;
  }

  /**
   * Clear the active hint without marking it as used or missed.
   * Used when the user explicitly dismisses a cue.
   */
  clearActiveHint(): void {
    this.activeHint = null;
  }

  // ── Context helpers ──

  /**
   * Get the last 5 **final** utterances formatted for legacy cue context.
   * This analyzer has no diarization metadata, so it keeps speaker attribution
   * unresolved instead of assuming every utterance came from the learner.
   */
  getConversationContext(): string {
    const finals = this.utterances.filter((u) => u.isFinal);
    if (finals.length === 0) return 'No conversation yet.';

    const lines = finals
      .slice(-5)
      .map((u) => formatLegacyContextUtterance(u.text))
      .filter((line) => line.length > 0);

    return lines.length > 0 ? lines.join('\n') : 'No conversation yet.';
  }

  // ── Adaptive difficulty ──

  /**
   * Calculate adaptive difficulty based on recent hint performance.
   *
   * Rules (applied to the last 5 resolved hints):
   * - Success rate < 30 % → decrease difficulty by 1 (min 1).
   * - Success rate > 70 % → increase difficulty by 1 (max 4).
   * - Otherwise keep current difficulty.
   *
   * @returns The (possibly updated) current difficulty level.
   */
  getAdaptiveDifficulty(): number {
    const recent = this.hintHistory.slice(-5);
    if (recent.length === 0) return this.currentDifficulty;

    const used = recent.filter((r) => r.status === 'used').length;
    const usedOrMissed = recent.filter(
      (r) => r.status === 'used' || r.status === 'missed'
    ).length;

    if (usedOrMissed === 0) return this.currentDifficulty;

    const rate = used / usedOrMissed;

    if (rate < 0.3 && this.currentDifficulty > 1) {
      this.currentDifficulty -= 1;
    } else if (rate > 0.7 && this.currentDifficulty < 4) {
      this.currentDifficulty += 1;
    }

    return this.currentDifficulty;
  }

  // ── Session analysis ──

  /**
   * Compute full session analysis for end-of-session reporting.
   */
  getSessionAnalysis(): SessionAnalysis {
    const total = this.hintHistory.length;
    const used = this.hintHistory.filter((r) => r.status === 'used').length;
    const missed = this.hintHistory.filter((r) => r.status === 'missed').length;
    const simplified = this.hintHistory.filter((r) => r.status === 'simplified').length;

    const successRate = total > 0 ? Math.round((used / total) * 100) : 0;

    const difficultyProgression = this.hintHistory.map((r) => r.difficulty);

    // Tally missed expressions and pick the top 5
    const missedCounts = new Map<string, number>();
    for (const r of this.hintHistory) {
      if (r.status === 'missed') {
        missedCounts.set(r.hint, (missedCounts.get(r.hint) ?? 0) + 1);
      }
    }
    const topMissedExpressions = [...missedCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([hint]) => hint);

    return {
      totalHints: total,
      hintsUsed: used,
      hintsMissed: missed,
      hintsSimplified: simplified,
      successRate,
      difficultyProgression,
      recommendedNextDifficulty: this.getAdaptiveDifficulty(),
      conversationLength: this.utterances.length,
      topMissedExpressions,
    };
  }

  // ── Accessors ──

  /** Get all hint usage records. */
  getHintHistory(): HintUsageRecord[] {
    return [...this.hintHistory];
  }

  /** Get the current running transcript as an array of text strings. */
  getTranscriptTexts(): string[] {
    return this.utterances.map((u) => u.text);
  }
}

function clampCueLevel(difficulty: number): 1 | 2 | 3 {
  const level = Math.max(1, Math.min(3, Math.round(difficulty)));
  return level as 1 | 2 | 3;
}

function fallbackOutcome(
  status: 'used' | 'missed' | 'simplified',
  usedOutcome: AssistOutcome,
): AssistOutcome {
  if (status === 'used') return usedOutcome;
  if (status === 'simplified') return 'partial';
  return 'failed';
}
