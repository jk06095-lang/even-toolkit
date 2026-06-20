#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { buildEvidenceStatus } from './echo-evidence-status.mjs';

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
  const issueArg = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
  const issueNumber = parseIssueNumber(issueArg);

  if (wantsHelp || !issueNumber) {
    console.info(`Usage: npm run preflight:echo-issue-close -- <issue-number>

Runs final-evidence status checks and npm run readiness:echo before deciding
whether a Project ECHO issue is safe to close. Pass the number without # in
shell commands, for example: npm run preflight:echo-issue-close -- 10`);
    process.exit(wantsHelp ? 0 : 1);
  }

  const status = buildEvidenceStatus({ validateFinal: true });
  const readiness = await runReadiness();
  const report = buildIssueClosePreflight(issueNumber, status, {
    readinessPassed: readiness.passed,
    readinessDetail: readiness.detail,
  });

  console.info(formatIssueClosePreflight(report));
  if (!report.ok) {
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
