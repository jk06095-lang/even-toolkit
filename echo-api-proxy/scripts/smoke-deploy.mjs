#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const wantsHelp = args.includes('--help') || args.includes('-h');

const baseUrl = readOption('--base-url') || process.env.ECHO_PROXY_BASE_URL || '';
const rawAllowedOrigin = readOption('--allowed-origin') || process.env.ECHO_PROXY_SMOKE_ORIGIN || '';
const sessionToken = readOption('--session-token') || process.env.ECHO_PROXY_SMOKE_SESSION_TOKEN || '';
const evidenceOut = readOption('--evidence-out') || process.env.ECHO_PROXY_SMOKE_EVIDENCE_OUT || '';
const rawDisallowedOrigin =
  readOption('--disallowed-origin') ||
  process.env.ECHO_PROXY_SMOKE_DISALLOWED_ORIGIN ||
  'https://blocked.project-echo.invalid';
const allowHttp = args.includes('--allow-http');
const allowUnconfigured = args.includes('--allow-unconfigured');
const allowUnauthenticated = args.includes('--allow-unauthenticated');
const allowQaDelay = args.includes('--allow-qa-delay');

if (wantsHelp || !baseUrl || !rawAllowedOrigin) {
  console.info(`Usage: npm run smoke:deploy -- --base-url https://api.project-echo.app --allowed-origin https://your-client-origin --session-token <short-lived-token> [--evidence-out ../docs/proxy-smoke-evidence.json]

Environment alternatives:
  ECHO_PROXY_BASE_URL
  ECHO_PROXY_SMOKE_ORIGIN
  ECHO_PROXY_SMOKE_SESSION_TOKEN
  ECHO_PROXY_SMOKE_DISALLOWED_ORIGIN
  ECHO_PROXY_SMOKE_EVIDENCE_OUT

Default release behavior requires HTTPS, /healthz configured=true, authConfigured=true, tokenPolicy.configured=true, signed-token support, a supplied smoke session token, and qaDelayMs=0.
Use --allow-http, --allow-unconfigured, --allow-unauthenticated, and --allow-qa-delay only for local smoke testing.`);
  process.exit(wantsHelp ? 0 : 1);
}

const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
const allowedOrigin = normalizeOrigin(rawAllowedOrigin, '--allowed-origin', { allowLocal: allowHttp });
const disallowedOrigin = normalizeOrigin(rawDisallowedOrigin, '--disallowed-origin', { allowLocal: allowHttp });
const failures = [];
const evidence = {
  schema: 'project-echo-proxy-smoke-v1',
  generatedAt: new Date().toISOString(),
  baseUrl: normalizedBaseUrl,
  allowedOrigin,
  disallowedOrigin,
  allowHttp,
  allowUnconfigured,
  allowUnauthenticated,
  allowQaDelay,
  sessionTokenProvided: Boolean(sessionToken),
  ok: false,
  checks: {},
};

if (!sessionToken && !allowUnauthenticated) {
  fail('release smoke requires --session-token or ECHO_PROXY_SMOKE_SESSION_TOKEN');
}
if (allowedOrigin === disallowedOrigin) {
  fail('--disallowed-origin must differ from --allowed-origin');
}

function fail(message) {
  failures.push(message);
}

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return '';
  return args[index + 1] || '';
}

function normalizeBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    console.error(`[proxy-smoke] invalid --base-url: ${value}`);
    process.exit(1);
  }

  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    console.error('[proxy-smoke] release smoke requires https:// base URL; pass --allow-http only for local checks');
    process.exit(1);
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function normalizeOrigin(value, optionName, { allowLocal = false } = {}) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    console.error(`[proxy-smoke] invalid ${optionName}: ${value}`);
    process.exit(1);
  }

  const isHttpAllowed = allowHttp && parsed.protocol === 'http:';
  if (parsed.protocol !== 'https:' && !isHttpAllowed) {
    console.error(`[proxy-smoke] release smoke requires ${optionName} to use https://; pass --allow-http only for local checks`);
    process.exit(1);
  }

  if (parsed.origin !== value.replace(/\/$/, '')) {
    console.error(`[proxy-smoke] ${optionName} must be an origin without path, query, or hash`);
    process.exit(1);
  }

  if (!allowLocal && isLocalHost(parsed.hostname)) {
    console.error(`[proxy-smoke] release smoke ${optionName} must not point to localhost or a private network host`);
    process.exit(1);
  }

  return parsed.origin;
}

function isLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '127.0.0.1' ||
    host === '::1'
  ) {
    return true;
  }
  const parts = host.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

async function fetchText(path, options = {}) {
  const response = await fetch(`${normalizedBaseUrl}${path}`, options);
  const text = await response.text();
  return { response, text, body: parseJson(text) };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function header(response, name) {
  return response.headers.get(name);
}

function authHeaders() {
  if (!sessionToken) return {};
  return { Authorization: `Bearer ${sessionToken}` };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertNumberInRange(actual, min, max, label) {
  if (typeof actual !== 'number' || !Number.isFinite(actual) || actual < min || actual > max) {
    fail(`${label}: expected number from ${min} to ${max}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(haystack, needle, label) {
  if (!String(haystack || '').includes(needle)) {
    fail(`${label}: expected to include ${JSON.stringify(needle)}`);
  }
}

function assertNotIncludes(haystack, needle, label) {
  if (String(haystack || '').includes(needle)) {
    fail(`${label}: must not include ${JSON.stringify(needle)}`);
  }
}

async function checkHealthz() {
  const { response, body } = await fetchText('/healthz', {
    headers: { Origin: allowedOrigin },
  });
  evidence.checks.healthz = {
    status: response.status,
    ok: body?.ok === true,
    configured: body?.configured === true,
    authConfigured: body?.authConfigured === true,
    qaDelayMs: body?.qaDelayMs ?? 0,
    tokenPolicyConfigured: body?.tokenPolicy?.configured === true,
    tokenPolicyIssuerPresent: typeof body?.tokenPolicy?.issuer === 'string' && body.tokenPolicy.issuer.trim().length > 0,
    tokenPolicyAudience: body?.tokenPolicy?.audience ?? null,
    tokenPolicyTtlSeconds: body?.tokenPolicy?.ttlSeconds ?? null,
    tokenPolicyRotationDays: body?.tokenPolicy?.rotationDays ?? null,
    tokenPolicyActiveTokenCount: body?.tokenPolicy?.activeTokenCount ?? null,
    tokenPolicySignedTokenConfigured: body?.tokenPolicy?.signedTokenConfigured === true,
    rateLimitWindowMs: body?.rateLimit?.windowMs ?? null,
    rateLimitMax: body?.rateLimit?.max ?? null,
    idempotencyTtlMs: body?.idempotency?.ttlMs ?? null,
    idempotencyMaxEntries: body?.idempotency?.maxEntries ?? null,
    circuitBreakerFailureThreshold: body?.circuitBreaker?.failureThreshold ?? null,
    circuitBreakerCooldownMs: body?.circuitBreaker?.cooldownMs ?? null,
    circuitBreakerOpen: body?.circuitBreaker?.open === true,
    corsOriginMatches: header(response, 'access-control-allow-origin') === allowedOrigin,
    cacheControlNoStore: String(header(response, 'cache-control') || '').includes('no-store'),
  };

  assertEqual(response.status, 200, 'GET /healthz status');
  assertEqual(body?.ok, true, 'GET /healthz ok');
  if (!allowUnconfigured) {
    assertEqual(body?.configured, true, 'GET /healthz configured');
  }
  if (!allowUnauthenticated) {
    assertEqual(body?.authConfigured, true, 'GET /healthz authConfigured');
    assertEqual(Boolean(sessionToken), true, 'smoke session token configured');
    assertEqual(body?.tokenPolicy?.configured, true, 'GET /healthz tokenPolicy.configured');
    assertEqual(body?.tokenPolicy?.signedTokenConfigured, true, 'GET /healthz tokenPolicy.signedTokenConfigured');
    assertEqual(typeof body?.tokenPolicy?.issuer === 'string' && body.tokenPolicy.issuer.trim().length > 0, true, 'GET /healthz tokenPolicy.issuer');
    assertNumberInRange(body?.tokenPolicy?.ttlSeconds, 1, 86_400, 'GET /healthz tokenPolicy.ttlSeconds');
    assertNumberInRange(body?.tokenPolicy?.rotationDays, 1, 30, 'GET /healthz tokenPolicy.rotationDays');
    assertNumberInRange(body?.tokenPolicy?.activeTokenCount, 1, 1_000, 'GET /healthz tokenPolicy.activeTokenCount');
  }
  if (!allowQaDelay) {
    assertEqual(body?.qaDelayMs ?? 0, 0, 'GET /healthz qaDelayMs');
  }
  assertNumberInRange(body?.rateLimit?.windowMs, 1, 86_400_000, 'GET /healthz rateLimit.windowMs');
  assertNumberInRange(body?.rateLimit?.max, 1, 100_000, 'GET /healthz rateLimit.max');
  assertNumberInRange(body?.idempotency?.ttlMs, 1, 86_400_000, 'GET /healthz idempotency.ttlMs');
  assertNumberInRange(body?.idempotency?.maxEntries, 1, 100_000, 'GET /healthz idempotency.maxEntries');
  assertNumberInRange(body?.circuitBreaker?.failureThreshold, 1, 100, 'GET /healthz circuitBreaker.failureThreshold');
  assertNumberInRange(body?.circuitBreaker?.cooldownMs, 1, 3_600_000, 'GET /healthz circuitBreaker.cooldownMs');
  assertEqual(body?.circuitBreaker?.open ?? false, false, 'GET /healthz circuitBreaker.open');
  assertEqual(header(response, 'access-control-allow-origin'), allowedOrigin, 'GET /healthz CORS origin');
  assertIncludes(header(response, 'cache-control'), 'no-store', 'GET /healthz cache-control');

  console.info(`[proxy-smoke] /healthz ok configured=${body?.configured} qaDelayMs=${body?.qaDelayMs ?? 0}`);
}

async function checkOptions() {
  const { response } = await fetchText('/v1/cue', {
    method: 'OPTIONS',
    headers: {
      Origin: allowedOrigin,
      'Access-Control-Request-Method': 'POST',
    },
  });
  evidence.checks.options = {
    status: response.status,
    corsOriginMatches: header(response, 'access-control-allow-origin') === allowedOrigin,
    allowsPost: String(header(response, 'access-control-allow-methods') || '').includes('POST'),
    allowsAuthorization: String(header(response, 'access-control-allow-headers') || '').includes('Authorization'),
    allowsSessionToken: String(header(response, 'access-control-allow-headers') || '').includes('X-Echo-Session-Token'),
    allowsIdempotencyKey: String(header(response, 'access-control-allow-headers') || '').includes('Idempotency-Key'),
  };

  assertEqual(response.status, 204, 'OPTIONS /v1/cue status');
  assertEqual(header(response, 'access-control-allow-origin'), allowedOrigin, 'OPTIONS /v1/cue CORS origin');
  assertIncludes(header(response, 'access-control-allow-methods'), 'POST', 'OPTIONS /v1/cue methods');
  assertIncludes(header(response, 'access-control-allow-headers'), 'Authorization', 'OPTIONS /v1/cue headers');
  assertIncludes(header(response, 'access-control-allow-headers'), 'X-Echo-Session-Token', 'OPTIONS /v1/cue headers');
  assertIncludes(header(response, 'access-control-allow-headers'), 'Idempotency-Key', 'OPTIONS /v1/cue headers');
  console.info('[proxy-smoke] OPTIONS /v1/cue ok');
}

async function checkMissingSessionToken() {
  if (allowUnauthenticated) {
    evidence.checks.missingSessionToken = {
      skipped: true,
      reason: 'allowUnauthenticated local override',
    };
    return;
  }

  const { response, body } = await fetchText('/v1/cue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
    },
    body: JSON.stringify({ topic: 'auth smoke' }),
  });
  evidence.checks.missingSessionToken = {
    status: response.status,
    errorCode: body?.error?.code ?? null,
    corsOriginMatches: header(response, 'access-control-allow-origin') === allowedOrigin,
  };

  assertEqual(response.status, 401, 'missing session token status');
  assertEqual(body?.error?.code, 'missing_session_token', 'missing session token error code');
  assertEqual(header(response, 'access-control-allow-origin'), allowedOrigin, 'missing session token CORS origin');
  console.info('[proxy-smoke] missing session token rejected');
}

async function checkDisallowedOrigin() {
  const { response, body } = await fetchText('/v1/cue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: disallowedOrigin,
    },
    body: JSON.stringify({ topic: 'blocked origin smoke' }),
  });
  evidence.checks.disallowedOrigin = {
    status: response.status,
    errorCode: body?.error?.code ?? null,
    corsOriginAbsent: header(response, 'access-control-allow-origin') === null,
  };

  assertEqual(response.status, 403, 'blocked origin status');
  assertEqual(body?.error?.code, 'origin_not_allowed', 'blocked origin error code');
  assertEqual(header(response, 'access-control-allow-origin'), null, 'blocked origin CORS origin');
  console.info('[proxy-smoke] disallowed origin rejected');
}

async function checkSafeErrorNoEcho() {
  const sensitive = 'raw learner sentence must never echo from smoke';
  const { response, text, body } = await fetchText('/v1/transcribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
      ...authHeaders(),
    },
    body: JSON.stringify({
      task: 'transcribe',
      lastUtterance: sensitive,
      audio: {
        mimeType: 'audio/wav',
        data: '',
      },
    }),
  });
  evidence.checks.safeError = {
    status: response.status,
    errorCode: body?.error?.code ?? null,
    errorCodePresent: Boolean(body?.error?.code),
    responseEchoedSensitive: text.includes(sensitive),
    corsOriginMatches: header(response, 'access-control-allow-origin') === allowedOrigin,
  };

  if (![400, 503].includes(response.status)) {
    fail(`safe error status: expected 400 or 503, got ${response.status}`);
  }
  assertEqual(Boolean(body?.error?.code), true, 'safe error code present');
  assertNotIncludes(text, sensitive, 'safe error body');
  assertEqual(header(response, 'access-control-allow-origin'), allowedOrigin, 'safe error CORS origin');
  console.info(`[proxy-smoke] safe error ok status=${response.status} code=${body?.error?.code}`);
}

try {
  await checkHealthz();
  await checkOptions();
  await checkMissingSessionToken();
  await checkDisallowedOrigin();
  await checkSafeErrorNoEcho();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

evidence.ok = failures.length === 0;
writeEvidence();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[proxy-smoke] error ${failure}`);
  }
  process.exit(1);
}

console.info(`[proxy-smoke] deployment smoke passed for ${normalizedBaseUrl}`);

function writeEvidence() {
  if (!evidenceOut) return;
  const outputPath = path.resolve(process.cwd(), evidenceOut);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.info(`[proxy-smoke] evidence written to ${outputPath}`);
}
