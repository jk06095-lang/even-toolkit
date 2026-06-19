#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_PINS = {
  '@evenrealities/even_hub_sdk': '0.0.10',
  '@evenrealities/evenhub-cli': '0.1.13',
  '@evenrealities/evenhub-simulator': '0.7.3',
};

const MANIFESTS = [
  {
    name: 'root package.json',
    packageJson: 'package.json',
    packageLock: 'package-lock.json',
  },
  {
    name: 'ECHO app package.json',
    packageJson: 'even-app/package.json',
    packageLock: 'even-app/package-lock.json',
  },
];

const errors = [];

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), relativePath), 'utf8'));
}

function collectDirectDependencies(packageJson) {
  return {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };
}

function validateManifest(manifest) {
  const packageJson = readJson(manifest.packageJson);
  const packageLock = readJson(manifest.packageLock);
  const directDependencies = collectDirectDependencies(packageJson);
  const lockRoot = packageLock.packages?.[''] ?? {};
  const lockDirectDependencies = {
    ...(lockRoot.dependencies ?? {}),
    ...(lockRoot.devDependencies ?? {}),
  };

  for (const [dependency, expectedVersion] of Object.entries(REQUIRED_PINS)) {
    validatePinnedValue(
      directDependencies[dependency],
      expectedVersion,
      `${manifest.name} ${dependency}`,
    );

    validatePinnedValue(
      lockDirectDependencies[dependency],
      expectedVersion,
      `${manifest.packageLock} root ${dependency}`,
    );
  }
}

function validatePinnedValue(actual, expected, label) {
  if (actual === undefined) {
    errors.push(`${label}: missing direct dependency pin ${expected}`);
    return;
  }

  if (actual !== expected) {
    errors.push(`${label}: expected exact ${expected}, got ${JSON.stringify(actual)}`);
  }
}

for (const manifest of MANIFESTS) {
  validateManifest(manifest);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`[release-deps] ${error}`);
  }
  console.error(`[release-deps] ${errors.length} dependency pin error(s) found`);
  process.exit(1);
}

console.info('[release-deps] Even SDK/tooling direct dependencies are exactly pinned');
