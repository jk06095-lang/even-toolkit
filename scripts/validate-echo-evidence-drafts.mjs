#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const repoRoot = process.cwd();

const outDir = path.resolve(repoRoot, readArg('--out-dir') ?? 'docs/evidence-drafts');
const packagePath = normalizePath(readArg('--package') ?? 'even-app/echo.ehpk');
const packageSource = readArg('--package-source') ?? 'workspace';
const packageAbs = path.resolve(repoRoot, packagePath);
const buildArtifactPath = path.join(outDir, 'project-echo-build-artifact.md');
const hardwareQaPath = path.join(outDir, 'project-echo-hardware-qa.draft.json');
const pilotEvidencePath = path.join(outDir, 'project-echo-pilot-evidence.draft.json');
const actionEvidencePath = path.join(outDir, 'project-echo-chatgpt-action-evidence.draft.json');
const fieldRunbookPath = path.join(outDir, 'project-echo-field-runbook.draft.md');

const errors = [];

if (packageSource !== 'workspace' && packageSource !== 'committed') {
  errors.push(`--package-source must be "workspace" or "committed", got ${packageSource}`);
}

let packageBuffer = null;
if (packageSource === 'committed') {
  packageBuffer = readCommittedFile(packagePath);
} else if (existsSync(packageAbs)) {
  packageBuffer = readFileSync(packageAbs);
} else {
  errors.push(`${packagePath}: package file is missing`);
}
if (!existsSync(buildArtifactPath)) {
  errors.push(`${repoRelative(buildArtifactPath)}: build artifact draft is missing`);
}
if (!existsSync(hardwareQaPath)) {
  errors.push(`${repoRelative(hardwareQaPath)}: hardware QA draft is missing`);
}
if (!existsSync(pilotEvidencePath)) {
  errors.push(`${repoRelative(pilotEvidencePath)}: pilot evidence draft is missing`);
}
if (!existsSync(actionEvidencePath)) {
  errors.push(`${repoRelative(actionEvidencePath)}: ChatGPT Action evidence draft is missing`);
}
if (!existsSync(fieldRunbookPath)) {
  errors.push(`${repoRelative(fieldRunbookPath)}: field runbook draft is missing`);
}

const appVersion = readJson('even-app/package.json')?.version;
if (!appVersion) {
  errors.push('even-app/package.json: missing app version');
}

const expectedSha = packageBuffer ? sha256Buffer(packageBuffer) : null;
const expectedBytes = packageSource === 'workspace' && existsSync(packageAbs)
  ? statSync(packageAbs).size
  : packageBuffer?.length ?? null;

if (expectedSha && existsSync(buildArtifactPath)) {
  const buildArtifact = readFileSync(buildArtifactPath, 'utf8');
  const reportedPath = matchLine(buildArtifact, /- Package path: (.+)/);
  const reportedSha = matchLine(buildArtifact, /- Package SHA-256: ([a-f0-9]{64})/i)?.toLowerCase();
  const reportedBytes = matchLine(buildArtifact, /- Package bytes: (\d+)/);
  assertEqual(reportedPath, packagePath, `${repoRelative(buildArtifactPath)} package path`);
  assertEqual(reportedSha, expectedSha, `${repoRelative(buildArtifactPath)} package SHA-256`);
  assertEqual(Number(reportedBytes), expectedBytes, `${repoRelative(buildArtifactPath)} package bytes`);
}

if (expectedSha && existsSync(hardwareQaPath)) {
  const hardware = readJson(hardwareQaPath);
  assertEqual(hardware?.device?.appVersion, appVersion, `${repoRelative(hardwareQaPath)} device.appVersion`);
  assertBuildArtifactMatches(hardware, hardwareQaPath);
}

if (expectedSha && existsSync(pilotEvidencePath)) {
  const pilot = readJson(pilotEvidencePath);
  assertEqual(pilot?.hardware?.appVersion, appVersion, `${repoRelative(pilotEvidencePath)} hardware.appVersion`);
  assertBuildArtifactMatches(pilot, pilotEvidencePath);
}

if (expectedSha && existsSync(actionEvidencePath)) {
  const action = readJson(actionEvidencePath);
  assertBuildArtifactMatches(action, actionEvidencePath);
}

if (expectedSha && existsSync(fieldRunbookPath)) {
  const runbook = readFileSync(fieldRunbookPath, 'utf8');
  assertContains(runbook, `- App version: ${appVersion}`, `${repoRelative(fieldRunbookPath)} app version`);
  assertContains(runbook, `- Package path: ${packagePath}`, `${repoRelative(fieldRunbookPath)} package path`);
  assertContains(runbook, `- Package SHA-256: ${expectedSha}`, `${repoRelative(fieldRunbookPath)} package SHA-256`);
  assertContains(
    runbook,
    `- Package evidence draft: ${normalizePath(repoRelative(buildArtifactPath))}`,
    `${repoRelative(fieldRunbookPath)} package evidence ref`,
  );
}

if (errors.length > 0) {
  console.error('[echo-evidence-drafts] evidence drafts are stale or incomplete:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.info(`[echo-evidence-drafts] drafts match ${packageSource} ${packagePath} (${expectedSha})`);
}

function readArg(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function readJson(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
  if (!existsSync(resolved)) return null;
  return JSON.parse(readFileSync(resolved, 'utf8'));
}

function matchLine(value, pattern) {
  return value.match(pattern)?.[1]?.trim();
}

function assertContains(value, expected, label) {
  if (!value.includes(expected)) {
    errors.push(`${label}: missing "${expected}"`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    errors.push(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertBuildArtifactMatches(manifest, manifestPath) {
  assertEqual(manifest?.buildArtifact?.packagePath, packagePath, `${repoRelative(manifestPath)} buildArtifact.packagePath`);
  assertEqual(manifest?.buildArtifact?.sha256, expectedSha, `${repoRelative(manifestPath)} buildArtifact.sha256`);
  assertEqual(
    manifest?.buildArtifact?.evidenceRef,
    normalizePath(repoRelative(buildArtifactPath)),
    `${repoRelative(manifestPath)} buildArtifact.evidenceRef`,
  );
}

function readCommittedFile(filePath) {
  try {
    return execFileSync('git', ['show', `HEAD:${filePath}`], {
      cwd: repoRoot,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    errors.push(`${filePath}: could not read committed package from HEAD`);
    return null;
  }
}

function sha256Buffer(buffer) {
  return createHash('sha256')
    .update(buffer)
    .digest('hex');
}

function repoRelative(filePath) {
  return normalizePath(path.relative(repoRoot, filePath));
}

function normalizePath(value) {
  return value.replace(/\\/g, '/');
}
