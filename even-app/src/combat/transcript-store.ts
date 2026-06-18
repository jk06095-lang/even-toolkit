/**
 * Transcript Store - local transcript persistence with explicit user consent.
 *
 * Raw transcript text is written to browser storage only when transcript saving
 * is enabled by the user. Session event analytics are stored separately as
 * metadata counts and never include utterance, hint, or audio text.
 */

import {
  isPersistentTranscriptRetention,
  loadPrivacySettings,
  retentionCutoffMs,
  type TranscriptRetentionPolicy,
} from '../privacy/settings';

export interface TranscriptEntry {
  /** Epoch timestamp */
  t: number;
  /** Event type */
  type: 'user_speech' | 'hint_given' | 'silence_event' | 'hint_used' | 'hint_missed' | 'hint_simplified';
  /** The actual text (utterance or hint) */
  text: string;
  /** Origin of the text */
  source?: 'speech_api' | 'gemini_eval' | 'fallback' | 'live_final';
  /** Whether this is a finalized recognition result */
  isFinal?: boolean;
}

export interface HintUsageStats {
  total: number;
  used: number;
  missed: number;
  simplified: number;
  successRate: number;
  difficultyProgression: number[];
  recommendedNextDifficulty: number;
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
  /** Hint usage statistics (populated at session end) */
  hintUsageStats?: HintUsageStats;
  /** Consent and retention snapshot used for this raw transcript. */
  savedWithConsent?: boolean;
  retentionPolicy?: TranscriptRetentionPolicy;
}

export interface SessionEventAnalytics {
  sessionId: string;
  startTime: number;
  endTime: number;
  week: number;
  topic: string;
  category: string;
  speechCount: number;
  hintCount: number;
  silenceCount: number;
  hintUsedCount: number;
  hintMissedCount: number;
  hintSimplifiedCount: number;
  rawTranscriptSaved: boolean;
}

export interface TranscriptStoreOptions {
  saveRawTranscript?: boolean;
  retentionPolicy?: TranscriptRetentionPolicy;
  now?: () => number;
}

export interface UserDataExport {
  exportVersion: '1.0.0';
  exportedAt: string;
  privacySettings: ReturnType<typeof loadPrivacySettings>;
  rawTranscripts: SessionTranscript[];
  eventAnalytics: SessionEventAnalytics[];
}

const SESSION_BUFFER_KEY = 'echo_transcript_buffer';
const STORAGE_KEY = 'echo_transcripts';
const ANALYTICS_KEY = 'echo_session_events';
const MAX_SESSIONS = 10;
const MAX_ANALYTICS = 100;

export class TranscriptStore {
  private session: SessionTranscript;
  private readonly saveRawTranscript: boolean;
  private readonly retentionPolicy: TranscriptRetentionPolicy;
  private readonly now: () => number;

  constructor(
    week: number,
    topic: string,
    category: string,
    options: TranscriptStoreOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.saveRawTranscript = options.saveRawTranscript === true;
    this.retentionPolicy = options.retentionPolicy ?? '7d';

    const now = this.now();
    const dateStr = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.session = {
      sessionId: `echo_${dateStr}`,
      startTime: now,
      endTime: 0,
      week,
      topic,
      category,
      entries: [],
      savedWithConsent: this.saveRawTranscript,
      retentionPolicy: this.retentionPolicy,
    };

    if (this.saveRawTranscript) {
      this.flush();
    } else {
      TranscriptStore.clearSessionBuffer();
    }
  }

  get sessionId(): string {
    return this.session.sessionId;
  }

  get entries(): TranscriptEntry[] {
    return this.session.entries;
  }

  get metadata(): Omit<SessionTranscript, 'entries'> {
    const { entries: _, ...meta } = this.session;
    return meta;
  }

  addSpeech(text: string, source: TranscriptEntry['source'] = 'speech_api', isFinal = true): void {
    if (!text.trim()) return;
    this.addEntry({
      t: this.now(),
      type: 'user_speech',
      text: text.trim(),
      source,
      isFinal,
    });
  }

  addHint(text: string, source: 'gemini_eval' | 'fallback' = 'gemini_eval'): void {
    if (!text.trim()) return;
    this.addEntry({
      t: this.now(),
      type: 'hint_given',
      text: text.trim(),
      source,
    });
  }

  addSilence(durationMs: number): void {
    this.addEntry({
      t: this.now(),
      type: 'silence_event',
      text: `${Math.round(durationMs)}ms`,
    });
  }

  addHintUsed(hintText: string, userResponse: string): void {
    this.addEntry({
      t: this.now(),
      type: 'hint_used',
      text: `Hint: ${hintText} | User: "${userResponse}"`,
    });
  }

  addHintMissed(hintText: string): void {
    this.addEntry({
      t: this.now(),
      type: 'hint_missed',
      text: `Hint: ${hintText}`,
    });
  }

  addHintSimplified(originalHint: string, simplifiedHint: string): void {
    this.addEntry({
      t: this.now(),
      type: 'hint_simplified',
      text: `Simplified: ${originalHint} -> ${simplifiedHint}`,
    });
  }

  setHintUsageStats(stats: HintUsageStats): void {
    this.session.hintUsageStats = stats;
    this.flush();
  }

  /**
   * Finalize the session. Returns a raw transcript only when persistence was
   * explicitly enabled and the selected retention policy keeps finalized data.
   */
  finalize(): SessionTranscript | null {
    this.session.endTime = this.now();
    this.persistEventAnalytics();

    const shouldPersistRaw =
      this.saveRawTranscript &&
      isPersistentTranscriptRetention(this.retentionPolicy);

    if (!shouldPersistRaw) {
      TranscriptStore.clearSessionBuffer();
      return null;
    }

    const stored = TranscriptStore.pruneSessions(
      [...TranscriptStore.loadAll(), this.session],
      this.retentionPolicy,
      this.now(),
    );

    while (stored.length > MAX_SESSIONS) {
      stored.shift();
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      try {
        if (stored.length > 1) {
          stored.splice(0, stored.length - 1);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        }
      } catch {
        // Storage is unavailable or full; leave raw transcript unpersisted.
      }
    }

    TranscriptStore.clearSessionBuffer();
    return this.session;
  }

  private addEntry(entry: TranscriptEntry): void {
    this.session.entries.push(entry);
    this.flush();
  }

  private flush(): void {
    if (!this.saveRawTranscript) return;
    try {
      sessionStorage.setItem(SESSION_BUFFER_KEY, JSON.stringify(this.session));
    } catch {
      // sessionStorage full or unavailable - continue without persistence.
    }
  }

  private persistEventAnalytics(): void {
    const analytics = buildEventAnalytics(
      this.session,
      this.saveRawTranscript && isPersistentTranscriptRetention(this.retentionPolicy),
    );
    const all = TranscriptStore.loadAnalytics();
    all.push(analytics);
    while (all.length > MAX_ANALYTICS) {
      all.shift();
    }
    try {
      localStorage.setItem(ANALYTICS_KEY, JSON.stringify(all));
    } catch {
      // Analytics are best-effort and contain no raw transcript text.
    }
  }

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

  static getById(sessionId: string): SessionTranscript | null {
    const all = TranscriptStore.loadAll();
    return all.find((s) => s.sessionId === sessionId) ?? null;
  }

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
    const settings = loadPrivacySettings();
    TranscriptStore.applyRetention(settings.transcriptRetention);
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

  static recoverBuffer(): SessionTranscript | null {
    if (!loadPrivacySettings().saveTranscripts) {
      TranscriptStore.clearSessionBuffer();
      return null;
    }

    try {
      const raw = sessionStorage.getItem(SESSION_BUFFER_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as SessionTranscript;
    } catch {
      return null;
    }
  }

  static deleteSession(sessionId: string): void {
    const all = TranscriptStore.loadAll();
    const filtered = all.filter((s) => s.sessionId !== sessionId);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch {
      // ignore
    }

    const analytics = TranscriptStore.loadAnalytics().filter((s) => s.sessionId !== sessionId);
    try {
      localStorage.setItem(ANALYTICS_KEY, JSON.stringify(analytics));
    } catch {
      // ignore
    }
  }

  static deleteLatestSession(): string | null {
    const latest = TranscriptStore.loadAll()
      .slice()
      .sort((a, b) => b.startTime - a.startTime)[0];
    if (!latest) return null;
    TranscriptStore.deleteSession(latest.sessionId);
    return latest.sessionId;
  }

  static deleteAllTranscripts(): number {
    const count = TranscriptStore.loadAll().length;
    try {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(SESSION_BUFFER_KEY);
    } catch {
      // ignore
    }
    return count;
  }

  static loadAnalytics(): SessionEventAnalytics[] {
    try {
      const raw = localStorage.getItem(ANALYTICS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  static exportUserData(): UserDataExport {
    return {
      exportVersion: '1.0.0',
      exportedAt: new Date().toISOString(),
      privacySettings: loadPrivacySettings(),
      rawTranscripts: TranscriptStore.loadAll(),
      eventAnalytics: TranscriptStore.loadAnalytics(),
    };
  }

  static applyRetention(policy: TranscriptRetentionPolicy, now = Date.now()): void {
    const stored = TranscriptStore.pruneSessions(TranscriptStore.loadAll(), policy, now);
    try {
      if (stored.length === 0) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      }
    } catch {
      // ignore
    }
  }

  static clearSessionBuffer(): void {
    try {
      sessionStorage.removeItem(SESSION_BUFFER_KEY);
    } catch {
      // ignore
    }
  }

  private static pruneSessions(
    sessions: SessionTranscript[],
    policy: TranscriptRetentionPolicy,
    now = Date.now(),
  ): SessionTranscript[] {
    if (policy === 'immediate') return [];
    const cutoff = retentionCutoffMs(policy, now);
    if (cutoff === null) return sessions;
    return sessions.filter((session) => {
      const end = session.endTime || session.startTime;
      return end >= cutoff;
    });
  }
}

function buildEventAnalytics(
  session: SessionTranscript,
  rawTranscriptSaved: boolean,
): SessionEventAnalytics {
  return {
    sessionId: session.sessionId,
    startTime: session.startTime,
    endTime: session.endTime,
    week: session.week,
    topic: session.topic,
    category: session.category,
    speechCount: session.entries.filter((e) => e.type === 'user_speech').length,
    hintCount: session.entries.filter((e) => e.type === 'hint_given').length,
    silenceCount: session.entries.filter((e) => e.type === 'silence_event').length,
    hintUsedCount: session.entries.filter((e) => e.type === 'hint_used').length,
    hintMissedCount: session.entries.filter((e) => e.type === 'hint_missed').length,
    hintSimplifiedCount: session.entries.filter((e) => e.type === 'hint_simplified').length,
    rawTranscriptSaved,
  };
}
