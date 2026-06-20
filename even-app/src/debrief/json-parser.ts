/**
 * Review JSON parser for Project ECHO debrief imports.
 *
 * The primary path is schema-versioned ECHO review items. Older FSI-style
 * reports are accepted only as a compatibility migration path into LearningItem
 * records.
 */

import { set, get } from 'idb-keyval';
import {
  ECHO_DOMAIN_V2_SCHEMA_VERSION,
  isLearningItem,
  type LearningItem,
} from '@toolkit/echo-domain-v2';

// Types

export interface BottleneckChunk {
  target: string;          // review phrase; legacy reports use this as bottleneck target
  interval: number[];      // legacy fixed interval minutes; v2 imports leave this empty
}

export type DebriefImportKind = 'legacy_debrief' | 'echo_review_items';

export interface DebriefReport {
  schemaVersion: typeof ECHO_DOMAIN_V2_SCHEMA_VERSION;
  importKind: DebriefImportKind;
  session_date: string;
  fsi_stress_level?: 'Low' | 'Medium' | 'High';
  bottleneck_chunks: BottleneckChunk[];
  learningItems: LearningItem[];
}

export interface StoredDebrief {
  report: DebriefReport;
  importedAt: number;
  scheduledPushes: ScheduledPush[];
}

export interface ScheduledPush {
  chunk: string;
  scheduledTime: number; // epoch ms
  pushed: boolean;
  learningItemId?: string;
}

export function getDebriefImportSourceLabel(report: Pick<DebriefReport, 'importKind'>): string {
  return report.importKind === 'echo_review_items' ? 'ECHO Review Items' : 'Legacy FSI Import';
}

const DEBRIEF_STORE_KEY = 'echo_debriefs';
const IMPORTED_LEARNING_ITEMS_STORAGE_KEY = 'echo_imported_learning_items_v1';
const MAX_RAW_DEBRIEF_CHARS = 200_000;
const MAX_SESSION_DATE_CHARS = 64;
const MAX_BOTTLENECK_CHUNKS = 100;
const MAX_TARGET_CHARS = 240;
const MAX_IMPORTED_LEARNING_ITEMS = 100;
const MAX_INTERVALS_PER_CHUNK = 12;
const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
const HTML_TAG_PATTERN = /<[a-z][\s\S]*>/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const URL_SCHEME_PATTERN = /\b(?:javascript|data|vbscript):/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_PATTERN = /(?:\+?\d[\s().-]*){7,}\d/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SPEECH_ACTS = ['answer', 'clarify', 'ask_repeat', 'buy_time', 'repair'] as const;
const BREAKDOWN_TYPES = [
  'recall_gap',
  'listening_gap',
  'grammar',
  'word_choice',
  'pronunciation',
  'turn_taking',
] as const;

// Parsing

/**
 * Parse a raw JSON string into a validated DebriefReport.
 * Throws on invalid format.
 */
export function parseDebriefJSON(raw: string): DebriefReport {
  if (raw.length > MAX_RAW_DEBRIEF_CHARS) {
    throw new Error('Debrief JSON is too large.');
  }

  const trimmed = raw.trim();

  // Handle markdown code blocks
  const jsonStr = trimmed
    .replace(/^```json?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Invalid JSON format. Please paste the exact JSON from the PC session.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON must be an object.');
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.schemaVersion === ECHO_DOMAIN_V2_SCHEMA_VERSION || obj.importKind === 'echo_review_items') {
    return parseEchoReviewImport(obj);
  }

  // Validate legacy required fields and migrate them into ECHO review items.
  if (typeof obj.session_date !== 'string') {
    throw new Error('Missing or invalid "session_date" field.');
  }
  const sessionDate = parseSafeText(obj.session_date, 'session_date', MAX_SESSION_DATE_CHARS);

  const validLevels = ['Low', 'Medium', 'High'];
  if (!validLevels.includes(obj.fsi_stress_level as string)) {
    throw new Error('Invalid "fsi_stress_level". Must be Low, Medium, or High.');
  }

  if (!Array.isArray(obj.bottleneck_chunks)) {
    throw new Error('Missing or invalid "bottleneck_chunks" array.');
  }
  if (obj.bottleneck_chunks.length > MAX_BOTTLENECK_CHUNKS) {
    throw new Error(`Too many bottleneck_chunks. Maximum is ${MAX_BOTTLENECK_CHUNKS}.`);
  }

  const chunks: BottleneckChunk[] = [];
  for (const item of obj.bottleneck_chunks) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    if (typeof c.target !== 'string') continue;
    if (!Array.isArray(c.interval)) continue;
    const target = parseSafeText(c.target, 'bottleneck_chunks.target', MAX_TARGET_CHARS);
    if (c.interval.length > MAX_INTERVALS_PER_CHUNK) {
      throw new Error(`Too many intervals for bottleneck chunk. Maximum is ${MAX_INTERVALS_PER_CHUNK}.`);
    }

    const intervals = c.interval.filter((n): n is number => (
      typeof n === 'number'
      && Number.isFinite(n)
      && Number.isInteger(n)
      && n > 0
      && n <= MAX_INTERVAL_MINUTES
    ));

    if (intervals.length === 0) continue;

    chunks.push({
      target,
      interval: intervals,
    });
  }

  if (chunks.length === 0) {
    throw new Error('No valid bottleneck_chunks found.');
  }

  const learningItems = chunks.map((chunk, index) => createLegacyLearningItem(sessionDate, chunk, index));

  return {
    schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
    importKind: 'legacy_debrief',
    session_date: sessionDate,
    fsi_stress_level: obj.fsi_stress_level as 'Low' | 'Medium' | 'High',
    bottleneck_chunks: chunks,
    learningItems,
  };
}

function parseEchoReviewImport(obj: Record<string, unknown>): DebriefReport {
  if (obj.schemaVersion !== ECHO_DOMAIN_V2_SCHEMA_VERSION) {
    throw new Error(`Invalid "schemaVersion". Must be ${ECHO_DOMAIN_V2_SCHEMA_VERSION}.`);
  }
  if (obj.importKind !== 'echo_review_items') {
    throw new Error('Invalid "importKind". Must be echo_review_items.');
  }

  const sessionDate = typeof obj.session_date === 'string'
    ? parseSafeText(obj.session_date, 'session_date', MAX_SESSION_DATE_CHARS)
    : typeof obj.sessionDate === 'string'
      ? parseSafeText(obj.sessionDate, 'sessionDate', MAX_SESSION_DATE_CHARS)
      : new Date().toISOString().slice(0, 10);

  const rawItems = Array.isArray(obj.learningItems)
    ? obj.learningItems
    : Array.isArray(obj.items)
      ? obj.items
      : null;
  if (!rawItems) {
    throw new Error('Missing or invalid "learningItems" array.');
  }
  if (rawItems.length === 0) {
    throw new Error('No learningItems found.');
  }
  if (rawItems.length > MAX_IMPORTED_LEARNING_ITEMS) {
    throw new Error(`Too many learningItems. Maximum is ${MAX_IMPORTED_LEARNING_ITEMS}.`);
  }

  const learningItems = rawItems.map((item, index) => normalizeImportedLearningItem(item, sessionDate, index));
  const bottleneckChunks = learningItems.map((item) => ({
    target: item.canonicalExpression,
    interval: [],
  }));

  return {
    schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
    importKind: 'echo_review_items',
    session_date: sessionDate,
    bottleneck_chunks: bottleneckChunks,
    learningItems,
  };
}

function parseSafeText(value: string, field: string, maxLength: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  const rejectsDirectIdentifiers = field !== 'session_date' && field !== 'sessionDate';
  if (!text) {
    throw new Error(`Missing or invalid "${field}" field.`);
  }
  if (text.length > maxLength) {
    throw new Error(`"${field}" is too long. Maximum is ${maxLength} characters.`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(text)) {
    throw new Error(`"${field}" must not contain control characters.`);
  }
  if (HTML_TAG_PATTERN.test(text)) {
    throw new Error(`"${field}" must not contain HTML tags.`);
  }
  if (URL_SCHEME_PATTERN.test(text)) {
    throw new Error(`"${field}" must not contain executable URL schemes.`);
  }
  if (rejectsDirectIdentifiers && (EMAIL_PATTERN.test(text) || PHONE_PATTERN.test(text))) {
    throw new Error(`"${field}" must not contain direct contact identifiers.`);
  }
  return text;
}

function normalizeImportedLearningItem(value: unknown, sessionDate: string, index: number): LearningItem {
  const record = requireRecord(value, 'learningItems.item');

  if (record.schemaVersion === ECHO_DOMAIN_V2_SCHEMA_VERSION) {
    if (!isLearningItem(record)) {
      throw new Error(`Invalid learningItems[${index}] domain item.`);
    }
    assertStableId(record.id, `learningItems[${index}].id`);
    assertLearningItemSafeText(record, index);
    return record;
  }

  const id = parseStableId(record.id, `learningItems[${index}].id`);
  const canonicalExpression = parseSafeTextField(
    record.canonicalExpression,
    `learningItems[${index}].canonicalExpression`,
    MAX_TARGET_CHARS,
  );
  const meaningKo = parseSafeTextField(record.meaningKo, `learningItems[${index}].meaningKo`, 400);
  const speechAct = parseEnumField(record.speechAct, SPEECH_ACTS, 'answer', `learningItems[${index}].speechAct`);
  const breakdownType = parseEnumField(
    record.breakdownType,
    BREAKDOWN_TYPES,
    'recall_gap',
    `learningItems[${index}].breakdownType`,
  );
  const scenarioTags = parseSafeTextArray(
    record.scenarioTags,
    `learningItems[${index}].scenarioTags`,
    ['imported review'],
    8,
    160,
  );
  const naturalRecast = typeof record.naturalRecast === 'string'
    ? parseSafeText(record.naturalRecast, `learningItems[${index}].naturalRecast`, 1000)
    : undefined;
  const dueAt = parseDueAt(record.dueAt ?? record.nextReviewAt, `learningItems[${index}].dueAt`);
  const sourceTurnIds = parseSafeIdArray(
    record.sourceTurnIds,
    `learningItems[${index}].sourceTurnIds`,
    [`${id}:import`],
  );
  const item: LearningItem = {
    schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
    id,
    canonicalExpression,
    meaningKo,
    speechAct,
    scenarioTags,
    breakdownType,
    sourceTurnIds,
    naturalRecast,
    cueLevelUsed: 0,
    lastOutcome: 'failed',
    examples: [
      {
        id: `${id}:example:1`,
        scenarioTag: scenarioTags[0] ?? 'imported review',
        learnerTurn: typeof record.userAttempt === 'string'
          ? parseSafeText(record.userAttempt, `learningItems[${index}].userAttempt`, 1000)
          : 'Imported review item.',
        meaningKo,
        targetExpression: canonicalExpression,
        sourceTurnIds,
      },
    ],
    scheduling: {
      reps: 0,
      lapses: 0,
      difficulty: 0.6,
      stability: 0.2,
      dueAt,
    },
  };

  if (!isLearningItem(item)) {
    throw new Error(`Invalid normalized learningItems[${index}] record.`);
  }

  return item;
}

function createLegacyLearningItem(sessionDate: string, chunk: BottleneckChunk, index: number): LearningItem {
  const id = cleanImportId(`legacy:${sessionDate}:${index + 1}:${chunk.target}`);
  const sourceTurnIds = [`${id}:import`];
  const item: LearningItem = {
    schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
    id,
    canonicalExpression: chunk.target,
    meaningKo: `Imported review phrase ${index + 1}. Recall the English expression before reveal.`,
    speechAct: 'answer',
    scenarioTags: ['legacy review import'],
    breakdownType: 'recall_gap',
    sourceTurnIds,
    naturalRecast: chunk.target,
    cueLevelUsed: 0,
    lastOutcome: 'failed',
    examples: [
      {
        id: `${id}:example:1`,
        scenarioTag: 'legacy review import',
        learnerTurn: 'Imported review item.',
        meaningKo: `Imported review phrase ${index + 1}.`,
        targetExpression: chunk.target,
        sourceTurnIds,
      },
    ],
    scheduling: {
      reps: 0,
      lapses: 0,
      difficulty: 0.7,
      stability: 0.2,
      dueAt: new Date().toISOString(),
    },
  };

  if (!isLearningItem(item)) {
    throw new Error(`Could not migrate bottleneck_chunks[${index}] into a learning item.`);
  }
  return item;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Missing or invalid "${field}" object.`);
  }
  return value as Record<string, unknown>;
}

function parseSafeTextField(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new Error(`Missing or invalid "${field}" field.`);
  }
  return parseSafeText(value, field, maxLength);
}

function parseStableId(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Missing or invalid "${field}" field.`);
  }
  assertStableId(value, field);
  return value;
}

function assertStableId(value: string, field: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new Error(`"${field}" must be a stable ASCII id.`);
  }
}

function parseEnumField<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
  field: string,
): T[number] {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T[number];
  }
  throw new Error(`Invalid "${field}". Must be one of: ${allowed.join(', ')}.`);
}

function parseSafeTextArray(
  value: unknown,
  field: string,
  fallback: string[],
  maxItems: number,
  maxLength: number,
): string[] {
  if (value === undefined || value === null) return fallback;
  if (!Array.isArray(value)) {
    throw new Error(`Invalid "${field}". Must be an array.`);
  }
  if (value.length === 0) return fallback;
  if (value.length > maxItems) {
    throw new Error(`Too many ${field}. Maximum is ${maxItems}.`);
  }
  return value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(`Invalid "${field}[${index}]". Must be a string.`);
    }
    return parseSafeText(item, `${field}[${index}]`, maxLength);
  });
}

function parseSafeIdArray(value: unknown, field: string, fallback: string[]): string[] {
  if (value === undefined || value === null) return fallback;
  if (!Array.isArray(value)) {
    throw new Error(`Invalid "${field}". Must be an array.`);
  }
  if (value.length === 0) return fallback;
  if (value.length > 32) {
    throw new Error(`Too many ${field}. Maximum is 32.`);
  }
  return value.map((item, index) => parseStableId(item, `${field}[${index}]`));
}

function parseDueAt(value: unknown, field: string): string {
  if (value === undefined || value === null || value === '') {
    return new Date().toISOString();
  }
  if (typeof value !== 'string' || !ISO_DATETIME_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid "${field}". Must be an ISO-8601 UTC timestamp.`);
  }
  return value;
}

function assertLearningItemSafeText(item: LearningItem, index: number): void {
  parseSafeText(item.canonicalExpression, `learningItems[${index}].canonicalExpression`, MAX_TARGET_CHARS);
  parseSafeText(item.meaningKo, `learningItems[${index}].meaningKo`, 400);
  if (item.naturalRecast) parseSafeText(item.naturalRecast, `learningItems[${index}].naturalRecast`, 1000);
  if (item.userAttempt) parseSafeText(item.userAttempt, `learningItems[${index}].userAttempt`, 1000);
  item.scenarioTags.forEach((tag, tagIndex) => {
    parseSafeText(tag, `learningItems[${index}].scenarioTags[${tagIndex}]`, 160);
  });
  item.examples.forEach((example, exampleIndex) => {
    parseSafeText(example.scenarioTag, `learningItems[${index}].examples[${exampleIndex}].scenarioTag`, 120);
    parseSafeText(example.learnerTurn, `learningItems[${index}].examples[${exampleIndex}].learnerTurn`, 1000);
    parseSafeText(example.targetExpression, `learningItems[${index}].examples[${exampleIndex}].targetExpression`, 240);
    if (example.partnerTurn) {
      parseSafeText(example.partnerTurn, `learningItems[${index}].examples[${exampleIndex}].partnerTurn`, 1000);
    }
    if (example.meaningKo) {
      parseSafeText(example.meaningKo, `learningItems[${index}].examples[${exampleIndex}].meaningKo`, 1000);
    }
  });
}

function cleanImportId(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128);
  return ID_PATTERN.test(cleaned) ? cleaned : `imported:${Date.now()}`;
}

// Storage

/**
 * Generate scheduled push times from a debrief report.
 * ECHO v2 imports use item dueAt; legacy imports retain fixed interval pushes
 * only for compatibility with older reports.
 */
function generateSchedule(report: DebriefReport): ScheduledPush[] {
  const now = Date.now();
  const pushes: ScheduledPush[] = [];

  if (report.importKind === 'echo_review_items') {
    for (const item of report.learningItems) {
      const dueAt = Date.parse(item.scheduling.dueAt);
      pushes.push({
        chunk: item.canonicalExpression,
        scheduledTime: Number.isFinite(dueAt) ? dueAt : now,
        pushed: false,
        learningItemId: item.id,
      });
    }
    pushes.sort((a, b) => a.scheduledTime - b.scheduledTime);
    return pushes;
  }

  for (const chunk of report.bottleneck_chunks) {
    for (const intervalMinutes of chunk.interval) {
      pushes.push({
        chunk: chunk.target,
        scheduledTime: now + intervalMinutes * 60 * 1000,
        pushed: false,
      });
    }
  }

  // Sort by time
  pushes.sort((a, b) => a.scheduledTime - b.scheduledTime);
  return pushes;
}

/**
 * Import a debrief report: parse, generate schedule, store in IndexedDB.
 */
export async function importDebrief(raw: string): Promise<StoredDebrief> {
  const report = parseDebriefJSON(raw);
  const scheduledPushes = generateSchedule(report);

  const stored: StoredDebrief = {
    report,
    importedAt: Date.now(),
    scheduledPushes,
  };

  // Append to existing debriefs
  const existing = await getStoredDebriefs();
  existing.push(stored);
  await set(DEBRIEF_STORE_KEY, existing);
  saveImportedLearningItemsForRecall(report.learningItems);

  return stored;
}

/**
 * Get all stored debriefs from IndexedDB.
 */
export async function getStoredDebriefs(): Promise<StoredDebrief[]> {
  const data = await get<StoredDebrief[]>(DEBRIEF_STORE_KEY);
  return Array.isArray(data)
    ? data.map(normalizeStoredDebrief).filter((item): item is StoredDebrief => item !== null)
    : [];
}

export function loadImportedLearningItemsForRecall(): LearningItem[] {
  try {
    const raw = localStorage.getItem(IMPORTED_LEARNING_ITEMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isLearningItem) : [];
  } catch {
    return [];
  }
}

export function saveImportedLearningItemsForRecall(items: LearningItem[]): void {
  if (items.length === 0) return;
  try {
    const existing = loadImportedLearningItemsForRecall();
    const byId = new Map(existing.map((item) => [item.id, item]));
    for (const item of items) {
      if (isLearningItem(item)) byId.set(item.id, item);
    }
    localStorage.setItem(
      IMPORTED_LEARNING_ITEMS_STORAGE_KEY,
      JSON.stringify(Array.from(byId.values()).slice(-MAX_IMPORTED_LEARNING_ITEMS)),
    );
  } catch {
    // Imported review items remain available in IndexedDB even if localStorage is full or unavailable.
  }
}

export function clearImportedLearningItemsForRecall(): void {
  try {
    localStorage.removeItem(IMPORTED_LEARNING_ITEMS_STORAGE_KEY);
  } catch {
    // localStorage is best-effort.
  }
}

export function normalizeStoredDebrief(value: StoredDebrief): StoredDebrief | null {
  if (!value || typeof value !== 'object' || !value.report) return null;
  const report = value.report as DebriefReport;
  if (Array.isArray(report.learningItems) && report.schemaVersion === ECHO_DOMAIN_V2_SCHEMA_VERSION) {
    return normalizeCurrentSchemaStoredDebrief(value, report);
  }

  if (
    typeof report.session_date === 'string' &&
    Array.isArray(report.bottleneck_chunks)
  ) {
    return normalizeLegacyStoredDebrief(value, report);
  }

  return null;
}

function normalizeLegacyStoredDebrief(value: StoredDebrief, report: DebriefReport): StoredDebrief | null {
  try {
    const sessionDate = parseSafeText(report.session_date, 'session_date', MAX_SESSION_DATE_CHARS);
    const bottleneckChunks = normalizeStoredBottleneckChunks(report.bottleneck_chunks, [], 'legacy_debrief');
    if (bottleneckChunks.length === 0) return null;

    const learningItems = bottleneckChunks.map((chunk, index) => {
      const item = createLegacyLearningItem(sessionDate, chunk, index);
      assertLearningItemSafeText(item, index);
      return item;
    });
    const fsiStressLevel = normalizeFsiStressLevel(report.fsi_stress_level);
    const migratedReport: DebriefReport = {
      schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
      importKind: 'legacy_debrief',
      session_date: sessionDate,
      ...(fsiStressLevel ? { fsi_stress_level: fsiStressLevel } : {}),
      bottleneck_chunks: bottleneckChunks,
      learningItems,
    };
    return {
      ...value,
      report: migratedReport,
      scheduledPushes: normalizeStoredScheduledPushes(value.scheduledPushes, migratedReport),
    };
  } catch {
    return null;
  }
}

function normalizeCurrentSchemaStoredDebrief(value: StoredDebrief, report: DebriefReport): StoredDebrief | null {
  try {
    const importKind = report.importKind === 'legacy_debrief' || report.importKind === 'echo_review_items'
      ? report.importKind
      : null;
    if (!importKind) return null;

    const sessionDate = parseSafeText(report.session_date, 'session_date', MAX_SESSION_DATE_CHARS);
    const learningItems = report.learningItems.map((item, index) => {
      if (!isLearningItem(item)) {
        throw new Error(`Invalid stored learningItems[${index}] domain item.`);
      }
      assertLearningItemSafeText(item, index);
      return item;
    });
    if (learningItems.length === 0) return null;

    const bottleneckChunks = normalizeStoredBottleneckChunks(report.bottleneck_chunks, learningItems, importKind);
    const fsiStressLevel = normalizeFsiStressLevel(report.fsi_stress_level);
    const normalizedReport: DebriefReport = {
      schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
      importKind,
      session_date: sessionDate,
      ...(fsiStressLevel ? { fsi_stress_level: fsiStressLevel } : {}),
      bottleneck_chunks: bottleneckChunks,
      learningItems,
    };

    return {
      ...value,
      report: normalizedReport,
      scheduledPushes: normalizeStoredScheduledPushes(value.scheduledPushes, normalizedReport),
    };
  } catch {
    return null;
  }
}

function normalizeFsiStressLevel(value: unknown): 'Low' | 'Medium' | 'High' | undefined {
  if (value === 'Low' || value === 'Medium' || value === 'High') return value;
  return undefined;
}

function normalizeStoredBottleneckChunks(
  value: unknown,
  learningItems: LearningItem[],
  importKind: DebriefImportKind,
): BottleneckChunk[] {
  if (Array.isArray(value)) {
    const chunks = value.flatMap((chunk, index): BottleneckChunk[] => {
      if (!chunk || typeof chunk !== 'object') return [];
      const record = chunk as Record<string, unknown>;
      if (typeof record.target !== 'string') return [];
      const target = parseSafeText(record.target, `bottleneck_chunks[${index}].target`, MAX_TARGET_CHARS);
      const interval = Array.isArray(record.interval)
        ? record.interval.filter((entry): entry is number => (
          typeof entry === 'number'
          && Number.isInteger(entry)
          && entry > 0
          && entry <= MAX_INTERVAL_MINUTES
        )).slice(0, MAX_INTERVALS_PER_CHUNK)
        : [];
      return [{ target, interval: importKind === 'echo_review_items' ? [] : interval }];
    });
    if (chunks.length > 0) return chunks;
  }

  return learningItems.map((item) => ({
    target: item.canonicalExpression,
    interval: [],
  }));
}

function normalizeStoredScheduledPushes(value: unknown, report: DebriefReport): ScheduledPush[] {
  const existing = Array.isArray(value) ? value : [];
  return generateSchedule(report).map((push) => {
    const matched = existing.find((entry) => (
      entry
      && typeof entry === 'object'
      && (
        ('learningItemId' in entry && entry.learningItemId === push.learningItemId && push.learningItemId)
        || ('chunk' in entry && entry.chunk === push.chunk && entry.scheduledTime === push.scheduledTime)
      )
    ));
    return {
      ...push,
      pushed: matched && 'pushed' in matched ? matched.pushed === true : push.pushed,
    };
  });
}

/**
 * Mark a scheduled review reminder as delivered.
 *
 * This does not mark the learning item mastered; Active Recall attempts own
 * reveal, grading, and scheduling.
 */
export async function markPushDelivered(
  debriefIndex: number,
  pushIndex: number,
): Promise<void> {
  const debriefs = await getStoredDebriefs();
  if (debriefs[debriefIndex]?.scheduledPushes[pushIndex]) {
    debriefs[debriefIndex]!.scheduledPushes[pushIndex]!.pushed = true;
    await set(DEBRIEF_STORE_KEY, debriefs);
  }
}

export const markPushCompleted = markPushDelivered;
