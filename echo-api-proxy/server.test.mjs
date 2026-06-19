import { strict as assert } from 'node:assert';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
      ECHO_PROXY_SESSION_TOKEN_ISSUER: 'test-session-issuer',
      ECHO_PROXY_SESSION_TOKEN_TTL_SECONDS: '3600',
      ECHO_PROXY_SESSION_TOKEN_ROTATION_DAYS: '7',
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
  assert.equal(body.tokenPolicy.configured, true);
  assert.equal(body.tokenPolicy.issuer, 'test-session-issuer');
  assert.equal(body.tokenPolicy.ttlSeconds, 3600);
  assert.equal(body.tokenPolicy.rotationDays, 7);
  assert.equal(body.tokenPolicy.activeTokenCount, 1);
  assert.equal(JSON.stringify(body).includes(sessionToken), false);
  assert.equal(body.qaDelayMs, qaDelayMs);
  assert.equal(body.rateLimit.max, 2);
  assert.equal(body.idempotency.ttlMs, 600000);
  assert.equal(body.circuitBreaker.failureThreshold, 5);
  assert.equal(body.actionOAuth.configured, false);
  assert.equal(body.actionOAuth.tokenStorage, 'hashed_in_memory');
  assert.deepEqual(body.actionOAuth.scopes, [
    'profile:read',
    'review:read',
    'review:write',
    'roleplay:write',
    'session:write',
  ]);
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

test('signed short-lived session tokens are accepted and expired tokens are rejected', async () => {
  const signedSecret = 'test-signed-session-token-secret-32-chars';
  const proxy = await startProxy({
    ECHO_PROXY_SESSION_TOKEN: '',
    ECHO_PROXY_SESSION_TOKENS: '',
    ECHO_PROXY_SESSION_TOKEN_SECRET: signedSecret,
    ECHO_PROXY_SESSION_TOKEN_AUDIENCE: 'project-echo-api',
    ECHO_PROXY_RATE_LIMIT_MAX: '20',
  });

  try {
    const healthz = await fetch(`${proxy.baseUrl}/healthz`, {
      headers: { Origin: allowedOrigin },
    });
    const healthBody = await healthz.json();
    assert.equal(healthz.status, 200);
    assert.equal(healthBody.authConfigured, true);
    assert.equal(healthBody.tokenPolicy.configured, true);
    assert.equal(healthBody.tokenPolicy.signedTokenConfigured, true);
    assert.equal(healthBody.tokenPolicy.activeTokenCount, 1);
    assert.equal(healthBody.tokenPolicy.audience, 'project-echo-api');

    const signedToken = issueSignedTestToken({
      secret: signedSecret,
      issuer: 'test-session-issuer',
      audience: 'project-echo-api',
      sessionId: 'signed-session-1',
      expiresInSeconds: 3600,
    });
    const accepted = await fetch(`${proxy.baseUrl}/v1/cue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
        Authorization: `Bearer ${signedToken}`,
      },
      body: JSON.stringify({
        topic: 'signed token qa',
        clientSessionId: 'signed-token-session',
      }),
    });
    const acceptedBody = await accepted.json();
    assert.equal(accepted.status, 503);
    assert.equal(acceptedBody.error.code, 'proxy_not_configured');

    const expiredToken = issueSignedTestToken({
      secret: signedSecret,
      issuer: 'test-session-issuer',
      audience: 'project-echo-api',
      sessionId: 'signed-session-2',
      expiresInSeconds: -60,
    });
    const rejected = await fetch(`${proxy.baseUrl}/v1/cue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
        Authorization: `Bearer ${expiredToken}`,
      },
      body: JSON.stringify({
        topic: 'expired token qa',
        clientSessionId: 'expired-token-session',
      }),
    });
    const rejectedBody = await rejected.json();
    assert.equal(rejected.status, 401);
    assert.equal(rejectedBody.error.code, 'invalid_session_token');
  } finally {
    await proxy.stop();
  }
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

test('ChatGPT Action routes serve bounded profile and write-backs without provider credentials', async () => {
  const proxy = await startProxy({
    GEMINI_API_KEY: '',
    GOOGLE_GENERATIVE_AI_API_KEY: '',
    ECHO_PROXY_RATE_LIMIT_MAX: '20',
  });

  try {
    const profileResponse = await fetch(`${proxy.baseUrl}/v1/learner/profile`, {
      headers: {
        Origin: allowedOrigin,
        ...authHeaders(),
      },
    });
    const profile = await profileResponse.json();

    assert.equal(profileResponse.status, 200);
    assert.equal(profileResponse.headers.get('cache-control'), 'no-store');
    assert.equal(profile.schemaVersion, '2.0.0');
    assert.equal(profile.privacyMode, 'server_synced');
    assert.ok(Array.isArray(profile.learningItems));
    assert.equal(JSON.stringify(profile).includes('rawTranscript'), false);

    const importedItem = {
      schemaVersion: '2.0.0',
      id: 'li_imported_repair_001',
      canonicalExpression: 'Could you clarify that?',
      meaningKo: '상대방에게 의미를 다시 확인하기',
      speechAct: 'clarify',
      breakdownType: 'listening_gap',
      lastOutcome: 'assisted',
      scenarioTags: ['travel'],
      naturalRecast: 'Can you explain that again?',
      scheduling: {
        reps: 0,
        lapses: 0,
        difficulty: 0.5,
        stability: 1,
        dueAt: new Date(Date.now() - 60_000).toISOString(),
      },
    };

    const importResponse = await fetch(`${proxy.baseUrl}/v1/sessions/import-summary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
        ...authHeaders(),
      },
      body: JSON.stringify({
        schemaVersion: '2.0.0',
        sessionId: 'session_import_001',
        endedAt: new Date().toISOString(),
        sessionSummary: 'Bounded session summary with no raw transcript.',
        learningItems: [importedItem],
      }),
    });
    const importBody = await importResponse.json();
    assert.equal(importResponse.status, 200);
    assert.deepEqual(importBody, { accepted: true });

    const updatedProfileResponse = await fetch(`${proxy.baseUrl}/v1/learner/profile`, {
      headers: {
        Origin: allowedOrigin,
        ...authHeaders(),
      },
    });
    const updatedProfile = await updatedProfileResponse.json();
    assert.equal(updatedProfileResponse.status, 200);
    assert.equal(updatedProfile.learningItems.some((item) => item.id === importedItem.id), true);
    assert.equal(updatedProfile.metrics.totalSessions, 1);

    const reviewResponse = await fetch(`${proxy.baseUrl}/v1/reviews/attempt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
        'Idempotency-Key': 'action-review-0001',
        ...authHeaders(),
      },
      body: JSON.stringify({
        schemaVersion: '2.0.0',
        itemId: importedItem.id,
        mode: 'meaning_to_expression',
        grade: 'good',
        captureSource: 'typed',
        userAttempt: 'Could you clarify that?',
        attemptedAt: new Date().toISOString(),
        semanticScore: 0.91,
      }),
    });
    const reviewBody = await reviewResponse.json();
    assert.equal(reviewResponse.status, 200);
    assert.equal(reviewBody.accepted, true);
    assert.equal(reviewBody.itemId, importedItem.id);
    assert.match(reviewBody.nextDueAt, /^\d{4}-\d{2}-\d{2}T/);

    const roleplayResponse = await fetch(`${proxy.baseUrl}/v1/roleplays/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
        ...authHeaders(),
      },
      body: JSON.stringify({
        schemaVersion: '2.0.0',
        learningItemIds: [importedItem.id],
        targetLanguage: 'en-US',
        scenarioPreference: 'airport counter',
        difficulty: 0.4,
      }),
    });
    const roleplayBody = await roleplayResponse.json();
    assert.equal(roleplayResponse.status, 200);
    assert.match(roleplayBody.roleplayId, /^rp_/);
    assert.equal(Array.isArray(roleplayBody.goals), true);

    const roleplayResultResponse = await fetch(`${proxy.baseUrl}/v1/roleplays/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
        ...authHeaders(),
      },
      body: JSON.stringify({
        schemaVersion: '2.0.0',
        roleplayId: roleplayBody.roleplayId,
        completedAt: new Date().toISOString(),
        summary: 'Learner repaired the conversation without exposing transcript history.',
        outcomes: [
          {
            itemId: importedItem.id,
            outcome: 'independent',
            evidenceSummary: 'Used the clarification goal in a new situation.',
            suggestedGrade: 'easy',
          },
        ],
      }),
    });
    const roleplayResultBody = await roleplayResultResponse.json();
    assert.equal(roleplayResultResponse.status, 200);
    assert.deepEqual(roleplayResultBody, { accepted: true });
  } finally {
    await proxy.stop();
  }
});

test('ChatGPT Action OAuth authorization-code tokens are scope-bound', async () => {
  const clientId = 'chatgpt-action-client';
  const clientSecret = 'test-action-oauth-secret-32';
  const redirectUri = 'https://chatgpt.com/aip/g-echo/oauth/callback';
  const proxy = await startProxy({
    GEMINI_API_KEY: '',
    GOOGLE_GENERATIVE_AI_API_KEY: '',
    ECHO_PROXY_RATE_LIMIT_MAX: '20',
    ECHO_ACTION_OAUTH_CLIENT_ID: clientId,
    ECHO_ACTION_OAUTH_CLIENT_SECRET: clientSecret,
    ECHO_ACTION_OAUTH_REDIRECT_ORIGINS: 'https://chatgpt.com,https://chat.openai.com',
  });

  try {
    const healthzResponse = await fetch(`${proxy.baseUrl}/healthz`, {
      headers: { Origin: allowedOrigin },
    });
    const healthz = await healthzResponse.json();
    assert.equal(healthz.actionOAuth.configured, true);
    assert.equal(healthz.actionOAuth.redirectOriginCount, 2);
    assert.equal(healthz.actionOAuth.tokenTtlSeconds, 3600);
    assert.equal(healthz.actionOAuth.tokenStorage, 'hashed_in_memory');

    const authorizeUrl = new URL(`${proxy.baseUrl}/oauth/authorize`);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', 'profile:read review:read');
    authorizeUrl.searchParams.set('state', 'state-123');

    const authorizeResponse = await fetch(authorizeUrl, {
      headers: { Origin: allowedOrigin },
      redirect: 'manual',
    });
    assert.equal(authorizeResponse.status, 302);
    assert.equal(authorizeResponse.headers.get('cache-control'), 'no-store');
    assert.equal(authorizeResponse.headers.get('access-control-allow-origin'), allowedOrigin);

    const callbackUrl = new URL(authorizeResponse.headers.get('location'));
    assert.equal(callbackUrl.origin + callbackUrl.pathname, redirectUri);
    assert.equal(callbackUrl.searchParams.get('state'), 'state-123');
    const code = callbackUrl.searchParams.get('code');
    assert.match(code, /^echo_code_/);

    const tokenResponse = await fetch(`${proxy.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        Origin: allowedOrigin,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenBody = await tokenResponse.json();
    assert.equal(tokenResponse.status, 200);
    assert.equal(tokenResponse.headers.get('cache-control'), 'no-store');
    assert.match(tokenBody.access_token, /^echo_oauth_/);
    assert.equal(tokenBody.token_type, 'Bearer');
    assert.equal(tokenBody.expires_in, 3600);
    assert.equal(tokenBody.scope, 'profile:read review:read');
    assert.equal(JSON.stringify(tokenBody).includes(clientSecret), false);
    assert.equal(JSON.stringify(healthz).includes(tokenBody.access_token), false);

    const profileResponse = await fetch(`${proxy.baseUrl}/v1/learner/profile`, {
      headers: {
        Authorization: `Bearer ${tokenBody.access_token}`,
        Origin: allowedOrigin,
      },
    });
    const profile = await profileResponse.json();
    assert.equal(profileResponse.status, 200);
    assert.equal(profile.schemaVersion, '2.0.0');
    assert.equal(profile.privacyMode, 'server_synced');

    const writeResponse = await fetch(`${proxy.baseUrl}/v1/reviews/attempt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenBody.access_token}`,
        Origin: allowedOrigin,
      },
      body: JSON.stringify({
        schemaVersion: '2.0.0',
        itemId: 'li_read_only_scope_check',
        mode: 'meaning_to_expression',
        grade: 'good',
        captureSource: 'typed',
        userAttempt: 'Could you clarify that?',
        attemptedAt: new Date().toISOString(),
      }),
    });
    const writeBody = await writeResponse.json();
    assert.equal(writeResponse.status, 403);
    assert.equal(writeBody.error.code, 'insufficient_scope');
  } finally {
    await proxy.stop();
  }
});

test('ChatGPT Action write routes reject raw transcript and direct contact payloads', async () => {
  const proxy = await startProxy({
    GEMINI_API_KEY: '',
    GOOGLE_GENERATIVE_AI_API_KEY: '',
    ECHO_PROXY_RATE_LIMIT_MAX: '20',
  });

  try {
    const sensitiveText = 'learner said my email is test@example.com';
    const response = await fetch(`${proxy.baseUrl}/v1/sessions/import-summary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
        ...authHeaders(),
      },
      body: JSON.stringify({
        schemaVersion: '2.0.0',
        sessionId: 'session_reject_001',
        endedAt: new Date().toISOString(),
        sessionSummary: 'Bounded summary.',
        rawTranscript: sensitiveText,
        learningItems: [],
      }),
    });
    const text = await response.text();
    const body = JSON.parse(text);

    assert.equal(response.status, 400);
    assert.equal(body.error.code, 'invalid_request_schema');
    assert.equal(text.includes(sensitiveText), false);
  } finally {
    await proxy.stop();
  }
});

test('ChatGPT Action file store persists bounded learner state across proxy restart', async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'echo-action-store-'));
  const storePath = path.join(tempRoot, 'action-store.json');
  const importedItemId = 'li_persisted_clarify_001';
  const storeEnv = {
    GEMINI_API_KEY: '',
    GOOGLE_GENERATIVE_AI_API_KEY: '',
    ECHO_PROXY_RATE_LIMIT_MAX: '20',
    ECHO_ACTION_STORE_PATH: storePath,
  };

  try {
    const firstProxy = await startProxy(storeEnv);
    try {
      const response = await fetch(`${firstProxy.baseUrl}/v1/sessions/import-summary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: allowedOrigin,
          ...authHeaders(),
        },
        body: JSON.stringify({
          schemaVersion: '2.0.0',
          sessionId: 'session_persist_001',
          endedAt: new Date().toISOString(),
          sessionSummary: 'Imported a bounded learning item for restart persistence.',
          learningItems: [
            {
              schemaVersion: '2.0.0',
              id: importedItemId,
              canonicalExpression: 'Could you explain that again?',
              meaningKo: '상대방에게 다시 설명해 달라고 요청하기',
              speechAct: 'clarify',
              breakdownType: 'listening_gap',
              lastOutcome: 'assisted',
              scenarioTags: ['support'],
              naturalRecast: 'Can you explain that one more time?',
              scheduling: {
                reps: 0,
                lapses: 0,
                difficulty: 0.48,
                stability: 1,
                dueAt: new Date(Date.now() - 60_000).toISOString(),
              },
            },
          ],
        }),
      });
      assert.equal(response.status, 200);

      const reviewResponse = await fetch(`${firstProxy.baseUrl}/v1/reviews/attempt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: allowedOrigin,
          'Idempotency-Key': 'persisted-review-0001',
          ...authHeaders(),
        },
        body: JSON.stringify({
          schemaVersion: '2.0.0',
          itemId: importedItemId,
          mode: 'meaning_to_expression',
          grade: 'good',
          captureSource: 'phone_web_speech',
          userAttempt: 'Could you explain that again?',
          attemptedAt: new Date().toISOString(),
          semanticScore: 0.87,
          pronunciationScore: 0.72,
        }),
      });
      assert.equal(reviewResponse.status, 200);
    } finally {
      await firstProxy.stop();
    }

    const persistedText = readFileSync(storePath, 'utf8');
    assert.match(persistedText, /project-echo-action-store-v1/);
    assert.equal(persistedText.includes(importedItemId), true);
    assert.equal(persistedText.includes('"captureSource": "phone_web_speech"'), true);
    assert.equal(persistedText.includes('rawTranscript'), false);
    assert.equal(persistedText.includes('test@example.com'), false);

    const restartedProxy = await startProxy(storeEnv);
    try {
      const profileResponse = await fetch(`${restartedProxy.baseUrl}/v1/learner/profile`, {
        headers: {
          Origin: allowedOrigin,
          ...authHeaders(),
        },
      });
      const profile = await profileResponse.json();

      assert.equal(profileResponse.status, 200);
      assert.equal(profile.metrics.totalSessions, 1);
      assert.equal(profile.learningItems.some((item) => item.id === importedItemId), true);
    } finally {
      await restartedProxy.stop();
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
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

test('idempotency key replays a successful provider response without a duplicate provider call', async () => {
  let providerCalls = 0;
  const provider = await startProviderStub((_req, res) => {
    providerCalls += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: '{"cue":"Could you repeat?"}' }],
          },
        },
      ],
    }));
  });
  const proxy = await startProxy({
    GEMINI_API_KEY: 'stub-provider-key',
    GEMINI_API_BASE_URL: provider.baseUrl,
    ECHO_PROXY_RATE_LIMIT_MAX: '20',
  });

  try {
    const request = () => fetch(`${proxy.baseUrl}/v1/cue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
        'Idempotency-Key': 'retry-cue-0001',
        ...authHeaders(),
      },
      body: JSON.stringify({
        topic: 'idempotency qa',
        clientSessionId: 'idempotency-session',
        requestId: 'idempotency-session:cue:1',
      }),
    });

    const first = await request();
    const second = await request();
    const firstBody = await first.json();
    const secondBody = await second.json();

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(firstBody.cue, 'Could you repeat?');
    assert.deepEqual(secondBody, firstBody);
    assert.equal(providerCalls, 1);
  } finally {
    await proxy.stop();
    await provider.stop();
  }
});

test('provider circuit opens after consecutive provider failures', async () => {
  let providerCalls = 0;
  const provider = await startProviderStub((_req, res) => {
    providerCalls += 1;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'temporary provider failure' }));
  });
  const proxy = await startProxy({
    GEMINI_API_KEY: 'stub-provider-key',
    GEMINI_API_BASE_URL: provider.baseUrl,
    ECHO_PROXY_RATE_LIMIT_MAX: '20',
    ECHO_PROXY_CIRCUIT_FAILURE_THRESHOLD: '2',
    ECHO_PROXY_CIRCUIT_COOLDOWN_MS: '60000',
  });

  try {
    const request = () => fetch(`${proxy.baseUrl}/v1/cue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: allowedOrigin,
        ...authHeaders(),
      },
      body: JSON.stringify({
        topic: 'circuit qa',
        clientSessionId: 'circuit-session',
      }),
    });

    const first = await request();
    const second = await request();
    const third = await request();
    const thirdBody = await third.json();

    assert.equal(first.status, 502);
    assert.equal(second.status, 502);
    assert.equal(third.status, 503);
    assert.equal(thirdBody.error.code, 'provider_circuit_open');
    assert.equal(providerCalls, 2);
  } finally {
    await proxy.stop();
    await provider.stop();
  }
});

async function startProviderStub(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}

async function startProxy(extraEnv = {}) {
  const proxyPort = 19_400 + Math.floor(Math.random() * 500);
  const proxy = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', import.meta.url),
    env: {
      ...process.env,
      PORT: String(proxyPort),
      ECHO_PROXY_ALLOWED_ORIGINS: allowedOrigin,
      ECHO_PROXY_SESSION_TOKEN: sessionToken,
      ECHO_PROXY_SESSION_TOKEN_ISSUER: 'test-session-issuer',
      ECHO_PROXY_SESSION_TOKEN_TTL_SECONDS: '3600',
      ECHO_PROXY_SESSION_TOKEN_ROTATION_DAYS: '7',
      ECHO_PROXY_RATE_LIMIT_WINDOW_MS: '60000',
      ECHO_PROXY_IDEMPOTENCY_TTL_MS: '600000',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proxy.stdout.setEncoding('utf8');
  proxy.stderr.setEncoding('utf8');
  proxy.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });

  const proxyBaseUrl = `http://127.0.0.1:${proxyPort}`;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${proxyBaseUrl}/healthz`);
      if (response.ok) {
        return {
          baseUrl: proxyBaseUrl,
          stop: async () => {
            if (proxy.exitCode !== null) return;
            proxy.kill();
            await Promise.race([once(proxy, 'exit'), delay(1_000)]);
          },
        };
      }
    } catch {
      // Server is still starting.
    }
    await delay(100);
  }

  proxy.kill();
  throw new Error('Proxy test server did not become ready.');
}

function issueSignedTestToken({
  secret,
  issuer,
  audience,
  sessionId,
  expiresInSeconds,
}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    iss: issuer,
    aud: audience,
    sub: 'test-subject',
    sid: sessionId,
    jti: `test-${Math.random().toString(36).slice(2)}`,
    iat: nowSeconds,
    exp: nowSeconds + expiresInSeconds,
  };
  const payloadPart = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signaturePart = createHmac('sha256', secret)
    .update(payloadPart)
    .digest('base64url');
  return `echo1.${payloadPart}.${signaturePart}`;
}
