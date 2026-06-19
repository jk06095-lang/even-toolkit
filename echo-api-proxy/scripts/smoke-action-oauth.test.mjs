import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

const scriptDir = new URL('.', import.meta.url);
const proxyDir = new URL('..', scriptDir);

test('Action OAuth smoke completes local flow without writing secrets to evidence', async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'echo-action-oauth-smoke-'));
  const evidencePath = path.join(tempRoot, 'action-oauth-smoke.json');
  const port = 20_200 + Math.floor(Math.random() * 500);
  const allowedOrigin = 'https://echo-action-smoke.example.test';
  const clientId = 'chatgpt-action-smoke-client';
  const clientSecret = 'test-action-oauth-smoke-secret-32';
  const redirectUri = 'https://chatgpt.com/aip/project-echo/oauth/callback';
  const proxy = spawn(process.execPath, ['server.mjs'], {
    cwd: proxyDir,
    env: {
      ...process.env,
      PORT: String(port),
      ECHO_PROXY_ALLOWED_ORIGINS: allowedOrigin,
      ECHO_PROXY_RATE_LIMIT_MAX: '60',
      ECHO_PROXY_RATE_LIMIT_WINDOW_MS: '60000',
      ECHO_ACTION_OAUTH_CLIENT_ID: clientId,
      ECHO_ACTION_OAUTH_CLIENT_SECRET: clientSecret,
      ECHO_ACTION_OAUTH_REDIRECT_ORIGINS: 'https://chatgpt.com',
      GEMINI_API_KEY: '',
      GOOGLE_GENERATIVE_AI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proxy.stderr.setEncoding('utf8');
  proxy.stderr.on('data', (chunk) => process.stderr.write(chunk));

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForProxy(baseUrl);
    const smoke = await runNode([
      path.join('scripts', 'smoke-action-oauth.mjs'),
      '--base-url',
      baseUrl,
      '--allowed-origin',
      allowedOrigin,
      '--client-id',
      clientId,
      '--client-secret',
      clientSecret,
      '--redirect-uri',
      redirectUri,
      '--evidence-out',
      evidencePath,
      '--allow-http',
    ]);

    assert.equal(smoke.code, 0, smoke.stderr || smoke.stdout);
    assert.match(smoke.stdout, /Action OAuth smoke passed/);

    const evidenceText = readFileSync(evidencePath, 'utf8');
    const evidence = JSON.parse(evidenceText);
    assert.equal(evidence.ok, true);
    assert.equal(evidence.accessTokenStoredInEvidence, false);
    assert.equal(evidence.clientSecretProvided, true);
    assert.equal(evidenceText.includes(clientSecret), false);
    assert.equal(evidenceText.includes('echo_oauth_'), false);
    assert.equal(evidenceText.includes('test@example.com'), false);
    assert.equal(evidence.checks.healthz.actionOAuthConfigured, true);
    assert.equal(evidence.checks.oauthAuthorize.codeReturned, true);
    assert.equal(evidence.checks.oauthToken.tokenTypeBearer, true);
    assert.equal(evidence.checks.learnerProfile.schemaVersion, '2.0.0');
    assert.equal(evidence.checks.reviewAttempt.writeAccepted, true);
    assert.equal(evidence.checks.roleplayResult.writeAccepted, true);
    assert.equal(evidence.checks.sessionImport.writeAccepted, true);
    assert.equal(evidence.checks.privacy.rawTranscriptRejected.rejected, true);
    assert.equal(evidence.checks.privacy.rawAudioRejected.rejected, true);
    assert.equal(evidence.checks.privacy.directContactIdentifiersRejected.rejected, true);
    assert.equal(evidence.checks.privacy.providerSecretsRejected.rejected, true);
  } finally {
    if (proxy.exitCode === null) {
      proxy.kill();
      await Promise.race([once(proxy, 'exit'), delay(1_000)]);
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

async function waitForProxy(baseUrl) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // Proxy is still starting.
    }
    await delay(100);
  }
  throw new Error('Proxy did not become ready.');
}

async function runNode(args) {
  const child = spawn(process.execPath, args, {
    cwd: proxyDir,
    env: process.env,
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
  const [code] = await once(child, 'exit');
  return { code, stdout, stderr };
}
