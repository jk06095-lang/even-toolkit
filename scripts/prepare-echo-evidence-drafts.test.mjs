import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

const repoRoot = process.cwd();
const resolvedRepoRoot = path.resolve(repoRoot);
const tmpRoot = path.join(repoRoot, '.tmp', `echo-evidence-drafts-${process.pid}`);

before(() => {
  mkdirSync(tmpRoot, { recursive: true });
});

after(() => {
  const resolvedTmpRoot = path.resolve(tmpRoot);
  if (resolvedTmpRoot.startsWith(`${resolvedRepoRoot}${path.sep}`) && existsSync(resolvedTmpRoot)) {
    rmSync(resolvedTmpRoot, { recursive: true, force: true });
  }
});

test('prepares draft evidence manifests without marking external evidence complete', async () => {
  const result = await runNode([
    'scripts/prepare-echo-evidence-drafts.mjs',
    '--out-dir',
    repoRelative(tmpRoot),
  ]);
  assert.equal(result.code, 0, result.stderr);

  const hardwarePath = path.join(tmpRoot, 'project-echo-hardware-qa.draft.json');
  const pilotPath = path.join(tmpRoot, 'project-echo-pilot-evidence.draft.json');
  const actionPath = path.join(tmpRoot, 'project-echo-chatgpt-action-evidence.draft.json');
  const buildReportPath = path.join(tmpRoot, 'project-echo-build-artifact.md');

  for (const filePath of [hardwarePath, pilotPath, actionPath, buildReportPath]) {
    assert.equal(existsSync(filePath), true, `${filePath} should exist`);
  }

  const appVersion = JSON.parse(readFileSync(path.join(repoRoot, 'even-app/package.json'), 'utf8')).version;
  const hardware = JSON.parse(readFileSync(hardwarePath, 'utf8'));
  const pilot = JSON.parse(readFileSync(pilotPath, 'utf8'));
  const action = JSON.parse(readFileSync(actionPath, 'utf8'));

  assert.equal(hardware.evidenceStatus, 'draft');
  assert.equal(pilot.evidenceStatus, 'draft');
  assert.equal(action.evidenceStatus, 'draft');
  assert.notEqual(hardware.evidenceStatus, 'complete');
  assert.equal(hardware.device.appVersion, appVersion);
  assert.equal(pilot.hardware.appVersion, appVersion);
  assert.equal(hardware.buildArtifact.packagePath, 'even-app/echo.ehpk');
  assert.match(hardware.buildArtifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal(hardware.buildArtifact.installedViaBetaOrPrivateBuild, null);
  assert.equal(action.actionContractVersion, JSON.parse(readFileSync(path.join(repoRoot, 'integrations/chatgpt-action/openapi.json'), 'utf8')).info.version);

  await assertValidatorPasses('scripts/validate-hardware-qa.mjs', hardwarePath);
  await assertValidatorPasses('scripts/validate-pilot-evidence.mjs', pilotPath);
  await assertValidatorPasses('scripts/validate-chatgpt-action-evidence.mjs', actionPath);
});

async function assertValidatorPasses(scriptPath, targetPath) {
  const result = await runNode([scriptPath, repoRelative(targetPath), '--allow-draft']);
  assert.equal(result.code, 0, result.stderr);
}

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
