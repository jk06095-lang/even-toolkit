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

test('validates present final evidence when requested', () => {
  const availableFiles = new Set([
    READINESS_HANDOFF_PATH,
    'docs/key-rotation-evidence.md',
  ]);
  const status = buildEvidenceStatus({
    fileExists: (filePath) => availableFiles.has(filePath),
    readText: () => '# README without final portfolio links\n',
    validateFinal: true,
    runValidator: (gate) => ({
      status: 'passed',
      detail: `${gate.name} validator passed`,
    }),
  });
  const keyRotation = status.finalGates.find((gate) => gate.artifact === 'docs/key-rotation-evidence.md');

  assert.equal(keyRotation.status, 'present');
  assert.deepEqual(keyRotation.validation, {
    status: 'passed',
    detail: 'provider key/session-token rotation validator passed',
  });
  assert.match(formatEvidenceStatus(status), /VALID #1\/#27: provider key\/session-token rotation/);
  assert.match(formatEvidenceStatus(status), /Validation: passed - provider key\/session-token rotation validator passed/);
});

test('marks present but invalid final evidence as invalid', () => {
  const availableFiles = new Set([
    READINESS_HANDOFF_PATH,
    'docs/project-echo-hardware-qa.completed.json',
  ]);
  const status = buildEvidenceStatus({
    fileExists: (filePath) => availableFiles.has(filePath),
    readText: () => '# README without final portfolio links\n',
    validateFinal: true,
    runValidator: () => ({
      status: 'failed',
      detail: 'hardware evidence missing ACK proof',
    }),
  });

  assert.match(formatEvidenceStatus(status), /INVALID #2\/#3\/#6\/#12\/#13\/#14\/#28: completed hardware QA manifest/);
  assert.match(formatEvidenceStatus(status), /Validation: failed - hardware evidence missing ACK proof/);
});

test('skips live proxy smoke artifact validation in status and points to readiness', () => {
  const availableFiles = new Set([
    READINESS_HANDOFF_PATH,
    'docs/proxy-smoke-evidence.json',
  ]);
  const status = buildEvidenceStatus({
    fileExists: (filePath) => availableFiles.has(filePath),
    readText: () => '# README without final portfolio links\n',
    validateFinal: true,
  });
  const proxySmoke = status.finalGates.find((gate) => gate.artifact === 'docs/proxy-smoke-evidence.json');

  assert.equal(proxySmoke.status, 'present');
  assert.equal(proxySmoke.validation.status, 'skipped');
  assert.match(proxySmoke.validation.detail, /readiness:echo/);
  assert.match(formatEvidenceStatus(status), /PRESENT #1\/#27: production proxy smoke/);
});

test('validates README portfolio links against completed pilot evidence', () => {
  const availableFiles = new Set([
    READINESS_HANDOFF_PATH,
    'docs/project-echo-pilot-evidence.completed.json',
  ]);
  const readme = `
# README

<!-- project-echo-portfolio-links:start -->
- [Project ECHO case study (KO)](https://portfolio.project-echo.test/project-echo-case-study.ko.md) <!-- project-echo-case-study-ko -->
- [Project ECHO case study (EN)](https://portfolio.project-echo.test/project-echo-case-study.en.md) <!-- project-echo-case-study-en -->
- [Project ECHO real G2 video](https://portfolio.project-echo.test/project-echo-real-g2-video.mp4) <!-- project-echo-real-g2-video -->
<!-- project-echo-portfolio-links:end -->
`;
  const completedPilot = {
    caseStudy: {
      koreanCaseStudyUrl: 'https://portfolio.project-echo.test/project-echo-case-study.ko.md',
      englishCaseStudyUrl: 'https://portfolio.project-echo.test/project-echo-case-study.en.md',
      realG2VideoUrl: 'https://portfolio.project-echo.test/project-echo-real-g2-video.mp4',
    },
  };
  const status = buildEvidenceStatus({
    fileExists: (filePath) => availableFiles.has(filePath),
    readText: (filePath) => {
      if (filePath === 'docs/project-echo-pilot-evidence.completed.json') {
        return JSON.stringify(completedPilot);
      }
      return readme;
    },
    validateFinal: true,
  });

  const readmeGate = status.finalGates.find((gate) => gate.validatorKind === 'readme-portfolio-links');
  assert.equal(readmeGate.validation.status, 'passed');
  assert.match(formatEvidenceStatus(status), /VALID #10: README portfolio evidence links/);
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
  assert.deepEqual(proxySmokeEnv.baseUrl, {
    ok: true,
    normalized: 'https://api.project-echo.app',
  });
  assert.deepEqual(proxySmokeEnv.origin, {
    ok: true,
    normalized: 'https://echo-client.example.test',
  });
  assert.equal(proxySmokeEnv.evidenceOut.ok, true);
  assert.equal(proxySmokeEnv.evidenceOut.repoRelativePath, 'docs/proxy-smoke-evidence.json');

  const status = buildEvidenceStatus({
    fileExists: () => false,
    readText: () => '# README without final portfolio links\n',
    env,
  });
  const formatted = formatEvidenceStatus(status);

  assert.match(formatted, /SET: ECHO_PROXY_SMOKE_SESSION_TOKEN \(value redacted\)/);
  assert.match(formatted, /OK: ECHO_PROXY_BASE_URL -> https:\/\/api\.project-echo\.app/);
  assert.match(formatted, /OK: ECHO_PROXY_SMOKE_ORIGIN -> https:\/\/echo-client\.example\.test/);
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

test('rejects local or path-shaped proxy smoke URLs in the status preflight', () => {
  const localBaseUrl = buildProxySmokeEnvStatus({
    ECHO_PROXY_BASE_URL: 'http://127.0.0.1:8787',
    ECHO_PROXY_SMOKE_ORIGIN: 'https://echo-client.example.test',
    ECHO_PROXY_SMOKE_SESSION_TOKEN: 'redacted',
    ECHO_PROXY_SMOKE_EVIDENCE_OUT: 'docs/proxy-smoke-evidence.json',
  });

  assert.equal(localBaseUrl.ready, false);
  assert.equal(localBaseUrl.baseUrl.ok, false);
  assert.match(localBaseUrl.baseUrl.detail, /must use https/);

  const pathOrigin = buildProxySmokeEnvStatus({
    ECHO_PROXY_BASE_URL: 'https://api.project-echo.app',
    ECHO_PROXY_SMOKE_ORIGIN: 'https://echo-client.example.test/app',
    ECHO_PROXY_SMOKE_SESSION_TOKEN: 'redacted',
    ECHO_PROXY_SMOKE_EVIDENCE_OUT: 'docs/proxy-smoke-evidence.json',
  });

  assert.equal(pathOrigin.ready, false);
  assert.equal(pathOrigin.origin.ok, false);
  assert.match(pathOrigin.origin.detail, /without path, query, or hash/);
  assert.match(formatEvidenceStatus({
    handoff: { path: READINESS_HANDOFF_PATH, status: 'available' },
    finalGates: [],
    draftFiles: [],
    proxySmokeEnv: pathOrigin,
    missingFinalCount: 0,
    missingDraftCount: 0,
  }), /CHECK: ECHO_PROXY_SMOKE_ORIGIN/);
});
