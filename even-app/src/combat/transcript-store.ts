/**
 * Transcript Store — cache-based conversation log persistence.
 *
 * Records every speech event (user utterances, hints, silences) during
 * a Combat session into sessionStorage for real-time durability,
 * then finalizes to localStorage on session end.
 *
 * Storage strategy:
 * - sessionStorage: live session buffer (survives tab refresh within tab lifetime)
 * - localStorage: finalized sessions (max 10, FIFO auto-delete)
 *
 * NOT cloud storage — all data stays on-device.
 */

// ── Types ──

export interface TranscriptEntry {
  /** Epoch timestamp */
  t: number;
  /** Event type */
  type: 'user_speech' | 'hint_given' | 'silence_event';
  /** The actual text (utterance or hint) */
  text: string;
  /** Origin of the text */
  source?: 'speech_api' | 'gemini_eval' | 'fallback' | 'live_final';
  /** Whether this is a finalized recognition result */
  isFinal?: boolean;
}

export interface SessionTranscript {
  /** Unique session identifier */
  sessionId: string;
  /** Session start epoch */
  startTime: number;
  /** Session end epoch (0 if still active) */
  endTime: number;
  /** Week number (1-4) */
  week: number;
  /** Topic label */
  topic: string;
  /** Category key */
  category: string;
  /** All recorded entries */
  entries: TranscriptEntry[];
}

// ── Constants ──

const SESSION_BUFFER_KEY = 'echo_transcript_buffer';
const STORAGE_KEY = 'echo_transcripts';
const MAX_SESSIONS = 10;

// ── Store ──

export class TranscriptStore {
  private session: SessionTranscript;

  constructor(week: number, topic: string, category: string) {
    const now = Date.now();
    const dateStr = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.session = {
      sessionId: `echo_${dateStr}`,
      startTime: now,
      endTime: 0,
      week,
      topic,
      category,
      entries: [],
    };
    // Immediately persist to sessionStorage
    this.flush();
  }

  /** Get the current session ID */
  get sessionId(): string {
    return this.session.sessionId;
  }

  /** Get a snapshot of current entries */
  get entries(): TranscriptEntry[] {
    return this.session.entries;
  }

  /** Get session metadata */
  get metadata(): Omit<SessionTranscript, 'entries'> {
    const { entries: _, ...meta } = this.session;
    return meta;
  }

  /**
   * Append a user speech event.
   */
  addSpeech(text: string, source: TranscriptEntry['source'] = 'speech_api', isFinal = true): void {
    if (!text.trim()) return;
    this.session.entries.push({
      t: Date.now(),
      type: 'user_speech',
      text: text.trim(),
      source,
      isFinal,
    });
    this.flush();
  }

  /**
   * Append a hint event.
   */
  addHint(text: string, source: 'gemini_eval' | 'fallback' = 'gemini_eval'): void {
    if (!text.trim()) return;
    this.session.entries.push({
      t: Date.now(),
      type: 'hint_given',
      text: text.trim(),
      source,
    });
    this.flush();
  }

  /**
   * Append a silence event.
   */
  addSilence(durationMs: number): void {
    this.session.entries.push({
      t: Date.now(),
      type: 'silence_event',
      text: `${Math.round(durationMs)}ms`,
    });
    this.flush();
  }

  /**
   * Write current state to sessionStorage (fast, synchronous).
   */
  private flush(): void {
    try {
      sessionStorage.setItem(SESSION_BUFFER_KEY, JSON.stringify(this.session));
    } catch {
      // sessionStorage full or unavailable — silent fail
    }
  }

  /**
   * Finalize the session: move from sessionStorage to localStorage.
   * Enforces the 10-session cap with FIFO auto-delete.
   */
  finalize(): SessionTranscript {
    this.session.endTime = Date.now();

    // Persist to localStorage
    const stored = TranscriptStore.loadAll();
    stored.push(this.session);

    // Enforce cap — remove oldest first
    while (stored.length > MAX_SESSIONS) {
      stored.shift();
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // localStorage full — try clearing old data first
      try {
        if (stored.length > 1) {
          stored.splice(0, stored.length - 1);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        }
      } catch {
        // Completely full — nothing we can do
      }
    }

    // Clear session buffer
    try {
      sessionStorage.removeItem(SESSION_BUFFER_KEY);
    } catch { /* ignore */ }

    return this.session;
  }

  // ── Static Methods ──

  /**
   * Load all finalized sessions from localStorage.
   */
  static loadAll(): SessionTranscript[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Get a specific session by ID.
   */
  static getById(sessionId: string): SessionTranscript | null {
    const all = TranscriptStore.loadAll();
    return all.find((s) => s.sessionId === sessionId) ?? null;
  }

  /**
   * Get session summaries (for UI listing without loading full entries).
   */
  static getSummaries(): Array<{
    sessionId: string;
    startTime: number;
    endTime: number;
    week: number;
    topic: string;
    entryCount: number;
    speechCount: number;
    hintCount: number;
  }> {
    const all = TranscriptStore.loadAll();
    return all.map((s) => ({
      sessionId: s.sessionId,
      startTime: s.startTime,
      endTime: s.endTime,
      week: s.week,
      topic: s.topic,
      entryCount: s.entries.length,
      speechCount: s.entries.filter((e) => e.type === 'user_speech').length,
      hintCount: s.entries.filter((e) => e.type === 'hint_given').length,
    }));
  }

  /**
   * Recover an active session buffer from sessionStorage (if app crashed).
   */
  static recoverBuffer(): SessionTranscript | null {
    try {
      const raw = sessionStorage.getItem(SESSION_BUFFER_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as SessionTranscript;
    } catch {
      return null;
    }
  }

  /**
   * Delete a specific session from localStorage.
   */
  static deleteSession(sessionId: string): void {
    const all = TranscriptStore.loadAll();
    const filtered = all.filter((s) => s.sessionId !== sessionId);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch { /* ignore */ }
  }
}
