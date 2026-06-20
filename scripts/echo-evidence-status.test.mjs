import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  DRAFT_SUPPORT_FILES,
  FINAL_EVIDENCE_GATES,
  buildActionOauthSmokeEnvStatus,
  buildEvidenceStatus,
  buildProxySmokeEnvStatus,
  formatEvidenceStatus,
} from './echo-evidence-status.mjs';
import { READINESS_HANDOFF_PATH } from './echo-release-readiness.mjs';
import { ISSUE_CLOSURE_LEDGER_PATH } from './validate-issue-closure-ledger.mjs';

const repoRoot = process.cwd();
const validIssueClosureLedgerText = readFileSync(path.resolve(repoRoot, ISSUE_CLOSURE_LEDGER_PATH), 'utf8');
const validIssueClosureLedgerStatus = {
  path: ISSUE_CLOSURE_LEDGER_PATH,
  status: 'valid',
  issueCount: 0,
  detail: 'open issue closure gates are mapped to final evidence.',
};

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
  assert.match(formatted, /npm run preflight:echo-open-issues/);
  assert.match(formatted, /npm run preflight:echo-issue-close -- 10/);
  assert.match(formatted, /Issue closure ledger: docs\/project-echo-issue-closure-ledger\.md \(MISSING:/);
  assert.match(formatted, /Proxy smoke env preflight/);
  assert.match(formatted, /Action OAuth smoke env preflight/);
  assert.match(formatted, /MISSING #5\/#10: completed 5-user pilot manifest/);
  assert.match(formatted, /Draft support: docs\/evidence-drafts\/project-echo-pilot-evidence\.draft\.json \(available\)/);
  assert.match(formatted, /proxy smoke env ready: no/);
  assert.match(formatted, /Action OAuth smoke env ready: no/);
  assert.match(formatted, /issue ledger valid: no/);
});

test('reports a valid issue closure ledger in evidence status', () => {
  const availableFiles = new Set([
    READINESS_HANDOFF_PATH,
    ISSUE_CLOSURE_LEDGER_PATH,
  ]);
  const status = buildEvidenceStatus({
    fileExists: (filePath) => availableFiles.has(filePath),
    readText: (filePath) => {
      if (filePath === ISSUE_CLOSURE_LEDGER_PATH) return validIssueClosureLedgerText;
      return '# README without final portfolio links\n';
    },
  });

  assert.equal(status.issueClosureLedger.status, 'valid');
  assert.match(formatEvidenceStatus(status), /Issue closure ledger: docs\/project-echo-issue-closure-ledger\.md \(VALID:/);
  assert.match(formatEvidenceStatus(status), /issue ledger valid: yes/);
});

test('reports an invalid issue closure ledger in evidence status', () => {
  const availableFiles = new Set([
    READINESS_HANDOFF_PATH,
    ISSUE_CLOSURE_LEDGER_PATH,
  ]);
  const status = buildEvidenceStatus({
    fileExists: (filePath) => availableFiles.has(filePath),
    readText: (filePath) => {
      if (filePath === ISSUE_CLOSURE_LEDGER_PATH) return validIssueClosureLedgerText.replaceAll('#29', '#30');
      return '# README without final portfolio links\n';
    },
  });

  assert.equal(status.issueClosureLedger.status, 'invalid');
  assert.match(status.issueClosureLedger.detail, /Missing open issue #29/);
  assert.match(formatEvidenceStatus(status), /Issue closure ledger: docs\/project-echo-issue-closure-ledger\.md \(INVALID:/);
  assert.match(formatEvidenceStatus(status), /issue ledger valid: no/);
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
    actionOauthSmokeEnv: buildActionOauthSmokeEnvStatus({}),
    issueClosureLedger: validIssueClosureLedgerStatus,
    missingFinalCount: 0,
    missingDraftCount: 0,
  }), /CHECK: ECHO_PROXY_SMOKE_ORIGIN/);
});

test('reports Action OAuth smoke env readiness without leaking the client secret', () => {
  const env = {
    ECHO_ACTION_SMOKE_BASE_URL: 'https://api.project-echo.app',
    ECHO_ACTION_SMOKE_ORIGIN: 'https://chatgpt.com',
    ECHO_ACTION_OAUTH_CLIENT_ID: 'project-echo-action-client',
    ECHO_ACTION_OAUTH_CLIENT_SECRET: 'secret-action-client-value-must-not-print',
    ECHO_ACTION_OAUTH_REDIRECT_URI: 'https://chatgpt.com/aip/project-echo/oauth/callback',
    ECHO_ACTION_SMOKE_EVIDENCE_OUT: '../docs/chatgpt-action-oauth-smoke.json',
  };
  const actionOauthSmokeEnv = buildActionOauthSmokeEnvStatus(env);

  assert.equal(actionOauthSmokeEnv.ready, true);
  assert.deepEqual(actionOauthSmokeEnv.baseUrl, {
    ok: true,
    normalized: 'https://api.project-echo.app',
    source: 'ECHO_ACTION_SMOKE_BASE_URL',
  });
  assert.deepEqual(actionOauthSmokeEnv.origin, {
    ok: true,
    normalized: 'https://chatgpt.com',
    source: 'ECHO_ACTION_SMOKE_ORIGIN',
  });
  assert.equal(actionOauthSmokeEnv.redirectUri.ok, true);
  assert.equal(actionOauthSmokeEnv.evidenceOut.repoRelativePath, 'docs/chatgpt-action-oauth-smoke.json');
  assert.equal(actionOauthSmokeEnv.evidenceOut.proxyRelativePath, '../docs/chatgpt-action-oauth-smoke.json');

  const status = buildEvidenceStatus({
    fileExists: () => false,
    readText: () => '# README without final portfolio links\n',
    env,
  });
  const formatted = formatEvidenceStatus(status);

  assert.match(formatted, /SET: ECHO_ACTION_OAUTH_CLIENT_SECRET \(value redacted\)/);
  assert.match(formatted, /OK: Action smoke base URL -> https:\/\/api\.project-echo\.app/);
  assert.match(formatted, /OK: Action smoke origin -> https:\/\/chatgpt\.com/);
  assert.match(formatted, /Ready to attempt Action OAuth smoke: yes/);
  assert.doesNotMatch(formatted, /secret-action-client-value-must-not-print/);
  assert.doesNotMatch(JSON.stringify(status), /secret-action-client-value-must-not-print/);
});

test('allows Action OAuth smoke URL fallback and default ChatGPT redirect URI', () => {
  const actionOauthSmokeEnv = buildActionOauthSmokeEnvStatus({
    ECHO_PROXY_BASE_URL: 'https://api.project-echo.app',
    ECHO_PROXY_SMOKE_ORIGIN: 'https://chatgpt.com',
    ECHO_ACTION_OAUTH_CLIENT_ID: 'project-echo-action-client',
    ECHO_ACTION_OAUTH_CLIENT_SECRET: 'redacted',
    ECHO_ACTION_SMOKE_EVIDENCE_OUT: 'docs/chatgpt-action-oauth-smoke.json',
  });

  assert.equal(actionOauthSmokeEnv.ready, true);
  assert.equal(actionOauthSmokeEnv.baseUrl.source, 'ECHO_PROXY_BASE_URL');
  assert.equal(actionOauthSmokeEnv.origin.source, 'ECHO_PROXY_SMOKE_ORIGIN');
  assert.equal(actionOauthSmokeEnv.redirectUri.defaulted, true);

  const formatted = formatEvidenceStatus({
    handoff: { path: READINESS_HANDOFF_PATH, status: 'available' },
    finalGates: [],
    draftFiles: [],
    proxySmokeEnv: buildProxySmokeEnvStatus({}),
    actionOauthSmokeEnv,
    issueClosureLedger: validIssueClosureLedgerStatus,
    missingFinalCount: 0,
    missingDraftCount: 0,
  });

  assert.match(formatted, /FALLBACK: ECHO_ACTION_SMOKE_BASE_URL via ECHO_PROXY_BASE_URL/);
  assert.match(formatted, /FALLBACK: ECHO_ACTION_SMOKE_ORIGIN via ECHO_PROXY_SMOKE_ORIGIN/);
  assert.match(formatted, /DEFAULT: ECHO_ACTION_OAUTH_REDIRECT_URI -> https:\/\/chatgpt\.com\/aip\/project-echo\/oauth\/callback/);
});

test('rejects unsafe Action OAuth smoke env values in the status preflight', () => {
  const unsafe = buildActionOauthSmokeEnvStatus({
    ECHO_ACTION_SMOKE_BASE_URL: 'http://127.0.0.1:8787',
    ECHO_ACTION_SMOKE_ORIGIN: 'https://chatgpt.com/action',
    ECHO_ACTION_OAUTH_CLIENT_ID: 'project-echo-action-client',
    ECHO_ACTION_OAUTH_CLIENT_SECRET: 'redacted',
    ECHO_ACTION_OAUTH_REDIRECT_URI: 'https://localhost/callback',
    ECHO_ACTION_SMOKE_EVIDENCE_OUT: '../../outside.json',
  });

  assert.equal(unsafe.ready, false);
  assert.equal(unsafe.baseUrl.ok, false);
  assert.match(unsafe.baseUrl.detail, /must use https/);
  assert.equal(unsafe.origin.ok, false);
  assert.match(unsafe.origin.detail, /without path, query, or hash/);
  assert.equal(unsafe.redirectUri.ok, false);
  assert.match(unsafe.redirectUri.detail, /must not point to localhost/);
  assert.equal(unsafe.evidenceOut.ok, false);
  assert.match(unsafe.evidenceOut.detail, /must stay inside the repository/);
});
