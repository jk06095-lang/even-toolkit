#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /^TBD(?:\b|$)/i,
  /^TODO$/i,
  /^N\/A$/i,
  /^placeholder$/i,
  /^fill/i,
  /^https?:\/\/example\.com/i,
  /^<.*>$/,
];

const REQUIRED_SECTIONS = [
  'Rotation Date',
  'Rotated Provider Keys',
  'Session Token Rotation',
  'Production Log Review',
  'Deployment Smoke Evidence',
  'Artifact Scan Evidence',
  'Follow-up Owner',
];

const REQUIRED_FIELDS = [
  'Date',
  'Rotation owner',
  'Production proxy URL',
  'Client build or package version',
  'Provider',
  'Previous key location removed from',
  'New key location',
  'Server secret manager reference',
  'Browser artifact key scan result',
  'Session token issuer',
  'Session token TTL',
  'Session token rotation cadence',
  'Session token revocation evidence',
  'Session token storage boundary',
  'Session token client artifact scan result',
  'Reviewed time window',
  'Log source',
  'Log allowlist confirmation',
  'Raw transcript/audio log exclusion',
  'Deployment smoke command result',
  'Deployment smoke evidence JSON',
  '/healthz configured true',
  'Allowed origin passed',
  'Untrusted origin blocked',
  'Safe non-echoing error response verified',
  'even-app/dist scan result',
  'even-app/echo.ehpk scan result',
  'Direct provider hostname scan result',
  'Development IP scan result',
  'Follow-up owner',
  'Follow-up issue or ticket',
  'Notes',
];

const TRUE_CONFIRMATION_FIELDS = [
  'Session token revocation evidence',
  'Log allowlist confirmation',
  'Raw transcript/audio log exclusion',
  '/healthz configured true',
  'Allowed origin passed',
  'Untrusted origin blocked',
  'Safe non-echoing error response verified',
];

const CLEAN_SCAN_FIELDS = [
  'Browser artifact key scan result',
  'Session token client artifact scan result',
  'even-app/dist scan result',
  'even-app/echo.ehpk scan result',
  'Direct provider hostname scan result',
  'Development IP scan result',
];

const POSITIVE_EVIDENCE_PATTERNS = [
  /\btrue\b/i,
  /\bpass(?:ed)?\b/i,
  /\bconfirmed\b/i,
  /\bverified\b/i,
  /\byes\b/i,
];

const CLEAN_SCAN_PATTERNS = [
  /\b0\s+matches?\b/i,
  /\bno\s+matches?\b/i,
  /\bnone\s+found\b/i,
  /\bnot\s+found\b/i,
  /\bclean\b/i,
  /\bpass(?:ed)?\b/i,
];

const SECRET_PATTERNS = [
  { name: 'Gemini API key', pattern: /AIza[0-9A-Za-z_-]{20,}/ },
  { name: 'GitHub token', pattern: /gh[pousr]_[0-9A-Za-z_]{20,}/ },
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'bearer token', pattern: /\bBearer\s+[0-9A-Za-z._~+/=-]{20,}/i },
];

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RELATIVE_JSON_PATH_PATTERN = /^(?:\.{1,2}\/)?[A-Za-z0-9_.\-/]+\.json$/i;

const args = process.argv.slice(2);
const allowDraft = args.includes('--allow-draft');
const verbose = args.includes('--verbose');
const wantsHelp = args.includes('--help') || args.includes('-h');
const targetArg = args.find((arg) => !arg.startsWith('--'));

if (wantsHelp || !targetArg) {
  console.info(`Usage: npm run validate:key-rotation-evidence -- <evidence.md> [--allow-draft] [--verbose]

Validates the Project ECHO production proxy/key-rotation evidence file.

Without --allow-draft, all required sections and fields must be filled with
non-placeholder values, production smoke evidence must avoid local-only smoke
flags, deployment smoke JSON must prove the remote checks and configured
session-token policy, and the evidence must not contain raw provider keys or
tokens.`);
  process.exit(wantsHelp ? 0 : 1);
}

const targetPath = path.resolve(process.cwd(), targetArg);
let text;

try {
  text = readFileSync(targetPath, 'utf8');
} catch (error) {
  console.error(`[key-rotation] could not read ${targetArg}: ${error.message}`);
  process.exit(1);
}

const errors = [];
const warnings = [];
let currentEchoAppVersion = null;

function addError(pointer, message) {
  errors.push(`${pointer}: ${message}`);
}

function addWarning(pointer, message) {
  warnings.push(`${pointer}: ${message}`);
}

function isPlaceholder(value) {
  const trimmed = String(value ?? '').trim();
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function extractHeadings(markdown) {
  return new Set(
    markdown
      .split(/\r?\n/)
      .map((line) => line.match(/^##\s+(.+?)\s*$/)?.[1])
      .filter(Boolean),
  );
}

function extractFields(markdown) {
  const fields = new Map();
  const lines = markdown.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith('- ')) continue;

    let bullet = line.slice(2).trim();
    let nextIndex = index + 1;
    while (
      nextIndex < lines.length &&
      /^\s+/.test(lines[nextIndex]) &&
      !lines[nextIndex].trim().startsWith('- ') &&
      !lines[nextIndex].trim().startsWith('#')
    ) {
      bullet += ` ${lines[nextIndex].trim()}`;
      nextIndex += 1;
    }
    index = nextIndex - 1;

    const colonIndex = bullet.indexOf(':');
    if (colonIndex === -1) continue;

    const key = bullet.slice(0, colonIndex).replace(/\s+/g, ' ').trim();
    const value = bullet.slice(colonIndex + 1).trim();
    fields.set(key, value);
  }

  return fields;
}

const headings = extractHeadings(text);
const fields = extractFields(text);

for (const section of REQUIRED_SECTIONS) {
  if (!headings.has(section)) {
    addError(`section.${section}`, 'missing required section');
  }
}

for (const field of REQUIRED_FIELDS) {
  if (!fields.has(field)) {
    addError(`field.${field}`, 'missing required field');
    continue;
  }

  const value = fields.get(field);
  if (isPlaceholder(value)) {
    if (allowDraft) {
      addWarning(`field.${field}`, 'draft placeholder remains');
    } else {
      addError(`field.${field}`, 'must be filled with non-placeholder evidence');
    }
  }
}

const proxyUrl = fields.get('Production proxy URL') ?? '';
validateIsoDateField('Date');
validateCurrentClientBuildVersion();
validateProductionProxyUrl(proxyUrl);
validateSessionTokenPolicyFields();

const smokeValue = fields.get('Deployment smoke command result') ?? '';
if (!allowDraft && !/smoke:deploy/.test(smokeValue)) {
  addError('field.Deployment smoke command result', 'must include the smoke:deploy command/result');
}

if (
  !allowDraft
  && !isPlaceholder(proxyUrl)
  && !isPlaceholder(smokeValue)
  && !smokeValue.includes(proxyUrl)
) {
  addError('field.Deployment smoke command result', 'must reference the Production proxy URL');
}
validateDeploymentSmokeEvidence(proxyUrl);

const forbiddenSmokeFlags = ['--allow-http', '--allow-unconfigured', '--allow-unauthenticated', '--allow-qa-delay'];
for (const flag of forbiddenSmokeFlags) {
  if (text.includes(flag)) {
    addError('deploymentSmoke', `must not include local-only smoke flag ${flag}`);
  }
}

for (const field of TRUE_CONFIRMATION_FIELDS) {
  validatePositiveEvidenceField(field);
}

for (const field of CLEAN_SCAN_FIELDS) {
  validateCleanScanField(field);
}

for (const { name, pattern } of SECRET_PATTERNS) {
  if (pattern.test(text)) {
    addError('secrets', `must not contain raw ${name}`);
  }
}

function validateProductionProxyUrl(value) {
  const pointer = 'field.Production proxy URL';
  if (allowDraft && isPlaceholder(value)) return;

  let url;
  try {
    url = new URL(value);
  } catch {
    addError(pointer, 'must be a valid production HTTPS URL');
    return;
  }

  if (url.protocol !== 'https:') {
    addError(pointer, 'must use https');
    return;
  }

  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host === '127.0.0.1'
    || host === '::1'
    || isPrivateIpv4(host)
  ) {
    addError(pointer, 'must not point to localhost or a private network host');
  }
}

function validateIsoDateField(field) {
  const value = fields.get(field) ?? '';
  if (allowDraft && isPlaceholder(value)) return;

  if (!ISO_DATE_PATTERN.test(value.trim())) {
    addError(`field.${field}`, 'must be a valid ISO date in YYYY-MM-DD format');
    return;
  }

  const [year, month, day] = value.trim().split('-').map((part) => Number.parseInt(part, 10));
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== month - 1
    || parsedDate.getUTCDate() !== day
  ) {
    addError(`field.${field}`, 'must be a real calendar date');
  }
}

function validateCurrentClientBuildVersion() {
  const pointer = 'field.Client build or package version';
  const value = fields.get('Client build or package version') ?? '';
  if (allowDraft && isPlaceholder(value)) return;

  const expected = getCurrentEchoAppVersion();
  if (!expected) {
    addError(pointer, 'could not read even-app/package.json version');
    return;
  }

  if (!value.includes(expected)) {
    addError(pointer, `must include current even-app/package.json version ${expected}`);
  }
}

function validateDeploymentSmokeEvidence(proxyUrl) {
  const pointer = 'field.Deployment smoke evidence JSON';
  const value = fields.get('Deployment smoke evidence JSON') ?? '';
  if (allowDraft && isPlaceholder(value)) return;

  if (!RELATIVE_JSON_PATH_PATTERN.test(value.trim())) {
    addError(pointer, 'must be a repo path to a JSON smoke evidence file');
    return;
  }

  const evidencePath = resolveRepoPath(value.trim(), pointer);
  if (!evidencePath) return;
  if (!existsSync(evidencePath)) {
    addError(pointer, 'repo path must point to an existing JSON file');
    return;
  }

  let evidence;
  try {
    evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  } catch (error) {
    addError(pointer, `must be valid JSON: ${error.message}`);
    return;
  }

  validateSmokeEvidenceObject(evidence, proxyUrl);
}

function resolveRepoPath(value, pointer) {
  const repoRoot = path.resolve(process.cwd());
  const resolvedPath = path.resolve(repoRoot, value);
  const repoPrefix = `${repoRoot}${path.sep}`;
  if (resolvedPath !== repoRoot && !resolvedPath.startsWith(repoPrefix)) {
    addError(pointer, 'must stay inside the repository');
    return null;
  }
  return resolvedPath;
}

function validateSmokeEvidenceObject(evidence, proxyUrl) {
  const pointer = 'deploymentSmokeEvidence';
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    addError(pointer, 'must be a JSON object');
    return;
  }

  if (evidence.schema !== 'project-echo-proxy-smoke-v1') {
    addError(`${pointer}.schema`, 'must be project-echo-proxy-smoke-v1');
  }
  if (!isIsoDateTime(evidence.generatedAt)) {
    addError(`${pointer}.generatedAt`, 'must be an ISO timestamp');
  }
  if (evidence.ok !== true) {
    addError(`${pointer}.ok`, 'must be true');
  }
  if (evidence.baseUrl !== normalizeEvidenceBaseUrl(proxyUrl)) {
    addError(`${pointer}.baseUrl`, 'must match Production proxy URL');
  }
  if (
    evidence.allowHttp !== false ||
    evidence.allowUnconfigured !== false ||
    evidence.allowUnauthenticated !== false ||
    evidence.allowQaDelay !== false
  ) {
    addError(`${pointer}.releaseFlags`, 'must not use local-only smoke override flags');
  }
  if (evidence.sessionTokenProvided !== true) {
    addError(`${pointer}.sessionTokenProvided`, 'must be true for production smoke');
  }

  const checks = evidence.checks && typeof evidence.checks === 'object' ? evidence.checks : {};
  validateSmokeCheck(checks.healthz, 'healthz', {
    status: 200,
    ok: true,
    configured: true,
    authConfigured: true,
    qaDelayMs: 0,
    tokenPolicyConfigured: true,
    tokenPolicyIssuerPresent: true,
    tokenPolicySignedTokenConfigured: true,
    corsOriginMatches: true,
    cacheControlNoStore: true,
  });
  validateSmokeTokenPolicy(checks.healthz);
  validateSmokeCheck(checks.options, 'options', {
    status: 204,
    corsOriginMatches: true,
    allowsPost: true,
    allowsAuthorization: true,
    allowsSessionToken: true,
    allowsIdempotencyKey: true,
  });
  validateSmokeCheck(checks.missingSessionToken, 'missingSessionToken', {
    status: 401,
    errorCode: 'missing_session_token',
    corsOriginMatches: true,
  });
  validateSmokeCheck(checks.disallowedOrigin, 'disallowedOrigin', {
    status: 403,
    errorCode: 'origin_not_allowed',
    corsOriginAbsent: true,
  });
  validateSmokeCheck(checks.safeError, 'safeError', {
    errorCodePresent: true,
    responseEchoedSensitive: false,
    corsOriginMatches: true,
  });

  const safeStatus = checks.safeError?.status;
  if (safeStatus !== 400 && safeStatus !== 503) {
    addError(`${pointer}.checks.safeError.status`, 'must be 400 or 503');
  }
  validateSmokeRateLimitPolicy(checks.healthz);
  validateSmokeRetryPolicy(checks.healthz);
}

function validateSmokeCheck(check, key, expectedFields) {
  const pointer = `deploymentSmokeEvidence.checks.${key}`;
  if (!check || typeof check !== 'object' || Array.isArray(check)) {
    addError(pointer, 'missing required smoke check object');
    return;
  }

  for (const [field, expected] of Object.entries(expectedFields)) {
    if (check[field] !== expected) {
      addError(`${pointer}.${field}`, `must be ${JSON.stringify(expected)}`);
    }
  }
}

function validateSmokeTokenPolicy(healthz) {
  const pointer = 'deploymentSmokeEvidence.checks.healthz';
  if (!healthz || typeof healthz !== 'object' || Array.isArray(healthz)) return;

  validateNumberRange(healthz.tokenPolicyTtlSeconds, 1, 86_400, `${pointer}.tokenPolicyTtlSeconds`);
  validateNumberRange(healthz.tokenPolicyRotationDays, 1, 30, `${pointer}.tokenPolicyRotationDays`);
  validateNumberRange(healthz.tokenPolicyActiveTokenCount, 1, 1_000, `${pointer}.tokenPolicyActiveTokenCount`);
}

function validateSmokeRateLimitPolicy(healthz) {
  const pointer = 'deploymentSmokeEvidence.checks.healthz';
  if (!healthz || typeof healthz !== 'object' || Array.isArray(healthz)) return;

  validateNumberRange(healthz.rateLimitWindowMs, 1, 86_400_000, `${pointer}.rateLimitWindowMs`);
  validateNumberRange(healthz.rateLimitMax, 1, 100_000, `${pointer}.rateLimitMax`);
}

function validateSmokeRetryPolicy(healthz) {
  const pointer = 'deploymentSmokeEvidence.checks.healthz';
  if (!healthz || typeof healthz !== 'object' || Array.isArray(healthz)) return;

  validateNumberRange(healthz.idempotencyTtlMs, 1, 86_400_000, `${pointer}.idempotencyTtlMs`);
  validateNumberRange(healthz.idempotencyMaxEntries, 1, 100_000, `${pointer}.idempotencyMaxEntries`);
  validateNumberRange(
    healthz.circuitBreakerFailureThreshold,
    1,
    100,
    `${pointer}.circuitBreakerFailureThreshold`,
  );
  validateNumberRange(
    healthz.circuitBreakerCooldownMs,
    1,
    3_600_000,
    `${pointer}.circuitBreakerCooldownMs`,
  );

  if (healthz.circuitBreakerOpen !== false) {
    addError(`${pointer}.circuitBreakerOpen`, 'must be false for production smoke evidence');
  }
}

function validateNumberRange(value, min, max, pointer) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    addError(pointer, `must be a number from ${min} to ${max}`);
  }
}

function normalizeEvidenceBaseUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function isIsoDateTime(value) {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && value.includes('T');
}

function getCurrentEchoAppVersion() {
  if (currentEchoAppVersion !== null) {
    return currentEchoAppVersion;
  }

  try {
    const packagePath = path.resolve(process.cwd(), 'even-app/package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    currentEchoAppVersion = typeof packageJson.version === 'string' ? packageJson.version : '';
  } catch {
    currentEchoAppVersion = '';
  }
  return currentEchoAppVersion;
}

function isPrivateIpv4(host) {
  const parts = host.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
  );
}

function validateSessionTokenPolicyFields() {
  validateDurationField('Session token TTL', 1, 86_400);
  validateDurationField('Session token rotation cadence', 1, 30 * 24 * 60 * 60);

  const issuer = fields.get('Session token issuer') ?? '';
  if (!(allowDraft && isPlaceholder(issuer)) && !/(issuer|session|auth|secret|edge|server)/i.test(issuer)) {
    addError('field.Session token issuer', 'must identify a server-side token issuer or secret-manager reference');
  }

  const boundary = fields.get('Session token storage boundary') ?? '';
  if (!(allowDraft && isPlaceholder(boundary)) && !/(server|secret manager|edge config|issuer)/i.test(boundary)) {
    addError('field.Session token storage boundary', 'must confirm server-side storage boundary');
  }
}

function validateDurationField(field, minSeconds, maxSeconds) {
  const value = fields.get(field) ?? '';
  if (allowDraft && isPlaceholder(value)) return;

  const seconds = parseDurationSeconds(value);
  if (seconds === null) {
    addError(`field.${field}`, 'must include a numeric duration with units');
    return;
  }
  if (seconds < minSeconds || seconds > maxSeconds) {
    addError(`field.${field}`, `must be between ${minSeconds} and ${maxSeconds} seconds`);
  }
}

function parseDurationSeconds(value) {
  const match = String(value || '').match(/\b(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/i);
  if (!match) return null;

  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = match[2].toLowerCase();
  if (unit === 's' || unit.startsWith('sec') || unit.startsWith('second')) return amount;
  if (unit === 'm' || unit.startsWith('min') || unit.startsWith('minute')) return amount * 60;
  if (unit === 'h' || unit.startsWith('hr') || unit.startsWith('hour')) return amount * 60 * 60;
  if (unit === 'd' || unit.startsWith('day')) return amount * 24 * 60 * 60;
  return null;
}

function validatePositiveEvidenceField(field) {
  const value = fields.get(field) ?? '';
  if (allowDraft && isPlaceholder(value)) return;
  if (!POSITIVE_EVIDENCE_PATTERNS.some((pattern) => pattern.test(value))) {
    addError(`field.${field}`, 'must include a positive confirmation such as true, passed, confirmed, or verified');
  }
}

function validateCleanScanField(field) {
  const value = fields.get(field) ?? '';
  if (allowDraft && isPlaceholder(value)) return;
  if (!CLEAN_SCAN_PATTERNS.some((pattern) => pattern.test(value))) {
    addError(`field.${field}`, 'must include clean scan evidence such as 0 matches, no matches, none found, clean, or passed');
  }
}

const maxDisplayedFindings = verbose ? Number.POSITIVE_INFINITY : 25;

function printFindings(kind, findings, writer) {
  const visibleFindings = findings.slice(0, maxDisplayedFindings);
  for (const finding of visibleFindings) {
    writer(`[key-rotation] ${kind} ${finding}`);
  }
  if (findings.length > visibleFindings.length) {
    writer(
      `[key-rotation] ${findings.length - visibleFindings.length} more ${kind}(s) hidden; rerun with --verbose to print all`,
    );
  }
}

if (warnings.length > 0) {
  if (allowDraft && !verbose) {
    console.info(`[key-rotation] ${warnings.length} draft placeholder warning(s); rerun with --verbose to print all`);
  } else {
    printFindings('warning', warnings, console.warn);
  }
}

const displayPath = path.relative(process.cwd(), targetPath) || targetPath;
if (errors.length > 0) {
  printFindings('error', errors, console.error);
  console.error(`[key-rotation] ${errors.length} error(s) found in ${displayPath}`);
  process.exit(1);
}

const modeLabel = allowDraft ? 'draft template shape accepted' : 'final key-rotation evidence accepted';
console.info(`[key-rotation] ${modeLabel}: ${displayPath}`);
