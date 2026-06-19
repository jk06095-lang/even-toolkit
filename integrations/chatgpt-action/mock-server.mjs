#!/usr/bin/env node
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export const ACTION_SCHEMA_VERSION = '2.0.0';
export const REVIEW_CAPTURE_SOURCES = ['typed', 'phone_web_speech', 'g2_bridge'];

export const FORBIDDEN_ACTION_FIELDS = [
  'rawTranscript',
  'fullTranscript',
  'transcriptEntries',
  'conversationTurns',
  'audio',
  'audioBase64',
  'email',
  'phone',
  'apiKey',
  'sessionToken',
];

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const learningItems = [
  {
    schemaVersion: ACTION_SCHEMA_VERSION,
    id: 'li_repair_001',
    canonicalExpression: 'Could you say that again, please?',
    meaningKo: '상대에게 다시 말해 달라고 정중히 요청하기',
    speechAct: 'ask_repeat',
    breakdownType: 'listening_gap',
    lastOutcome: 'assisted',
    scenarioTags: ['retail', 'repair'],
    naturalRecast: 'Could you repeat that, please?',
    scheduling: {
      reps: 1,
      lapses: 0,
      difficulty: 0.42,
      stability: 2.5,
      dueAt: '2026-06-20T09:00:00.000Z',
    },
  },
  {
    schemaVersion: ACTION_SCHEMA_VERSION,
    id: 'li_buy_time_001',
    canonicalExpression: 'Let me think for a second.',
    meaningKo: '대답하기 전에 잠시 생각할 시간을 벌기',
    speechAct: 'buy_time',
    breakdownType: 'turn_taking',
    lastOutcome: 'independent',
    scenarioTags: ['small_talk', 'meeting'],
    naturalRecast: 'Give me a second to think about that.',
    scheduling: {
      reps: 2,
      lapses: 0,
      difficulty: 0.35,
      stability: 4,
      dueAt: '2026-06-21T09:00:00.000Z',
    },
  },
];

export function createChatGptActionMockServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');

      if (request.method === 'GET' && url.pathname === '/healthz') {
        sendJson(response, 200, { ok: true, schemaVersion: ACTION_SCHEMA_VERSION });
        return;
      }

      if (!url.pathname.startsWith('/v1/')) {
        sendJson(response, 404, errorBody('not_found', 'Unknown Action endpoint'));
        return;
      }

      if (!isAuthorized(request)) {
        sendJson(response, 401, errorBody('unauthorized', 'Bearer authorization required'));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/learner/profile') {
        sendJson(response, 200, learnerProfile());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/reviews/next') {
        sendJson(response, 200, reviewQueue());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/reviews/attempt') {
        const body = await readJsonBody(request);
        assertPrivacySafe(body);
        assertRequired(body, ['schemaVersion', 'itemId', 'mode', 'grade', 'captureSource', 'attemptedAt']);
        assertSchemaVersion(body);
        assertOneOf(body.grade, ['again', 'hard', 'good', 'easy'], 'grade');
        assertOneOf(body.mode, ['meaning_to_expression', 'transfer'], 'mode');
        assertOneOf(body.captureSource, REVIEW_CAPTURE_SOURCES, 'captureSource');
        sendJson(response, 200, {
          accepted: true,
          itemId: body.itemId,
          nextDueAt: nextDueAtForGrade(body.grade),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/roleplays/start') {
        const body = await readJsonBody(request);
        assertPrivacySafe(body);
        assertRequired(body, ['schemaVersion', 'learningItemIds', 'targetLanguage']);
        assertSchemaVersion(body);
        assertArrayBounds(body.learningItemIds, 1, 3, 'learningItemIds');
        sendJson(response, 200, {
          roleplayId: 'rp_local_reference_001',
          scenario: 'You are buying a drink and need to repair the conversation without switching to Korean.',
          goals: [
            'Ask for repetition once.',
            'Buy time before answering.',
            'Finish with one independent English response.',
          ],
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/roleplays/result') {
        const body = await readJsonBody(request);
        assertPrivacySafe(body);
        assertRequired(body, ['schemaVersion', 'roleplayId', 'completedAt', 'outcomes']);
        assertSchemaVersion(body);
        assertArrayBounds(body.outcomes, 1, 3, 'outcomes');
        sendJson(response, 200, { accepted: true });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/sessions/import-summary') {
        const body = await readJsonBody(request);
        assertPrivacySafe(body);
        assertRequired(body, ['schemaVersion', 'sessionId', 'endedAt', 'sessionSummary', 'learningItems']);
        assertSchemaVersion(body);
        assertArrayBounds(body.learningItems, 0, 3, 'learningItems');
        sendJson(response, 200, { accepted: true });
        return;
      }

      sendJson(response, 405, errorBody('method_not_allowed', 'Unsupported method for Action endpoint'));
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      const code = status >= 500 ? 'internal_error' : 'invalid_request';
      const message = status >= 500 ? 'Mock Action server error' : error.message;
      sendJson(response, status, errorBody(code, message));
    }
  });
}

export function learnerProfile() {
  return {
    schemaVersion: ACTION_SCHEMA_VERSION,
    learnerId: 'learner_local_reference',
    updatedAt: '2026-06-19T09:00:00.000Z',
    profileLocale: 'ko-KR',
    targetLanguage: 'en-US',
    privacyMode: 'server_synced',
    metrics: {
      conversationRecoveryRate: 0.74,
      independentTransferRate: 0.58,
      assistedExactRate: 0.31,
      activeRecallDueCount: 2,
      totalSessions: 12,
    },
    ability: {
      recall: 0.61,
      listening: 0.55,
      grammar: 0.7,
      wordChoice: 0.66,
      pronunciation: 0.49,
      turnTaking: 0.68,
    },
    learningItems,
  };
}

export function reviewQueue() {
  return {
    schemaVersion: ACTION_SCHEMA_VERSION,
    items: learningItems.map((item, index) => ({
      itemId: item.id,
      mode: index === 0 ? 'meaning_to_expression' : 'transfer',
      prompt: index === 0 ? item.meaningKo : '회의 중 바로 대답하기 어렵다는 뜻을 새 상황에서 표현하기',
      meaningKo: item.meaningKo,
      scenarioTag: item.scenarioTags[0],
      dueAt: item.scheduling.dueAt,
    })),
  };
}

function nextDueAtForGrade(grade) {
  if (grade === 'again') return '2026-06-19T13:00:00.000Z';
  if (grade === 'hard') return '2026-06-20T09:00:00.000Z';
  if (grade === 'good') return '2026-06-22T09:00:00.000Z';
  return '2026-06-26T09:00:00.000Z';
}

function isAuthorized(request) {
  const value = request.headers.authorization ?? '';
  return /^Bearer [A-Za-z0-9._~-]{6,}$/.test(value);
}

function sendJson(response, status, body) {
  const payload = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    ...jsonHeaders,
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function errorBody(code, message) {
  return {
    error: {
      code,
      message,
    },
  };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > 64 * 1024) {
        reject(httpError(413, 'Request body is too large for the bounded Action contract'));
        request.destroy();
      }
    });
    request.on('error', reject);
    request.on('end', () => {
      try {
        resolve(body.length > 0 ? JSON.parse(body) : {});
      } catch {
        reject(httpError(400, 'Request body must be valid JSON'));
      }
    });
  });
}

function assertPrivacySafe(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPrivacySafe(item, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_ACTION_FIELDS.includes(key)) {
        throw httpError(400, 'Forbidden Action payload field rejected');
      }
      assertPrivacySafe(child, `${path}.${key}`);
    }
    return;
  }

  if (typeof value !== 'string') return;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) {
    throw httpError(400, 'Direct contact identifier rejected');
  }
  if (/\b(?:\+?\d[\s.-]?){8,}\b/.test(value)) {
    throw httpError(400, 'Direct contact identifier rejected');
  }
}

function assertRequired(body, fields) {
  for (const field of fields) {
    if (!(field in body)) {
      throw httpError(400, `Missing required field ${field}`);
    }
  }
}

function assertSchemaVersion(body) {
  if (body.schemaVersion !== ACTION_SCHEMA_VERSION) {
    throw httpError(400, `schemaVersion must be ${ACTION_SCHEMA_VERSION}`);
  }
}

function assertOneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw httpError(400, `${field} must be one of ${allowed.join(', ')}`);
  }
}

function assertArrayBounds(value, min, max, field) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw httpError(400, `${field} must contain ${min}-${max} item(s)`);
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number.parseInt(process.env.PORT ?? '8787', 10);
  const host = process.env.HOST ?? '127.0.0.1';
  const server = createChatGptActionMockServer();
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.info(`[chatgpt-action-mock] listening on http://${host}:${actualPort}`);
  });
}
