import { strict as assert } from 'node:assert';
import path from 'node:path';
import { test } from 'node:test';

import { validateProxySmokeEvidenceOut } from './echo-release-readiness.mjs';

const repoRoot = process.cwd();

test('accepts repo-local proxy smoke evidence JSON and converts it for echo-api-proxy cwd', () => {
  const result = validateProxySmokeEvidenceOut('docs/proxy-smoke-evidence.json', { repoRoot });

  assert.equal(result.ok, true);
  assert.equal(result.repoRelativePath, 'docs/proxy-smoke-evidence.json');
  assert.equal(result.proxyRelativePath, '../docs/proxy-smoke-evidence.json');
});

test('accepts nested repo-local evidence JSON paths', () => {
  const result = validateProxySmokeEvidenceOut('docs/evidence/proxy/smoke.json', { repoRoot });

  assert.equal(result.ok, true);
  assert.equal(result.repoRelativePath, 'docs/evidence/proxy/smoke.json');
  assert.equal(result.proxyRelativePath, '../docs/evidence/proxy/smoke.json');
});

test('rejects missing, non-json, absolute, and parent-traversal smoke evidence paths', () => {
  const cases = [
    '',
    'docs/proxy-smoke-evidence.md',
    '../outside.json',
    path.resolve(repoRoot, '..', 'outside.json'),
  ];

  for (const value of cases) {
    const result = validateProxySmokeEvidenceOut(value, { repoRoot });
    assert.equal(result.ok, false, `${value} should be rejected`);
    assert.match(result.detail, /ECHO_PROXY_SMOKE_EVIDENCE_OUT/);
  }
});
