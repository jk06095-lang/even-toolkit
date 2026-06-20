#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  HARDWARE_QA_EVIDENCE_ISSUES,
  READINESS_HANDOFF_PATH,
  validateReadmePortfolioLinks,
  validateProxySmokeEvidenceOut,
} from './echo-release-readiness.mjs';
import {
  ISSUE_CLOSURE_LEDGER_PATH,
  findIssueClosureLedgerIssues,
} from './validate-issue-closure-ledger.mjs';

const repoRoot = process.cwd();

export const FINAL_EVIDENCE_GATES = [
  {
    issue: '#1/#27',
    name: 'production proxy smoke',
    artifact: 'docs/proxy-smoke-evidence.json',
    validator: 'npm run readiness:echo with ECHO_PROXY_* env',
    draftRef: 'docs/evidence-drafts/key-rotation-evidence.draft.md',
    next: 'Deploy the production proxy, mint a short-lived signed smoke token, and write ECHO_PROXY_SMOKE_EVIDENCE_OUT to docs/proxy-smoke-evidence.json.',
  },
  {
    issue: '#1/#27',
    name: 'provider key/session-token rotation',
    artifact: 'docs/key-rotation-evidence.md',
    validator: 'npm run validate:key-rotation-evidence -- docs/key-rotation-evidence.md',
    validatorCommand: ['run', 'validate:key-rotation-evidence', '--', 'docs/key-rotation-evidence.md'],
    draftRef: 'docs/evidence-drafts/key-rotation-evidence.draft.md',
    next: 'Fill the production rotation evidence from smoke output, artifact scans, and redacted log review.',
  },
  {
    issue: HARDWARE_QA_EVIDENCE_ISSUES,
    name: 'completed hardware QA manifest',
    artifact: 'docs/project-echo-hardware-qa.completed.json',
    validator: 'npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json',
    validatorCommand: ['run', 'validate:hardware-qa', '--', 'docs/project-echo-hardware-qa.completed.json'],
    draftRef: 'docs/evidence-drafts/project-echo-hardware-qa.draft.json',
    next: 'Capture the physical G2/private-beta lifecycle, HUD, Assist, audio-source, lazy-runtime, and timeline evidence on the tested .ehpk.',
  },
  {
    issue: '#5/#10',
    name: 'completed 5-user pilot manifest',
    artifact: 'docs/project-echo-pilot-evidence.completed.json',
    validator: 'npm run validate:pilot-evidence -- docs/project-echo-pilot-evidence.completed.json',
    validatorCommand: ['run', 'validate:pilot-evidence', '--', 'docs/project-echo-pilot-evidence.completed.json'],
    draftRef: 'docs/evidence-drafts/project-echo-pilot-evidence.draft.json',
    next: 'Run the real G2 A/B/C pilot, attach VAD exports and summaries, and link final case-study/video assets.',
  },
  {
    issue: '#29',
    name: 'completed ChatGPT Action evidence manifest',
    artifact: 'docs/project-echo-chatgpt-action-evidence.completed.json',
    validator: 'npm run validate:chatgpt-action-evidence -- docs/project-echo-chatgpt-action-evidence.completed.json',
    validatorCommand: ['run', 'validate:chatgpt-action-evidence', '--', 'docs/project-echo-chatgpt-action-evidence.completed.json'],
    draftRef: 'docs/evidence-drafts/project-echo-chatgpt-action-evidence.draft.json',
    next: 'Deploy the OAuth-backed Action and capture privacy rejection plus Day 1/Day 7 G2 audio-level recall evidence.',
  },
  {
    issue: '#10',
    name: 'README portfolio evidence links',
    artifact: 'README portfolio evidence link block',
    validator: 'npm run promote:echo-portfolio-links',
    draftRef: 'docs/evidence-drafts/project-echo-case-study.ko.draft.md',
    readmeBlock: true,
    validatorKind: 'readme-portfolio-links',
    next: 'Promote README links only after the completed pilot manifest and final case-study/video targets validate.',
  },
];

export const DRAFT_SUPPORT_FILES = [
  {
    name: 'field runbook',
    path: 'docs/evidence-drafts/project-echo-field-runbook.draft.md',
  },
  {
    name: 'field-run prep report',
    path: 'docs/evidence-drafts/project-echo-field-run-prep-report.draft.md',
  },
  {
    name: 'build artifact summary',
    path: 'docs/evidence-drafts/project-echo-build-artifact.md',
  },
  {
    name: 'bundle report',
    path: 'docs/evidence-drafts/project-echo-bundle-report.md',
  },
  {
    name: 'hardware QA draft',
    path: 'docs/evidence-drafts/project-echo-hardware-qa.draft.json',
  },
  {
    name: 'pilot evidence draft',
    path: 'docs/evidence-drafts/project-echo-pilot-evidence.draft.json',
  },
  {
    name: 'ChatGPT Action evidence draft',
    path: 'docs/evidence-drafts/project-echo-chatgpt-action-evidence.draft.json',
  },
  {
    name: 'key-rotation draft',
    path: 'docs/evidence-drafts/key-rotation-evidence.draft.md',
  },
  {
    name: 'Korean case-study draft',
    path: 'docs/evidence-drafts/project-echo-case-study.ko.draft.md',
  },
  {
    name: 'English case-study draft',
    path: 'docs/evidence-drafts/project-echo-case-study.en.draft.md',
  },
  {
    name: 'real G2 video shot list',
    path: 'docs/evidence-drafts/project-echo-real-g2-video-shot-list.draft.md',
  },
];

export const PROXY_SMOKE_ENV_VARS = [
  'ECHO_PROXY_BASE_URL',
  'ECHO_PROXY_SMOKE_ORIGIN',
  'ECHO_PROXY_SMOKE_SESSION_TOKEN',
  'ECHO_PROXY_SMOKE_EVIDENCE_OUT',
];

export const ACTION_OAUTH_SMOKE_ENV_VARS = [
  'ECHO_ACTION_SMOKE_BASE_URL',
  'ECHO_ACTION_SMOKE_ORIGIN',
  'ECHO_ACTION_OAUTH_CLIENT_ID',
  'ECHO_ACTION_OAUTH_CLIENT_SECRET',
  'ECHO_ACTION_OAUTH_REDIRECT_URI',
  'ECHO_ACTION_SMOKE_EVIDENCE_OUT',
];

const ACTION_OAUTH_REDIRECT_URI_DEFAULT = 'https://chatgpt.com/aip/project-echo/oauth/callback';

export function buildEvidenceStatus(options = {}) {
  const fileExists = options.fileExists ?? defaultFileExists;
  const readText = options.readText ?? defaultReadText;
  const env = options.env ?? process.env;
  const root = options.repoRoot ?? repoRoot;
  const validateFinal = options.validateFinal === true;
  const runValidator = options.runValidator ?? defaultRunFinalGateValidator;

  const finalGates = FINAL_EVIDENCE_GATES.map((gate) => {
    const present = gate.readmeBlock
      ? readmePortfolioBlockExists(readText)
      : fileExists(gate.artifact);

    return {
      ...gate,
      status: present ? 'present' : 'missing',
      draftStatus: gate.draftRef && fileExists(gate.draftRef) ? 'available' : 'missing',
      validation: validateFinal
        ? validateFinalGate(gate, { present, readText, fileExists, runValidator })
        : undefined,
    };
  });

  const draftFiles = DRAFT_SUPPORT_FILES.map((draft) => ({
    ...draft,
    status: fileExists(draft.path) ? 'available' : 'missing',
  }));

  const handoff = {
    path: READINESS_HANDOFF_PATH,
    status: fileExists(READINESS_HANDOFF_PATH) ? 'available' : 'missing',
  };
  const issueClosureLedger = buildIssueClosureLedgerStatus({ fileExists, readText });

  const proxySmokeEnv = buildProxySmokeEnvStatus(env, { repoRoot: root });
  const actionOauthSmokeEnv = buildActionOauthSmokeEnvStatus(env, { repoRoot: root });

  return {
    handoff,
    issueClosureLedger,
    finalGates,
    draftFiles,
    proxySmokeEnv,
    actionOauthSmokeEnv,
    missingFinalCount: finalGates.filter((gate) => gate.status !== 'present').length,
    missingDraftCount: draftFiles.filter((draft) => draft.status !== 'available').length,
  };
}

export function formatEvidenceStatus(status) {
  const lines = [
    '# Project ECHO Evidence Status',
    '',
    'Informational only. `npm run readiness:echo` remains the release gate.',
    `Field handoff: ${status.handoff.path} (${status.handoff.status})`,
    `Issue closure ledger: ${formatIssueClosureLedgerStatus(status.issueClosureLedger)}`,
    '',
    'Proxy smoke env preflight:',
    ...formatProxySmokeEnvLines(status.proxySmokeEnv),
    '',
    'Action OAuth smoke env preflight:',
    ...formatActionOauthSmokeEnvLines(status.actionOauthSmokeEnv),
    '',
    'Final evidence gates:',
  ];

  for (const gate of status.finalGates) {
    const marker = finalGateMarker(gate);
    lines.push(`- ${marker} ${gate.issue}: ${gate.name} - ${gate.artifact}`);
    lines.push(`  Validator: ${gate.validator}`);
    if (gate.validation) {
      lines.push(`  Validation: ${gate.validation.status} - ${gate.validation.detail}`);
    }
    if (gate.status !== 'present') {
      lines.push(`  Next: ${gate.next}`);
    }
    if (gate.draftRef) {
      lines.push(`  Draft support: ${gate.draftRef} (${gate.draftStatus})`);
    }
  }

  lines.push('');
  lines.push('Draft support files:');
  for (const draft of status.draftFiles) {
    const marker = draft.status === 'available' ? 'READY' : 'MISSING';
    lines.push(`- ${marker}: ${draft.name} - ${draft.path}`);
  }

  lines.push('');
  lines.push('Next commands:');
  lines.push('- npm run prepare:echo-field-run');
  lines.push('- npm run prepare:echo-evidence-drafts');
  lines.push('- npm run validate:echo-evidence-drafts');
  lines.push('- npm run validate:issue-closure-ledger');
  lines.push('- npm run status:echo-evidence -- --validate-final');
  lines.push('- npm run report:echo-open-issues');
  lines.push('- npm run preflight:echo-open-issues');
  lines.push('- npm run preflight:echo-issue-close -- 10');
  lines.push('- npm run readiness:echo');
  lines.push('');
  lines.push(`Summary: ${status.missingFinalCount} final gate(s) missing, ${status.missingDraftCount} draft support file(s) missing, proxy smoke env ready: ${status.proxySmokeEnv.ready ? 'yes' : 'no'}, Action OAuth smoke env ready: ${status.actionOauthSmokeEnv.ready ? 'yes' : 'no'}, issue ledger valid: ${status.issueClosureLedger.status === 'valid' ? 'yes' : 'no'}.`);

  return `${lines.join('\n')}\n`;
}

function buildIssueClosureLedgerStatus({ fileExists, readText }) {
  if (!fileExists(ISSUE_CLOSURE_LEDGER_PATH)) {
    return {
      path: ISSUE_CLOSURE_LEDGER_PATH,
      status: 'missing',
      issueCount: 0,
      detail: 'issue closure ledger missing',
    };
  }

  let ledgerText;
  try {
    ledgerText = readText(ISSUE_CLOSURE_LEDGER_PATH);
  } catch (error) {
    return {
      path: ISSUE_CLOSURE_LEDGER_PATH,
      status: 'invalid',
      issueCount: 0,
      detail: `could not read issue closure ledger: ${error.message}`,
    };
  }

  const issues = findIssueClosureLedgerIssues(ledgerText);
  if (issues.length > 0) {
    return {
      path: ISSUE_CLOSURE_LEDGER_PATH,
      status: 'invalid',
      issueCount: issues.length,
      detail: issues.slice(0, 2).join('; '),
    };
  }

  return {
    path: ISSUE_CLOSURE_LEDGER_PATH,
    status: 'valid',
    issueCount: 0,
    detail: 'open issue closure gates are mapped to final evidence.',
  };
}

function formatIssueClosureLedgerStatus(issueClosureLedger) {
  const marker = issueClosureLedger.status.toUpperCase();
  return `${issueClosureLedger.path} (${marker}: ${issueClosureLedger.detail})`;
}

function validateFinalGate(gate, { present, readText, fileExists, runValidator }) {
  if (!present) {
    return {
      status: 'not_run',
      detail: 'artifact missing',
    };
  }

  if (gate.validatorKind === 'readme-portfolio-links') {
    return validateReadmePortfolioGate(readText, fileExists);
  }

  if (!gate.validatorCommand) {
    return {
      status: 'skipped',
      detail: 'Use npm run readiness:echo with ECHO_PROXY_* env to verify live production smoke.',
    };
  }

  return runValidator(gate);
}

function validateReadmePortfolioGate(readText, fileExists) {
  if (!fileExists('docs/project-echo-pilot-evidence.completed.json')) {
    return {
      status: 'failed',
      detail: 'docs/project-echo-pilot-evidence.completed.json is required before README portfolio links can validate.',
    };
  }

  let completedPilot;
  try {
    completedPilot = JSON.parse(readText('docs/project-echo-pilot-evidence.completed.json'));
  } catch (error) {
    return {
      status: 'failed',
      detail: `could not read completed pilot evidence: ${error.message}`,
    };
  }

  const findings = validateReadmePortfolioLinks(readText('README.md'), completedPilot);
  if (findings.length > 0) {
    return {
      status: 'failed',
      detail: findings.slice(0, 2).join('; '),
    };
  }

  return {
    status: 'passed',
    detail: 'README portfolio links match completed pilot evidence.',
  };
}

function defaultRunFinalGateValidator(gate) {
  const invocation = npmInvocation(gate.validatorCommand);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status === 0) {
    return {
      status: 'passed',
      detail: firstUsefulLine(output) || gate.validator,
    };
  }

  return {
    status: 'failed',
    detail: firstUsefulLine(output) || `${gate.validator} failed`,
  };
}

function npmInvocation(args) {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...args],
    };
  }

  return {
    command: 'npm',
    args,
  };
}

function firstUsefulLine(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('> '))
    .find((line) => !line.startsWith('npm ')) || '';
}

function finalGateMarker(gate) {
  if (gate.status !== 'present') return 'MISSING';
  if (gate.validation?.status === 'passed') return 'VALID';
  if (gate.validation?.status === 'failed') return 'INVALID';
  return 'PRESENT';
}

export function buildProxySmokeEnvStatus(env, options = {}) {
  const variables = PROXY_SMOKE_ENV_VARS.map((name) => ({
    name,
    status: env[name] ? 'set' : 'missing',
    redacted: name === 'ECHO_PROXY_SMOKE_SESSION_TOKEN' && Boolean(env[name]),
  }));
  const evidenceOut = validateProxySmokeEvidenceOut(env.ECHO_PROXY_SMOKE_EVIDENCE_OUT || '', {
    repoRoot: options.repoRoot ?? repoRoot,
  });
  const baseUrl = validateProductionProxyBaseUrl(env.ECHO_PROXY_BASE_URL || '');
  const origin = validateProductionProxyOrigin(env.ECHO_PROXY_SMOKE_ORIGIN || '');

  return {
    variables,
    baseUrl,
    origin,
    evidenceOut: evidenceOut.ok
      ? {
        ok: true,
        repoRelativePath: evidenceOut.repoRelativePath,
        proxyRelativePath: evidenceOut.proxyRelativePath,
      }
      : {
        ok: false,
        detail: evidenceOut.detail,
      },
    ready: variables.every((variable) => variable.status === 'set')
      && baseUrl.ok
      && origin.ok
      && evidenceOut.ok,
  };
}

export function buildActionOauthSmokeEnvStatus(env, options = {}) {
  const baseUrlStatus = buildFallbackVariableStatus(
    env,
    'ECHO_ACTION_SMOKE_BASE_URL',
    'ECHO_PROXY_BASE_URL',
  );
  const originStatus = buildFallbackVariableStatus(
    env,
    'ECHO_ACTION_SMOKE_ORIGIN',
    'ECHO_PROXY_SMOKE_ORIGIN',
  );
  const clientIdStatus = buildRequiredVariableStatus(env, 'ECHO_ACTION_OAUTH_CLIENT_ID');
  const clientSecretStatus = buildRequiredVariableStatus(env, 'ECHO_ACTION_OAUTH_CLIENT_SECRET', {
    redacted: true,
  });
  const redirectUriStatus = env.ECHO_ACTION_OAUTH_REDIRECT_URI
    ? {
      name: 'ECHO_ACTION_OAUTH_REDIRECT_URI',
      status: 'set',
    }
    : {
      name: 'ECHO_ACTION_OAUTH_REDIRECT_URI',
      status: 'default',
      source: ACTION_OAUTH_REDIRECT_URI_DEFAULT,
    };
  const evidenceOutStatus = buildRequiredVariableStatus(env, 'ECHO_ACTION_SMOKE_EVIDENCE_OUT');
  const variables = [
    baseUrlStatus,
    originStatus,
    clientIdStatus,
    clientSecretStatus,
    redirectUriStatus,
    evidenceOutStatus,
  ];
  const evidenceOut = validateActionOauthSmokeEvidenceOut(
    env.ECHO_ACTION_SMOKE_EVIDENCE_OUT || '',
    { repoRoot: options.repoRoot ?? repoRoot },
  );
  const baseUrl = validateProductionActionBaseUrl(
    baseUrlStatus.value || '',
    baseUrlStatus.sourceName || 'ECHO_ACTION_SMOKE_BASE_URL',
  );
  const origin = validateProductionActionOrigin(
    originStatus.value || '',
    originStatus.sourceName || 'ECHO_ACTION_SMOKE_ORIGIN',
  );
  const redirectUri = validateProductionActionRedirectUri(
    env.ECHO_ACTION_OAUTH_REDIRECT_URI || ACTION_OAUTH_REDIRECT_URI_DEFAULT,
  );

  return {
    variables: variables.map(({ value, ...variable }) => variable),
    baseUrl,
    origin,
    redirectUri,
    evidenceOut: evidenceOut.ok
      ? {
        ok: true,
        repoRelativePath: evidenceOut.repoRelativePath,
        proxyRelativePath: evidenceOut.proxyRelativePath,
      }
      : {
        ok: false,
        detail: evidenceOut.detail,
      },
    ready: clientIdStatus.status === 'set'
      && clientSecretStatus.status === 'set'
      && evidenceOutStatus.status === 'set'
      && baseUrl.ok
      && origin.ok
      && redirectUri.ok
      && evidenceOut.ok,
  };
}

function buildFallbackVariableStatus(env, name, fallbackName) {
  if (env[name]) {
    return {
      name,
      status: 'set',
      sourceName: name,
      value: env[name],
    };
  }

  if (env[fallbackName]) {
    return {
      name,
      status: 'fallback',
      source: fallbackName,
      sourceName: fallbackName,
      value: env[fallbackName],
    };
  }

  return {
    name,
    status: 'missing',
    sourceName: name,
    value: '',
  };
}

function buildRequiredVariableStatus(env, name, options = {}) {
  return {
    name,
    status: env[name] ? 'set' : 'missing',
    redacted: options.redacted === true && Boolean(env[name]),
    value: env[name] || '',
  };
}

function validateProductionProxyBaseUrl(value) {
  if (!value) {
    return {
      ok: false,
      detail: 'ECHO_PROXY_BASE_URL is required.',
    };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      detail: 'ECHO_PROXY_BASE_URL must be a valid URL.',
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      detail: 'ECHO_PROXY_BASE_URL must use https:// for release smoke.',
    };
  }

  if (isLocalOrPrivateHost(parsed.hostname)) {
    return {
      ok: false,
      detail: 'ECHO_PROXY_BASE_URL must not point to localhost or a private network host.',
    };
  }

  if (parsed.search || parsed.hash) {
    return {
      ok: false,
      detail: 'ECHO_PROXY_BASE_URL must not include query or hash.',
    };
  }

  return {
    ok: true,
    normalized: normalizeUrlWithoutTrailingSlash(parsed),
  };
}

function validateProductionProxyOrigin(value) {
  if (!value) {
    return {
      ok: false,
      detail: 'ECHO_PROXY_SMOKE_ORIGIN is required.',
    };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      detail: 'ECHO_PROXY_SMOKE_ORIGIN must be a valid URL origin.',
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      detail: 'ECHO_PROXY_SMOKE_ORIGIN must use https:// for release smoke.',
    };
  }

  if (parsed.origin !== value.replace(/\/$/, '')) {
    return {
      ok: false,
      detail: 'ECHO_PROXY_SMOKE_ORIGIN must be an origin without path, query, or hash.',
    };
  }

  if (isLocalOrPrivateHost(parsed.hostname)) {
    return {
      ok: false,
      detail: 'ECHO_PROXY_SMOKE_ORIGIN must not point to localhost or a private network host.',
    };
  }

  return {
    ok: true,
    normalized: parsed.origin,
  };
}

function validateProductionActionBaseUrl(value, envName) {
  if (!value) {
    return {
      ok: false,
      detail: `${envName} is required.`,
    };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      detail: `${envName} must be a valid URL.`,
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      detail: `${envName} must use https:// for release smoke.`,
    };
  }

  if (isLocalOrPrivateHost(parsed.hostname)) {
    return {
      ok: false,
      detail: `${envName} must not point to localhost or a private network host.`,
    };
  }

  if (parsed.search || parsed.hash) {
    return {
      ok: false,
      detail: `${envName} must not include query or hash.`,
    };
  }

  return {
    ok: true,
    normalized: normalizeUrlWithoutTrailingSlash(parsed),
    source: envName,
  };
}

function validateProductionActionOrigin(value, envName) {
  if (!value) {
    return {
      ok: false,
      detail: `${envName} is required.`,
    };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      detail: `${envName} must be a valid URL origin.`,
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      detail: `${envName} must use https:// for release smoke.`,
    };
  }

  if (parsed.origin !== value.replace(/\/$/, '')) {
    return {
      ok: false,
      detail: `${envName} must be an origin without path, query, or hash.`,
    };
  }

  if (isLocalOrPrivateHost(parsed.hostname)) {
    return {
      ok: false,
      detail: `${envName} must not point to localhost or a private network host.`,
    };
  }

  return {
    ok: true,
    normalized: parsed.origin,
    source: envName,
  };
}

function validateProductionActionRedirectUri(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      detail: 'ECHO_ACTION_OAUTH_REDIRECT_URI must be a valid URL.',
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      detail: 'ECHO_ACTION_OAUTH_REDIRECT_URI must use https:// for release smoke.',
    };
  }

  if (isLocalOrPrivateHost(parsed.hostname)) {
    return {
      ok: false,
      detail: 'ECHO_ACTION_OAUTH_REDIRECT_URI must not point to localhost or a private network host.',
    };
  }

  if (parsed.hash) {
    return {
      ok: false,
      detail: 'ECHO_ACTION_OAUTH_REDIRECT_URI must not include a hash fragment.',
    };
  }

  parsed.hash = '';
  return {
    ok: true,
    normalized: parsed.toString(),
    defaulted: value === ACTION_OAUTH_REDIRECT_URI_DEFAULT,
  };
}

function validateActionOauthSmokeEvidenceOut(value, options = {}) {
  const envName = 'ECHO_ACTION_SMOKE_EVIDENCE_OUT';
  const root = path.resolve(options.repoRoot ?? repoRoot);
  if (!value) {
    return {
      ok: false,
      detail: `${envName} is required.`,
    };
  }

  if (!/^(?:\.{1,2}[\\/])?[A-Za-z0-9_.\-/\\]+\.json$/i.test(value)) {
    return {
      ok: false,
      detail: `${envName} must be a repo-local JSON path.`,
    };
  }

  const rootResolved = path.resolve(root, value);
  const proxyResolved = path.resolve(root, 'echo-api-proxy', value);
  const resolvedPath = pathStaysInside(rootResolved, root) ? rootResolved : proxyResolved;
  if (!pathStaysInside(resolvedPath, root)) {
    return {
      ok: false,
      detail: `${envName} must stay inside the repository.`,
    };
  }

  const repoRelativePath = path.relative(root, resolvedPath).replace(/\\/g, '/');
  if (!repoRelativePath || repoRelativePath.startsWith('..') || path.isAbsolute(repoRelativePath)) {
    return {
      ok: false,
      detail: `${envName} must resolve to a file inside the repository.`,
    };
  }

  const proxyRoot = path.resolve(root, 'echo-api-proxy');
  const proxyRelativePath = path.relative(proxyRoot, resolvedPath).replace(/\\/g, '/');
  return {
    ok: true,
    repoRelativePath,
    proxyRelativePath,
  };
}

function pathStaysInside(targetPath, root) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  const rootPrefix = `${resolvedRoot}${path.sep}`;
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(rootPrefix);
}

function normalizeUrlWithoutTrailingSlash(parsed) {
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

function isLocalOrPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host === '127.0.0.1'
    || host === '::1'
  ) {
    return true;
  }

  const parts = host.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  return a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254);
}

function formatProxySmokeEnvLines(proxySmokeEnv) {
  const lines = proxySmokeEnv.variables.map((variable) => {
    const marker = variable.status === 'set' ? 'SET' : 'MISSING';
    const redacted = variable.redacted ? ' (value redacted)' : '';
    return `- ${marker}: ${variable.name}${redacted}`;
  });

  if (proxySmokeEnv.baseUrl.ok) {
    lines.push(`- OK: ECHO_PROXY_BASE_URL -> ${proxySmokeEnv.baseUrl.normalized}`);
  } else {
    lines.push(`- CHECK: ECHO_PROXY_BASE_URL - ${proxySmokeEnv.baseUrl.detail}`);
  }

  if (proxySmokeEnv.origin.ok) {
    lines.push(`- OK: ECHO_PROXY_SMOKE_ORIGIN -> ${proxySmokeEnv.origin.normalized}`);
  } else {
    lines.push(`- CHECK: ECHO_PROXY_SMOKE_ORIGIN - ${proxySmokeEnv.origin.detail}`);
  }

  if (proxySmokeEnv.evidenceOut.ok) {
    lines.push(`- OK: ECHO_PROXY_SMOKE_EVIDENCE_OUT -> ${proxySmokeEnv.evidenceOut.repoRelativePath}`);
  } else {
    lines.push(`- CHECK: ECHO_PROXY_SMOKE_EVIDENCE_OUT - ${proxySmokeEnv.evidenceOut.detail}`);
  }
  lines.push(`- Ready to attempt production proxy smoke: ${proxySmokeEnv.ready ? 'yes' : 'no'}`);

  return lines;
}

function formatActionOauthSmokeEnvLines(actionOauthSmokeEnv) {
  const lines = actionOauthSmokeEnv.variables.map((variable) => {
    if (variable.status === 'fallback') {
      return `- FALLBACK: ${variable.name} via ${variable.source}`;
    }
    if (variable.status === 'default') {
      return `- DEFAULT: ${variable.name} -> ${variable.source}`;
    }
    const marker = variable.status === 'set' ? 'SET' : 'MISSING';
    const redacted = variable.redacted ? ' (value redacted)' : '';
    return `- ${marker}: ${variable.name}${redacted}`;
  });

  if (actionOauthSmokeEnv.baseUrl.ok) {
    lines.push(`- OK: Action smoke base URL -> ${actionOauthSmokeEnv.baseUrl.normalized}`);
  } else {
    lines.push(`- CHECK: Action smoke base URL - ${actionOauthSmokeEnv.baseUrl.detail}`);
  }

  if (actionOauthSmokeEnv.origin.ok) {
    lines.push(`- OK: Action smoke origin -> ${actionOauthSmokeEnv.origin.normalized}`);
  } else {
    lines.push(`- CHECK: Action smoke origin - ${actionOauthSmokeEnv.origin.detail}`);
  }

  if (actionOauthSmokeEnv.redirectUri.ok) {
    lines.push(`- OK: ECHO_ACTION_OAUTH_REDIRECT_URI -> ${actionOauthSmokeEnv.redirectUri.normalized}`);
  } else {
    lines.push(`- CHECK: ECHO_ACTION_OAUTH_REDIRECT_URI - ${actionOauthSmokeEnv.redirectUri.detail}`);
  }

  if (actionOauthSmokeEnv.evidenceOut.ok) {
    lines.push(`- OK: ECHO_ACTION_SMOKE_EVIDENCE_OUT -> ${actionOauthSmokeEnv.evidenceOut.repoRelativePath}`);
  } else {
    lines.push(`- CHECK: ECHO_ACTION_SMOKE_EVIDENCE_OUT - ${actionOauthSmokeEnv.evidenceOut.detail}`);
  }
  lines.push(`- Ready to attempt Action OAuth smoke: ${actionOauthSmokeEnv.ready ? 'yes' : 'no'}`);

  return lines;
}

function defaultFileExists(filePath) {
  return existsSync(path.resolve(repoRoot, filePath));
}

function defaultReadText(filePath) {
  return readFileSync(path.resolve(repoRoot, filePath), 'utf8');
}

function readmePortfolioBlockExists(readText) {
  try {
    const readme = readText('README.md');
    return readme.includes('<!-- project-echo-portfolio-links:start -->')
      && readme.includes('<!-- project-echo-portfolio-links:end -->');
  } catch {
    return false;
  }
}

function main() {
  const status = buildEvidenceStatus({
    validateFinal: process.argv.includes('--validate-final'),
  });
  if (process.argv.includes('--json')) {
    console.info(JSON.stringify(status, null, 2));
    return;
  }
  console.info(formatEvidenceStatus(status));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
