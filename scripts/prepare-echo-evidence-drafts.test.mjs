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
  const keyRotationPath = path.join(tmpRoot, 'key-rotation-evidence.draft.md');
  const caseStudyKoPath = path.join(tmpRoot, 'project-echo-case-study.ko.draft.md');
  const caseStudyEnPath = path.join(tmpRoot, 'project-echo-case-study.en.draft.md');
  const architecturePath = path.join(tmpRoot, 'project-echo-architecture.draft.md');
  const videoShotListPath = path.join(tmpRoot, 'project-echo-real-g2-video-shot-list.draft.md');
  const fieldRunbookPath = path.join(tmpRoot, 'project-echo-field-runbook.draft.md');
  const buildReportPath = path.join(tmpRoot, 'project-echo-build-artifact.md');

  for (const filePath of [
    hardwarePath,
    pilotPath,
    actionPath,
    keyRotationPath,
    caseStudyKoPath,
    caseStudyEnPath,
    architecturePath,
    videoShotListPath,
    fieldRunbookPath,
    buildReportPath,
  ]) {
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

  const keyRotation = readFileSync(keyRotationPath, 'utf8');
  assert.match(keyRotation, new RegExp(`Client build or package version: echo-app ${escapeRegExp(appVersion)}`));
  assert.match(keyRotation, /Provider: Gemini/);
  assert.match(keyRotation, /Browser artifact key scan result: \d+ matches across \d+ file\(s\): even-app\/dist, even-app\/echo\.ehpk/);
  assert.match(keyRotation, /Session token client artifact scan result: \d+ matches across \d+ file\(s\): even-app\/dist, even-app\/echo\.ehpk/);
  assert.match(keyRotation, /Follow-up issue or ticket: #1\/#27/);
  assert.doesNotMatch(keyRotation, /Date: \d{4}-\d{2}-\d{2}/);

  const caseStudyKo = readFileSync(caseStudyKoPath, 'utf8');
  const caseStudyEn = readFileSync(caseStudyEnPath, 'utf8');
  const architecture = readFileSync(architecturePath, 'utf8');
  const videoShotList = readFileSync(videoShotListPath, 'utf8');
  const fieldRunbook = readFileSync(fieldRunbookPath, 'utf8');

  assert.match(caseStudyKo, /Draft only/);
  assert.match(caseStudyKo, /project-echo-case-study-ko/);
  assert.match(caseStudyKo, new RegExp(`App version: ${escapeRegExp(appVersion)}`));
  assert.match(caseStudyEn, /Draft only/);
  assert.match(caseStudyEn, /project-echo-case-study-en/);
  assert.match(caseStudyEn, new RegExp(`App version: ${escapeRegExp(appVersion)}`));
  assert.match(architecture, /flowchart LR/);
  assert.match(architecture, /ECHO API proxy/);
  assert.match(videoShotList, /project-echo-real-g2-video/);
  assert.match(videoShotList, /G2 shows READY/);
  assert.match(fieldRunbook, /Project ECHO Field Runbook Draft/);
  assert.match(fieldRunbook, /npm run readiness:echo/);
  assert.match(fieldRunbook, /Beta Testing is the reviewer-parity path/);
  assert.match(fieldRunbook, /ECHO_PROXY_SMOKE_SESSION_TOKEN/);
  assert.match(fieldRunbook, /ECHO_PROXY_SMOKE_EVIDENCE_OUT=docs\/proxy-smoke-evidence\.json/);
  assert.match(fieldRunbook, /\.\.\/docs\/proxy-smoke-evidence\.json/);
  assert.match(fieldRunbook, /#2\/#3\/#4\/#6\/#12\/#13\/#14\/#28/);
  assert.match(fieldRunbook, /docs\/project-echo-chatgpt-action-evidence\.completed\.json/);
  assert.match(fieldRunbook, /Do not rename draft files to completed files without real external evidence/);
  assert.doesNotMatch(caseStudyKo, /\]\(docs\/project-echo-case-study\.ko\.md\)/);
  assert.doesNotMatch(caseStudyEn, /\]\(docs\/project-echo-case-study\.en\.md\)/);

  await assertValidatorPasses('scripts/validate-hardware-qa.mjs', hardwarePath);
  await assertValidatorPasses('scripts/validate-pilot-evidence.mjs', pilotPath);
  await assertValidatorPasses('scripts/validate-chatgpt-action-evidence.mjs', actionPath);
  await assertValidatorPasses('scripts/validate-key-rotation-evidence.mjs', keyRotationPath);
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
