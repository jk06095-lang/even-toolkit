import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  DRAFT_SUPPORT_FILES,
  FINAL_EVIDENCE_GATES,
  buildEvidenceStatus,
  buildProxySmokeEnvStatus,
  formatEvidenceStatus,
} from './echo-evidence-status.mjs';
import { READINESS_HANDOFF_PATH } from './echo-release-readiness.mjs';

test('reports missing final evidence without treating draft support as complete', () => {
  const availableFiles = new Set([
    READINESS_HANDOFF_PATH,
    ...DRAFT_SUPPORT_FILES.map((draft) => draft.path),
  ]);
  const status = buildEvidenceStatus({
    fileExists: (filePath) => availableFiles.has(filePath),
    readText: () => '# README without final portfolio links\n',
  });

  assert.equal(status.missingFinalCount, FINAL_EVIDENCE_GATES.length);
  assert.equal(status.missingDraftCount, 0);
  assert.equal(status.finalGates.every((gate) => gate.status === 'missing'), true);
  assert.equal(status.draftFiles.every((draft) => draft.status === 'available'), true);

  const formatted = formatEvidenceStatus(status);
  assert.match(formatted, /Informational only/);
  assert.match(formatted, /npm run readiness:echo/);
  assert.match(formatted, /Proxy smoke env preflight/);
  assert.match(formatted, /MISSING #5\/#10: completed 5-user pilot manifest/);
  assert.match(formatted, /Draft support: docs\/evidence-drafts\/project-echo-pilot-evidence\.draft\.json \(available\)/);
  assert.match(formatted, /proxy smoke env ready: no/);
});

test('detects present completed artifacts and README portfolio block', () => {
  const availableFiles = new Set([
    READINESS_HANDOFF_PATH,
    ...DRAFT_SUPPORT_FILES.map((draft) => draft.path),
    ...FINAL_EVIDENCE_GATES
      .filter((gate) => !gate.readmeBlock)
      .map((gate) => gate.artifact),
  ]);
  const readme = `
# README

<!-- project-echo-portfolio-links:start -->
- [Project ECHO case study (KO)](docs/project-echo-case-study.ko.md) <!-- project-echo-case-study-ko -->
- [Project ECHO case study (EN)](docs/project-echo-case-study.en.md) <!-- project-echo-case-study-en -->
- [Project ECHO real G2 video](docs/project-echo-real-g2-video.mp4) <!-- project-echo-real-g2-video -->
<!-- project-echo-portfolio-links:end -->
`;

  const status = buildEvidenceStatus({
    fileExists: (filePath) => availableFiles.has(filePath),
    readText: () => readme,
  });

  assert.equal(status.missingFinalCount, 0);
  assert.equal(status.finalGates.every((gate) => gate.status === 'present'), true);
  assert.match(formatEvidenceStatus(status), /Summary: 0 final gate\(s\) missing/);
});

test('reports proxy smoke env readiness without leaking the session token', () => {
  const env = {
    ECHO_PROXY_BASE_URL: 'https://api.project-echo.app',
    ECHO_PROXY_SMOKE_ORIGIN: 'https://echo-client.example.test',
    ECHO_PROXY_SMOKE_SESSION_TOKEN: 'secret-smoke-token-must-not-print',
    ECHO_PROXY_SMOKE_EVIDENCE_OUT: 'docs/proxy-smoke-evidence.json',
  };
  const proxySmokeEnv = buildProxySmokeEnvStatus(env);

  assert.equal(proxySmokeEnv.ready, true);
  assert.equal(proxySmokeEnv.evidenceOut.ok, true);
  assert.equal(proxySmokeEnv.evidenceOut.repoRelativePath, 'docs/proxy-smoke-evidence.json');

  const status = buildEvidenceStatus({
    fileExists: () => false,
    readText: () => '# README without final portfolio links\n',
    env,
  });
  const formatted = formatEvidenceStatus(status);

  assert.match(formatted, /SET: ECHO_PROXY_SMOKE_SESSION_TOKEN \(value redacted\)/);
  assert.match(formatted, /Ready to attempt production proxy smoke: yes/);
  assert.doesNotMatch(formatted, /secret-smoke-token-must-not-print/);
  assert.doesNotMatch(JSON.stringify(status), /secret-smoke-token-must-not-print/);
});

test('rejects unsafe proxy smoke evidence paths in the status preflight', () => {
  const proxySmokeEnv = buildProxySmokeEnvStatus({
    ECHO_PROXY_BASE_URL: 'https://api.project-echo.app',
    ECHO_PROXY_SMOKE_ORIGIN: 'https://echo-client.example.test',
    ECHO_PROXY_SMOKE_SESSION_TOKEN: 'redacted',
    ECHO_PROXY_SMOKE_EVIDENCE_OUT: '../outside.json',
  });

  assert.equal(proxySmokeEnv.ready, false);
  assert.equal(proxySmokeEnv.evidenceOut.ok, false);
  assert.match(proxySmokeEnv.evidenceOut.detail, /must stay inside the repository/);
});
