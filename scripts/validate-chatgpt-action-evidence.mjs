#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_SCOPES = [
  'profile:read',
  'review:read',
  'review:write',
  'roleplay:write',
  'session:write',
];

const REQUIRED_ENDPOINTS = {
  learnerProfile: { path: '/v1/learner/profile', method: 'GET', write: false },
  reviewsNext: { path: '/v1/reviews/next', method: 'GET', write: false },
  reviewAttempt: { path: '/v1/reviews/attempt', method: 'POST', write: true },
  roleplayStart: { path: '/v1/roleplays/start', method: 'POST', write: false },
  roleplayResult: { path: '/v1/roleplays/result', method: 'POST', write: true },
  sessionImport: { path: '/v1/sessions/import-summary', method: 'POST', write: true },
};

const PRONUNCIATION_SCORING_SOURCES = [
  'g2_audio_level_policy',
  'device_pronunciation_evaluator',
  'external_pronunciation_evaluator',
];

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /^TBD$/i,
  /^TODO$/i,
  /^N\/A$/i,
  /^placeholder$/i,
  /^fill/i,
  /^https?:\/\/example\.com/i,
];

const SECRET_PATTERNS = [
  { name: 'Gemini API key', pattern: /AIza[0-9A-Za-z_-]{20,}/ },
  { name: 'GitHub token', pattern: /gh[pousr]_[0-9A-Za-z_]{20,}/ },
  { name: 'OpenAI API key', pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: 'bearer token', pattern: /\bBearer\s+[0-9A-Za-z._~+/=-]{20,}/i },
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

const EVIDENCE_EXTENSIONS = ['md', 'txt', 'log', 'json', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'mov', 'webm', 'mkv'];
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const args = process.argv.slice(2);
const allowDraft = args.includes('--allow-draft');
const verbose = args.includes('--verbose');
const wantsHelp = args.includes('--help') || args.includes('-h');
const targetArg = args.find((arg) => !arg.startsWith('--'));

if (wantsHelp || !targetArg) {
  console.info(`Usage: npm run validate:chatgpt-action-evidence -- <evidence.json> [--allow-draft] [--verbose]

Validates final Project ECHO Custom GPT Action / active-recall evidence.

Without --allow-draft, the manifest must prove the deployed Action API,
per-user OAuth boundary, bounded endpoint behavior, privacy rejection tests,
and G2/audio-level recall evidence without raw secrets or placeholder claims.`);
  process.exit(wantsHelp ? 0 : 1);
}

const targetPath = path.resolve(process.cwd(), targetArg);
let manifest;

try {
  manifest = JSON.parse(readFileSync(targetPath, 'utf8'));
} catch (error) {
  console.error(`[chatgpt-action-evidence] could not read ${targetArg}: ${error.message}`);
  process.exit(1);
}

const specPath = path.resolve(process.cwd(), 'integrations/chatgpt-action/openapi.json');
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const expectedBaseUrl = String(spec.servers?.[0]?.url ?? '').replace(/\/+$/, '');
const expectedVersion = String(spec.info?.version ?? '');
const errors = [];
const warnings = [];

function addError(pointer, message) {
  errors.push(`${pointer}: ${message}`);
}

function addWarning(pointer, message) {
  warnings.push(`${pointer}: ${message}`);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPlaceholder(value) {
  if (typeof value !== 'string') return false;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

function validateObject(value, pointer) {
  if (!isPlainObject(value)) {
    addError(pointer, 'expected an object');
    return false;
  }
  return true;
}

function validateText(object, key, pointer) {
  const fieldPointer = `${pointer}.${key}`;
  if (!hasOwn(object, key)) {
    addError(fieldPointer, 'missing required field');
    return;
  }

  const value = object[key];
  if (allowDraft && (value === null || isPlaceholder(value))) {
    addWarning(fieldPointer, 'draft placeholder remains');
    return;
  }

  if (typeof value !== 'string' || isPlaceholder(value)) {
    addError(fieldPointer, 'must be a non-placeholder string');
  }
}

function validateIsoDate(object, key, pointer) {
  const fieldPointer = `${pointer}.${key}`;
  if (!hasOwn(object, key)) {
    addError(fieldPointer, 'missing required ISO date');
    return;
  }

  const value = object[key];
  if (allowDraft && (value === null || isPlaceholder(value))) {
    addWarning(fieldPointer, 'draft ISO date placeholder remains');
    return;
  }

  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value.trim())) {
    addError(fieldPointer, 'must be a valid ISO date in YYYY-MM-DD format');
    return;
  }

  const [year, month, day] = value.trim().split('-').map((part) => Number.parseInt(part, 10));
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== month - 1
    || parsedDate.getUTCDate() !== day
  ) {
    addError(fieldPointer, 'must be a real calendar date');
  }
}

function validateExpected(object, key, expected, pointer) {
  const fieldPointer = `${pointer}.${key}`;
  if (!hasOwn(object, key)) {
    addError(fieldPointer, `missing required value ${JSON.stringify(expected)}`);
    return;
  }

  const value = object[key];
  if (allowDraft && (value === null || value === 'TBD')) {
    addWarning(fieldPointer, `draft value must become ${JSON.stringify(expected)}`);
    return;
  }

  if (value !== expected) {
    addError(fieldPointer, `must be ${JSON.stringify(expected)}`);
  }
}

function validateNumberRange(object, key, pointer, min, max) {
  const fieldPointer = `${pointer}.${key}`;
  if (!hasOwn(object, key)) {
    addError(fieldPointer, 'missing required numeric field');
    return;
  }

  const value = object[key];
  if (allowDraft && (value === null || value === 'TBD')) {
    addWarning(fieldPointer, `draft number must become ${min}..${max}`);
    return;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    addError(fieldPointer, `must be a finite number from ${min} to ${max}`);
  }
}

function validateIntegerRange(object, key, pointer, min, max) {
  const fieldPointer = `${pointer}.${key}`;
  if (!hasOwn(object, key)) {
    addError(fieldPointer, 'missing required integer field');
    return;
  }

  const value = object[key];
  if (allowDraft && (value === null || value === 'TBD')) {
    addWarning(fieldPointer, `draft integer must become ${min}..${max}`);
    return;
  }

  if (!Number.isInteger(value) || value < min || value > max) {
    addError(fieldPointer, `must be an integer from ${min} to ${max}`);
  }
}

function validateEnum(object, key, allowedValues, pointer) {
  const fieldPointer = `${pointer}.${key}`;
  if (!hasOwn(object, key)) {
    addError(fieldPointer, `missing required value; expected one of ${allowedValues.join(', ')}`);
    return;
  }

  const value = object[key];
  if (allowDraft && (value === null || value === 'TBD')) {
    addWarning(fieldPointer, `draft value must become one of ${allowedValues.join(', ')}`);
    return;
  }

  if (!allowedValues.includes(value)) {
    addError(fieldPointer, `must be one of ${allowedValues.join(', ')}`);
  }
}

function validateHttpsUrl(object, key, pointer, expected = null) {
  const fieldPointer = `${pointer}.${key}`;
  validateText(object, key, pointer);
  const value = object[key];
  if (allowDraft && (value === null || isPlaceholder(value))) return;
  if (typeof value !== 'string') return;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    addError(fieldPointer, 'must be a valid URL');
    return;
  }

  if (parsed.protocol !== 'https:') {
    addError(fieldPointer, 'must use https');
  }

  if (isLocalHost(parsed.hostname)) {
    addError(fieldPointer, 'must not point to localhost or a private network host');
  }

  const normalized = value.replace(/\/+$/, '');
  if (expected && normalized !== expected) {
    addError(fieldPointer, `must match ${expected}`);
  }
}

function validateEvidenceLink(object, key, pointer) {
  const fieldPointer = `${pointer}.${key}`;
  validateText(object, key, pointer);
  const value = object[key];
  if (allowDraft && (value === null || isPlaceholder(value))) return;
  if (typeof value !== 'string') return;

  validateEvidenceLinkValue(value, fieldPointer);
}

function validateEvidenceLinkValue(value, pointer) {
  if (/^https:\/\/\S+$/i.test(value.trim())) return;
  if (/^http:\/\//i.test(value.trim())) {
    addError(pointer, 'must use https or a repo path');
    return;
  }

  const escapedExtensions = EVIDENCE_EXTENSIONS.map((extension) => extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const relativePathPattern = new RegExp(
    `^(?:\\.{1,2}/)?[A-Za-z0-9_.\\-/]+\\.(${escapedExtensions.join('|')})$`,
    'i',
  );
  if (!relativePathPattern.test(value.trim())) {
    addError(pointer, `must be an https URL or repo path ending in one of: ${EVIDENCE_EXTENSIONS.join(', ')}`);
    return;
  }

  const resolvedPath = path.resolve(process.cwd(), value.trim());
  const repoRoot = `${process.cwd()}${path.sep}`;
  if (resolvedPath !== process.cwd() && !resolvedPath.startsWith(repoRoot)) {
    addError(pointer, 'repo path must stay inside the repository');
    return;
  }

  if (!existsSync(resolvedPath)) {
    addError(pointer, 'repo path evidence must point to an existing file');
  }
}

function validateEvidenceLinkArray(object, key, pointer, minItems) {
  const fieldPointer = `${pointer}.${key}`;
  const value = object?.[key];
  if (!Array.isArray(value)) {
    addError(fieldPointer, 'must be an array of evidence links');
    return;
  }

  if (allowDraft && value.length === 0) {
    addWarning(fieldPointer, `draft array must include at least ${minItems} evidence link(s)`);
    return;
  }

  if (value.length < minItems) {
    addError(fieldPointer, `must include at least ${minItems} evidence link(s)`);
  }

  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || isPlaceholder(item)) {
      addError(`${fieldPointer}[${index}]`, 'must be a non-placeholder evidence link');
      continue;
    }
    validateEvidenceLinkValue(item, `${fieldPointer}[${index}]`);
  }
}

function validateRoot() {
  if (!validateObject(manifest, 'manifest')) return;

  validateText(manifest, 'project', 'manifest');
  validateIsoDate(manifest, 'runDate', 'manifest');
  validateExpected(manifest, 'evidenceStatus', allowDraft ? 'draft' : 'complete', 'manifest');
  validateHttpsUrl(manifest, 'actionApiBaseUrl', 'manifest', expectedBaseUrl);
  validateExpected(manifest, 'actionContractVersion', expectedVersion, 'manifest');
}

function validateActionGpt() {
  if (!validateObject(manifest.actionGpt, 'actionGpt')) return;
  for (const key of [
    'customGptConfigured',
    'openapiSchemaUploaded',
    'privacyPolicyConfigured',
    'actionsAndAppsNotMixed',
  ]) {
    validateExpected(manifest.actionGpt, key, true, 'actionGpt');
  }
  validateEvidenceLink(manifest.actionGpt, 'evidenceRef', 'actionGpt');
}

function validateOauth() {
  if (!validateObject(manifest.oauth, 'oauth')) return;
  validateExpected(manifest.oauth, 'authorizationCodeConfigured', true, 'oauth');
  validateHttpsUrl(manifest.oauth, 'authorizationUrl', 'oauth', `${expectedBaseUrl}/oauth/authorize`);
  validateHttpsUrl(manifest.oauth, 'tokenUrl', 'oauth', `${expectedBaseUrl}/oauth/token`);
  validateScopes();
  validateText(manifest.oauth, 'tokenStorageBoundary', 'oauth');
  validateTokenStorageBoundary();
  validateExpected(manifest.oauth, 'providerSecretsInGpt', false, 'oauth');
  validateEvidenceLink(manifest.oauth, 'evidenceRef', 'oauth');
}

function validateTokenStorageBoundary() {
  const value = manifest.oauth?.tokenStorageBoundary;
  if (allowDraft && isPlaceholder(value)) return;
  if (typeof value !== 'string') return;

  if (!/(server|proxy|oauth|issuer|secret manager)/i.test(value)) {
    addError('oauth.tokenStorageBoundary', 'must describe a server-side OAuth token boundary');
  }

  if (!/(hash|fingerprint|encrypted|secret manager|not stored raw|no raw|without raw|opaque)/i.test(value)) {
    addError('oauth.tokenStorageBoundary', 'must describe non-raw token storage such as hashed fingerprints, encrypted storage, or secret-manager-only storage');
  }

  if (/\bstores?\s+(?:raw|plain(?:text)?)\b/i.test(value)) {
    addError('oauth.tokenStorageBoundary', 'must not claim raw or plaintext token storage');
  }
}

function validateScopes() {
  const pointer = 'oauth.scopesGranted';
  const scopes = manifest.oauth?.scopesGranted;
  if (!Array.isArray(scopes)) {
    addError(pointer, 'must be an array');
    return;
  }

  if (allowDraft && scopes.some((scope) => scope === 'TBD')) {
    addWarning(pointer, 'draft scopes remain');
    return;
  }

  for (const scope of REQUIRED_SCOPES) {
    if (!scopes.includes(scope)) {
      addError(pointer, `must include ${scope}`);
    }
  }

  for (const scope of scopes) {
    if (!REQUIRED_SCOPES.includes(scope)) {
      addError(pointer, `unexpected scope ${scope}`);
    }
  }
}

function validateEndpoints() {
  if (!validateObject(manifest.endpoints, 'endpoints')) return;

  for (const [key, expected] of Object.entries(REQUIRED_ENDPOINTS)) {
    const endpoint = manifest.endpoints[key];
    const pointer = `endpoints.${key}`;
    if (!validateObject(endpoint, pointer)) continue;
    validateExpected(endpoint, 'path', expected.path, pointer);
    validateExpected(endpoint, 'method', expected.method, pointer);
    validateExpected(endpoint, 'status', 200, pointer);
    validateExpected(endpoint, 'schemaVersion', '2.0.0', pointer);
    if (expected.write) {
      validateExpected(endpoint, 'writeAccepted', true, pointer);
    }
    validateExpected(endpoint, 'rawTranscriptReturned', false, pointer);
    validateExpected(endpoint, 'rawAudioReturned', false, pointer);
    validateExpected(endpoint, 'directIdentifierReturned', false, pointer);
    validateEvidenceLink(endpoint, 'evidenceRef', pointer);
  }
}

function validatePrivacy() {
  if (!validateObject(manifest.privacy, 'privacy')) return;
  for (const key of [
    'rawTranscriptRejected',
    'rawAudioRejected',
    'directContactIdentifiersRejected',
    'providerSecretsRejected',
  ]) {
    validateExpected(manifest.privacy, key, true, 'privacy');
  }
  validateNumberRange(manifest.privacy, 'boundedLearningItemsMax', 'privacy', 1, 30);
  validateEvidenceLink(manifest.privacy, 'evidenceRef', 'privacy');
}

function validateDeviceEvidence() {
  if (!validateObject(manifest.activeRecallDeviceEvidence, 'activeRecallDeviceEvidence')) return;
  validateExpected(manifest.activeRecallDeviceEvidence, 'g2BridgeRecallCaptured', true, 'activeRecallDeviceEvidence');
  validateExpected(manifest.activeRecallDeviceEvidence, 'audioLevelPronunciationScoring', true, 'activeRecallDeviceEvidence');
  validateExpected(manifest.activeRecallDeviceEvidence, 'calibratedG2ThresholdUsed', true, 'activeRecallDeviceEvidence');
  validateExpected(manifest.activeRecallDeviceEvidence, 'webSpeechOnlyMarkedInsufficient', true, 'activeRecallDeviceEvidence');
  validateExpected(manifest.activeRecallDeviceEvidence, 'twoSeparateRecallDaysProven', true, 'activeRecallDeviceEvidence');
  validateExpected(manifest.activeRecallDeviceEvidence, 'transferScenarioEvidenceCaptured', true, 'activeRecallDeviceEvidence');
  validateExpected(manifest.activeRecallDeviceEvidence, 'sameDayRepeatNotCountedAsTransfer', true, 'activeRecallDeviceEvidence');
  validateRecallTransferProof(
    manifest.activeRecallDeviceEvidence.recallTransferProof,
    'activeRecallDeviceEvidence.recallTransferProof',
  );
  validateG2AudioLevelEvidence(
    manifest.activeRecallDeviceEvidence.g2AudioLevelEvidence,
    'activeRecallDeviceEvidence.g2AudioLevelEvidence',
  );
  validatePronunciationScoringPolicy(
    manifest.activeRecallDeviceEvidence.pronunciationScoringPolicy,
    'activeRecallDeviceEvidence.pronunciationScoringPolicy',
  );
  validateEvidenceLink(manifest.activeRecallDeviceEvidence, 'evidenceRef', 'activeRecallDeviceEvidence');
}

function validateTutorBehavior() {
  if (!validateObject(manifest.tutorBehavior, 'tutorBehavior')) return;

  for (const key of [
    'flowBeforeCorrection',
    'maxOneCorrectionPerTurn',
    'cueLadderOrderVerified',
    'koreanExplanationBrief',
    'immediateRepeatNotMastery',
    'masteryRequiresTwoDaysAndTransfer',
    'roleplayResultWritesBoundedItemIds',
    'roleplayResultOmitsRawTranscript',
    'roleplayResultIncludesOutcomeSummary',
    'transferWriteBackUsesScenarioId',
  ]) {
    validateExpected(manifest.tutorBehavior, key, true, 'tutorBehavior');
  }

  validateIntegerRange(manifest.tutorBehavior, 'maxLearningItemsPerSession', 'tutorBehavior', 1, 3);
  validateEvidenceLink(manifest.tutorBehavior, 'instructionsEvidenceRef', 'tutorBehavior');
  validateEvidenceLink(manifest.tutorBehavior, 'roleplayEvidenceRef', 'tutorBehavior');
}

function validateRecallTransferProof(proof, pointer) {
  if (!validateObject(proof, pointer)) return;
  validateDay1Day7TransferDates(proof, pointer);
  validateRecallDates(proof, pointer);
  validateEvidenceLinkArray(proof, 'independentRecallAttemptRefs', pointer, 2);
  validateTransferScenarioIds(proof, pointer);
  validateEvidenceLink(proof, 'transferEvidenceRef', pointer);
  validateEvidenceLink(proof, 'sameDayRepeatEvidenceRef', pointer);
}

function validateDay1Day7TransferDates(proof, pointer) {
  validateIsoDate(proof, 'day1RecallDate', pointer);
  validateIsoDate(proof, 'day7TransferDate', pointer);

  const day1 = isoDateToUtcDay(proof.day1RecallDate);
  const day7 = isoDateToUtcDay(proof.day7TransferDate);
  if (day1 === null || day7 === null) return;

  if (day7 - day1 < 6) {
    addError(`${pointer}.day7TransferDate`, 'must be at least six calendar days after day1RecallDate');
  }

  const recallDates = Array.isArray(proof.recallDates)
    ? proof.recallDates.map((date) => (typeof date === 'string' ? date.trim() : date))
    : [];
  if (!recallDates.includes(proof.day1RecallDate.trim())) {
    addError(`${pointer}.recallDates`, 'must include day1RecallDate');
  }
  if (!recallDates.includes(proof.day7TransferDate.trim())) {
    addError(`${pointer}.recallDates`, 'must include day7TransferDate');
  }
}

function isoDateToUtcDay(value) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value.trim())) return null;
  const [year, month, day] = value.trim().split('-').map((part) => Number.parseInt(part, 10));
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== month - 1
    || parsedDate.getUTCDate() !== day
  ) {
    return null;
  }
  return Math.floor(parsedDate.getTime() / 86_400_000);
}

function validateRecallDates(proof, pointer) {
  const fieldPointer = `${pointer}.recallDates`;
  const dates = proof.recallDates;
  if (!Array.isArray(dates)) {
    addError(fieldPointer, 'must be an array of ISO dates');
    return;
  }

  if (allowDraft && dates.length === 0) {
    addWarning(fieldPointer, 'draft array must prove at least two separate recall dates');
    return;
  }

  const uniqueDates = new Set();
  for (const [index, date] of dates.entries()) {
    if (typeof date !== 'string' || !ISO_DATE_PATTERN.test(date.trim())) {
      addError(`${fieldPointer}[${index}]`, 'must be an ISO date in YYYY-MM-DD format');
      continue;
    }
    uniqueDates.add(date.trim());
  }

  if (uniqueDates.size < 2) {
    addError(fieldPointer, 'must include at least two distinct recall dates');
  }
}

function validateTransferScenarioIds(proof, pointer) {
  const fieldPointer = `${pointer}.transferScenarioIds`;
  const ids = proof.transferScenarioIds;
  if (!Array.isArray(ids)) {
    addError(fieldPointer, 'must be an array of bounded transfer scenario IDs');
    return;
  }

  if (allowDraft && ids.length === 0) {
    addWarning(fieldPointer, 'draft array must include at least one transfer scenario ID');
    return;
  }

  if (ids.length < 1) {
    addError(fieldPointer, 'must include at least one transfer scenario ID');
  }

  const uniqueIds = new Set();
  for (const [index, id] of ids.entries()) {
    if (typeof id !== 'string' || isPlaceholder(id) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id.trim())) {
      addError(`${fieldPointer}[${index}]`, 'must be a stable bounded ASCII scenario ID');
      continue;
    }
    uniqueIds.add(id.trim());
  }

  if (uniqueIds.size !== ids.length) {
    addError(fieldPointer, 'must not contain duplicate transfer scenario IDs');
  }
}

function validateG2AudioLevelEvidence(evidence, pointer) {
  if (!validateObject(evidence, pointer)) return;
  validateExpected(evidence, 'captureSource', 'g2_bridge', pointer);
  validateNumberRange(evidence, 'speechThreshold', pointer, 0.0001, 0.35);
  validateNumberRange(evidence, 'speechFrameRatio', pointer, 0.0001, 1);
  validateIntegerRange(evidence, 'totalFrames', pointer, 1, 1_000_000);
  validateIntegerRange(evidence, 'speechFrames', pointer, 1, 1_000_000);
  validateIntegerRange(evidence, 'clippedFrameCount', pointer, 0, 1_000_000);
  validateExpected(evidence, 'rawAudioRetained', false, pointer);
  validateEvidenceLink(evidence, 'evidenceRef', pointer);

  if (Number.isInteger(evidence.totalFrames) && Number.isInteger(evidence.speechFrames) && evidence.speechFrames > evidence.totalFrames) {
    addError(`${pointer}.speechFrames`, 'must not exceed totalFrames');
  }
  if (Number.isInteger(evidence.totalFrames) && Number.isInteger(evidence.clippedFrameCount) && evidence.clippedFrameCount > evidence.totalFrames) {
    addError(`${pointer}.clippedFrameCount`, 'must not exceed totalFrames');
  }
}

function validatePronunciationScoringPolicy(policy, pointer) {
  if (!validateObject(policy, pointer)) return;
  validateEnum(policy, 'scoringSource', PRONUNCIATION_SCORING_SOURCES, pointer);
  validateExpected(policy, 'webSpeechConfidenceUsedForG2', false, pointer);
  validateExpected(policy, 'rawAudioRetained', false, pointer);
  validateExpected(policy, 'g2BridgePcmEvidencePresent', true, pointer);
  validateExpected(policy, 'calibratedThresholdInEvidence', true, pointer);
  validateEvidenceLink(policy, 'evidenceRef', pointer);
}

function validateNoSecrets() {
  const text = JSON.stringify(manifest);
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      addError('secrets', `must not contain raw ${name}`);
    }
  }
}

function validateOpenApiContract() {
  for (const { path: endpointPath, method } of Object.values(REQUIRED_ENDPOINTS)) {
    const operation = spec.paths?.[endpointPath]?.[method.toLowerCase()];
    if (!operation) {
      addError('openapi', `missing ${method} ${endpointPath} in integrations/chatgpt-action/openapi.json`);
    }
  }
}

function isLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host === '127.0.0.1'
    || host === '::1'
  ) {
    return true;
  }
  const parts = host.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

validateRoot();
validateActionGpt();
validateOauth();
validateEndpoints();
validatePrivacy();
validateDeviceEvidence();
validateTutorBehavior();
validateNoSecrets();
validateOpenApiContract();

const maxDisplayedFindings = verbose ? Number.POSITIVE_INFINITY : 25;

function printFindings(kind, findings, writer) {
  const visibleFindings = findings.slice(0, maxDisplayedFindings);
  for (const finding of visibleFindings) {
    writer(`[chatgpt-action-evidence] ${kind} ${finding}`);
  }
  if (findings.length > visibleFindings.length) {
    writer(
      `[chatgpt-action-evidence] ${findings.length - visibleFindings.length} more ${kind}(s) hidden; rerun with --verbose to print all`,
    );
  }
}

if (warnings.length > 0) {
  if (allowDraft && !verbose) {
    console.info(`[chatgpt-action-evidence] ${warnings.length} draft placeholder warning(s); rerun with --verbose to print all`);
  } else {
    printFindings('warning', warnings, console.warn);
  }
}

const displayPath = path.relative(process.cwd(), targetPath) || targetPath;
if (errors.length > 0) {
  printFindings('error', errors, console.error);
  console.error(`[chatgpt-action-evidence] ${errors.length} error(s) found in ${displayPath}`);
  process.exit(1);
}

const modeLabel = allowDraft ? 'draft template shape accepted' : 'final ChatGPT Action evidence accepted';
console.info(`[chatgpt-action-evidence] ${modeLabel}: ${displayPath}`);
