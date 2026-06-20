import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  buildIssueClosePreflight,
  formatIssueClosePreflight,
  gateIssueNumbers,
  parseIssueNumber,
} from './preflight-echo-issue-close.mjs';

test('parses issue numbers with or without hash prefix', () => {
  assert.equal(parseIssueNumber('10'), 10);
  assert.equal(parseIssueNumber('#10'), 10);
  assert.equal(parseIssueNumber('issue-10'), null);
});

test('extracts all issue numbers from a readiness gate group', () => {
  assert.deepEqual(gateIssueNumbers('#2/#3/#6/#12/#13/#14/#28'), [2, 3, 6, 12, 13, 14, 28]);
});

test('blocks issue close when mapped final evidence is missing', () => {
  const report = buildIssueClosePreflight(10, statusFixture(), {
    readinessPassed: false,
    readinessDetail: '[readiness] 6 blocker(s) remain',
  });

  assert.equal(report.ok, false);
  assert.equal(report.gates.length, 2);
  assert.ok(report.findings.some((finding) => finding.includes('completed 5-user pilot manifest')));
  assert.ok(report.findings.some((finding) => finding.includes('README portfolio evidence links')));
  assert.match(formatIssueClosePreflight(report), /Decision: DO NOT CLOSE #10/);
});

test('requires global readiness even when issue-specific gates pass', () => {
  const status = statusFixture({
    finalGates: [
      passedGate('#29', 'completed ChatGPT Action evidence manifest'),
    ],
  });
  const report = buildIssueClosePreflight(29, status, {
    readinessPassed: false,
    readinessDetail: '[readiness] 1 blocker(s) remain',
  });

  assert.equal(report.ok, false);
  assert.ok(report.findings.some((finding) => finding.includes('readiness:echo has not passed')));
});

test('passes when readiness and all mapped gates pass', () => {
  const status = statusFixture({
    finalGates: [
      passedGate('#29', 'completed ChatGPT Action evidence manifest'),
    ],
  });
  const report = buildIssueClosePreflight(29, status, {
    readinessPassed: true,
    readinessDetail: '[readiness] Project ECHO release evidence is complete',
  });

  assert.equal(report.ok, true);
  assert.match(formatIssueClosePreflight(report), /Decision: OK TO CLOSE #29/);
});

test('allows production proxy smoke only when readiness has passed', () => {
  const status = statusFixture({
    finalGates: [
      {
        issue: '#1/#27',
        name: 'production proxy smoke',
        artifact: 'docs/proxy-smoke-evidence.json',
        validator: 'npm run readiness:echo with ECHO_PROXY_* env',
        status: 'present',
        validation: {
          status: 'skipped',
          detail: 'Use npm run readiness:echo with ECHO_PROXY_* env to verify live production smoke.',
        },
      },
      passedGate('#1/#27', 'provider key/session-token rotation'),
    ],
  });
  const report = buildIssueClosePreflight(1, status, {
    readinessPassed: true,
    readinessDetail: '[readiness] Project ECHO release evidence is complete',
  });

  assert.equal(report.ok, true);
});

test('blocks unknown issue numbers without mapped gates', () => {
  const report = buildIssueClosePreflight(999, statusFixture(), {
    readinessPassed: true,
    readinessDetail: '[readiness] Project ECHO release evidence is complete',
  });

  assert.equal(report.ok, false);
  assert.ok(report.findings.some((finding) => finding.includes('No Project ECHO final evidence gate')));
});

function statusFixture(overrides = {}) {
  return {
    finalGates: overrides.finalGates ?? [
      missingGate('#5/#10', 'completed 5-user pilot manifest', 'docs/project-echo-pilot-evidence.completed.json'),
      missingGate('#10', 'README portfolio evidence links', 'README portfolio evidence link block'),
      missingGate('#29', 'completed ChatGPT Action evidence manifest', 'docs/project-echo-chatgpt-action-evidence.completed.json'),
    ],
  };
}

function missingGate(issue, name, artifact) {
  return {
    issue,
    name,
    artifact,
    validator: `validate ${artifact}`,
    status: 'missing',
    validation: {
      status: 'not_run',
      detail: 'artifact missing',
    },
  };
}

function passedGate(issue, name) {
  return {
    issue,
    name,
    artifact: `artifact for ${name}`,
    validator: `validator for ${name}`,
    status: 'present',
    validation: {
      status: 'passed',
      detail: 'validated',
    },
  };
}
