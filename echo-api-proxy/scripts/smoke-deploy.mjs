#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const wantsHelp = args.includes('--help') || args.includes('-h');

const baseUrl = readOption('--base-url') || process.env.ECHO_PROXY_BASE_URL || '';
const allowedOrigin = readOption('--allowed-origin') || process.env.ECHO_PROXY_SMOKE_ORIGIN || '';
const evidenceOut = readOption('--evidence-out') || process.env.ECHO_PROXY_SMOKE_EVIDENCE_OUT || '';
const disallowedOrigin =
  readOption('--disallowed-origin') ||
  process.env.ECHO_PROXY_SMOKE_DISALLOWED_ORIGIN ||
  'https://blocked.project-echo.invalid';
const allowHttp = args.includes('--allow-http');
const allowUnconfigured = args.includes('--allow-unconfigured');
const allowQaDelay = args.includes('--allow-qa-delay');

if (wantsHelp || !baseUrl || !allowedOrigin) {
  console.info(`Usage: npm run smoke:deploy -- --base-url https://api.project-echo.app --allowed-origin https://your-client-origin [--evidence-out ../docs/proxy-smoke-evidence.json]

Environment alternatives:
  ECHO_PROXY_BASE_URL
  ECHO_PROXY_SMOKE_ORIGIN
  ECHO_PROXY_SMOKE_DISALLOWED_ORIGIN
  ECHO_PROXY_SMOKE_EVIDENCE_OUT

Default release behavior requires HTTPS, /healthz configured=true, and qaDelayMs=0.
Use --allow-http, --allow-unconfigured, and --allow-qa-delay only for local smoke testing.`);
  process.exit(wantsHelp ? 0 : 1);
}

const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
const failures = [];
const evidence = {
  schema: 'project-echo-proxy-smoke-v1',
  generatedAt: new Date().toISOString(),
  baseUrl: normalizedBaseUrl,
  allowedOrigin,
  disallowedOrigin,
  allowHttp,
  allowUnconfigured,
  allowQaDelay,
  ok: false,
  checks: {},
};

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

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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
    qaDelayMs: body?.qaDelayMs ?? 0,
    corsOriginMatches: header(response, 'access-control-allow-origin') === allowedOrigin,
    cacheControlNoStore: String(header(response, 'cache-control') || '').includes('no-store'),
  };

  assertEqual(response.status, 200, 'GET /healthz status');
  assertEqual(body?.ok, true, 'GET /healthz ok');
  if (!allowUnconfigured) {
    assertEqual(body?.configured, true, 'GET /healthz configured');
  }
  if (!allowQaDelay) {
    assertEqual(body?.qaDelayMs ?? 0, 0, 'GET /healthz qaDelayMs');
  }
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
  };

  assertEqual(response.status, 204, 'OPTIONS /v1/cue status');
  assertEqual(header(response, 'access-control-allow-origin'), allowedOrigin, 'OPTIONS /v1/cue CORS origin');
  assertIncludes(header(response, 'access-control-allow-methods'), 'POST', 'OPTIONS /v1/cue methods');
  console.info('[proxy-smoke] OPTIONS /v1/cue ok');
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
