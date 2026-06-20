#!/usr/bin/env node
import { spawn } from 'node:child_process';

const steps = [
  {
    label: 'release dependency pins',
    args: ['run', 'validate:release-deps'],
  },
  {
    label: 'README production key guidance',
    args: ['run', 'validate:readme-security'],
  },
  {
    label: 'root TypeScript build',
    args: ['run', 'build'],
  },
  {
    label: 'ECHO domain v2 schemas',
    args: ['run', 'validate:echo-domain-v2'],
  },
  {
    label: 'Project ECHO ChatGPT Action contract',
    args: ['run', 'validate:chatgpt-action'],
  },
  {
    label: 'Project ECHO ChatGPT Action mock smoke',
    args: ['run', 'test:chatgpt-action-mock'],
  },
  {
    label: 'Project ECHO ChatGPT Action evidence template',
    args: ['run', 'validate:chatgpt-action-template'],
  },
  {
    label: 'Project ECHO ChatGPT Action evidence validator tests',
    args: ['run', 'test:chatgpt-action-evidence'],
  },
  {
    label: 'Project ECHO pilot evidence template',
    args: ['run', 'validate:pilot-template'],
  },
  {
    label: 'Project ECHO pilot evidence validator tests',
    args: ['run', 'test:pilot-evidence'],
  },
  {
    label: 'Project ECHO hardware QA template',
    args: ['run', 'validate:hardware-template'],
  },
  {
    label: 'Project ECHO hardware QA validator tests',
    args: ['run', 'test:hardware-qa'],
  },
  {
    label: 'Project ECHO key-rotation template',
    args: ['run', 'validate:key-rotation-template'],
  },
  {
    label: 'Project ECHO key-rotation evidence validator tests',
    args: ['run', 'test:key-rotation-evidence'],
  },
  {
    label: 'Project ECHO evidence draft prep tests',
    args: ['run', 'test:echo-evidence-drafts'],
  },
  {
    label: 'Project ECHO field-run prep runner tests',
    args: ['run', 'test:echo-field-run'],
  },
  {
    label: 'Project ECHO evidence status tests',
    args: ['run', 'test:echo-evidence-status'],
  },
  {
    label: 'Project ECHO release readiness tests',
    args: ['run', 'test:echo-readiness'],
  },
  {
    label: 'Project ECHO readiness handoff contract',
    args: ['run', 'validate:readiness-handoff'],
  },
  {
    label: 'Project ECHO readiness handoff validator tests',
    args: ['run', 'test:readiness-handoff'],
  },
  {
    label: 'Project ECHO issue closure ledger contract',
    args: ['run', 'validate:issue-closure-ledger'],
  },
  {
    label: 'Project ECHO issue closure ledger tests',
    args: ['run', 'test:issue-closure-ledger'],
  },
  {
    label: 'Project ECHO portfolio link promotion tests',
    args: ['run', 'test:echo-portfolio-links'],
  },
  {
    label: 'ECHO API proxy verify',
    args: ['--prefix', 'echo-api-proxy', 'run', 'verify'],
  },
  {
    label: 'ECHO app verify',
    args: ['--prefix', 'even-app', 'run', 'verify'],
  },
  {
    label: 'Project ECHO evidence drafts current',
    args: ['run', 'validate:echo-evidence-drafts:committed'],
  },
];

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

function runStep(step) {
  return new Promise((resolve, reject) => {
    console.info(`\n[verify:all] ${step.label}`);
    const invocation = npmInvocation(step.args);
    const child = spawn(invocation.command, invocation.args, {
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${step.label} failed with exit code ${code}`));
    });
  });
}

for (const step of steps) {
  await runStep(step);
}

console.info('\n[verify:all] all local gates passed');
