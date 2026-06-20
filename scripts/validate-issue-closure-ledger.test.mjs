import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  ISSUE_CLOSURE_LEDGER_PATH,
  extractLedgerOpenIssues,
  findOpenIssueSetDrift,
  findIssueClosureLedgerIssues,
  readGitHubOpenIssues,
} from './validate-issue-closure-ledger.mjs';

const repoRoot = process.cwd();
const ledgerText = readFileSync(path.resolve(repoRoot, ISSUE_CLOSURE_LEDGER_PATH), 'utf8');

test('current issue closure ledger covers all open issue gates', () => {
  assert.deepEqual(findIssueClosureLedgerIssues(ledgerText), []);
});

test('extracts the current open issue set from the ledger', () => {
  assert.deepEqual(extractLedgerOpenIssues(ledgerText).map(([number]) => number), [
    1,
    2,
    3,
    5,
    6,
    10,
    12,
    13,
    14,
    27,
    28,
    29,
  ]);
});

test('detects drift between the ledger and live GitHub open issue set', () => {
  const liveIssues = [
    [1, 'P0: Deploy ECHO API proxy and rotate exposed provider keys'],
    [29, 'P1: Add active-recall learning loop and Custom GPT profile export'],
    [30, 'P2: New follow-up issue'],
  ];
  const issues = findOpenIssueSetDrift(ledgerText, liveIssues);

  assert.ok(
    issues.some((issue) => issue.includes('Current Open Issue Set is missing live issue #30')),
  );
  assert.ok(
    issues.some((issue) => issue.includes('Current Open Issue Set contains non-open or unexpected issue #2')),
  );
});

test('detects live GitHub title drift', () => {
  const liveIssues = [
    [28, 'P1: Build translated partner timeline'],
  ];
  const issues = findOpenIssueSetDrift(ledgerText, liveIssues);

  assert.ok(
    issues.some((issue) => issue.includes('Current Open Issue Set title mismatch for #28')),
  );
});

test('reads live GitHub open issues from gh JSON output', () => {
  const issues = readGitHubOpenIssues({
    runCommand: () => ({
      status: 0,
      stdout: JSON.stringify([
        { number: 29, title: 'P1: Add active-recall learning loop and Custom GPT profile export' },
        { number: 1, title: 'P0: Deploy ECHO API proxy and rotate exposed provider keys' },
      ]),
      stderr: '',
    }),
  });

  assert.deepEqual(issues, [
    [1, 'P0: Deploy ECHO API proxy and rotate exposed provider keys'],
    [29, 'P1: Add active-recall learning loop and Custom GPT profile export'],
  ]);
});

test('surfaces gh failures for live GitHub open issue checks', () => {
  assert.throws(
    () => readGitHubOpenIssues({
      runCommand: () => ({
        status: 1,
        stdout: '',
        stderr: 'authentication required',
      }),
    }),
    /authentication required/,
  );
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
