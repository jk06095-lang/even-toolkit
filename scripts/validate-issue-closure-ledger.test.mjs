import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  ISSUE_CLOSURE_LEDGER_PATH,
  findIssueClosureLedgerIssues,
} from './validate-issue-closure-ledger.mjs';

const repoRoot = process.cwd();
const ledgerText = readFileSync(path.resolve(repoRoot, ISSUE_CLOSURE_LEDGER_PATH), 'utf8');

test('current issue closure ledger covers all open issue gates', () => {
  assert.deepEqual(findIssueClosureLedgerIssues(ledgerText), []);
});

test('fails when an open issue title is removed', () => {
  const driftedLedger = ledgerText.replace(
    'P1: Build two-speaker ConversationTurn timeline with Korean translation',
    'P1: Build two-speaker timeline',
  );
  const issues = findIssueClosureLedgerIssues(driftedLedger);

  assert.ok(
    issues.some((issue) => issue.includes('Missing open issue title for #28')),
  );
});

test('fails when a final evidence artifact is removed', () => {
  const driftedLedger = ledgerText.replaceAll(
    'docs/project-echo-chatgpt-action-evidence.completed.json',
    'docs/project-echo-chatgpt-action-evidence.draft.json',
  );
  const issues = findIssueClosureLedgerIssues(driftedLedger);

  assert.ok(
    issues.some((issue) => issue.includes('Missing ChatGPT Action artifact')),
  );
});

test('fails when the draft-evidence closure guard is removed', () => {
  const driftedLedger = ledgerText.replace(
    'Do not close an issue based on a draft file under `docs/evidence-drafts/`',
    'Draft files can be reviewed during preparation.',
  );
  const issues = findIssueClosureLedgerIssues(driftedLedger);

  assert.ok(
    issues.some((issue) => issue.includes('Missing draft evidence closure guard')),
  );
});
