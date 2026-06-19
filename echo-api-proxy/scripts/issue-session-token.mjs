#!/usr/bin/env node
import { createHmac, randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const wantsHelp = args.includes('--help') || args.includes('-h');

const secret = readOption('--secret') || process.env.ECHO_PROXY_SESSION_TOKEN_SECRET || '';
const issuer = readOption('--issuer') || process.env.ECHO_PROXY_SESSION_TOKEN_ISSUER || '';
const audience = readOption('--audience') || process.env.ECHO_PROXY_SESSION_TOKEN_AUDIENCE || 'project-echo-api';
const subject = readOption('--subject') || 'smoke-test';
const sessionId = readOption('--session-id') || `echo-session-${randomUUID()}`;
const ttlSeconds = readPositiveInt(
  readOption('--ttl-seconds') || process.env.ECHO_PROXY_SESSION_TOKEN_TTL_SECONDS || '3600',
);

if (wantsHelp) {
  console.info(`Usage: node scripts/issue-session-token.mjs --subject smoke-test [--session-id qa-run-001]

Environment:
  ECHO_PROXY_SESSION_TOKEN_SECRET   HMAC secret, at least 32 characters.
  ECHO_PROXY_SESSION_TOKEN_ISSUER   Issuer label expected by the proxy.
  ECHO_PROXY_SESSION_TOKEN_AUDIENCE Optional audience, default project-echo-api.
  ECHO_PROXY_SESSION_TOKEN_TTL_SECONDS Optional TTL, default 3600.

The token is printed to stdout. Do not commit issued tokens.`);
  process.exit(0);
}

if (secret.length < 32) {
  console.error('[issue-session-token] ECHO_PROXY_SESSION_TOKEN_SECRET must be at least 32 characters.');
  process.exit(1);
}

if (!issuer.trim()) {
  console.error('[issue-session-token] ECHO_PROXY_SESSION_TOKEN_ISSUER is required.');
  process.exit(1);
}

if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86_400) {
  console.error('[issue-session-token] TTL must be between 1 and 86400 seconds.');
  process.exit(1);
}

const nowSeconds = Math.floor(Date.now() / 1000);
const payload = {
  iss: issuer.trim(),
  aud: audience.trim(),
  sub: sanitizeClaim(subject, 120),
  sid: sanitizeClaim(sessionId, 180),
  jti: randomUUID(),
  iat: nowSeconds,
  exp: nowSeconds + ttlSeconds,
};

const payloadPart = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
const signaturePart = createHmac('sha256', secret)
  .update(payloadPart)
  .digest('base64url');

console.info(`echo1.${payloadPart}.${signaturePart}`);

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return '';
  return args[index + 1] || '';
}

function readPositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
}

function sanitizeClaim(value, maxLength) {
  return String(value || '')
    .replace(/[^A-Za-z0-9._:@-]/g, '-')
    .slice(0, maxLength)
    || 'echo-session';
}
