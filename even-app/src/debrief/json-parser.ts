/**
 * JSON Parser — Phase 3 Debrief data ingestion.
 *
 * Parses the FSI-standard JSON report from PC Gemini
 * and stores it in IndexedDB for ambient scheduling.
 */

import { set, get } from 'idb-keyval';

// ── Types ──

export interface BottleneckChunk {
  target: string;          // e.g. "depends on the situation"
  interval: number[];      // [10, 60, 240] minutes
}

export interface DebriefReport {
  session_date: string;
  fsi_stress_level: 'Low' | 'Medium' | 'High';
  bottleneck_chunks: BottleneckChunk[];
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
}

const DEBRIEF_STORE_KEY = 'echo_debriefs';
const MAX_RAW_DEBRIEF_CHARS = 200_000;
const MAX_SESSION_DATE_CHARS = 64;
const MAX_BOTTLENECK_CHUNKS = 100;
const MAX_TARGET_CHARS = 240;
const MAX_INTERVALS_PER_CHUNK = 12;
const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
const HTML_TAG_PATTERN = /<[a-z][\s\S]*>/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const URL_SCHEME_PATTERN = /\b(?:javascript|data|vbscript):/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_PATTERN = /(?:\+?\d[\s().-]*){7,}\d/;

// ── Parsing ──

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

  // Validate required fields
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

  return {
    session_date: sessionDate,
    fsi_stress_level: obj.fsi_stress_level as 'Low' | 'Medium' | 'High',
    bottleneck_chunks: chunks,
  };
}

function parseSafeText(value: string, field: string, maxLength: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  const rejectsDirectIdentifiers = field !== 'session_date';
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

// ── Storage ──

/**
 * Generate scheduled push times from a debrief report.
 * Intervals are in minutes from now.
 */
function generateSchedule(report: DebriefReport): ScheduledPush[] {
  const now = Date.now();
  const pushes: ScheduledPush[] = [];

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

  return stored;
}

/**
 * Get all stored debriefs from IndexedDB.
 */
export async function getStoredDebriefs(): Promise<StoredDebrief[]> {
  const data = await get<StoredDebrief[]>(DEBRIEF_STORE_KEY);
  return data ?? [];
}

/**
 * Mark a scheduled push as completed.
 */
export async function markPushCompleted(
  debriefIndex: number,
  pushIndex: number,
): Promise<void> {
  const debriefs = await getStoredDebriefs();
  if (debriefs[debriefIndex]?.scheduledPushes[pushIndex]) {
    debriefs[debriefIndex]!.scheduledPushes[pushIndex]!.pushed = true;
    await set(DEBRIEF_STORE_KEY, debriefs);
  }
}
