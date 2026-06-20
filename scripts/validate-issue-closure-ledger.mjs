#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  HARDWARE_QA_EVIDENCE_ISSUES,
  READINESS_HANDOFF_PATH,
} from './echo-release-readiness.mjs';

export const ISSUE_CLOSURE_LEDGER_PATH = 'docs/project-echo-issue-closure-ledger.md';

const repoRoot = process.cwd();
const args = process.argv.slice(2);

const OPEN_ISSUES = [
  [1, 'P0: Deploy ECHO API proxy and rotate exposed provider keys'],
  [2, 'P0: Split End Practice from Exit ECHO and verify lifecycle cleanup'],
  [3, 'P1: Reduce G2 HUD to READY, LISTENING, CUE, ACK, and PAUSED states'],
  [5, 'P1: Wire calibration output into real VAD thresholds'],
  [6, 'P1: Add session guards, AbortController cleanup, and latency instrumentation'],
  [10, 'P2: Complete real-device QA and portfolio evidence package'],
  [12, 'P2: Lazy-load Project ECHO voice runtime after device QA'],
  [13, 'P1: Keep G2 Mic and Phone Mic paths explicit'],
  [14, 'P0: Preserve explicit G2 wear status states'],
  [27, 'P0: Harden ECHO API proxy auth, session tokens, rate limits, and schemas'],
  [28, 'P1: Build two-speaker ConversationTurn timeline with Korean translation'],
  [29, 'P1: Add active-recall learning loop and Custom GPT profile export'],
];

const REQUIRED_SNIPPETS = [
  ['current open issue set section', '## Current Open Issue Set'],
  ['closure ledger section', '## Closure Ledger'],
  ['evidence groups section', '## Evidence Groups'],
  ['required commands section', '## Required Commands'],
  ['non-negotiables section', '## Non-Negotiables'],
  ['primary handoff reference', READINESS_HANDOFF_PATH],
  ['readiness gate command', 'npm run readiness:echo'],
  ['status validation command', 'npm run status:echo-evidence -- --validate-final'],
  ['live GitHub issue set validation command', 'npm run validate:issue-closure-ledger:github'],
  ['open issue close preflight command', 'npm run preflight:echo-open-issues'],
  ['single issue close preflight command', 'npm run preflight:echo-issue-close'],
  ['key rotation validator command', 'npm run validate:key-rotation-evidence -- docs/key-rotation-evidence.md'],
  ['hardware QA validator command', 'npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json'],
  ['pilot validator command', 'npm run validate:pilot-evidence -- docs/project-echo-pilot-evidence.completed.json'],
  ['ChatGPT Action validator command', 'npm run validate:chatgpt-action-evidence -- docs/project-echo-chatgpt-action-evidence.completed.json'],
  ['portfolio promotion command', 'npm run promote:echo-portfolio-links'],
  ['proxy smoke artifact', 'docs/proxy-smoke-evidence.json'],
  ['key rotation artifact', 'docs/key-rotation-evidence.md'],
  ['hardware QA artifact', 'docs/project-echo-hardware-qa.completed.json'],
  ['pilot evidence artifact', 'docs/project-echo-pilot-evidence.completed.json'],
  ['ChatGPT Action artifact', 'docs/project-echo-chatgpt-action-evidence.completed.json'],
  ['README portfolio evidence block', 'README portfolio evidence link block'],
  ['hardware QA issue group', HARDWARE_QA_EVIDENCE_ISSUES],
  ['draft evidence closure guard', 'Do not close an issue based on a draft file under `docs/evidence-drafts/`'],
  ['template evidence closure guard', 'Do not use `.draft.` or `.template.` evidence references in completed manifests.'],
  ['simulator-only hardware guard', 'Do not close hardware issues from simulator-only proof.'],
  ['Action transfer guard', 'Do not close #29 from endpoint smoke alone'],
];

export function findIssueClosureLedgerIssues(ledgerText, options = {}) {
  const issues = [];
  const openIssues = options.openIssues ?? OPEN_ISSUES;
  const requiredSnippets = options.requiredSnippets ?? REQUIRED_SNIPPETS;
  const requireExactOpenIssueSet = options.requireExactOpenIssueSet === true;

  for (const [issueNumber, title] of openIssues) {
    const issue = `#${issueNumber}`;
    if (!ledgerText.includes(issue)) {
      issues.push(`Missing open issue ${issue}`);
    }
    if (!ledgerText.includes(title)) {
      issues.push(`Missing open issue title for ${issue}: ${title}`);
    }
  }

  for (const [label, snippet] of requiredSnippets) {
    if (!ledgerText.includes(snippet)) {
      issues.push(`Missing ${label}: ${snippet}`);
    }
  }

  if (requireExactOpenIssueSet) {
    issues.push(...findOpenIssueSetDrift(ledgerText, openIssues));
  }

  return issues;
}

export function extractLedgerOpenIssues(ledgerText) {
  const match = ledgerText.match(/## Current Open Issue Set\s+([\s\S]*?)(?:\n## |\n?$)/);
  const section = match?.[1] ?? '';
  const issues = [];
  for (const line of section.split(/\r?\n/)) {
    const issueMatch = line.match(/^- #(\d+) `([^`]+)`\s*$/);
    if (issueMatch) {
      issues.push([Number.parseInt(issueMatch[1], 10), issueMatch[2]]);
    }
  }
  return issues;
}

export function findOpenIssueSetDrift(ledgerText, openIssues) {
  const issues = [];
  const ledgerIssues = extractLedgerOpenIssues(ledgerText);
  const ledgerByNumber = new Map(ledgerIssues.map(([number, title]) => [number, title]));
  const liveByNumber = new Map(openIssues.map(([number, title]) => [number, title]));

  for (const [number, title] of liveByNumber) {
    const ledgerTitle = ledgerByNumber.get(number);
    if (!ledgerTitle) {
      issues.push(`Current Open Issue Set is missing live issue #${number}: ${title}`);
    } else if (ledgerTitle !== title) {
      issues.push(`Current Open Issue Set title mismatch for #${number}: expected "${title}", found "${ledgerTitle}"`);
    }
  }

  for (const [number, title] of ledgerByNumber) {
    if (!liveByNumber.has(number)) {
      issues.push(`Current Open Issue Set contains non-open or unexpected issue #${number}: ${title}`);
    }
  }

  return issues;
}

export function readGitHubOpenIssues(options = {}) {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const result = runCommand('gh', [
    'issue',
    'list',
    '--state',
    'open',
    '--limit',
    '100',
    '--json',
    'number,title',
  ]);

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'gh issue list failed');
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`could not parse gh issue list JSON: ${error.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('gh issue list JSON must be an array');
  }

  return parsed
    .map((issue) => [Number.parseInt(issue.number, 10), String(issue.title || '')])
    .filter(([number, title]) => Number.isInteger(number) && number > 0 && title.length > 0)
    .sort((a, b) => a[0] - b[0]);
}

function defaultRunCommand(command, commandArgs) {
  return spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function main() {
  const ledgerPath = path.resolve(repoRoot, ISSUE_CLOSURE_LEDGER_PATH);
  if (!existsSync(ledgerPath)) {
    console.error(`[issue-ledger] Missing ${ISSUE_CLOSURE_LEDGER_PATH}`);
    process.exit(1);
  }

  const ledgerText = readFileSync(ledgerPath, 'utf8');
  const validateLiveGitHub = args.includes('--github-open-issues');
  const openIssues = validateLiveGitHub ? readGitHubOpenIssues() : OPEN_ISSUES;
  const issues = findIssueClosureLedgerIssues(ledgerText, {
    openIssues,
    requireExactOpenIssueSet: validateLiveGitHub,
  });
  if (issues.length > 0) {
    console.error(`[issue-ledger] ${ISSUE_CLOSURE_LEDGER_PATH} is out of sync with the open issue closure gates:`);
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  const source = validateLiveGitHub ? 'live GitHub' : 'pinned';
  console.info(`[issue-ledger] ${ISSUE_CLOSURE_LEDGER_PATH} covers ${openIssues.length} ${source} open issues and ${REQUIRED_SNIPPETS.length} closure cues`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
