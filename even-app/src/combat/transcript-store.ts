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
import {
  ECHO_DOMAIN_V2_SCHEMA_VERSION,
  isAssistEpisode,
  isConversationTurn,
  isCue,
  type AssistEpisode,
  type ConversationTurn,
  type ConversationTurnSource,
  type Cue,
  type SpeakerRole,
} from '@toolkit/echo-domain-v2';

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
  /** ECHO domain v2 learner turns, migrated from entries when loading legacy sessions. */
  conversationTurns?: ConversationTurn[];
  /** ECHO domain v2 cues shown during this session. */
  cues?: Cue[];
  /** ECHO domain v2 assist lifecycle records linked to cues and turns. */
  assistEpisodes?: AssistEpisode[];
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
  audioSource?: string;
  avgSilenceDurationMs?: number;
  selfResponseRate?: number;
  cueLatencyCount?: number;
  cueLatencyP50Ms?: number | null;
  cueLatencyP95Ms?: number | null;
  cueLatencyMaxMs?: number | null;
  manualCueRequestCount?: number;
  autoCueTriggerCount?: number;
  cueDismissedCount?: number;
  falseTriggerCount?: number;
  cueUsedCount?: number;
  autoAssistPaused?: boolean;
  vadSpeechThreshold?: number;
  vadNoiseFloorRms?: number;
  vadSpeechFloorRms?: number;
  vadCalibratedAt?: number;
}

export interface TranscriptStoreOptions {
  saveRawTranscript?: boolean;
  retentionPolicy?: TranscriptRetentionPolicy;
  now?: () => number;
  defaultTurnSource?: ConversationTurnSource;
  defaultLanguage?: string;
  idFactory?: () => string;
}

export interface AddConversationTurnInput {
  speaker?: SpeakerRole;
  transcript: string;
  startedAt?: number;
  endedAt?: number;
  source?: ConversationTurnSource;
  language?: string;
  translationKo?: string;
  confidence?: number;
  isFinal?: boolean;
  correctedByUser?: boolean;
  piiFlags?: string[];
}

export type ConversationTurnUpdate = Partial<Pick<
  ConversationTurn,
  'speaker' |
  'translationKo' |
  'confidence' |
  'correctedByUser' |
  'language' |
  'isFinal' |
  'piiFlags'
>>;

export type SessionEventTelemetry = Omit<
  Partial<SessionEventAnalytics>,
  | 'sessionId'
  | 'startTime'
  | 'endTime'
  | 'week'
  | 'topic'
  | 'category'
  | 'speechCount'
  | 'hintCount'
  | 'silenceCount'
  | 'hintUsedCount'
  | 'hintMissedCount'
  | 'hintSimplifiedCount'
  | 'rawTranscriptSaved'
>;

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
  private readonly defaultTurnSource: ConversationTurnSource;
  private readonly defaultLanguage: string;
  private readonly idFactory: () => string;
  private eventTelemetry: SessionEventTelemetry = {};

  constructor(
    week: number,
    topic: string,
    category: string,
    options: TranscriptStoreOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.saveRawTranscript = options.saveRawTranscript === true;
    this.retentionPolicy = options.retentionPolicy ?? 'immediate';
    this.defaultTurnSource = options.defaultTurnSource ?? 'g2';
    this.defaultLanguage = options.defaultLanguage ?? 'en-US';
    this.idFactory = options.idFactory ?? createTurnId;

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
      conversationTurns: [],
      cues: [],
      assistEpisodes: [],
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

  addSpeech(text: string, source: TranscriptEntry['source'] = 'speech_api', isFinal = true): ConversationTurn | null {
    if (!text.trim()) return null;
    return this.addEntry({
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

  addConversationTurn(input: AddConversationTurnInput): ConversationTurn | null {
    const text = input.transcript.trim();
    if (!text) return null;
    const startedAt = coerceTimestamp(input.startedAt, this.now());
    const turn: ConversationTurn = {
      schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
      id: this.idFactory(),
      sessionId: this.session.sessionId,
      speaker: input.speaker ?? 'unknown',
      startedAt,
      endedAt: coerceTimestamp(input.endedAt, startedAt),
      source: input.source ?? this.defaultTurnSource,
      language: input.language ?? this.defaultLanguage,
      transcript: text,
      translationKo: cleanOptionalPlainText(input.translationKo, 1000),
      confidence: input.confidence,
      isFinal: input.isFinal ?? true,
      correctedByUser: input.correctedByUser,
      piiFlags: input.piiFlags ?? [],
    };

    if (!isConversationTurn(turn)) return null;
    this.session.conversationTurns ??= [];
    this.session.conversationTurns.push(turn);
    this.flush();
    return turn;
  }

  addCue(cue: Cue): Cue | null {
    if (!isCue(cue)) return null;
    this.session.cues ??= [];
    const existingIndex = this.session.cues.findIndex((entry) => entry.cueId === cue.cueId);
    if (existingIndex >= 0) {
      this.session.cues[existingIndex] = cue;
    } else {
      this.session.cues.push(cue);
    }
    this.flush();
    return cue;
  }

  addAssistEpisode(episode: AssistEpisode): AssistEpisode | null {
    if (!isAssistEpisode(episode)) return null;
    this.session.assistEpisodes ??= [];
    const existingIndex = this.session.assistEpisodes.findIndex((entry) => entry.id === episode.id);
    if (existingIndex >= 0) {
      this.session.assistEpisodes[existingIndex] = episode;
    } else {
      this.session.assistEpisodes.push(episode);
    }
    this.flush();
    return episode;
  }

  updateAssistEpisode(
    episodeId: string,
    patch: Partial<AssistEpisode>,
  ): AssistEpisode | null {
    const episodes = this.session.assistEpisodes ?? [];
    const existingIndex = episodes.findIndex((episode) => episode.id === episodeId);
    if (existingIndex < 0) return null;

    const updated = {
      ...episodes[existingIndex],
      ...patch,
    };

    if (!isAssistEpisode(updated)) return null;
    episodes[existingIndex] = updated;
    this.session.assistEpisodes = episodes;
    this.flush();
    return updated;
  }

  getLatestConversationTurnId(): string | null {
    const turns = this.session.conversationTurns ?? [];
    return turns[turns.length - 1]?.id ?? null;
  }

  updateConversationTurn(
    turnId: string,
    patch: ConversationTurnUpdate,
  ): ConversationTurn | null {
    const turns = this.session.conversationTurns ?? [];
    const index = turns.findIndex((turn) => turn.id === turnId);
    if (index < 0) return null;

    const updated = applyConversationTurnUpdate(turns[index]!, patch);
    if (!updated) return null;
    turns[index] = updated;
    this.session.conversationTurns = turns;
    this.flush();
    return updated;
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

  setSessionEventTelemetry(telemetry: SessionEventTelemetry): void {
    this.eventTelemetry = {
      ...this.eventTelemetry,
      ...telemetry,
    };
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

  private addEntry(entry: TranscriptEntry): ConversationTurn | null {
    this.session.entries.push(entry);
    let turn: ConversationTurn | null = null;
    if (entry.type === 'user_speech') {
      this.session.conversationTurns ??= [];
      turn = createConversationTurnFromEntry(
        this.session,
        entry,
        this.idFactory(),
        this.defaultTurnSource,
        this.defaultLanguage,
      );
      this.session.conversationTurns.push(turn);
    }
    this.flush();
    return turn;
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
      this.eventTelemetry,
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
      return Array.isArray(parsed) ? parsed.map(normalizeSessionTranscript) : [];
    } catch {
      return [];
    }
  }

  static getById(sessionId: string): SessionTranscript | null {
    const all = TranscriptStore.loadAll();
    return all.find((s) => s.sessionId === sessionId) ?? null;
  }

  static updateConversationTurn(
    sessionId: string,
    turnId: string,
    patch: ConversationTurnUpdate,
  ): ConversationTurn | null {
    const all = TranscriptStore.loadAll();
    const sessionIndex = all.findIndex((session) => session.sessionId === sessionId);
    if (sessionIndex < 0) return null;

    const session = all[sessionIndex]!;
    const turns = getConversationTurns(session);
    const turnIndex = turns.findIndex((turn) => turn.id === turnId);
    if (turnIndex < 0) return null;

    const updated = applyConversationTurnUpdate(turns[turnIndex]!, patch);
    if (!updated) return null;

    turns[turnIndex] = updated;
    all[sessionIndex] = {
      ...session,
      conversationTurns: turns,
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
      return null;
    }

    return updated;
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
      return normalizeSessionTranscript(JSON.parse(raw));
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

export function getConversationTurns(session: SessionTranscript): ConversationTurn[] {
  return normalizeSessionTranscript(session).conversationTurns ?? [];
}

export function getCues(session: SessionTranscript): Cue[] {
  return normalizeSessionTranscript(session).cues ?? [];
}

export function getAssistEpisodes(session: SessionTranscript): AssistEpisode[] {
  return normalizeSessionTranscript(session).assistEpisodes ?? [];
}

function normalizeSessionTranscript(value: unknown): SessionTranscript {
  const record = isRecord(value) ? value : {};
  const startTime = coerceTimestamp(record.startTime, Date.now());
  const session: SessionTranscript = {
    sessionId: coerceString(record.sessionId, `legacy-${startTime}`),
    startTime,
    endTime: coerceTimestamp(record.endTime, 0),
    week: coerceNumber(record.week, 1),
    topic: coerceString(record.topic, 'Legacy session'),
    category: coerceString(record.category, 'general'),
    entries: Array.isArray(record.entries)
      ? record.entries.filter(isTranscriptEntry)
      : [],
    hintUsageStats: isHintUsageStats(record.hintUsageStats)
      ? record.hintUsageStats
      : undefined,
    savedWithConsent: typeof record.savedWithConsent === 'boolean'
      ? record.savedWithConsent
      : undefined,
    retentionPolicy: isTranscriptRetentionPolicy(record.retentionPolicy)
      ? record.retentionPolicy
      : undefined,
  };
  session.conversationTurns = normalizeConversationTurns(record.conversationTurns, session);
  session.cues = normalizeCues(record.cues);
  session.assistEpisodes = normalizeAssistEpisodes(record.assistEpisodes);
  return session;
}

function normalizeConversationTurns(value: unknown, session: SessionTranscript): ConversationTurn[] {
  const storedTurns = Array.isArray(value)
    ? value.filter(isConversationTurn)
    : [];

  if (storedTurns.length > 0) {
    return storedTurns.slice().sort((a, b) => a.startedAt - b.startedAt);
  }

  return session.entries
    .filter((entry) => entry.type === 'user_speech' && entry.text.trim())
    .map((entry, index) => createConversationTurnFromEntry(
      session,
      entry,
      `${session.sessionId}:turn:${index + 1}`,
      'g2',
      'en-US',
    ));
}

function applyConversationTurnUpdate(
  turn: ConversationTurn,
  patch: ConversationTurnUpdate,
): ConversationTurn | null {
  const updated: ConversationTurn = {
    ...turn,
  };

  if (patch.speaker !== undefined) updated.speaker = patch.speaker;
  if (patch.language !== undefined) updated.language = patch.language;
  if (patch.confidence !== undefined) updated.confidence = patch.confidence;
  if (patch.correctedByUser !== undefined) updated.correctedByUser = patch.correctedByUser;
  if (patch.isFinal !== undefined) updated.isFinal = patch.isFinal;
  if (patch.piiFlags !== undefined) updated.piiFlags = patch.piiFlags;
  if (patch.translationKo !== undefined) {
    const translationKo = cleanOptionalPlainText(patch.translationKo, 1000);
    if (translationKo) {
      updated.translationKo = translationKo;
    } else {
      delete updated.translationKo;
    }
  }

  if (!isConversationTurn(updated)) return null;
  return updated;
}

function normalizeCues(value: unknown): Cue[] {
  return Array.isArray(value) ? value.filter(isCue) : [];
}

function normalizeAssistEpisodes(value: unknown): AssistEpisode[] {
  return Array.isArray(value) ? value.filter(isAssistEpisode) : [];
}

function createConversationTurnFromEntry(
  session: SessionTranscript,
  entry: TranscriptEntry,
  id: string,
  source: ConversationTurnSource,
  language: string,
): ConversationTurn {
  const timestamp = coerceTimestamp(entry.t, session.startTime);
  return {
    schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
    id,
    sessionId: session.sessionId,
    speaker: 'learner',
    startedAt: timestamp,
    endedAt: timestamp,
    source,
    language,
    transcript: entry.text.trim(),
    isFinal: entry.isFinal ?? true,
    piiFlags: [],
  };
}

function createTurnId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function coerceString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function coerceNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function coerceTimestamp(value: unknown, fallback: number): number {
  const timestamp = coerceNumber(value, fallback);
  return timestamp >= 0 ? timestamp : fallback;
}

function cleanOptionalPlainText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return cleaned || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTranscriptEntry(value: unknown): value is TranscriptEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.t === 'number' &&
    Number.isFinite(value.t) &&
    typeof value.type === 'string' &&
    [
      'user_speech',
      'hint_given',
      'silence_event',
      'hint_used',
      'hint_missed',
      'hint_simplified',
    ].includes(value.type) &&
    typeof value.text === 'string'
  );
}

function isHintUsageStats(value: unknown): value is HintUsageStats {
  if (!isRecord(value)) return false;
  return (
    typeof value.total === 'number' &&
    typeof value.used === 'number' &&
    typeof value.missed === 'number' &&
    typeof value.simplified === 'number' &&
    typeof value.successRate === 'number' &&
    Array.isArray(value.difficultyProgression) &&
    typeof value.recommendedNextDifficulty === 'number'
  );
}

function isTranscriptRetentionPolicy(value: unknown): value is TranscriptRetentionPolicy {
  return value === 'immediate' || value === '1d' || value === '7d' || value === 'until_deleted';
}

function buildEventAnalytics(
  session: SessionTranscript,
  rawTranscriptSaved: boolean,
  telemetry: SessionEventTelemetry = {},
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
    ...telemetry,
  };
}
