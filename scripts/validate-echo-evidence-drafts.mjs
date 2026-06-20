#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const repoRoot = process.cwd();

const outDir = path.resolve(repoRoot, readArg('--out-dir') ?? 'docs/evidence-drafts');
const packagePath = normalizePath(readArg('--package') ?? 'even-app/echo.ehpk');
const packageAbs = path.resolve(repoRoot, packagePath);
const buildArtifactPath = path.join(outDir, 'project-echo-build-artifact.md');
const hardwareQaPath = path.join(outDir, 'project-echo-hardware-qa.draft.json');
const fieldRunbookPath = path.join(outDir, 'project-echo-field-runbook.draft.md');

const errors = [];

if (!existsSync(packageAbs)) {
  errors.push(`${packagePath}: package file is missing`);
}
if (!existsSync(buildArtifactPath)) {
  errors.push(`${repoRelative(buildArtifactPath)}: build artifact draft is missing`);
}
if (!existsSync(hardwareQaPath)) {
  errors.push(`${repoRelative(hardwareQaPath)}: hardware QA draft is missing`);
}
if (!existsSync(fieldRunbookPath)) {
  errors.push(`${repoRelative(fieldRunbookPath)}: field runbook draft is missing`);
}

const appVersion = readJson('even-app/package.json')?.version;
if (!appVersion) {
  errors.push('even-app/package.json: missing app version');
}

const expectedSha = existsSync(packageAbs) ? sha256File(packageAbs) : null;
const expectedBytes = existsSync(packageAbs) ? statSync(packageAbs).size : null;

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
  assertEqual(hardware?.buildArtifact?.packagePath, packagePath, `${repoRelative(hardwareQaPath)} buildArtifact.packagePath`);
  assertEqual(hardware?.buildArtifact?.sha256, expectedSha, `${repoRelative(hardwareQaPath)} buildArtifact.sha256`);
  assertEqual(
    hardware?.buildArtifact?.evidenceRef,
    normalizePath(repoRelative(buildArtifactPath)),
    `${repoRelative(hardwareQaPath)} buildArtifact.evidenceRef`,
  );
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
  console.info(`[echo-evidence-drafts] drafts match ${packagePath} (${expectedSha})`);
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

function sha256File(filePath) {
  return createHash('sha256')
    .update(readFileSync(filePath))
    .digest('hex');
}

function repoRelative(filePath) {
  return normalizePath(path.relative(repoRoot, filePath));
}

function normalizePath(value) {
  return value.replace(/\\/g, '/');
}
