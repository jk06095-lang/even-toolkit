#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildEvidenceStatus } from './echo-evidence-status.mjs';
import { readGitHubOpenIssues } from './validate-issue-closure-ledger.mjs';

export function parseIssueNumber(value) {
  const match = String(value ?? '').trim().match(/^#?(\d+)$/);
  if (!match) return null;
  const issueNumber = Number.parseInt(match[1], 10);
  return Number.isInteger(issueNumber) && issueNumber > 0 ? issueNumber : null;
}

export function gateIssueNumbers(issueGroup) {
  return [...String(issueGroup ?? '').matchAll(/#(\d+)/g)]
    .map((match) => Number.parseInt(match[1], 10))
    .filter((issueNumber) => Number.isInteger(issueNumber));
}

export function buildIssueClosePreflight(issueNumber, status, options = {}) {
  const readinessPassed = options.readinessPassed === true;
  const readinessDetail = options.readinessDetail || 'readiness was not run';
  const gates = (status.finalGates ?? []).filter((gate) => gateIssueNumbers(gate.issue).includes(issueNumber));
  const findings = [];

  if (gates.length === 0) {
    findings.push(`No Project ECHO final evidence gate is mapped to #${issueNumber}.`);
  }

  if (!readinessPassed) {
    findings.push(`npm run readiness:echo has not passed: ${readinessDetail}`);
  }

  const gateResults = gates.map((gate) => {
    const validationStatus = gate.validation?.status ?? 'not_run';
    const passed = gate.status === 'present'
      && (
        validationStatus === 'passed'
        || (readinessPassed && gate.name === 'production proxy smoke')
      );
    const detail = gate.status !== 'present'
      ? `missing ${gate.artifact}`
      : gate.validation?.detail ?? 'validation not available';

    if (!passed) {
      findings.push(`#${issueNumber} gate blocked: ${gate.name} - ${detail}`);
    }

    return {
      issue: gate.issue,
      name: gate.name,
      artifact: gate.artifact,
      validator: gate.validator,
      status: passed ? 'passed' : 'blocked',
      detail,
    };
  });

  return {
    issueNumber,
    readinessPassed,
    readinessDetail,
    gates: gateResults,
    ok: findings.length === 0,
    findings,
  };
}

export function formatIssueClosePreflight(report) {
  const lines = [
    '# Project ECHO Issue Close Preflight',
    '',
    `Issue: #${report.issueNumber}`,
    `Global readiness: ${report.readinessPassed ? 'passed' : 'blocked'} - ${report.readinessDetail}`,
    '',
    'Issue-specific gates:',
  ];

  if (report.gates.length === 0) {
    lines.push('- NONE: no mapped final evidence gate');
  } else {
    for (const gate of report.gates) {
      const marker = gate.status === 'passed' ? 'PASS' : 'BLOCKED';
      lines.push(`- ${marker}: ${gate.issue} ${gate.name} - ${gate.artifact}`);
      lines.push(`  Validator: ${gate.validator}`);
      lines.push(`  Detail: ${gate.detail}`);
    }
  }

  lines.push('');
  if (report.ok) {
    lines.push(`Decision: OK TO CLOSE #${report.issueNumber}`);
  } else {
    lines.push(`Decision: DO NOT CLOSE #${report.issueNumber}`);
    for (const finding of report.findings) {
      lines.push(`- ${finding}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function buildOpenIssueClosePreflight(openIssues, status, options = {}) {
  const reports = openIssues.map(([issueNumber, title]) => ({
    title,
    ...buildIssueClosePreflight(issueNumber, status, options),
  }));

  return {
    readinessPassed: options.readinessPassed === true,
    readinessDetail: options.readinessDetail || 'readiness was not run',
    issueCount: reports.length,
    closeableCount: reports.filter((report) => report.ok).length,
    blockedCount: reports.filter((report) => !report.ok).length,
    reports,
    ok: reports.every((report) => report.ok),
  };
}

export function formatOpenIssueClosePreflight(summary) {
  const lines = [
    '# Project ECHO Open Issue Close Preflight',
    '',
    `Global readiness: ${summary.readinessPassed ? 'passed' : 'blocked'} - ${summary.readinessDetail}`,
    `Open issues checked: ${summary.issueCount}`,
    `Closeable: ${summary.closeableCount}`,
    `Blocked: ${summary.blockedCount}`,
    '',
    'Issue decisions:',
  ];

  for (const report of summary.reports) {
    const decision = report.ok ? 'OK TO CLOSE' : 'DO NOT CLOSE';
    lines.push(`- #${report.issueNumber} ${decision}: ${report.title}`);
    if (!report.ok) {
      const gateNames = report.gates
        .filter((gate) => gate.status !== 'passed')
        .map((gate) => gate.name);
      const gateSuffix = gateNames.length > 0 ? ` (${gateNames.join('; ')})` : '';
      lines.push(`  Reason: ${report.findings[0] || 'blocked'}${gateSuffix}`);
    }
  }

  lines.push('');
  if (summary.ok) {
    lines.push('Decision: ALL OPEN ISSUES ARE SAFE TO CLOSE');
  } else {
    lines.push('Decision: DO NOT BULK-CLOSE OPEN ISSUES');
  }

  return `${lines.join('\n')}\n`;
}

export function writePreflightReport(markdown, reportPath, options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const resolvedPath = resolveRepoMarkdownPath(reportPath, repoRoot);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, markdown, 'utf8');
  return path.relative(repoRoot, resolvedPath).replace(/\\/g, '/');
}

async function runReadiness() {
  const result = await runNpm(['run', 'readiness:echo']);
  return {
    passed: result.code === 0,
    detail: firstUsefulLine(result.output) || (result.code === 0 ? 'readiness passed' : 'readiness failed'),
  };
}

function runNpm(args) {
  return new Promise((resolve) => {
    const invocation = npmInvocation(args);
    const child = spawn(invocation.command, invocation.args, {
      cwd: process.cwd(),
      shell: false,
      env: process.env,
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', (error) => {
      resolve({ code: 1, output: error.message });
    });
    child.on('exit', (code) => {
      resolve({ code: code ?? 1, output });
    });
  });
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
  const lines = String(output ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('> '))
    .filter((line) => !line.startsWith('npm '));

  return lines.find((line) => line.startsWith('[readiness]'))
    ?? lines.find((line) => line.startsWith('- BLOCKED'))
    ?? lines[0]
    ?? '';
}

async function main() {
  const wantsHelp = process.argv.includes('--help') || process.argv.includes('-h');
  const wantsLiveGitHub = process.argv.includes('--github-open-issues');
  const allowBlockedReport = process.argv.includes('--allow-blocked-report');
  const reportOut = readOption('--out') || readOption('--report-out');
  const issueArg = readIssueArg(process.argv.slice(2));
  const issueNumber = parseIssueNumber(issueArg);

  if (wantsHelp || (!issueNumber && !wantsLiveGitHub)) {
    console.info(`Usage: npm run preflight:echo-issue-close -- <issue-number>
       npm run preflight:echo-open-issues

Runs final-evidence status checks and npm run readiness:echo before deciding
whether a Project ECHO issue is safe to close. Pass the number without # for a
single issue, for example: npm run preflight:echo-issue-close -- 10

Use --github-open-issues, or npm run preflight:echo-open-issues, to check every
currently open GitHub issue in one run.

Use --out docs/evidence-drafts/example.draft.md to write the markdown report.
The --allow-blocked-report flag is only for report-generation commands; it lets
the command write a blocked draft report without treating that as permission to
close issues.`);
    process.exit(wantsHelp ? 0 : 1);
  }

  const status = buildEvidenceStatus({ validateFinal: true });
  const readiness = await runReadiness();
  const readinessOptions = {
    readinessPassed: readiness.passed,
    readinessDetail: readiness.detail,
  };

  if (wantsLiveGitHub) {
    const openIssues = readGitHubOpenIssues();
    const summary = buildOpenIssueClosePreflight(openIssues, status, readinessOptions);
    const markdown = formatOpenIssueClosePreflight(summary);
    console.info(markdown);
    maybeWriteReport(markdown, reportOut);
    if (!summary.ok && !(allowBlockedReport && reportOut)) {
      process.exit(1);
    }
    return;
  }

  const report = buildIssueClosePreflight(issueNumber, status, {
    ...readinessOptions,
  });
  const markdown = formatIssueClosePreflight(report);

  console.info(markdown);
  maybeWriteReport(markdown, reportOut);
  if (!report.ok && !(allowBlockedReport && reportOut)) {
    process.exit(1);
  }
}

function maybeWriteReport(markdown, reportOut) {
  if (!reportOut) return;
  const writtenPath = writePreflightReport(markdown, reportOut);
  console.info(`[issue-preflight] wrote ${writtenPath}`);
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return '';
  return process.argv[index + 1] || '';
}

export function readIssueArg(args) {
  const optionNamesWithValues = new Set(['--out', '--report-out']);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (optionNamesWithValues.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith('-')) return arg;
  }
  return '';
}

function resolveRepoMarkdownPath(value, repoRoot) {
  if (!/^(?:\.{1,2}[\\/])?[A-Za-z0-9_.\-/\\]+\.md$/i.test(String(value ?? ''))) {
    throw new Error('preflight report path must be a repo-local markdown file');
  }

  const resolvedPath = path.resolve(repoRoot, value);
  const rootPrefix = `${repoRoot}${path.sep}`;
  if (resolvedPath !== repoRoot && !resolvedPath.startsWith(rootPrefix)) {
    throw new Error('preflight report path must stay inside the repository');
  }

  return resolvedPath;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
