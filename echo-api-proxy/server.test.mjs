import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';

const port = 18_700 + Math.floor(Math.random() * 500);
const allowedOrigin = 'https://echo-client.example.test';
const baseUrl = `http://127.0.0.1:${port}`;
const qaDelayMs = 120;
const sessionToken = 'test-session-token';

let child;
let proxyOutput = '';
let proxyErrorOutput = '';

before(async () => {
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      ECHO_PROXY_ALLOWED_ORIGINS: allowedOrigin,
      ECHO_PROXY_QA_DELAY_MS: String(qaDelayMs),
      ECHO_PROXY_SESSION_TOKEN: sessionToken,
      ECHO_PROXY_RATE_LIMIT_MAX: '2',
      ECHO_PROXY_RATE_LIMIT_WINDOW_MS: '60000',
      ECHO_PROXY_MAX_BODY_BYTES: '1024',
      GEMINI_API_KEY: '',
      GOOGLE_GENERATIVE_AI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    proxyOutput += chunk;
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    proxyErrorOutput += chunk;
    process.stderr.write(chunk);
  });

  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(100);
  }

  throw new Error('Proxy test server did not become ready.');
});

after(async () => {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    once(child, 'exit'),
    delay(1_000),
  ]);
});

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${sessionToken}`,
    ...extra,
  };
}

test('healthz reports configuration state without requiring provider credentials', async () => {
  const response = await fetch(`${baseUrl}/healthz`, {
    headers: { Origin: allowedOrigin },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.equal(body.ok, true);
  assert.equal(body.configured, false);
  assert.equal(body.authConfigured, true);
  assert.equal(body.qaDelayMs, qaDelayMs);
  assert.equal(body.rateLimit.max, 2);
  assert.equal(typeof body.model, 'string');
});

test('missing session token is rejected before provider work starts', async () => {
  const response = await fetch(`${baseUrl}/v1/cue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
    },
    body: JSON.stringify({
      topic: 'auth qa',
      clientSessionId: 'missing-token-session',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'missing_session_token');
});

test('invalid session token is rejected without echoing request content', async () => {
  const sensitiveText = 'invalid token learner text must not echo';
  const response = await fetch(`${baseUrl}/v1/cue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
      Authorization: 'Bearer wrong-token',
    },
    body: JSON.stringify({
      topic: 'auth qa',
      clientSessionId: 'invalid-token-session',
      lastUtterance: sensitiveText,
    }),
  });
  const text = await response.text();
  const body = JSON.parse(text);

  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'invalid_session_token');
  assert.equal(text.includes(sensitiveText), false);
});

test('missing provider key fails safely without echoing request content', async () => {
  const sensitiveText = 'raw learner sentence must not come back';
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/v1/cue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
      ...authHeaders(),
    },
    body: JSON.stringify({
      topic: 'hardware qa',
      clientSessionId: 'safe-provider-session',
      lastUtterance: sensitiveText,
    }),
  });
  const text = await response.text();
  const elapsedMs = Date.now() - startedAt;
  const body = JSON.parse(text);

  assert.equal(response.status, 503);
  assert.ok(elapsedMs >= qaDelayMs, `expected delayed QA response, got ${elapsedMs}ms`);
  assert.equal(body.error.code, 'proxy_not_configured');
  assert.match(body.error.message, /not configured/i);
  assert.equal(text.includes(sensitiveText), false);
  await delay(20);
  assert.equal((proxyOutput + proxyErrorOutput).includes(sensitiveText), false);
});

test('missing provider key fails safely for translation without echoing source text', async () => {
  const sensitiveText = 'translate this learner sentence without echoing it';
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/v1/translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
      ...authHeaders(),
    },
    body: JSON.stringify({
      clientSessionId: 'translation-safe-session',
      requestId: 'translation-safe-session:translate:1',
      turnId: 'turn-1',
      sourceLanguage: 'en-US',
      targetLanguage: 'ko-KR',
      text: sensitiveText,
    }),
  });
  const text = await response.text();
  const elapsedMs = Date.now() - startedAt;
  const body = JSON.parse(text);

  assert.equal(response.status, 503);
  assert.ok(elapsedMs >= qaDelayMs, `expected delayed QA response, got ${elapsedMs}ms`);
  assert.equal(body.error.code, 'proxy_not_configured');
  assert.equal(text.includes(sensitiveText), false);
  await delay(20);
  assert.equal((proxyOutput + proxyErrorOutput).includes(sensitiveText), false);
});

test('rate limit returns a clear 429 before provider work starts', async () => {
  const request = () => fetch(`${baseUrl}/v1/cue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
      ...authHeaders(),
    },
    body: JSON.stringify({
      topic: 'rate qa',
      clientSessionId: 'rate-limit-session',
    }),
  });

  assert.equal((await request()).status, 503);
  assert.equal((await request()).status, 503);

  const response = await request();
  const body = await response.json();
  assert.equal(response.status, 429);
  assert.equal(body.error.code, 'rate_limit_exceeded');
});

test('malformed JSON is rejected before provider work starts', async () => {
  const response = await fetch(`${baseUrl}/v1/cue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
      ...authHeaders(),
    },
    body: '{"topic":',
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'invalid_json');
});

test('malformed request schema is rejected before provider work starts', async () => {
  const response = await fetch(`${baseUrl}/v1/cue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
      ...authHeaders(),
    },
    body: JSON.stringify({
      topic: 'schema qa',
      clientSessionId: 'malformed-schema-session',
      usedHints: 'not an array',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'invalid_request_schema');
});

test('translation request schema is bounded before provider work starts', async () => {
  const response = await fetch(`${baseUrl}/v1/translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
      ...authHeaders(),
    },
    body: JSON.stringify({
      clientSessionId: 'translation-schema-session',
      turnId: 'turn-1',
      sourceLanguage: 'en-US',
      targetLanguage: 'en-US',
      text: 'What problem are you solving first?',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'invalid_request_schema');
});

test('oversized bodies are rejected before provider work starts', async () => {
  const response = await fetch(`${baseUrl}/v1/cue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
      ...authHeaders(),
    },
    body: JSON.stringify({
      topic: 'x'.repeat(2_000),
      clientSessionId: 'oversized-session',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 413);
  assert.equal(body.error.code, 'payload_too_large');
});

test('disallowed origins are rejected before proxy work starts', async () => {
  const response = await fetch(`${baseUrl}/v1/cue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://untrusted.example.test',
    },
    body: JSON.stringify({ topic: 'blocked' }),
  });
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(body.error.code, 'origin_not_allowed');
});
