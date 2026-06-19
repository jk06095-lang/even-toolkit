#!/usr/bin/env node
import { spawn } from 'node:child_process';

const steps = [
  {
    label: 'release dependency pins',
    args: ['run', 'validate:release-deps'],
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
    label: 'Project ECHO ChatGPT Action evidence template',
    args: ['run', 'validate:chatgpt-action-template'],
  },
  {
    label: 'Project ECHO pilot evidence template',
    args: ['run', 'validate:pilot-template'],
  },
  {
    label: 'Project ECHO hardware QA template',
    args: ['run', 'validate:hardware-template'],
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
