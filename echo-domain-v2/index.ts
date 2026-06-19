export const ECHO_DOMAIN_V2_SCHEMA_VERSION = '2.0.0';
export const ECHO_DOMAIN_V2_SCHEMA_BASE_ID = 'https://even-toolkit.dev/schemas/echo-domain-v2';

export type SpeakerRole = 'learner' | 'partner' | 'unknown';
export type ConversationTurnSource = 'g2' | 'phone' | 'import';
export type AssistAction = 'none' | 'prefetch' | 'show';
export type AssistTrigger =
  | 'manual'
  | 'long_pause'
  | 'abandoned_utterance'
  | 'repeated_filler'
  | 'comprehension_breakdown';
export type CueLevel = 1 | 2 | 3;
export type CueLevelUsed = 0 | CueLevel;
export type SpeechAct = 'answer' | 'clarify' | 'ask_repeat' | 'buy_time' | 'repair';
export type AssistOutcome =
  | 'independent'
  | 'assisted_adapted'
  | 'assisted_exact'
  | 'partial'
  | 'failed';
export type LearningOutcome = 'independent' | 'assisted' | 'failed';
export type BreakdownType =
  | 'recall_gap'
  | 'listening_gap'
  | 'grammar'
  | 'word_choice'
  | 'pronunciation'
  | 'turn_taking';

export interface ConversationTurn {
  schemaVersion: typeof ECHO_DOMAIN_V2_SCHEMA_VERSION;
  id: string;
  sessionId: string;
  speaker: SpeakerRole;
  startedAt: number;
  endedAt: number;
  source: ConversationTurnSource;
  language: string;
  transcript: string;
  translationKo?: string;
  confidence?: number;
  isFinal: boolean;
  correctedByUser?: boolean;
  piiFlags?: string[];
}

export interface AssistDecision {
  action: AssistAction;
  confidence: number;
  trigger: AssistTrigger;
  maxCueLevel: CueLevel;
}

export interface Cue {
  schemaVersion: typeof ECHO_DOMAIN_V2_SCHEMA_VERSION;
  cueId: string;
  speechAct: SpeechAct;
  level: CueLevel;
  phrase: string;
  meaningKo: string;
  alternatives: string[];
  expiresAfterMs: number;
  targetTurnId: string;
}

export interface AssistEpisode {
  schemaVersion: typeof ECHO_DOMAIN_V2_SCHEMA_VERSION;
  id: string;
  sessionId: string;
  targetTurnId: string;
  trigger: AssistTrigger;
  decision: AssistDecision;
  cueId?: string;
  cueLevelUsed: CueLevelUsed;
  speechAct?: SpeechAct;
  requestedAt: number;
  shownAt?: number;
  acknowledgedAt?: number;
  resolvedAt?: number;
  outcome: AssistOutcome;
  userAttempt?: string;
  acceptedPhrase?: string;
  latencyMs?: number;
}

export interface DialogueExample {
  id: string;
  scenarioTag: string;
  partnerTurn?: string;
  learnerTurn: string;
  meaningKo?: string;
  targetExpression: string;
  sourceTurnIds: string[];
}

export interface LearningItem {
  schemaVersion: typeof ECHO_DOMAIN_V2_SCHEMA_VERSION;
  id: string;
  canonicalExpression: string;
  meaningKo: string;
  speechAct: SpeechAct;
  scenarioTags: string[];
  breakdownType: BreakdownType;
  sourceTurnIds: string[];
  userAttempt?: string;
  naturalRecast?: string;
  cueLevelUsed: CueLevelUsed;
  lastOutcome: LearningOutcome;
  examples: DialogueExample[];
  scheduling: {
    reps: number;
    lapses: number;
    difficulty: number;
    stability: number;
    dueAt: string;
  };
}

export interface LearnerProfileMetricSet {
  conversationRecoveryRate?: number;
  independentTransferRate?: number;
  assistedExactRate?: number;
  activeRecallDueCount?: number;
  totalSessions?: number;
}

export interface LearnerAbilityVector {
  recall: number;
  listening: number;
  grammar: number;
  wordChoice: number;
  pronunciation: number;
  turnTaking: number;
}

export interface LearnerProfile {
  schemaVersion: typeof ECHO_DOMAIN_V2_SCHEMA_VERSION;
  id: string;
  learnerId: string;
  createdAt: string;
  updatedAt: string;
  profileLocale: string;
  targetLanguage: string;
  privacyMode: 'local_only' | 'server_synced';
  metrics: LearnerProfileMetricSet;
  ability: LearnerAbilityVector;
  learningItems: LearningItem[];
  recentAssistEpisodeIds: string[];
}

export interface JsonSchema {
  readonly [key: string]: unknown;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const HTML_TAG_PATTERN = /<[a-z][\s\S]*>/i;
const ISO_DATETIME_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$';

const speakerRoles = ['learner', 'partner', 'unknown'] as const;
const turnSources = ['g2', 'phone', 'import'] as const;
const assistActions = ['none', 'prefetch', 'show'] as const;
const assistTriggers = [
  'manual',
  'long_pause',
  'abandoned_utterance',
  'repeated_filler',
  'comprehension_breakdown',
] as const;
const cueLevels = [1, 2, 3] as const;
const cueLevelsUsed = [0, 1, 2, 3] as const;
const speechActs = ['answer', 'clarify', 'ask_repeat', 'buy_time', 'repair'] as const;
const assistOutcomes = ['independent', 'assisted_adapted', 'assisted_exact', 'partial', 'failed'] as const;
const learningOutcomes = ['independent', 'assisted', 'failed'] as const;
const breakdownTypes = [
  'recall_gap',
  'listening_gap',
  'grammar',
  'word_choice',
  'pronunciation',
  'turn_taking',
] as const;
const assistDecisionFields = ['action', 'confidence', 'trigger', 'maxCueLevel'] as const;
const conversationTurnFields = [
  'schemaVersion',
  'id',
  'sessionId',
  'speaker',
  'startedAt',
  'endedAt',
  'source',
  'language',
  'transcript',
  'translationKo',
  'confidence',
  'isFinal',
  'correctedByUser',
  'piiFlags',
] as const;
const cueFields = [
  'schemaVersion',
  'cueId',
  'speechAct',
  'level',
  'phrase',
  'meaningKo',
  'alternatives',
  'expiresAfterMs',
  'targetTurnId',
] as const;
const assistEpisodeFields = [
  'schemaVersion',
  'id',
  'sessionId',
  'targetTurnId',
  'trigger',
  'decision',
  'cueId',
  'cueLevelUsed',
  'speechAct',
  'requestedAt',
  'shownAt',
  'acknowledgedAt',
  'resolvedAt',
  'outcome',
  'userAttempt',
  'acceptedPhrase',
  'latencyMs',
] as const;
const dialogueExampleFields = [
  'id',
  'scenarioTag',
  'partnerTurn',
  'learnerTurn',
  'meaningKo',
  'targetExpression',
  'sourceTurnIds',
] as const;
const learningItemFields = [
  'schemaVersion',
  'id',
  'canonicalExpression',
  'meaningKo',
  'speechAct',
  'scenarioTags',
  'breakdownType',
  'sourceTurnIds',
  'userAttempt',
  'naturalRecast',
  'cueLevelUsed',
  'lastOutcome',
  'examples',
  'scheduling',
] as const;
const learningScheduleFields = ['reps', 'lapses', 'difficulty', 'stability', 'dueAt'] as const;
const learnerProfileFields = [
  'schemaVersion',
  'id',
  'learnerId',
  'createdAt',
  'updatedAt',
  'profileLocale',
  'targetLanguage',
  'privacyMode',
  'metrics',
  'ability',
  'learningItems',
  'recentAssistEpisodeIds',
] as const;
const learnerMetricFields = [
  'conversationRecoveryRate',
  'independentTransferRate',
  'assistedExactRate',
  'activeRecallDueCount',
  'totalSessions',
] as const;
const learnerAbilityFields = ['recall', 'listening', 'grammar', 'wordChoice', 'pronunciation', 'turnTaking'] as const;

function plainTextSchema(maxLength: number): JsonSchema {
  return {
    type: 'string',
    minLength: 1,
    maxLength,
    not: { pattern: HTML_TAG_PATTERN.source },
  };
}

function optionalPlainTextSchema(maxLength: number): JsonSchema {
  return {
    type: 'string',
    maxLength,
    not: { pattern: HTML_TAG_PATTERN.source },
  };
}

const schemaVersionProperty = { const: ECHO_DOMAIN_V2_SCHEMA_VERSION };
const idProperty = { type: 'string', minLength: 1, maxLength: 128 };
const timestampMsProperty = { type: 'number', minimum: 0 };
const scoreProperty = { type: 'number', minimum: 0, maximum: 1 };
const plainTextArrayProperty = {
  type: 'array',
  maxItems: 32,
  items: optionalPlainTextSchema(160),
};

export const conversationTurnSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${ECHO_DOMAIN_V2_SCHEMA_BASE_ID}/conversation-turn.schema.json`,
  title: 'ConversationTurn',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'sessionId',
    'speaker',
    'startedAt',
    'endedAt',
    'source',
    'language',
    'transcript',
    'isFinal',
  ],
  properties: {
    schemaVersion: schemaVersionProperty,
    id: idProperty,
    sessionId: idProperty,
    speaker: { enum: speakerRoles },
    startedAt: timestampMsProperty,
    endedAt: timestampMsProperty,
    source: { enum: turnSources },
    language: { type: 'string', minLength: 2, maxLength: 35 },
    transcript: plainTextSchema(4000),
    translationKo: optionalPlainTextSchema(4000),
    confidence: scoreProperty,
    isFinal: { type: 'boolean' },
    correctedByUser: { type: 'boolean' },
    piiFlags: plainTextArrayProperty,
  },
} as const satisfies JsonSchema;

export const assistDecisionSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${ECHO_DOMAIN_V2_SCHEMA_BASE_ID}/assist-decision.schema.json`,
  title: 'AssistDecision',
  type: 'object',
  additionalProperties: false,
  required: ['action', 'confidence', 'trigger', 'maxCueLevel'],
  properties: {
    action: { enum: assistActions },
    confidence: scoreProperty,
    trigger: { enum: assistTriggers },
    maxCueLevel: { enum: cueLevels },
  },
} as const satisfies JsonSchema;

export const cueSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${ECHO_DOMAIN_V2_SCHEMA_BASE_ID}/cue.schema.json`,
  title: 'Cue',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'cueId',
    'speechAct',
    'level',
    'phrase',
    'meaningKo',
    'alternatives',
    'expiresAfterMs',
    'targetTurnId',
  ],
  properties: {
    schemaVersion: schemaVersionProperty,
    cueId: idProperty,
    speechAct: { enum: speechActs },
    level: { enum: cueLevels },
    phrase: plainTextSchema(160),
    meaningKo: plainTextSchema(240),
    alternatives: plainTextArrayProperty,
    expiresAfterMs: { type: 'integer', minimum: 100, maximum: 30000 },
    targetTurnId: idProperty,
  },
} as const satisfies JsonSchema;

export const assistEpisodeSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${ECHO_DOMAIN_V2_SCHEMA_BASE_ID}/assist-episode.schema.json`,
  title: 'AssistEpisode',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'sessionId',
    'targetTurnId',
    'trigger',
    'decision',
    'cueLevelUsed',
    'requestedAt',
    'outcome',
  ],
  properties: {
    schemaVersion: schemaVersionProperty,
    id: idProperty,
    sessionId: idProperty,
    targetTurnId: idProperty,
    trigger: { enum: assistTriggers },
    decision: assistDecisionSchema,
    cueId: idProperty,
    cueLevelUsed: { enum: cueLevelsUsed },
    speechAct: { enum: speechActs },
    requestedAt: timestampMsProperty,
    shownAt: timestampMsProperty,
    acknowledgedAt: timestampMsProperty,
    resolvedAt: timestampMsProperty,
    outcome: { enum: assistOutcomes },
    userAttempt: optionalPlainTextSchema(4000),
    acceptedPhrase: optionalPlainTextSchema(240),
    latencyMs: { type: 'number', minimum: 0 },
  },
} as const satisfies JsonSchema;

export const dialogueExampleSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${ECHO_DOMAIN_V2_SCHEMA_BASE_ID}/dialogue-example.schema.json`,
  title: 'DialogueExample',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'scenarioTag', 'learnerTurn', 'targetExpression', 'sourceTurnIds'],
  properties: {
    id: idProperty,
    scenarioTag: plainTextSchema(120),
    partnerTurn: optionalPlainTextSchema(1000),
    learnerTurn: plainTextSchema(1000),
    meaningKo: optionalPlainTextSchema(1000),
    targetExpression: plainTextSchema(240),
    sourceTurnIds: plainTextArrayProperty,
  },
} as const satisfies JsonSchema;

export const learningItemSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${ECHO_DOMAIN_V2_SCHEMA_BASE_ID}/learning-item.schema.json`,
  title: 'LearningItem',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'canonicalExpression',
    'meaningKo',
    'speechAct',
    'scenarioTags',
    'breakdownType',
    'sourceTurnIds',
    'cueLevelUsed',
    'lastOutcome',
    'examples',
    'scheduling',
  ],
  properties: {
    schemaVersion: schemaVersionProperty,
    id: idProperty,
    canonicalExpression: plainTextSchema(240),
    meaningKo: plainTextSchema(400),
    speechAct: { enum: speechActs },
    scenarioTags: plainTextArrayProperty,
    breakdownType: { enum: breakdownTypes },
    sourceTurnIds: plainTextArrayProperty,
    userAttempt: optionalPlainTextSchema(1000),
    naturalRecast: optionalPlainTextSchema(1000),
    cueLevelUsed: { enum: cueLevelsUsed },
    lastOutcome: { enum: learningOutcomes },
    examples: {
      type: 'array',
      maxItems: 12,
      items: dialogueExampleSchema,
    },
    scheduling: {
      type: 'object',
      additionalProperties: false,
      required: ['reps', 'lapses', 'difficulty', 'stability', 'dueAt'],
      properties: {
        reps: { type: 'integer', minimum: 0 },
        lapses: { type: 'integer', minimum: 0 },
        difficulty: { type: 'number', minimum: 0, maximum: 1 },
        stability: { type: 'number', minimum: 0 },
        dueAt: { type: 'string', pattern: ISO_DATETIME_PATTERN },
      },
    },
  },
} as const satisfies JsonSchema;

export const learnerProfileSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `${ECHO_DOMAIN_V2_SCHEMA_BASE_ID}/learner-profile.schema.json`,
  title: 'LearnerProfile',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'learnerId',
    'createdAt',
    'updatedAt',
    'profileLocale',
    'targetLanguage',
    'privacyMode',
    'metrics',
    'ability',
    'learningItems',
    'recentAssistEpisodeIds',
  ],
  properties: {
    schemaVersion: schemaVersionProperty,
    id: idProperty,
    learnerId: idProperty,
    createdAt: { type: 'string', pattern: ISO_DATETIME_PATTERN },
    updatedAt: { type: 'string', pattern: ISO_DATETIME_PATTERN },
    profileLocale: { type: 'string', minLength: 2, maxLength: 35 },
    targetLanguage: { type: 'string', minLength: 2, maxLength: 35 },
    privacyMode: { enum: ['local_only', 'server_synced'] },
    metrics: {
      type: 'object',
      additionalProperties: false,
      properties: {
        conversationRecoveryRate: scoreProperty,
        independentTransferRate: scoreProperty,
        assistedExactRate: scoreProperty,
        activeRecallDueCount: { type: 'integer', minimum: 0 },
        totalSessions: { type: 'integer', minimum: 0 },
      },
    },
    ability: {
      type: 'object',
      additionalProperties: false,
      required: ['recall', 'listening', 'grammar', 'wordChoice', 'pronunciation', 'turnTaking'],
      properties: {
        recall: scoreProperty,
        listening: scoreProperty,
        grammar: scoreProperty,
        wordChoice: scoreProperty,
        pronunciation: scoreProperty,
        turnTaking: scoreProperty,
      },
    },
    learningItems: {
      type: 'array',
      maxItems: 500,
      items: learningItemSchema,
    },
    recentAssistEpisodeIds: plainTextArrayProperty,
  },
} as const satisfies JsonSchema;

export const ECHO_DOMAIN_V2_SCHEMAS = {
  conversationTurn: conversationTurnSchema,
  assistDecision: assistDecisionSchema,
  cue: cueSchema,
  assistEpisode: assistEpisodeSchema,
  dialogueExample: dialogueExampleSchema,
  learningItem: learningItemSchema,
  learnerProfile: learnerProfileSchema,
} as const;

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

function result(issues: ValidationIssue[]): ValidationResult {
  return { ok: issues.length === 0, issues };
}

function asRecord(value: unknown, path: string, issues: ValidationIssue[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push(issue(path, 'Expected an object.'));
    return null;
  }
  return value as Record<string, unknown>;
}

function validateKnownFields(
  record: Record<string, unknown>,
  allowedFields: readonly string[],
  issues: ValidationIssue[],
  pathPrefix = '',
): void {
  const allowed = new Set(allowedFields);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      issues.push(issue(pathPrefix ? `${pathPrefix}.${key}` : key, 'Unknown field is not allowed.'));
    }
  }
}

function validateSchemaVersion(record: Record<string, unknown>, issues: ValidationIssue[]): void {
  if (record.schemaVersion !== ECHO_DOMAIN_V2_SCHEMA_VERSION) {
    issues.push(issue('schemaVersion', `Expected ${ECHO_DOMAIN_V2_SCHEMA_VERSION}.`));
  }
}

function validateStringField(
  record: Record<string, unknown>,
  field: string,
  issues: ValidationIssue[],
  options: { required?: boolean; maxLength?: number; noHtml?: boolean } = {},
): void {
  const value = record[field];
  if (value === undefined || value === null) {
    if (options.required) issues.push(issue(field, 'Required string is missing.'));
    return;
  }
  if (typeof value !== 'string') {
    issues.push(issue(field, 'Expected a string.'));
    return;
  }
  if (options.required && value.trim().length === 0) {
    issues.push(issue(field, 'Required string cannot be empty.'));
  }
  if (options.maxLength && value.length > options.maxLength) {
    issues.push(issue(field, `Expected at most ${options.maxLength} characters.`));
  }
  if (options.noHtml && HTML_TAG_PATTERN.test(value)) {
    issues.push(issue(field, 'HTML-like tags are not allowed in learner-facing text.'));
  }
}

function validateNumberField(
  record: Record<string, unknown>,
  field: string,
  issues: ValidationIssue[],
  options: { required?: boolean; min?: number; max?: number; integer?: boolean } = {},
): void {
  const value = record[field];
  if (value === undefined || value === null) {
    if (options.required) issues.push(issue(field, 'Required number is missing.'));
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(issue(field, 'Expected a finite number.'));
    return;
  }
  if (options.integer && !Number.isInteger(value)) {
    issues.push(issue(field, 'Expected an integer.'));
  }
  if (options.min !== undefined && value < options.min) {
    issues.push(issue(field, `Expected >= ${options.min}.`));
  }
  if (options.max !== undefined && value > options.max) {
    issues.push(issue(field, `Expected <= ${options.max}.`));
  }
}

function validateBooleanField(
  record: Record<string, unknown>,
  field: string,
  issues: ValidationIssue[],
  required = false,
): void {
  const value = record[field];
  if (value === undefined || value === null) {
    if (required) issues.push(issue(field, 'Required boolean is missing.'));
    return;
  }
  if (typeof value !== 'boolean') {
    issues.push(issue(field, 'Expected a boolean.'));
  }
}

function validateEnumField<T extends string | number>(
  record: Record<string, unknown>,
  field: string,
  values: readonly T[],
  issues: ValidationIssue[],
  required = true,
): void {
  const value = record[field];
  if (value === undefined || value === null) {
    if (required) issues.push(issue(field, 'Required enum value is missing.'));
    return;
  }
  if (!values.includes(value as T)) {
    issues.push(issue(field, `Expected one of: ${values.join(', ')}.`));
  }
}

function validateStringArrayField(
  record: Record<string, unknown>,
  field: string,
  issues: ValidationIssue[],
  options: { required?: boolean; maxItems?: number; maxLength?: number; noHtml?: boolean } = {},
): void {
  const value = record[field];
  if (value === undefined || value === null) {
    if (options.required) issues.push(issue(field, 'Required string array is missing.'));
    return;
  }
  if (!Array.isArray(value)) {
    issues.push(issue(field, 'Expected an array.'));
    return;
  }
  if (options.maxItems && value.length > options.maxItems) {
    issues.push(issue(field, `Expected at most ${options.maxItems} items.`));
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string') {
      issues.push(issue(`${field}.${index}`, 'Expected a string.'));
      return;
    }
    if (options.maxLength && item.length > options.maxLength) {
      issues.push(issue(`${field}.${index}`, `Expected at most ${options.maxLength} characters.`));
    }
    if (options.noHtml && HTML_TAG_PATTERN.test(item)) {
      issues.push(issue(`${field}.${index}`, 'HTML-like tags are not allowed.'));
    }
  });
}

function validateIsoDateField(record: Record<string, unknown>, field: string, issues: ValidationIssue[]): void {
  validateStringField(record, field, issues, { required: true, maxLength: 40 });
  const value = record[field];
  if (typeof value === 'string' && !new RegExp(ISO_DATETIME_PATTERN).test(value)) {
    issues.push(issue(field, 'Expected an ISO-8601 UTC timestamp.'));
  }
}

export function validateAssistDecision(value: unknown, path = 'assistDecision'): ValidationResult {
  const issues: ValidationIssue[] = [];
  const record = asRecord(value, path, issues);
  if (!record) return result(issues);

  validateKnownFields(record, assistDecisionFields, issues);
  validateEnumField(record, 'action', assistActions, issues);
  validateNumberField(record, 'confidence', issues, { required: true, min: 0, max: 1 });
  validateEnumField(record, 'trigger', assistTriggers, issues);
  validateEnumField(record, 'maxCueLevel', cueLevels, issues);

  return result(issues);
}

export function validateConversationTurn(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const record = asRecord(value, 'conversationTurn', issues);
  if (!record) return result(issues);

  validateKnownFields(record, conversationTurnFields, issues);
  validateSchemaVersion(record, issues);
  validateStringField(record, 'id', issues, { required: true, maxLength: 128 });
  validateStringField(record, 'sessionId', issues, { required: true, maxLength: 128 });
  validateEnumField(record, 'speaker', speakerRoles, issues);
  validateNumberField(record, 'startedAt', issues, { required: true, min: 0 });
  validateNumberField(record, 'endedAt', issues, { required: true, min: 0 });
  validateEnumField(record, 'source', turnSources, issues);
  validateStringField(record, 'language', issues, { required: true, maxLength: 35 });
  validateStringField(record, 'transcript', issues, { required: true, maxLength: 4000, noHtml: true });
  validateStringField(record, 'translationKo', issues, { maxLength: 4000, noHtml: true });
  validateNumberField(record, 'confidence', issues, { min: 0, max: 1 });
  validateBooleanField(record, 'isFinal', issues, true);
  validateBooleanField(record, 'correctedByUser', issues);
  validateStringArrayField(record, 'piiFlags', issues, { maxItems: 32, maxLength: 160, noHtml: true });

  if (
    typeof record.startedAt === 'number' &&
    typeof record.endedAt === 'number' &&
    record.endedAt < record.startedAt
  ) {
    issues.push(issue('endedAt', 'endedAt must be greater than or equal to startedAt.'));
  }

  return result(issues);
}

export function validateCue(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const record = asRecord(value, 'cue', issues);
  if (!record) return result(issues);

  validateKnownFields(record, cueFields, issues);
  validateSchemaVersion(record, issues);
  validateStringField(record, 'cueId', issues, { required: true, maxLength: 128 });
  validateEnumField(record, 'speechAct', speechActs, issues);
  validateEnumField(record, 'level', cueLevels, issues);
  validateStringField(record, 'phrase', issues, { required: true, maxLength: 160, noHtml: true });
  validateStringField(record, 'meaningKo', issues, { required: true, maxLength: 240, noHtml: true });
  validateStringArrayField(record, 'alternatives', issues, {
    required: true,
    maxItems: 32,
    maxLength: 160,
    noHtml: true,
  });
  validateNumberField(record, 'expiresAfterMs', issues, { required: true, min: 100, max: 30000, integer: true });
  validateStringField(record, 'targetTurnId', issues, { required: true, maxLength: 128 });

  return result(issues);
}

export function validateAssistEpisode(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const record = asRecord(value, 'assistEpisode', issues);
  if (!record) return result(issues);

  validateKnownFields(record, assistEpisodeFields, issues);
  validateSchemaVersion(record, issues);
  validateStringField(record, 'id', issues, { required: true, maxLength: 128 });
  validateStringField(record, 'sessionId', issues, { required: true, maxLength: 128 });
  validateStringField(record, 'targetTurnId', issues, { required: true, maxLength: 128 });
  validateEnumField(record, 'trigger', assistTriggers, issues);
  validateEnumField(record, 'cueLevelUsed', cueLevelsUsed, issues);
  validateEnumField(record, 'speechAct', speechActs, issues, false);
  validateNumberField(record, 'requestedAt', issues, { required: true, min: 0 });
  validateNumberField(record, 'shownAt', issues, { min: 0 });
  validateNumberField(record, 'acknowledgedAt', issues, { min: 0 });
  validateNumberField(record, 'resolvedAt', issues, { min: 0 });
  validateEnumField(record, 'outcome', assistOutcomes, issues);
  validateStringField(record, 'cueId', issues, { maxLength: 128 });
  validateStringField(record, 'userAttempt', issues, { maxLength: 4000, noHtml: true });
  validateStringField(record, 'acceptedPhrase', issues, { maxLength: 240, noHtml: true });
  validateNumberField(record, 'latencyMs', issues, { min: 0 });

  const decisionResult = validateAssistDecision(record.decision);
  issues.push(...decisionResult.issues.map((entry) => issue(`decision.${entry.path}`, entry.message)));

  return result(issues);
}

function validateDialogueExample(value: unknown, path: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  const record = asRecord(value, path, issues);
  if (!record) return result(issues);

  validateKnownFields(record, dialogueExampleFields, issues, path);
  validateStringField(record, 'id', issues, { required: true, maxLength: 128 });
  validateStringField(record, 'scenarioTag', issues, { required: true, maxLength: 120, noHtml: true });
  validateStringField(record, 'partnerTurn', issues, { maxLength: 1000, noHtml: true });
  validateStringField(record, 'learnerTurn', issues, { required: true, maxLength: 1000, noHtml: true });
  validateStringField(record, 'meaningKo', issues, { maxLength: 1000, noHtml: true });
  validateStringField(record, 'targetExpression', issues, { required: true, maxLength: 240, noHtml: true });
  validateStringArrayField(record, 'sourceTurnIds', issues, { required: true, maxItems: 32, maxLength: 128 });

  return result(issues);
}

export function validateLearningItem(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const record = asRecord(value, 'learningItem', issues);
  if (!record) return result(issues);

  validateKnownFields(record, learningItemFields, issues);
  validateSchemaVersion(record, issues);
  validateStringField(record, 'id', issues, { required: true, maxLength: 128 });
  validateStringField(record, 'canonicalExpression', issues, { required: true, maxLength: 240, noHtml: true });
  validateStringField(record, 'meaningKo', issues, { required: true, maxLength: 400, noHtml: true });
  validateEnumField(record, 'speechAct', speechActs, issues);
  validateStringArrayField(record, 'scenarioTags', issues, { required: true, maxItems: 32, maxLength: 160, noHtml: true });
  validateEnumField(record, 'breakdownType', breakdownTypes, issues);
  validateStringArrayField(record, 'sourceTurnIds', issues, { required: true, maxItems: 32, maxLength: 128 });
  validateStringField(record, 'userAttempt', issues, { maxLength: 1000, noHtml: true });
  validateStringField(record, 'naturalRecast', issues, { maxLength: 1000, noHtml: true });
  validateEnumField(record, 'cueLevelUsed', cueLevelsUsed, issues);
  validateEnumField(record, 'lastOutcome', learningOutcomes, issues);

  const examples = record.examples;
  if (!Array.isArray(examples)) {
    issues.push(issue('examples', 'Expected an array.'));
  } else {
    examples.forEach((example, index) => {
      const exampleResult = validateDialogueExample(example, `examples.${index}`);
      issues.push(...exampleResult.issues);
    });
  }

  const scheduling = asRecord(record.scheduling, 'scheduling', issues);
  if (scheduling) {
    validateKnownFields(scheduling, learningScheduleFields, issues, 'scheduling');
    validateNumberField(scheduling, 'reps', issues, { required: true, min: 0, integer: true });
    validateNumberField(scheduling, 'lapses', issues, { required: true, min: 0, integer: true });
    validateNumberField(scheduling, 'difficulty', issues, { required: true, min: 0, max: 1 });
    validateNumberField(scheduling, 'stability', issues, { required: true, min: 0 });
    validateIsoDateField(scheduling, 'dueAt', issues);
  }

  return result(issues);
}

export function validateLearnerProfile(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const record = asRecord(value, 'learnerProfile', issues);
  if (!record) return result(issues);

  validateKnownFields(record, learnerProfileFields, issues);
  validateSchemaVersion(record, issues);
  validateStringField(record, 'id', issues, { required: true, maxLength: 128 });
  validateStringField(record, 'learnerId', issues, { required: true, maxLength: 128 });
  validateIsoDateField(record, 'createdAt', issues);
  validateIsoDateField(record, 'updatedAt', issues);
  validateStringField(record, 'profileLocale', issues, { required: true, maxLength: 35 });
  validateStringField(record, 'targetLanguage', issues, { required: true, maxLength: 35 });
  validateEnumField(record, 'privacyMode', ['local_only', 'server_synced'] as const, issues);
  validateStringArrayField(record, 'recentAssistEpisodeIds', issues, {
    required: true,
    maxItems: 32,
    maxLength: 128,
  });

  const metrics = asRecord(record.metrics, 'metrics', issues);
  if (metrics) {
    validateKnownFields(metrics, learnerMetricFields, issues, 'metrics');
    validateNumberField(metrics, 'conversationRecoveryRate', issues, { min: 0, max: 1 });
    validateNumberField(metrics, 'independentTransferRate', issues, { min: 0, max: 1 });
    validateNumberField(metrics, 'assistedExactRate', issues, { min: 0, max: 1 });
    validateNumberField(metrics, 'activeRecallDueCount', issues, { min: 0, integer: true });
    validateNumberField(metrics, 'totalSessions', issues, { min: 0, integer: true });
  }

  const ability = asRecord(record.ability, 'ability', issues);
  if (ability) {
    validateKnownFields(ability, learnerAbilityFields, issues, 'ability');
    for (const field of ['recall', 'listening', 'grammar', 'wordChoice', 'pronunciation', 'turnTaking']) {
      validateNumberField(ability, field, issues, { required: true, min: 0, max: 1 });
    }
  }

  const learningItems = record.learningItems;
  if (!Array.isArray(learningItems)) {
    issues.push(issue('learningItems', 'Expected an array.'));
  } else {
    learningItems.forEach((item, index) => {
      const itemResult = validateLearningItem(item);
      issues.push(...itemResult.issues.map((entry) => issue(`learningItems.${index}.${entry.path}`, entry.message)));
    });
  }

  return result(issues);
}

export function isConversationTurn(value: unknown): value is ConversationTurn {
  return validateConversationTurn(value).ok;
}

export function isAssistDecision(value: unknown): value is AssistDecision {
  return validateAssistDecision(value).ok;
}

export function isCue(value: unknown): value is Cue {
  return validateCue(value).ok;
}

export function isAssistEpisode(value: unknown): value is AssistEpisode {
  return validateAssistEpisode(value).ok;
}

export function isLearningItem(value: unknown): value is LearningItem {
  return validateLearningItem(value).ok;
}

export function isLearnerProfile(value: unknown): value is LearnerProfile {
  return validateLearnerProfile(value).ok;
}
