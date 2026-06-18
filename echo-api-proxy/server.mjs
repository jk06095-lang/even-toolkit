import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = readNumberEnv('PORT', readNumberEnv('ECHO_PROXY_PORT', 8787));
const MAX_BODY_BYTES = readNumberEnv('ECHO_PROXY_MAX_BODY_BYTES', 6_000_000);
const PROVIDER_TIMEOUT_MS = readNumberEnv('ECHO_PROXY_PROVIDER_TIMEOUT_MS', 20_000);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
const ALLOWED_ORIGINS = parseOrigins(
  process.env.ECHO_PROXY_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173',
);

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const server = http.createServer(async (req, res) => {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const url = new URL(req.url || '/', 'http://echo-proxy.local');

  try {
    if (req.method === 'OPTIONS') {
      sendEmpty(req, res, 204);
      return;
    }

    if (req.headers.origin && !allowedOrigin(req.headers.origin)) {
      throw new HttpError(403, 'origin_not_allowed', 'Origin is not allowed for this proxy.');
    }

    if (req.method === 'GET' && url.pathname === '/healthz') {
      sendJson(req, res, 200, {
        ok: true,
        configured: Boolean(GEMINI_API_KEY),
        model: GEMINI_MODEL,
      });
      return;
    }

    if (req.method !== 'POST') {
      throw new HttpError(405, 'method_not_allowed', 'Use POST for ECHO API endpoints.');
    }

    if (!GEMINI_API_KEY) {
      throw new HttpError(503, 'proxy_not_configured', 'ECHO API proxy is not configured.');
    }

    const body = await readJsonBody(req);
    if (url.pathname === '/v1/cue') {
      sendJson(req, res, 200, await handleCue(body));
      return;
    }

    if (url.pathname === '/v1/transcribe') {
      sendJson(req, res, 200, await handleTranscription(body));
      return;
    }

    if (url.pathname === '/v1/session-analysis') {
      sendJson(req, res, 200, await handleSessionAnalysis(body));
      return;
    }

    throw new HttpError(404, 'not_found', 'Unknown ECHO API endpoint.');
  } catch (err) {
    sendSafeError(req, res, err);
  } finally {
    console.info(
      `[EchoProxy] ${requestId} ${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - startedAt}ms`,
    );
  }
});

server.listen(PORT, () => {
  console.info(`[EchoProxy] listening on :${PORT}`);
});

async function handleCue(input) {
  const startedAt = Date.now();
  const intent = input?.intent === 'simplify' ? 'simplify' : 'cue';
  const prompt = [
    'You are Project ECHO, a real-time English speaking coach for Even G2 smart glasses.',
    'Return JSON only. Schema: {"cue":"short English phrase"}.',
    'The cue must be natural spoken English, 2 to 8 words, max 50 characters, no explanation.',
    intent === 'simplify'
      ? 'Simplify the missed hint into easier spoken English.'
      : 'Generate one context-aware cue that helps the learner continue speaking.',
    `Topic: ${clipString(input?.topic, 120) || 'general'}`,
    `Difficulty week: ${clipString(input?.difficulty, 20) || '1'}`,
    `Category: ${clipString(input?.category, 80) || 'general'}`,
    `Scenario: ${clipString(input?.scenarioContext, 500) || 'none'}`,
    `Last utterance: ${clipString(input?.lastUtterance, 500) || 'none'}`,
    `Recent context: ${clipString(input?.recentTranscript || input?.conversationContext, 1_000) || 'none'}`,
    `Missed hint: ${clipString(input?.missedHint, 120) || 'none'}`,
    `Already used: ${clipArray(input?.usedHints, 10, 50).join(' | ') || 'none'}`,
  ].join('\n');

  const parsed = await callGeminiJson([{ text: prompt }], 96);
  const cue = cleanCue(firstText(parsed, ['cue', 'chunk', 'text']));
  if (!cue) throw new HttpError(502, 'provider_empty', 'Cue unavailable.');

  return {
    cue,
    chunk: cue,
    source: 'proxy',
    latencyMs: Date.now() - startedAt,
  };
}

async function handleTranscription(input) {
  const startedAt = Date.now();
  const audio = input?.audio;
  if (!audio || typeof audio.data !== 'string' || !audio.data.trim()) {
    throw new HttpError(400, 'missing_audio', 'Audio payload is required.');
  }

  const mimeType = cleanMimeType(audio.mimeType);
  const task = input?.task === 'speech_evaluation' ? 'speech_evaluation' : 'transcribe';
  const prompt =
    task === 'speech_evaluation'
      ? [
          'Transcribe the learner audio as English. Then decide if a short cue is needed.',
          'Return JSON only. Schema: {"transcript":"...","cue":null|"short phrase"}.',
          'Set cue to null when the learner produced a usable English utterance.',
          'Any cue must be 2 to 8 words, max 50 characters, and no explanation.',
          `Topic: ${clipString(input?.topic, 120) || 'general'}`,
          `Difficulty week: ${clipString(input?.difficulty, 20) || '1'}`,
          `Scenario: ${clipString(input?.scenarioContext, 500) || 'none'}`,
          `Last utterance: ${clipString(input?.lastUtterance, 500) || 'none'}`,
          `Already used cues: ${clipArray(input?.usedHints, 10, 50).join(' | ') || 'none'}`,
        ].join('\n')
      : 'Transcribe the learner audio as English. Return JSON only: {"transcript":"..."}.';

  const parsed = await callGeminiJson(
    [
      { text: prompt },
      { inlineData: { mimeType, data: audio.data } },
    ],
    task === 'speech_evaluation' ? 192 : 128,
  );

  const transcript = cleanTranscript(firstText(parsed, ['transcript', 'text']));
  const cue = cleanCue(firstText(parsed, ['cue', 'hint', 'chunk']));

  if (task === 'speech_evaluation') {
    return {
      transcript,
      text: transcript,
      cue: cue || null,
      hint: cue || null,
      chunk: cue || null,
      source: 'proxy',
      latencyMs: Date.now() - startedAt,
    };
  }

  return {
    transcript,
    text: transcript,
    source: 'proxy',
    latencyMs: Date.now() - startedAt,
  };
}

async function handleSessionAnalysis(input) {
  const startedAt = Date.now();
  const task = typeof input?.task === 'string' ? input.task : 'session_handoff';

  if (task === 'grammar') {
    const prompt = [
      'You are Project ECHO. Return JSON only: {"correction":null|"Try: corrected spoken phrase"}.',
      'If the utterance is already natural English, correction must be null.',
      `Topic: ${clipString(input?.topic, 120) || 'general'}`,
      `Transcript: ${clipString(input?.transcript, 1_000)}`,
    ].join('\n');
    const parsed = await callGeminiJson([{ text: prompt }], 128);
    return {
      correction: cleanCorrection(firstText(parsed, ['correction', 'text', 'result'])),
      source: 'proxy',
      latencyMs: Date.now() - startedAt,
    };
  }

  const stage1 = input?.stage_1_raw || {};
  const stage2 = input?.stage_2_analysis || {};
  const prompt = [
    'You are Project ECHO. Create a coaching handoff from session metrics.',
    'Return JSON only with this schema:',
    '{"weak_areas":[],"recommended_chunks":[],"difficulty_assessment":"","next_session_focus":"","gem_instruction":""}',
    'Keep arrays to max 5 items. Do not include personal data or raw transcript dumps.',
    `Week: ${clipString(stage1.week, 20) || 'unknown'}`,
    `Topic: ${clipString(stage1.topic, 120) || 'unknown'}`,
    `Category: ${clipString(stage1.category, 80) || 'unknown'}`,
    `Metrics: ${clipString(JSON.stringify(stage2), 4_000)}`,
    `Recent entries: ${clipString(JSON.stringify(compactEntries(stage1.entries)), 4_000)}`,
  ].join('\n');

  const parsed = await callGeminiJson([{ text: prompt }], 512);
  return {
    weak_areas: arrayOfStrings(parsed?.weak_areas).slice(0, 5),
    recommended_chunks: arrayOfStrings(parsed?.recommended_chunks).slice(0, 5),
    difficulty_assessment: clipString(parsed?.difficulty_assessment, 160) || 'Week in progress',
    next_session_focus: clipString(parsed?.next_session_focus, 240) || 'Continue current topic practice.',
    gem_instruction: clipString(parsed?.gem_instruction, 600) || 'Review the session metrics and suggest targeted practice.',
    source: 'proxy',
    latencyMs: Date.now() - startedAt,
  };
}

async function callGeminiJson(parts, maxOutputTokens) {
  const text = await callGemini(parts, maxOutputTokens);
  const parsed = parseJsonish(text);
  if (parsed && typeof parsed === 'object') return parsed;
  return { text };
}

async function callGemini(parts, maxOutputTokens) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent` +
    `?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens,
          responseMimeType: 'application/json',
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new HttpError(502, 'provider_error', 'AI provider request failed.');
    }

    const payload = await response.json();
    const candidateParts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(candidateParts)) return '';

    return candidateParts
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new HttpError(504, 'provider_timeout', 'AI provider request timed out.');
    }
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, 'provider_error', 'AI provider request failed.');
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new HttpError(413, 'payload_too_large', 'Request body is too large.');
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
}

function sendJson(req, res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(req),
  });
  res.end(JSON.stringify(body));
}

function sendEmpty(req, res, status) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    ...corsHeaders(req),
  });
  res.end();
}

function sendSafeError(req, res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  const code = err instanceof HttpError ? err.code : 'internal_error';
  const message =
    err instanceof HttpError
      ? err.message
      : 'ECHO API proxy failed safely. Please try again later.';

  sendJson(req, res, status, {
    error: {
      code,
      message,
    },
  });
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  const allowed = origin ? allowedOrigin(origin) : '';
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };

  if (allowed) headers['Access-Control-Allow-Origin'] = allowed;
  return headers;
}

function allowedOrigin(origin) {
  if (!origin) return '';
  if (ALLOWED_ORIGINS.includes('*')) return '*';
  return ALLOWED_ORIGINS.includes(origin) ? origin : '';
}

function parseOrigins(value) {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function readNumberEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseJsonish(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function firstText(input, keys) {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return '';
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

function clipString(value, max) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function clipArray(value, maxItems, maxChars) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item) => clipString(item, maxChars)).filter(Boolean);
}

function arrayOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => clipString(item, 160)).filter(Boolean);
}

function cleanCue(value) {
  return clipString(value, 50)
    .replace(/^["'[\(]+/, '')
    .replace(/["'\]\)]+$/, '')
    .trim();
}

function cleanTranscript(value) {
  return clipString(value, 2_000)
    .replace(/^(Transcript|Here is|The speaker said|The audio says)[:\s]*/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

function cleanCorrection(value) {
  const correction = clipString(value, 240);
  if (!correction || correction.toLowerCase() === 'null') return null;
  return correction;
}

function cleanMimeType(value) {
  const mimeType = typeof value === 'string' ? value.toLowerCase() : 'audio/wav';
  if (!/^audio\/[a-z0-9.+-]+$/.test(mimeType)) {
    throw new HttpError(400, 'invalid_audio_type', 'Audio mime type must be audio/*.');
  }
  return mimeType;
}

function compactEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(-12).map((entry) => ({
    type: clipString(entry?.type, 40),
    text: clipString(entry?.text, 160),
  }));
}
