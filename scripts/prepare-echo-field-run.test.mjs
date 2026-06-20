import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

import {
  FIELD_RUN_PREP_REPORT_PATH,
  FIELD_RUN_PREP_STEPS,
  buildFieldRunPrepReport,
  writeFieldRunPrepReport,
} from './prepare-echo-field-run.mjs';

const repoRoot = process.cwd();
const tmpRoot = path.join(repoRoot, '.tmp', `echo-field-run-prep-${process.pid}`);
const commandLines = FIELD_RUN_PREP_STEPS.map((step) => ['npm', ...step.args].join(' '));

before(() => {
  mkdirSync(tmpRoot, { recursive: true });
});

after(() => {
  const resolvedTmpRoot = path.resolve(tmpRoot);
  const resolvedRepoRoot = path.resolve(repoRoot);
  if (resolvedTmpRoot.startsWith(`${resolvedRepoRoot}${path.sep}`) && existsSync(resolvedTmpRoot)) {
    rmSync(resolvedTmpRoot, { recursive: true, force: true });
  }
});

test('field-run prep packages before refreshing and validating evidence drafts', () => {
  assert.deepEqual(commandLines, [
    'npm --prefix even-app run verify',
    'npm run prepare:echo-evidence-drafts',
    'npm run validate:echo-evidence-drafts',
    'npm run status:echo-evidence -- --validate-final',
  ]);
});

test('field-run prep does not promote or fabricate final evidence', () => {
  assert.equal(commandLines.some((command) => command.includes('readiness:echo')), false);
  assert.equal(commandLines.some((command) => command.includes('promote:echo-portfolio-links')), false);
  assert.equal(commandLines.some((command) => command.includes('.completed.json')), false);
});

test('field-run prep report records local prep without promoting final evidence', () => {
  const report = buildFieldRunPrepReport(statusFixture(), {
    packageInfo: {
      path: 'even-app/echo.ehpk',
      status: 'available',
      bytes: 12345,
      sha256: 'a'.repeat(64),
    },
  });

  assert.match(report, /# Project ECHO Field-Run Prep Report/);
  assert.match(report, /Draft only/);
  assert.match(report, /npm --prefix even-app run verify/);
  assert.match(report, /Package status: available/);
  assert.match(report, /Package SHA-256: a{64}/);
  assert.match(report, /MISSING #10: README portfolio evidence links/);
  assert.match(report, /Production proxy smoke env ready: no/);
  assert.match(report, /Action OAuth smoke env ready: no/);
  assert.match(report, /READY: field-run prep report/);
  assert.match(report, /readiness:echo/);
  assert.doesNotMatch(report, /promote:echo-portfolio-links/);
});

test('field-run prep report can represent an in-progress prep sequence', () => {
  const report = buildFieldRunPrepReport(statusFixture(), {
    completedStepCount: 2,
    packageInfo: {
      path: 'even-app/echo.ehpk',
      status: 'available',
      bytes: 12345,
      sha256: 'a'.repeat(64),
    },
  });

  assert.match(report, /PASS: Project ECHO draft evidence refresh/);
  assert.match(report, /PENDING: Project ECHO workspace package\/draft SHA check/);
  assert.match(report, /PENDING: Project ECHO evidence status review/);
});

test('writes field-run prep reports inside the repository', () => {
  const reportPath = path.join('.tmp', `echo-field-run-prep-${process.pid}`, 'report.draft.md');
  const relativePath = writeFieldRunPrepReport('# Field Run\n', reportPath, { repoRoot });

  assert.equal(relativePath, reportPath.replace(/\\/g, '/'));
  assert.equal(readFileSync(path.resolve(repoRoot, reportPath), 'utf8'), '# Field Run\n');
});

test('rejects unsafe field-run prep report paths', () => {
  assert.throws(
    () => writeFieldRunPrepReport('# Field Run\n', '../outside.md', { repoRoot }),
    /must stay inside the repository/,
  );
  assert.throws(
    () => writeFieldRunPrepReport('# Field Run\n', 'docs/report.txt', { repoRoot }),
    /repo-local markdown file/,
  );
});

test('uses a stable draft report path by default', () => {
  assert.equal(FIELD_RUN_PREP_REPORT_PATH, 'docs/evidence-drafts/project-echo-field-run-prep-report.draft.md');
});

function statusFixture() {
  return {
    finalGates: [
      {
        issue: '#10',
        name: 'README portfolio evidence links',
        artifact: 'README portfolio evidence link block',
        status: 'missing',
        next: 'Promote README links only after completed pilot evidence validates.',
        draftRef: 'docs/evidence-drafts/project-echo-case-study.ko.draft.md',
        draftStatus: 'available',
      },
    ],
    draftFiles: [
      {
        name: 'field-run prep report',
        path: 'docs/evidence-drafts/project-echo-field-run-prep-report.draft.md',
        status: 'available',
      },
    ],
    proxySmokeEnv: { ready: false },
    actionOauthSmokeEnv: { ready: false },
    missingFinalCount: 1,
    missingDraftCount: 0,
  };
}
