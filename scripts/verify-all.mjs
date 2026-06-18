#!/usr/bin/env node
import { spawn } from 'node:child_process';

const steps = [
  {
    label: 'root TypeScript build',
    args: ['run', 'build'],
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
