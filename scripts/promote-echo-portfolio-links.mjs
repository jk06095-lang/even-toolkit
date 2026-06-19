#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const wantsHelp = args.includes('--help') || args.includes('-h');
const repoRoot = process.cwd();
const pilotManifestPath = path.resolve(
  repoRoot,
  readOption('--pilot-manifest') || 'docs/project-echo-pilot-evidence.completed.json',
);
const readmePath = path.resolve(repoRoot, readOption('--readme') || 'README.md');
const dryRun = args.includes('--dry-run');
const PORTFOLIO_MARKERS = [
  'project-echo-case-study-ko',
  'project-echo-case-study-en',
  'project-echo-real-g2-video',
];

if (wantsHelp) {
  console.info(`Usage: npm run promote:echo-portfolio-links -- [--pilot-manifest docs/project-echo-pilot-evidence.completed.json] [--readme README.md] [--dry-run]

Promotes final Project ECHO portfolio links only after completed pilot evidence
exists. The command reads the completed pilot manifest, sets
caseStudy.readmeLinksUpdated=true in a validated copy, and updates README link
lines so they match the manifest's Korean case-study, English case-study, and
real G2 video targets.`);
  process.exit(0);
}

const manifest = readJson(pilotManifestPath);
const promotedManifest = {
  ...manifest,
  caseStudy: {
    ...(manifest.caseStudy ?? {}),
    readmeLinksUpdated: true,
  },
};
const targets = readPortfolioTargets(promotedManifest);
const readmeText = readFileSync(readmePath, 'utf8');
const promotedReadme = upsertPortfolioLinks(readmeText, targets);

await validatePilotManifestDraft(promotedManifest);
assertReadmeTargets(promotedReadme, targets);

if (dryRun) {
  console.info('[echo-portfolio] dry run passed; no files written');
  printTargets(targets);
  process.exit(0);
}

writeFileSync(pilotManifestPath, `${JSON.stringify(promotedManifest, null, 2)}\n`, 'utf8');
writeFileSync(readmePath, promotedReadme, 'utf8');

const finalValidation = await runNode([
  'scripts/validate-pilot-evidence.mjs',
  repoRelative(pilotManifestPath),
]);
if (finalValidation.code !== 0) {
  console.error(finalValidation.stdout);
  console.error(finalValidation.stderr);
  process.exit(finalValidation.code);
}

console.info('[echo-portfolio] README portfolio links promoted');
printTargets(targets);

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return '';
  return args[index + 1] || '';
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readPortfolioTargets(value) {
  const caseStudy = value?.caseStudy;
  if (!caseStudy || typeof caseStudy !== 'object' || Array.isArray(caseStudy)) {
    throw new Error('pilot manifest must contain caseStudy evidence targets');
  }

  const targets = {
    ko: String(caseStudy.koreanCaseStudyUrl ?? ''),
    en: String(caseStudy.englishCaseStudyUrl ?? ''),
    video: String(caseStudy.realG2VideoUrl ?? ''),
  };

  for (const [key, target] of Object.entries(targets)) {
    if (!target || /^TBD$/i.test(target) || /^https?:\/\/example\.com/i.test(target)) {
      throw new Error(`caseStudy ${key} target must be final evidence, not a placeholder`);
    }
  }

  return targets;
}

async function validatePilotManifestDraft(value) {
  const tempDir = path.resolve(repoRoot, '.tmp', `echo-portfolio-promote-${process.pid}`);
  const tempManifestPath = path.join(tempDir, 'project-echo-pilot-evidence.completed.json');
  mkdirSync(tempDir, { recursive: true });
  try {
    writeFileSync(tempManifestPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    const result = await runNode(['scripts/validate-pilot-evidence.mjs', repoRelative(tempManifestPath)]);
    if (result.code !== 0) {
      console.error(result.stdout);
      console.error(result.stderr);
      process.exit(result.code);
    }
  } finally {
    const resolvedTempDir = path.resolve(tempDir);
    const resolvedRepoRoot = path.resolve(repoRoot);
    if (
      resolvedTempDir !== resolvedRepoRoot
      && resolvedTempDir.startsWith(`${resolvedRepoRoot}${path.sep}`)
    ) {
      rmSync(resolvedTempDir, { recursive: true, force: true });
    }
  }
}

function upsertPortfolioLinks(readmeText, targets) {
  const block = portfolioBlock(targets);
  const lines = readmeText.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === '<!-- project-echo-portfolio-links:start -->');
  const endIndex = lines.findIndex((line) => line.trim() === '<!-- project-echo-portfolio-links:end -->');

  if (startIndex !== -1 && endIndex > startIndex) {
    lines.splice(startIndex, endIndex - startIndex + 1, ...block.split('\n'));
    return normalizeTrailingNewline(lines.join('\n'));
  }

  const firstMarkerIndex = lines.findIndex((line) => PORTFOLIO_MARKERS.some((marker) => line.includes(marker)));
  const beforeFieldRunIndex = lines.findIndex((line) => line.startsWith('Before a field run'));
  const insertionIndex = firstMarkerIndex !== -1
    ? firstMarkerIndex
    : beforeFieldRunIndex !== -1
      ? beforeFieldRunIndex
      : lines.length;

  const needsLeadingBlank = insertionIndex > 0 && lines[insertionIndex - 1] !== '';
  const needsTrailingBlank = lines[insertionIndex] !== '';
  const insertLines = [
    ...(needsLeadingBlank ? [''] : []),
    ...block.split('\n'),
    ...(needsTrailingBlank ? [''] : []),
  ];
  lines.splice(insertionIndex, 0, ...insertLines);
  return normalizeTrailingNewline(lines.join('\n'));
}

function portfolioBlock(targets) {
  return [
    '<!-- project-echo-portfolio-links:start -->',
    'Final Project ECHO portfolio evidence links:',
    `- [Project ECHO case study (KO)](${targets.ko}) <!-- project-echo-case-study-ko -->`,
    `- [Project ECHO case study (EN)](${targets.en}) <!-- project-echo-case-study-en -->`,
    `- [Project ECHO real G2 video](${targets.video}) <!-- project-echo-real-g2-video -->`,
    '<!-- project-echo-portfolio-links:end -->',
  ].join('\n');
}

function assertReadmeTargets(readmeText, targets) {
  const expectations = [
    { marker: 'project-echo-case-study-ko', target: targets.ko },
    { marker: 'project-echo-case-study-en', target: targets.en },
    { marker: 'project-echo-real-g2-video', target: targets.video },
  ];
  const lines = readmeText.split(/\r?\n/);

  for (const expectation of expectations) {
    const line = lines.find((candidate) => candidate.includes(expectation.marker));
    if (!line) {
      throw new Error(`README is missing ${expectation.marker}`);
    }

    const target = extractMarkdownLinkTarget(line);
    if (target !== expectation.target) {
      throw new Error(`README ${expectation.marker} target must be ${expectation.target}`);
    }
  }
}

function extractMarkdownLinkTarget(line) {
  const match = line.match(/\[[^\]]+\]\(([^)\s]+)\)/);
  return match?.[1] ?? '';
}

function runNode(nodeArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, nodeArgs, {
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
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function printTargets(targets) {
  console.info(`- project-echo-case-study-ko -> ${targets.ko}`);
  console.info(`- project-echo-case-study-en -> ${targets.en}`);
  console.info(`- project-echo-real-g2-video -> ${targets.video}`);
}

function normalizeTrailingNewline(value) {
  return `${value.replace(/\n*$/, '')}\n`;
}

function repoRelative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}
