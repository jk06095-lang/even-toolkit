import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

const repoRoot = process.cwd();
const resolvedRepoRoot = path.resolve(repoRoot);
const tmpRoot = path.join(repoRoot, '.tmp', `key-rotation-validator-${process.pid}`);
const proxyUrl = 'https://api.project-echo.app';
const appVersion = JSON.parse(readFileSync(path.join(repoRoot, 'even-app/package.json'), 'utf8')).version;

before(() => {
  mkdirSync(tmpRoot, { recursive: true });
});

after(() => {
  const resolvedTmpRoot = path.resolve(tmpRoot);
  if (resolvedTmpRoot.startsWith(`${resolvedRepoRoot}${path.sep}`) && existsSync(resolvedTmpRoot)) {
    rmSync(resolvedTmpRoot, { recursive: true, force: true });
  }
});

test('accepts key-rotation evidence with passing structured deployment smoke JSON', async () => {
  const fixture = writeFixture('valid', smokeEvidence());
  const result = await runValidator(fixture.markdownPath);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /final key-rotation evidence accepted/);
});

test('rejects deployment smoke evidence that used local-only release override flags', async () => {
  const fixture = writeFixture('override-flag', smokeEvidence({ allowHttp: true }));
  const result = await runValidator(fixture.markdownPath);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /deploymentSmokeEvidence\.releaseFlags/);
});

test('rejects key-rotation evidence text that includes unauthenticated smoke override', async () => {
  const fixture = writeFixture('unauthenticated-flag-text', smokeEvidence());
  const markdownPath = path.join(repoRoot, fixture.markdownPath);
  const markdown = readFileSync(markdownPath, 'utf8').replace(' passed', ' --allow-unauthenticated passed');
  writeFileSync(markdownPath, markdown, 'utf8');

  const result = await runValidator(fixture.markdownPath);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /--allow-unauthenticated/);
});

test('rejects deployment smoke evidence that echoed sensitive learner text', async () => {
  const fixture = writeFixture('echoed-sensitive', smokeEvidence({
    checks: {
      safeError: {
        responseEchoedSensitive: true,
      },
    },
  }));
  const result = await runValidator(fixture.markdownPath);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /deploymentSmokeEvidence\.checks\.safeError\.responseEchoedSensitive/);
});

test('rejects deployment smoke evidence without configured session-token policy', async () => {
  const fixture = writeFixture('missing-token-policy', smokeEvidence({
    checks: {
      healthz: {
        tokenPolicyConfigured: false,
        tokenPolicyIssuerPresent: false,
        tokenPolicyTtlSeconds: null,
        tokenPolicyRotationDays: null,
        tokenPolicyActiveTokenCount: 0,
        tokenPolicySignedTokenConfigured: false,
      },
    },
  }));
  const result = await runValidator(fixture.markdownPath);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /deploymentSmokeEvidence\.checks\.healthz\.tokenPolicyConfigured/);
});

test('rejects deployment smoke evidence without retry guard metadata', async () => {
  const fixture = writeFixture('missing-retry-guards', smokeEvidence({
    checks: {
      healthz: {
        idempotencyTtlMs: null,
        idempotencyMaxEntries: 0,
        circuitBreakerFailureThreshold: 0,
        circuitBreakerCooldownMs: null,
        circuitBreakerOpen: true,
      },
      options: {
        allowsIdempotencyKey: false,
      },
    },
  }));
  const result = await runValidator(fixture.markdownPath);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /deploymentSmokeEvidence\.checks\.healthz\.idempotencyTtlMs/);
  assert.match(result.stderr, /deploymentSmokeEvidence\.checks\.healthz\.idempotencyMaxEntries/);
  assert.match(result.stderr, /deploymentSmokeEvidence\.checks\.healthz\.circuitBreakerFailureThreshold/);
  assert.match(result.stderr, /deploymentSmokeEvidence\.checks\.healthz\.circuitBreakerCooldownMs/);
  assert.match(result.stderr, /deploymentSmokeEvidence\.checks\.healthz\.circuitBreakerOpen/);
  assert.match(result.stderr, /deploymentSmokeEvidence\.checks\.options\.allowsIdempotencyKey/);
});

test('rejects deployment smoke evidence without rate-limit metadata', async () => {
  const fixture = writeFixture('missing-rate-limit-policy', smokeEvidence({
    checks: {
      healthz: {
        rateLimitWindowMs: null,
        rateLimitMax: 0,
      },
    },
  }));
  const result = await runValidator(fixture.markdownPath);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /deploymentSmokeEvidence\.checks\.healthz\.rateLimitWindowMs/);
  assert.match(result.stderr, /deploymentSmokeEvidence\.checks\.healthz\.rateLimitMax/);
});

function writeFixture(name, evidence) {
  const fixtureDir = path.join(tmpRoot, name);
  mkdirSync(fixtureDir, { recursive: true });

  const evidencePath = path.join(fixtureDir, 'proxy-smoke-evidence.json');
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  const evidenceRelativePath = repoRelative(evidencePath);
  const markdownPath = path.join(fixtureDir, 'key-rotation-evidence.md');
  writeFileSync(markdownPath, keyRotationMarkdown(evidenceRelativePath), 'utf8');

  return {
    markdownPath: repoRelative(markdownPath),
    evidencePath: evidenceRelativePath,
  };
}

function smokeEvidence(overrides = {}) {
  const base = {
    schema: 'project-echo-proxy-smoke-v1',
    generatedAt: '2026-06-19T00:00:00.000Z',
    baseUrl: proxyUrl,
    allowedOrigin: 'https://echo-client.example.test',
    disallowedOrigin: 'https://blocked.project-echo.invalid',
    allowHttp: false,
    allowUnconfigured: false,
    allowUnauthenticated: false,
    allowQaDelay: false,
    sessionTokenProvided: true,
    ok: true,
    checks: {
      healthz: {
        status: 200,
        ok: true,
        configured: true,
        authConfigured: true,
        qaDelayMs: 0,
        tokenPolicyConfigured: true,
        tokenPolicyIssuerPresent: true,
        tokenPolicyAudience: 'project-echo-api',
        tokenPolicyTtlSeconds: 3600,
        tokenPolicyRotationDays: 7,
        tokenPolicyActiveTokenCount: 1,
        tokenPolicySignedTokenConfigured: true,
        rateLimitWindowMs: 60000,
        rateLimitMax: 60,
        idempotencyTtlMs: 300000,
        idempotencyMaxEntries: 500,
        circuitBreakerFailureThreshold: 3,
        circuitBreakerCooldownMs: 30000,
        circuitBreakerOpen: false,
        corsOriginMatches: true,
        cacheControlNoStore: true,
      },
      options: {
        status: 204,
        corsOriginMatches: true,
        allowsPost: true,
        allowsAuthorization: true,
        allowsSessionToken: true,
        allowsIdempotencyKey: true,
      },
      missingSessionToken: {
        status: 401,
        errorCode: 'missing_session_token',
        corsOriginMatches: true,
      },
      disallowedOrigin: {
        status: 403,
        errorCode: 'origin_not_allowed',
        corsOriginAbsent: true,
      },
      safeError: {
        status: 503,
        errorCode: 'proxy_not_configured',
        errorCodePresent: true,
        responseEchoedSensitive: false,
        corsOriginMatches: true,
      },
    },
  };

  return deepMerge(base, overrides);
}

function keyRotationMarkdown(evidenceRelativePath) {
  return `# Project ECHO Key Rotation Evidence

## Rotation Date

- Date: 2026-06-19
- Rotation owner: Release owner
- Production proxy URL: ${proxyUrl}
- Client build or package version: echo-app ${appVersion}

## Rotated Provider Keys

- Provider: Gemini
- Previous key location removed from: server secret manager previous version
- New key location: server secret manager current version
- Server secret manager reference: production/project-echo/GEMINI_API_KEY
- Browser artifact key scan result: 0 matches

## Session Token Rotation

- Session token issuer: production/project-echo/session-token-issuer
- Session token TTL: 1 hour
- Session token rotation cadence: 7 days
- Session token revocation evidence: verified old smoke token rejected after rotation
- Session token storage boundary: server secret manager only
- Session token client artifact scan result: 0 matches

## Production Log Review

- Reviewed time window: 2026-06-19T00:00:00Z to 2026-06-19T01:00:00Z
- Log source: production proxy logs
- Log allowlist confirmation: verified true
- Raw transcript/audio log exclusion: verified true

## Deployment Smoke Evidence

- Deployment smoke command result: npm run smoke:deploy -- --base-url ${proxyUrl} --allowed-origin https://echo-client.example.test --evidence-out ${evidenceRelativePath} passed
- Deployment smoke evidence JSON: ${evidenceRelativePath}
- /healthz configured true: verified true
- Allowed origin passed: passed
- Untrusted origin blocked: passed
- Safe non-echoing error response verified: verified true

## Artifact Scan Evidence

- even-app/dist scan result: 0 matches
- even-app/echo.ehpk scan result: 0 matches
- Direct provider hostname scan result: 0 matches
- Development IP scan result: 0 matches

## Follow-up Owner

- Follow-up owner: Release owner
- Follow-up issue or ticket: #1
- Notes: Structured validator fixture.
`;
}

function runValidator(markdownPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/validate-key-rotation-evidence.mjs', markdownPath], {
      cwd: repoRoot,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function repoRelative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function deepMerge(base, overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && base[key]
      && typeof base[key] === 'object'
      && !Array.isArray(base[key])
    ) {
      merged[key] = deepMerge(base[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
