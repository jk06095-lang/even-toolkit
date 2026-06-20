import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  HARDWARE_QA_EVIDENCE_ISSUES,
  READINESS_HANDOFF_PATH,
} from './echo-release-readiness.mjs';
import { findReadinessHandoffIssues } from './validate-readiness-handoff.mjs';

const repoRoot = process.cwd();
const handoffText = readFileSync(path.resolve(repoRoot, READINESS_HANDOFF_PATH), 'utf8');

test('current readiness handoff covers all release cues', () => {
  assert.deepEqual(findReadinessHandoffIssues(handoffText), []);
});

test('fails when the hardware QA issue group drifts from readiness', () => {
  const driftedHandoff = handoffText.replace(HARDWARE_QA_EVIDENCE_ISSUES, '#2/#3/#6');
  const issues = findReadinessHandoffIssues(driftedHandoff);

  assert.ok(
    issues.some((issue) => issue.includes(`hardware QA evidence issue group: ${HARDWARE_QA_EVIDENCE_ISSUES}`)),
  );
});

test('fails when official Even Hub references are removed', () => {
  const driftedHandoff = handoffText.replace(
    'https://hub.evenrealities.com/docs/ship/app-submission',
    'https://example.com/app-submission',
  );
  const issues = findReadinessHandoffIssues(driftedHandoff);

  assert.ok(
    issues.some((issue) => issue.includes('Missing official Even Hub reference: https://hub.evenrealities.com/docs/ship/app-submission')),
  );
});
