#!/usr/bin/env node

const args = process.argv.slice(2);
const wantsHelp = args.includes('--help') || args.includes('-h');

const baseUrl = readOption('--base-url') || process.env.ECHO_PROXY_BASE_URL || '';
const allowedOrigin = readOption('--allowed-origin') || process.env.ECHO_PROXY_SMOKE_ORIGIN || '';
const disallowedOrigin =
  readOption('--disallowed-origin') ||
  process.env.ECHO_PROXY_SMOKE_DISALLOWED_ORIGIN ||
  'https://blocked.project-echo.invalid';
const allowHttp = args.includes('--allow-http');
const allowUnconfigured = args.includes('--allow-unconfigured');

if (wantsHelp || !baseUrl || !allowedOrigin) {
  console.info(`Usage: npm run smoke:deploy -- --base-url https://api.project-echo.app --allowed-origin https://your-client-origin

Environment alternatives:
  ECHO_PROXY_BASE_URL
  ECHO_PROXY_SMOKE_ORIGIN
  ECHO_PROXY_SMOKE_DISALLOWED_ORIGIN

Default release behavior requires HTTPS and /healthz configured=true.
Use --allow-http and --allow-unconfigured only for local smoke testing.`);
  process.exit(wantsHelp ? 0 : 1);
}

const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
const failures = [];

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

  assertEqual(response.status, 200, 'GET /healthz status');
  assertEqual(body?.ok, true, 'GET /healthz ok');
  if (!allowUnconfigured) {
    assertEqual(body?.configured, true, 'GET /healthz configured');
  }
  assertEqual(header(response, 'access-control-allow-origin'), allowedOrigin, 'GET /healthz CORS origin');
  assertIncludes(header(response, 'cache-control'), 'no-store', 'GET /healthz cache-control');

  console.info(`[proxy-smoke] /healthz ok configured=${body?.configured}`);
}

async function checkOptions() {
  const { response } = await fetchText('/v1/cue', {
    method: 'OPTIONS',
    headers: {
      Origin: allowedOrigin,
      'Access-Control-Request-Method': 'POST',
    },
  });

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

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[proxy-smoke] error ${failure}`);
  }
  process.exit(1);
}

console.info(`[proxy-smoke] deployment smoke passed for ${normalizedBaseUrl}`);
