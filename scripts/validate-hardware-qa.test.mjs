import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

const repoRoot = process.cwd();
const resolvedRepoRoot = path.resolve(repoRoot);
const tmpRoot = path.join(repoRoot, '.tmp', `hardware-qa-validator-${process.pid}`);
const templatePath = path.join(repoRoot, 'docs/project-echo-hardware-qa.template.json');

before(() => {
  mkdirSync(tmpRoot, { recursive: true });
});

after(() => {
  const resolvedTmpRoot = path.resolve(tmpRoot);
  if (resolvedTmpRoot.startsWith(`${resolvedRepoRoot}${path.sep}`) && existsSync(resolvedTmpRoot)) {
    rmSync(resolvedTmpRoot, { recursive: true, force: true });
  }
});

test('requires ACK as a first-class G2 HUD evidence state', async () => {
  const template = JSON.parse(readFileSync(templatePath, 'utf8'));
  assert.deepEqual(Object.keys(template.hud.states), ['READY', 'LISTENING', 'CUE', 'ACK', 'PAUSED']);

  const templateResult = await runNode([
    'scripts/validate-hardware-qa.mjs',
    'docs/project-echo-hardware-qa.template.json',
    '--allow-draft',
  ]);
  assert.equal(templateResult.code, 0, templateResult.stderr);

  const missingAck = structuredClone(template);
  delete missingAck.hud.states.ACK;
  const missingAckPath = path.join(tmpRoot, 'hardware-missing-ack.json');
  writeFileSync(missingAckPath, `${JSON.stringify(missingAck, null, 2)}\n`, 'utf8');

  const missingAckResult = await runNode([
    'scripts/validate-hardware-qa.mjs',
    repoRelative(missingAckPath),
    '--allow-draft',
  ]);
  assert.notEqual(missingAckResult.code, 0);
  assert.match(combinedOutput(missingAckResult), /hud\.states\.ACK: expected an object/);

  const extraState = structuredClone(template);
  extraState.hud.states.TRANSCRIPT = {
    rendered: null,
    noOverlap: null,
    evidenceRef: 'TBD',
  };
  const extraStatePath = path.join(tmpRoot, 'hardware-extra-state.json');
  writeFileSync(extraStatePath, `${JSON.stringify(extraState, null, 2)}\n`, 'utf8');

  const extraStateResult = await runNode([
    'scripts/validate-hardware-qa.mjs',
    repoRelative(extraStatePath),
    '--allow-draft',
  ]);
  assert.notEqual(extraStateResult.code, 0);
  assert.match(combinedOutput(extraStateResult), /hud\.states\.TRANSCRIPT: unexpected key; allowed keys: READY, LISTENING, CUE, ACK, PAUSED/);
});

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function repoRelative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function combinedOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}
