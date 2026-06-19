/**
 * Transcript Analyzer — Combat Mode conversation analysis engine.
 *
 * Tracks the running conversation transcript, manages active expression hints,
 * checks whether the user incorporated suggested expressions, and provides
 * adaptive difficulty progression based on recent performance.
 */

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
}

/** Result of checking whether the user's speech matched the active hint. */
export interface HintCheckResult {
  /** Whether the hint is considered "used" (≥ 2 keyword matches). */
  used: boolean;
  /** Which keywords were found in the user's speech. */
  matchedWords: string[];
  /** Ratio of matched keywords to total keywords (0–1). */
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
  setActiveHint(hintText: string, difficulty: number): void {
    this.activeHint = {
      text: hintText,
      keyWords: extractKeyWords(hintText),
      givenAt: Date.now(),
      difficulty,
      status: 'pending',
    };
  }

  /**
   * Check if the user's recent speech contains the active hint's key
   * expressions.
   *
   * Uses local keyword matching:
   * - Extract content words from the hint (stop-words removed).
   * - Compare against the provided transcript (case-insensitive).
   * - If ≥ 2 keywords match the hint is considered "used".
   *
   * @param transcript The user's recent speech to evaluate.
   * @returns {@link HintCheckResult} with match details.
   */
  checkHintUsage(transcript: string): HintCheckResult {
    if (!this.activeHint || this.activeHint.keyWords.length === 0) {
      return { used: false, matchedWords: [], matchRatio: 0 };
    }

    const lowerTranscript = transcript.toLowerCase();
    const transcriptWords = new Set(
      lowerTranscript.replace(/[^\w\s']/g, '').split(/\s+/)
    );

    const matchedWords: string[] = [];
    for (const kw of this.activeHint.keyWords) {
      // Check both as a standalone word and as a substring (handles conjugation edge cases)
      if (transcriptWords.has(kw) || lowerTranscript.includes(kw)) {
        matchedWords.push(kw);
      }
    }

    const totalKeyWords = this.activeHint.keyWords.length;
    const matchRatio = totalKeyWords > 0 ? matchedWords.length / totalKeyWords : 0;
    const used = matchedWords.length >= 2;

    return { used, matchedWords, matchRatio };
  }

  /**
   * Mark the active hint as used/missed and persist the record.
   *
   * @param status       Outcome — 'used' or 'missed'.
   * @param userResponse Optional: what the user actually said.
   */
  resolveActiveHint(status: 'used' | 'missed' | 'simplified', detail?: string): void {
    if (!this.activeHint) return;

    this.activeHint.status = status;

    const record: HintUsageRecord = {
      hint: this.activeHint.text,
      status,
      timestamp: Date.now(),
      difficulty: this.activeHint.difficulty,
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
   * Get the last 5 **final** utterances formatted for Gemini context.
   *
   * @returns A newline-separated string of recent utterances, e.g.:
   * ```
   * User said: "I'd like a coffee"
   * User said: "With oat milk please"
   * ```
   */
  getConversationContext(): string {
    const finals = this.utterances.filter((u) => u.isFinal);
    if (finals.length === 0) return 'No conversation yet.';

    return finals
      .slice(-5)
      .map((u) => `User said: "${u.text}"`)
      .join('\n');
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
