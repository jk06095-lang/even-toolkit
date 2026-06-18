import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';

const port = 18_700 + Math.floor(Math.random() * 500);
const allowedOrigin = 'https://echo-client.example.test';
const baseUrl = `http://127.0.0.1:${port}`;
const qaDelayMs = 120;

let child;

before(async () => {
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      ECHO_PROXY_ALLOWED_ORIGINS: allowedOrigin,
      ECHO_PROXY_QA_DELAY_MS: String(qaDelayMs),
      GEMINI_API_KEY: '',
      GOOGLE_GENERATIVE_AI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
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

test('healthz reports configuration state without requiring provider credentials', async () => {
  const response = await fetch(`${baseUrl}/healthz`, {
    headers: { Origin: allowedOrigin },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.equal(body.ok, true);
  assert.equal(body.configured, false);
  assert.equal(body.qaDelayMs, qaDelayMs);
  assert.equal(typeof body.model, 'string');
});

test('missing provider key fails safely without echoing request content', async () => {
  const sensitiveText = 'raw learner sentence must not come back';
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/v1/cue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
    },
    body: JSON.stringify({
      topic: 'hardware qa',
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
