#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const FIELD_RUN_PREP_STEPS = [
  {
    label: 'ECHO app verify, build, bundle check, and package',
    args: ['--prefix', 'even-app', 'run', 'verify'],
  },
  {
    label: 'Project ECHO draft evidence refresh',
    args: ['run', 'prepare:echo-evidence-drafts'],
  },
  {
    label: 'Project ECHO workspace package/draft SHA check',
    args: ['run', 'validate:echo-evidence-drafts'],
  },
  {
    label: 'Project ECHO evidence status review',
    args: ['run', 'status:echo-evidence', '--', '--validate-final'],
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
    console.info(`\n[echo-field-run] ${step.label}`);
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

export async function runFieldRunPrep(steps = FIELD_RUN_PREP_STEPS) {
  for (const step of steps) {
    await runStep(step);
  }

  console.info('\n[echo-field-run] local package and draft evidence are ready for external field capture.');
  console.info('[echo-field-run] npm run readiness:echo remains the release gate and will stay blocked until final external evidence exists.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await runFieldRunPrep();
}
