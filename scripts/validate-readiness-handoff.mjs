#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  HARDWARE_QA_EVIDENCE_ISSUES,
  READINESS_HANDOFF_PATH,
} from './echo-release-readiness.mjs';

const repoRoot = process.cwd();

const OFFICIAL_EVEN_HUB_REFERENCES = [
  'https://hub.evenrealities.com/docs/get-started/overview',
  'https://hub.evenrealities.com/docs/test',
  'https://hub.evenrealities.com/docs/test/beta-testing',
  'https://hub.evenrealities.com/docs/reference/cli',
  'https://hub.evenrealities.com/docs/ship/app-submission',
];

const REQUIRED_HANDOFF_SNIPPETS = [
  ['current local position section', '## Current Local Position'],
  ['remaining evidence gates section', '## Remaining Evidence Gates'],
  ['official Even Hub boundary section', '## Official Even Hub Boundary'],
  ['next execution order section', '## Next Execution Order'],
  ['non-negotiables section', '## Non-Negotiables'],
  ['issue closure ledger reference', 'docs/project-echo-issue-closure-ledger.md'],
  ['readiness source of truth command', 'npm run readiness:echo'],
  ['issue closure ledger validation command', 'npm run validate:issue-closure-ledger'],
  ['evidence status command', 'npm run status:echo-evidence'],
  ['final evidence status validation command', 'npm run status:echo-evidence -- --validate-final'],
  ['draft evidence preparation command', 'npm run prepare:echo-evidence-drafts'],
  ['field-run local prep command', 'npm run prepare:echo-field-run'],
  ['field-run prep report path', 'docs/evidence-drafts/project-echo-field-run-prep-report.draft.md'],
  ['open issue preflight report command', 'npm run report:echo-open-issues'],
  ['open issue close preflight command', 'npm run preflight:echo-open-issues'],
  ['issue close preflight command', 'npm run preflight:echo-issue-close'],
  ['ECHO package command', 'npm --prefix even-app run pack'],
  ['hardware evidence validator command', 'npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json'],
  ['pilot evidence validator command', 'npm run validate:pilot-evidence -- docs/project-echo-pilot-evidence.completed.json'],
  ['ChatGPT Action evidence validator command', 'npm run validate:chatgpt-action-evidence -- docs/project-echo-chatgpt-action-evidence.completed.json'],
  ['portfolio link promotion command', 'npm run promote:echo-portfolio-links'],
  ['production proxy evidence issue group', '#1/#27'],
  ['production proxy smoke artifact', 'docs/proxy-smoke-evidence.json'],
  ['key rotation evidence artifact', 'docs/key-rotation-evidence.md'],
  ['hardware QA evidence issue group', HARDWARE_QA_EVIDENCE_ISSUES],
  ['hardware QA completed artifact', 'docs/project-echo-hardware-qa.completed.json'],
  ['pilot evidence issue group', '#5/#10'],
  ['pilot evidence completed artifact', 'docs/project-echo-pilot-evidence.completed.json'],
  ['ChatGPT Action evidence issue', '#29'],
  ['ChatGPT Action completed artifact', 'docs/project-echo-chatgpt-action-evidence.completed.json'],
  ['README portfolio link block gate', 'README portfolio link block'],
  ['packaged app evidence boundary', 'packaged `.ehpk`'],
  ['private or beta testing boundary', 'Private Testing or Beta Testing'],
  ['same package digest instruction', 'SHA-256'],
  ['fabrication guard', 'Do not fabricate pilot, hardware, proxy, key-rotation, Action, or portfolio'],
  ['pronunciation evidence guard', 'Do not use Web Speech confidence as G2 pronunciation evidence'],
  ['transfer proof guard', 'Do not use same-day repeat attempts as transfer proof'],
  ['privacy guard', 'Do not publish raw transcripts'],
];

export function findReadinessHandoffIssues(handoffText, options = {}) {
  const issues = [];
  const requiredSnippets = options.requiredSnippets ?? REQUIRED_HANDOFF_SNIPPETS;
  const officialReferences = options.officialReferences ?? OFFICIAL_EVEN_HUB_REFERENCES;

  for (const [label, snippet] of requiredSnippets) {
    if (!handoffText.includes(snippet)) {
      issues.push(`Missing ${label}: ${snippet}`);
    }
  }

  for (const url of officialReferences) {
    if (!handoffText.includes(url)) {
      issues.push(`Missing official Even Hub reference: ${url}`);
    }
  }

  return issues;
}

function main() {
  const handoffPath = path.resolve(repoRoot, READINESS_HANDOFF_PATH);
  if (!existsSync(handoffPath)) {
    console.error(`[handoff] Missing ${READINESS_HANDOFF_PATH}`);
    process.exit(1);
  }

  const handoffText = readFileSync(handoffPath, 'utf8');
  const issues = findReadinessHandoffIssues(handoffText);

  if (issues.length > 0) {
    console.error(`[handoff] ${READINESS_HANDOFF_PATH} is out of sync with readiness blockers:`);
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.info(`[handoff] ${READINESS_HANDOFF_PATH} covers ${REQUIRED_HANDOFF_SNIPPETS.length + OFFICIAL_EVEN_HUB_REFERENCES.length} required release cues`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
