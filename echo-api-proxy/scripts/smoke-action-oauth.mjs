#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_SCOPES = [
  'profile:read',
  'review:read',
  'review:write',
  'roleplay:write',
  'session:write',
];

const args = process.argv.slice(2);
const wantsHelp = args.includes('--help') || args.includes('-h');

const baseUrl = readOption('--base-url') || process.env.ECHO_ACTION_SMOKE_BASE_URL || process.env.ECHO_PROXY_BASE_URL || '';
const allowedOrigin = readOption('--allowed-origin') || process.env.ECHO_ACTION_SMOKE_ORIGIN || process.env.ECHO_PROXY_SMOKE_ORIGIN || '';
const clientId = readOption('--client-id') || process.env.ECHO_ACTION_OAUTH_CLIENT_ID || '';
const clientSecret = readOption('--client-secret') || process.env.ECHO_ACTION_OAUTH_CLIENT_SECRET || '';
const redirectUri =
  readOption('--redirect-uri') ||
  process.env.ECHO_ACTION_OAUTH_REDIRECT_URI ||
  'https://chatgpt.com/aip/project-echo/oauth/callback';
const evidenceOut = readOption('--evidence-out') || process.env.ECHO_ACTION_SMOKE_EVIDENCE_OUT || '';
const allowHttp = args.includes('--allow-http');

if (wantsHelp || !baseUrl || !allowedOrigin || !clientId || !clientSecret) {
  console.info(`Usage: npm run smoke:action-oauth -- --base-url https://api.project-echo.app --allowed-origin https://your-client-origin --client-id <client-id> --client-secret <client-secret> [--redirect-uri https://chatgpt.com/aip/project-echo/oauth/callback] [--evidence-out ../docs/chatgpt-action-oauth-smoke.json]

Environment alternatives:
  ECHO_ACTION_SMOKE_BASE_URL or ECHO_PROXY_BASE_URL
  ECHO_ACTION_SMOKE_ORIGIN or ECHO_PROXY_SMOKE_ORIGIN
  ECHO_ACTION_OAUTH_CLIENT_ID
  ECHO_ACTION_OAUTH_CLIENT_SECRET
  ECHO_ACTION_OAUTH_REDIRECT_URI
  ECHO_ACTION_SMOKE_EVIDENCE_OUT

Default release behavior requires an HTTPS base URL and writes no OAuth access token or client secret to evidence.
Use --allow-http only for local smoke testing.`);
  process.exit(wantsHelp ? 0 : 1);
}

const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
const normalizedRedirectUri = normalizeHttpsUrl(redirectUri, '--redirect-uri');
const failures = [];
let accessToken = '';
let seedItemId = '';
let roleplayId = '';

const evidence = {
  schema: 'project-echo-action-oauth-smoke-v1',
  generatedAt: new Date().toISOString(),
  baseUrl: normalizedBaseUrl,
  allowedOrigin,
  redirectUri: normalizedRedirectUri,
  clientIdFingerprint: hashForEvidence(clientId),
  clientSecretProvided: Boolean(clientSecret),
  accessTokenStoredInEvidence: false,
  requestedScopes: REQUIRED_SCOPES,
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
  const parsed = parseUrl(value, '--base-url');
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    console.error('[action-oauth-smoke] release smoke requires https:// base URL; pass --allow-http only for local checks');
    process.exit(1);
  }
  if (!allowHttp && isLocalHost(parsed.hostname)) {
    console.error('[action-oauth-smoke] release smoke must not point to localhost or a private network host');
    process.exit(1);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function normalizeHttpsUrl(value, label) {
  const parsed = parseUrl(value, label);
  if (parsed.protocol !== 'https:') {
    console.error(`[action-oauth-smoke] ${label} must use https://`);
    process.exit(1);
  }
  parsed.hash = '';
  return parsed.toString();
}

function parseUrl(value, label) {
  try {
    return new URL(value);
  } catch {
    console.error(`[action-oauth-smoke] invalid ${label}: ${value}`);
    process.exit(1);
  }
}

function isLocalHost(hostname) {
  const host = hostname.toLowerCase();
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

function hashForEvidence(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

async function fetchText(urlOrPath, options = {}) {
  const url = urlOrPath.startsWith('http') ? urlOrPath : `${normalizedBaseUrl}${urlOrPath}`;
  const response = await fetch(url, options);
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

function assertTrue(value, label) {
  if (value !== true) fail(`${label}: expected true, got ${JSON.stringify(value)}`);
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

function noStore(response) {
  return String(header(response, 'cache-control') || '').includes('no-store');
}

function corsMatches(response) {
  return header(response, 'access-control-allow-origin') === allowedOrigin;
}

function hasNoSensitiveReturned(text) {
  return !/(rawTranscript|fullTranscript|audioBase64|test@example\.com|providerSecret|AIza|sk-)/i.test(text);
}

async function checkHealthz() {
  const { response, body } = await fetchText('/healthz', {
    headers: { Origin: allowedOrigin },
  });
  const scopes = Array.isArray(body?.actionOAuth?.scopes) ? body.actionOAuth.scopes : [];
  evidence.checks.healthz = {
    status: response.status,
    ok: body?.ok === true,
    actionOAuthConfigured: body?.actionOAuth?.configured === true,
    authorizationCode: body?.actionOAuth?.authorizationCode === true,
    tokenTtlSeconds: body?.actionOAuth?.tokenTtlSeconds ?? null,
    redirectOriginCount: body?.actionOAuth?.redirectOriginCount ?? null,
    scopes,
    corsOriginMatches: corsMatches(response),
    cacheControlNoStore: noStore(response),
  };

  assertEqual(response.status, 200, 'GET /healthz status');
  assertTrue(body?.ok === true, 'GET /healthz ok');
  assertTrue(body?.actionOAuth?.configured === true, 'GET /healthz actionOAuth.configured');
  assertTrue(body?.actionOAuth?.authorizationCode === true, 'GET /healthz actionOAuth.authorizationCode');
  assertNumberInRange(body?.actionOAuth?.tokenTtlSeconds, 1, 86_400, 'GET /healthz actionOAuth.tokenTtlSeconds');
  assertNumberInRange(body?.actionOAuth?.redirectOriginCount, 1, 100, 'GET /healthz actionOAuth.redirectOriginCount');
  for (const scope of REQUIRED_SCOPES) assertIncludes(scopes.join(' '), scope, `GET /healthz actionOAuth.scopes ${scope}`);
  assertTrue(corsMatches(response), 'GET /healthz CORS origin');
  assertTrue(noStore(response), 'GET /healthz cache-control');
  console.info('[action-oauth-smoke] /healthz Action OAuth metadata ok');
}

async function checkOAuthFlow() {
  const state = `state_${randomUUID().replace(/-/g, '')}`;
  const authorizeUrl = new URL(`${normalizedBaseUrl}/oauth/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', normalizedRedirectUri);
  authorizeUrl.searchParams.set('scope', REQUIRED_SCOPES.join(' '));
  authorizeUrl.searchParams.set('state', state);

  const authorize = await fetchText(authorizeUrl.toString(), {
    headers: { Origin: allowedOrigin },
    redirect: 'manual',
  });
  const location = header(authorize.response, 'location') || '';
  let callbackUrl = null;
  let code = '';
  try {
    callbackUrl = new URL(location);
    code = callbackUrl.searchParams.get('code') || '';
  } catch {
    // Failure is recorded below.
  }

  evidence.checks.oauthAuthorize = {
    status: authorize.response.status,
    redirected: authorize.response.status === 302,
    redirectedToConfiguredUri: callbackUrl
      ? callbackUrl.origin + callbackUrl.pathname === new URL(normalizedRedirectUri).origin + new URL(normalizedRedirectUri).pathname
      : false,
    codeReturned: code.startsWith('echo_code_'),
    stateReturned: callbackUrl?.searchParams.get('state') === state,
    corsOriginMatches: corsMatches(authorize.response),
    cacheControlNoStore: noStore(authorize.response),
  };
  assertEqual(authorize.response.status, 302, 'GET /oauth/authorize status');
  assertTrue(evidence.checks.oauthAuthorize.redirectedToConfiguredUri, 'GET /oauth/authorize redirect_uri');
  assertTrue(code.startsWith('echo_code_'), 'GET /oauth/authorize code');
  assertTrue(callbackUrl?.searchParams.get('state') === state, 'GET /oauth/authorize state');
  assertTrue(corsMatches(authorize.response), 'GET /oauth/authorize CORS origin');
  assertTrue(noStore(authorize.response), 'GET /oauth/authorize cache-control');

  const tokenResponse = await fetchText('/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      Origin: allowedOrigin,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: normalizedRedirectUri,
    }),
  });
  accessToken = tokenResponse.body?.access_token || '';
  const responseEchoedClientSecret = tokenResponse.text.includes(clientSecret);
  evidence.checks.oauthToken = {
    status: tokenResponse.response.status,
    tokenTypeBearer: tokenResponse.body?.token_type === 'Bearer',
    accessTokenReturned: accessToken.startsWith('echo_oauth_'),
    accessTokenStoredInEvidence: false,
    expiresInSeconds: tokenResponse.body?.expires_in ?? null,
    scope: tokenResponse.body?.scope ?? null,
    responseEchoedClientSecret,
    corsOriginMatches: corsMatches(tokenResponse.response),
    cacheControlNoStore: noStore(tokenResponse.response),
  };

  assertEqual(tokenResponse.response.status, 200, 'POST /oauth/token status');
  assertTrue(tokenResponse.body?.token_type === 'Bearer', 'POST /oauth/token token_type');
  assertTrue(accessToken.startsWith('echo_oauth_'), 'POST /oauth/token access_token');
  assertNumberInRange(tokenResponse.body?.expires_in, 1, 86_400, 'POST /oauth/token expires_in');
  assertEqual(
    normalizeScopeText(tokenResponse.body?.scope),
    REQUIRED_SCOPES.join(' '),
    'POST /oauth/token scope',
  );
  assertTrue(responseEchoedClientSecret === false, 'POST /oauth/token client secret not echoed');
  assertTrue(corsMatches(tokenResponse.response), 'POST /oauth/token CORS origin');
  assertTrue(noStore(tokenResponse.response), 'POST /oauth/token cache-control');
  console.info('[action-oauth-smoke] OAuth authorization-code exchange ok');
}

function normalizeScopeText(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function actionHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Origin: allowedOrigin,
    ...extra,
  };
}

async function checkActionEndpoints() {
  const profile = await fetchJsonAction('/v1/learner/profile', 'GET');
  seedItemId = profile.body?.learningItems?.[0]?.id || 'li_ask_repeat_seed';
  recordEndpointEvidence('learnerProfile', profile, {
    schemaVersion: profile.body?.schemaVersion ?? null,
  });
  assertEqual(profile.response.status, 200, 'GET /v1/learner/profile status');
  assertEqual(profile.body?.schemaVersion, '2.0.0', 'GET /v1/learner/profile schemaVersion');
  assertTrue(Array.isArray(profile.body?.learningItems), 'GET /v1/learner/profile learningItems');

  const reviews = await fetchJsonAction('/v1/reviews/next?limit=1', 'GET');
  recordEndpointEvidence('reviewsNext', reviews, {
    schemaVersion: reviews.body?.schemaVersion ?? null,
  });
  assertEqual(reviews.response.status, 200, 'GET /v1/reviews/next status');
  assertEqual(reviews.body?.schemaVersion, '2.0.0', 'GET /v1/reviews/next schemaVersion');
  assertTrue(Array.isArray(reviews.body?.items), 'GET /v1/reviews/next items');

  const reviewAttempt = await fetchJsonAction('/v1/reviews/attempt', 'POST', {
    schemaVersion: '2.0.0',
    itemId: seedItemId,
    mode: 'meaning_to_expression',
    grade: 'good',
    captureSource: 'phone_web_speech',
    userAttempt: 'Could you say that again, please?',
    attemptedAt: new Date().toISOString(),
    semanticScore: 0.9,
  }, { 'Idempotency-Key': `action-smoke-review-${Date.now()}` });
  recordEndpointEvidence('reviewAttempt', reviewAttempt, {
    writeAccepted: reviewAttempt.body?.accepted === true,
    schemaVersion: '2.0.0',
  });
  assertEqual(reviewAttempt.response.status, 200, 'POST /v1/reviews/attempt status');
  assertTrue(reviewAttempt.body?.accepted === true, 'POST /v1/reviews/attempt accepted');

  const roleplayStart = await fetchJsonAction('/v1/roleplays/start', 'POST', {
    schemaVersion: '2.0.0',
    learningItemIds: [seedItemId],
    targetLanguage: 'en-US',
    scenarioPreference: 'custom gpt action smoke',
    difficulty: 0.4,
  });
  roleplayId = roleplayStart.body?.roleplayId || '';
  recordEndpointEvidence('roleplayStart', roleplayStart, {
    schemaVersion: '2.0.0',
  });
  assertEqual(roleplayStart.response.status, 200, 'POST /v1/roleplays/start status');
  assertTrue(roleplayId.startsWith('rp_'), 'POST /v1/roleplays/start roleplayId');

  const roleplayResult = await fetchJsonAction('/v1/roleplays/result', 'POST', {
    schemaVersion: '2.0.0',
    roleplayId,
    completedAt: new Date().toISOString(),
    summary: 'Smoke result recorded without raw transcript.',
    outcomes: [
      {
        itemId: seedItemId,
        outcome: 'independent',
        evidenceSummary: 'Learner used the repair goal in a bounded smoke scenario.',
        suggestedGrade: 'good',
      },
    ],
  });
  recordEndpointEvidence('roleplayResult', roleplayResult, {
    writeAccepted: roleplayResult.body?.accepted === true,
    schemaVersion: '2.0.0',
  });
  assertEqual(roleplayResult.response.status, 200, 'POST /v1/roleplays/result status');
  assertTrue(roleplayResult.body?.accepted === true, 'POST /v1/roleplays/result accepted');

  const sessionImport = await fetchJsonAction('/v1/sessions/import-summary', 'POST', {
    schemaVersion: '2.0.0',
    sessionId: `session_action_smoke_${Date.now()}`,
    endedAt: new Date().toISOString(),
    sessionSummary: 'Bounded smoke import with no raw transcript.',
    learningItems: [],
  });
  recordEndpointEvidence('sessionImport', sessionImport, {
    writeAccepted: sessionImport.body?.accepted === true,
    schemaVersion: '2.0.0',
  });
  assertEqual(sessionImport.response.status, 200, 'POST /v1/sessions/import-summary status');
  assertTrue(sessionImport.body?.accepted === true, 'POST /v1/sessions/import-summary accepted');
  console.info('[action-oauth-smoke] Action endpoint read/write smoke ok');
}

async function fetchJsonAction(endpointPath, method, body = null, extraHeaders = {}) {
  const options = {
    method,
    headers: actionHeaders({
      ...extraHeaders,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    }),
  };
  if (body) options.body = JSON.stringify(body);
  return fetchText(endpointPath, options);
}

function recordEndpointEvidence(key, result, extra = {}) {
  evidence.checks[key] = {
    status: result.response.status,
    schemaVersion: extra.schemaVersion ?? result.body?.schemaVersion ?? null,
    writeAccepted: extra.writeAccepted,
    corsOriginMatches: corsMatches(result.response),
    cacheControlNoStore: noStore(result.response),
    rawTranscriptReturned: /rawTranscript|fullTranscript|conversationTurns/i.test(result.text),
    rawAudioReturned: /audioBase64|rawAudio|audioPayload/i.test(result.text),
    directIdentifierReturned: /test@example\.com|\b\+?1?[-.\s]?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/i.test(result.text),
  };
  assertTrue(corsMatches(result.response), `${key} CORS origin`);
  assertTrue(noStore(result.response), `${key} cache-control`);
  assertTrue(hasNoSensitiveReturned(result.text), `${key} privacy boundary`);
}

async function checkPrivacyRejections() {
  const privacyChecks = [
    {
      key: 'rawTranscriptRejected',
      body: {
        schemaVersion: '2.0.0',
        sessionId: 'session_privacy_raw_transcript',
        endedAt: new Date().toISOString(),
        sessionSummary: 'Bounded summary.',
        rawTranscript: 'raw learner sentence must not pass',
        learningItems: [],
      },
      sensitive: 'raw learner sentence must not pass',
    },
    {
      key: 'rawAudioRejected',
      body: {
        schemaVersion: '2.0.0',
        sessionId: 'session_privacy_audio',
        endedAt: new Date().toISOString(),
        sessionSummary: 'Bounded summary.',
        audioBase64: 'UklGRg==',
        learningItems: [],
      },
      sensitive: 'UklGRg==',
    },
    {
      key: 'directContactIdentifiersRejected',
      body: {
        schemaVersion: '2.0.0',
        sessionId: 'session_privacy_contact',
        endedAt: new Date().toISOString(),
        sessionSummary: 'Bounded summary.',
        email: 'test@example.com',
        learningItems: [],
      },
      sensitive: 'test@example.com',
    },
    {
      key: 'providerSecretsRejected',
      body: {
        schemaVersion: '2.0.0',
        sessionId: 'session_privacy_secret',
        endedAt: new Date().toISOString(),
        sessionSummary: 'Bounded summary.',
        providerSecret: 'AIzaFakeProviderSecretMustNotEcho12345',
        learningItems: [],
      },
      sensitive: 'AIzaFakeProviderSecretMustNotEcho12345',
    },
  ];

  const privacyEvidence = {};
  for (const check of privacyChecks) {
    const result = await fetchJsonAction('/v1/sessions/import-summary', 'POST', check.body);
    const passed = result.response.status === 400 && result.body?.error?.code === 'invalid_request_schema';
    const echoedSensitive = result.text.includes(check.sensitive);
    privacyEvidence[check.key] = {
      status: result.response.status,
      errorCode: result.body?.error?.code ?? null,
      rejected: passed,
      responseEchoedSensitive: echoedSensitive,
      corsOriginMatches: corsMatches(result.response),
      cacheControlNoStore: noStore(result.response),
    };
    assertTrue(passed, check.key);
    assertTrue(echoedSensitive === false, `${check.key} sensitive text not echoed`);
    assertTrue(corsMatches(result.response), `${check.key} CORS origin`);
    assertTrue(noStore(result.response), `${check.key} cache-control`);
  }

  evidence.checks.privacy = privacyEvidence;
  console.info('[action-oauth-smoke] Action privacy rejection smoke ok');
}

try {
  await checkHealthz();
  await checkOAuthFlow();
  await checkActionEndpoints();
  await checkPrivacyRejections();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

evidence.ok = failures.length === 0;
writeEvidence();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[action-oauth-smoke] error ${failure}`);
  }
  process.exit(1);
}

console.info(`[action-oauth-smoke] Action OAuth smoke passed for ${normalizedBaseUrl}`);

function writeEvidence() {
  if (!evidenceOut) return;
  const outputPath = path.resolve(process.cwd(), evidenceOut);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.info(`[action-oauth-smoke] evidence written to ${outputPath}`);
}
