#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  HARDWARE_QA_EVIDENCE_ISSUES,
  READINESS_HANDOFF_PATH,
} from './echo-release-readiness.mjs';

export const ISSUE_CLOSURE_LEDGER_PATH = 'docs/project-echo-issue-closure-ledger.md';

const repoRoot = process.cwd();

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

  return issues;
}

function main() {
  const ledgerPath = path.resolve(repoRoot, ISSUE_CLOSURE_LEDGER_PATH);
  if (!existsSync(ledgerPath)) {
    console.error(`[issue-ledger] Missing ${ISSUE_CLOSURE_LEDGER_PATH}`);
    process.exit(1);
  }

  const ledgerText = readFileSync(ledgerPath, 'utf8');
  const issues = findIssueClosureLedgerIssues(ledgerText);
  if (issues.length > 0) {
    console.error(`[issue-ledger] ${ISSUE_CLOSURE_LEDGER_PATH} is out of sync with the open issue closure gates:`);
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.info(`[issue-ledger] ${ISSUE_CLOSURE_LEDGER_PATH} covers ${OPEN_ISSUES.length} open issues and ${REQUIRED_SNIPPETS.length} closure cues`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
