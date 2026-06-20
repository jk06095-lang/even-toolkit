import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { FIELD_RUN_PREP_STEPS } from './prepare-echo-field-run.mjs';

const commandLines = FIELD_RUN_PREP_STEPS.map((step) => ['npm', ...step.args].join(' '));

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
