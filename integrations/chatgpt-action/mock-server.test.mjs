import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';

import {
  ACTION_SCHEMA_VERSION,
  FORBIDDEN_ACTION_FIELDS,
  createChatGptActionMockServer,
  learnerProfile,
} from './mock-server.mjs';

let server;
let baseUrl;

before(async () => {
  server = createChatGptActionMockServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
});

test('requires bearer auth and no-store JSON responses for Action endpoints', async () => {
  const response = await request('/v1/learner/profile', { auth: false });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assertNoForbiddenPayload(await response.json());
});

test('serves bounded learner and review data matching the Action contract', async () => {
  const profileResponse = await request('/v1/learner/profile');
  assert.equal(profileResponse.status, 200);
  const profile = await profileResponse.json();

  assert.equal(profile.schemaVersion, ACTION_SCHEMA_VERSION);
  assert.equal(profile.privacyMode, 'server_synced');
  assert.ok(profile.learningItems.length > 0);
  assert.ok(profile.learningItems.length <= 30);
  assertNoForbiddenPayload(profile);

  for (const item of profile.learningItems) {
    assert.equal(item.schemaVersion, ACTION_SCHEMA_VERSION);
    assert.ok(item.canonicalExpression.length <= 240);
    assert.ok(item.meaningKo.length <= 400);
    assert.ok(item.scenarioTags.length <= 5);
  }

  const reviewsResponse = await request('/v1/reviews/next');
  assert.equal(reviewsResponse.status, 200);
  const reviews = await reviewsResponse.json();
  assert.equal(reviews.schemaVersion, ACTION_SCHEMA_VERSION);
  assert.ok(reviews.items.length > 0);
  assert.ok(reviews.items.length <= 10);
  assertNoForbiddenPayload(reviews);
});

test('accepts review, roleplay, and redacted session writes', async () => {
  const profile = learnerProfile();
  const item = profile.learningItems[0];

  const attempt = await jsonPost('/v1/reviews/attempt', {
    schemaVersion: ACTION_SCHEMA_VERSION,
    itemId: item.id,
    mode: 'meaning_to_expression',
    grade: 'good',
    userAttempt: 'Could you say that again, please?',
    attemptedAt: '2026-06-19T09:05:00.000Z',
    semanticScore: 0.82,
    pronunciationScore: 0.7,
  });
  assert.equal(attempt.status, 200);
  assert.deepEqual(Object.keys(await attempt.json()).sort(), ['accepted', 'itemId', 'nextDueAt']);

  const roleplay = await jsonPost('/v1/roleplays/start', {
    schemaVersion: ACTION_SCHEMA_VERSION,
    learningItemIds: [item.id],
    targetLanguage: 'en-US',
    scenarioPreference: 'retail',
    difficulty: 0.45,
  });
  assert.equal(roleplay.status, 200);
  const roleplayBody = await roleplay.json();
  assert.equal(roleplayBody.goals.length, 3);
  assertNoForbiddenPayload(roleplayBody);

  const roleplayResult = await jsonPost('/v1/roleplays/result', {
    schemaVersion: ACTION_SCHEMA_VERSION,
    roleplayId: roleplayBody.roleplayId,
    completedAt: '2026-06-19T09:08:00.000Z',
    summary: 'Learner repaired the conversation with one short English request.',
    outcomes: [
      {
        itemId: item.id,
        outcome: 'independent',
        evidenceSummary: 'The learner asked for repetition before answering.',
        suggestedGrade: 'good',
      },
    ],
  });
  assert.equal(roleplayResult.status, 200);
  assert.deepEqual(await roleplayResult.json(), { accepted: true });

  const importResponse = await jsonPost('/v1/sessions/import-summary', {
    schemaVersion: ACTION_SCHEMA_VERSION,
    sessionId: 'session_local_reference_001',
    endedAt: '2026-06-19T09:10:00.000Z',
    sessionSummary: 'Redacted retail practice summary with no direct identifiers.',
    learningItems: [item],
  });
  assert.equal(importResponse.status, 200);
  assert.deepEqual(await importResponse.json(), { accepted: true });
});

test('rejects raw transcripts, audio fields, and direct identifiers', async () => {
  const forbiddenFieldResponse = await jsonPost('/v1/sessions/import-summary', {
    schemaVersion: ACTION_SCHEMA_VERSION,
    sessionId: 'session_local_reference_002',
    endedAt: '2026-06-19T09:12:00.000Z',
    sessionSummary: 'This should be rejected.',
    rawTranscript: 'Full transcript must never enter the Action API.',
    learningItems: [],
  });
  assert.equal(forbiddenFieldResponse.status, 400);
  assertNoForbiddenPayload(await forbiddenFieldResponse.json());

  const audioFieldResponse = await jsonPost('/v1/sessions/import-summary', {
    schemaVersion: ACTION_SCHEMA_VERSION,
    sessionId: 'session_local_reference_003',
    endedAt: '2026-06-19T09:12:00.000Z',
    sessionSummary: 'This should also be rejected.',
    learningItems: [],
    audioBase64: 'UklGRg==',
  });
  assert.equal(audioFieldResponse.status, 400);
  assertNoForbiddenPayload(await audioFieldResponse.json());

  const identifierResponse = await jsonPost('/v1/sessions/import-summary', {
    schemaVersion: ACTION_SCHEMA_VERSION,
    sessionId: 'session_local_reference_004',
    endedAt: '2026-06-19T09:12:00.000Z',
    sessionSummary: 'Contact me at learner@example.com.',
    learningItems: [],
  });
  assert.equal(identifierResponse.status, 400);
  assertNoForbiddenPayload(await identifierResponse.json());
});

function request(pathname, options = {}) {
  const headers = new Headers(options.headers);
  if (options.auth !== false) {
    headers.set('authorization', 'Bearer localtest');
  }
  return fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers,
  });
}

function jsonPost(pathname, body) {
  return request(pathname, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function assertNoForbiddenPayload(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of FORBIDDEN_ACTION_FIELDS) {
    assert.equal(serialized.includes(`"${forbidden}"`), false, `payload contains ${forbidden}`);
  }
  assert.doesNotMatch(serialized, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.doesNotMatch(serialized, /\b(?:\+?\d[\s.-]?){8,}\b/);
}
