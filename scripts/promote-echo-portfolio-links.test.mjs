import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

const repoRoot = process.cwd();
const resolvedRepoRoot = path.resolve(repoRoot);
const tmpRoot = path.join(repoRoot, '.tmp', `echo-portfolio-promote-${process.pid}`);
const appVersion = JSON.parse(readFileSync(path.join(repoRoot, 'even-app/package.json'), 'utf8')).version;

before(() => {
  mkdirSync(tmpRoot, { recursive: true });
});

after(() => {
  const resolvedTmpRoot = path.resolve(tmpRoot);
  if (resolvedTmpRoot.startsWith(`${resolvedRepoRoot}${path.sep}`) && existsSync(resolvedTmpRoot)) {
    rmSync(resolvedTmpRoot, { recursive: true, force: true });
  }
});

test('promotes README portfolio links only from a completed pilot manifest', async () => {
  const evidence = createEvidenceFiles();
  const manifestPath = path.join(tmpRoot, 'project-echo-pilot-evidence.completed.json');
  const readmePath = path.join(tmpRoot, 'README.md');

  writeFileSync(manifestPath, `${JSON.stringify(validPilotManifest(evidence), null, 2)}\n`, 'utf8');
  writeFileSync(readmePath, readmeFixture(), 'utf8');

  const result = await runNode([
    'scripts/promote-echo-portfolio-links.mjs',
    '--pilot-manifest',
    repoRelative(manifestPath),
    '--readme',
    repoRelative(readmePath),
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /README portfolio links promoted/);

  const promotedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(promotedManifest.caseStudy.readmeLinksUpdated, true);

  const promotedReadme = readFileSync(readmePath, 'utf8');
  assert.match(promotedReadme, /\[Project ECHO case study \(KO\)\]\(.tmp\/echo-portfolio-promote-/);
  assert.match(promotedReadme, /\[Project ECHO case study \(EN\)\]\(.tmp\/echo-portfolio-promote-/);
  assert.match(promotedReadme, /\[Project ECHO real G2 video\]\(.tmp\/echo-portfolio-promote-/);

  assertReadmeTarget(promotedReadme, 'project-echo-case-study-ko', evidence.ko);
  assertReadmeTarget(promotedReadme, 'project-echo-case-study-en', evidence.en);
  assertReadmeTarget(promotedReadme, 'project-echo-real-g2-video', evidence.video);

  const firstKoMarker = promotedReadme.indexOf('project-echo-case-study-ko');
  const proseKoMarker = promotedReadme.indexOf('`project-echo-case-study-ko`');
  assert.ok(firstKoMarker !== -1);
  assert.ok(proseKoMarker !== -1);
  assert.ok(firstKoMarker < proseKoMarker, 'generated link marker should appear before marker prose');

  const rerun = await runNode([
    'scripts/promote-echo-portfolio-links.mjs',
    '--pilot-manifest',
    repoRelative(manifestPath),
    '--readme',
    repoRelative(readmePath),
  ]);

  assert.equal(rerun.code, 0, rerun.stderr);
  const rerunReadme = readFileSync(readmePath, 'utf8');
  assert.equal(matchCount(rerunReadme, '<!-- project-echo-portfolio-links:start -->'), 1);
  assert.equal(matchCount(rerunReadme, '<!-- project-echo-portfolio-links:end -->'), 1);

  const validation = await runNode(['scripts/validate-pilot-evidence.mjs', repoRelative(manifestPath)]);
  assert.equal(validation.code, 0, validation.stderr);
});

function readmeFixture() {
  return `# even-toolkit

## Project ECHO Evidence

Final portfolio links must be markdown links carrying the markers
\`project-echo-case-study-ko\`,
\`project-echo-case-study-en\`, and \`project-echo-real-g2-video\`.

Before a field run, generate draft evidence manifests.
`;
}

function createEvidenceFiles() {
  const evidenceDir = path.join(tmpRoot, 'evidence');
  const exportsDir = path.join(evidenceDir, 'exports');
  const notesDir = path.join(evidenceDir, 'notes');
  const videosDir = path.join(evidenceDir, 'videos');
  mkdirSync(exportsDir, { recursive: true });
  mkdirSync(notesDir, { recursive: true });
  mkdirSync(videosDir, { recursive: true });

  const ko = writeEvidenceFile(path.join(evidenceDir, 'project-echo-case-study.ko.md'), '# KO case study\n');
  const en = writeEvidenceFile(path.join(evidenceDir, 'project-echo-case-study.en.md'), '# EN case study\n');
  const architecture = writeEvidenceFile(path.join(evidenceDir, 'project-echo-architecture.md'), '# Architecture\n');
  const outcomeSummary = writeEvidenceFile(path.join(evidenceDir, 'project-echo-outcome-summary.md'), '# Outcome summary\n');
  const video = writeEvidenceFile(path.join(videosDir, 'project-echo-real-g2-video.mp4'), 'video placeholder\n');

  return {
    ko,
    en,
    architecture,
    outcomeSummary,
    video,
    qaExport(condition, participantId) {
      return writeEvidenceFile(
        path.join(exportsDir, `qa-export-${participantId}-${condition}.json`),
        '{"eventAnalytics":{}}\n',
      );
    },
    observerNotes(condition, participantId) {
      return writeEvidenceFile(
        path.join(notesDir, `observer-notes-${participantId}-${condition}.md`),
        `${participantId} ${condition} observer notes\n`,
      );
    },
    runVideo(condition, participantId) {
      return writeEvidenceFile(
        path.join(videosDir, `${participantId}-${condition}.mp4`),
        `${participantId} ${condition} video placeholder\n`,
      );
    },
    vadQaExport(environmentName) {
      return writeEvidenceFile(
        path.join(exportsDir, `qa-${environmentName}.json`),
        `{"environment":"${environmentName}"}\n`,
      );
    },
  };
}

function writeEvidenceFile(filePath, contents) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf8');
  return repoRelative(filePath);
}

function validPilotManifest(evidence) {
  const participants = ['P01', 'P02', 'P03', 'P04', 'P05'].map((participantId, index) => ({
    id: participantId,
    consentRecorded: true,
    scenario: `Controlled retail conversation ${index + 1}`,
    order: conditionOrders[index],
    runs: ['A', 'B', 'C'].map((condition) => runEvidence(condition, participantId, evidence)),
  }));

  return {
    project: 'Project ECHO',
    pilotDate: '2026-06-19',
    evidenceStatus: 'complete',
    hardware: {
      device: 'Even Realities G2',
      firmwareVersion: 'firmware-test-build',
      appVersion,
      bridgeVersion: 'bridge-test-build',
    },
    participants,
    vadCalibration: {
      environments: [
        vadEnvironment('quiet_room', 0.015, 0.005, 0.03, evidence),
        vadEnvironment('cafe_background', 0.02, 0.008, 0.04, evidence),
        vadEnvironment('air_conditioner', 0.022, 0.009, 0.043, evidence),
        vadEnvironment('outdoor_wind', 0.026, 0.011, 0.05, evidence),
      ],
    },
    aggregate: {
      conditions: {
        A: aggregateCondition('A'),
        B: aggregateCondition('B'),
        C: aggregateCondition('C'),
      },
    },
    outcomeMetrics: {
      conversationRecoveryRate: 0.74,
      conversationRecoveryWindowSeconds: 8,
      independentTransferRateDay1: 0.46,
      independentTransferRateDay7: 0.34,
      transferScenarioCount: 10,
      evidenceRef: evidence.outcomeSummary,
      notes: 'Portfolio promotion fixture includes core outcome KPI proof.',
    },
    caseStudy: {
      koreanCaseStudyUrl: evidence.ko,
      englishCaseStudyUrl: evidence.en,
      architectureDiagramUrl: evidence.architecture,
      realG2VideoUrl: evidence.video,
      readmeLinksUpdated: false,
    },
  };
}

const conditionOrders = [
  ['A', 'B', 'C'],
  ['B', 'C', 'A'],
  ['C', 'A', 'B'],
  ['A', 'C', 'B'],
  ['B', 'A', 'C'],
];

function runEvidence(condition, participantId, evidence) {
  return {
    condition,
    mode: modeForCondition(condition),
    systemMetrics: systemMetrics(condition),
    uxMetrics: uxMetrics(condition),
    artifacts: {
      qaExportPath: evidence.qaExport(condition, participantId),
      observerNotesPath: evidence.observerNotes(condition, participantId),
      videoEvidence: evidence.runVideo(condition, participantId),
    },
  };
}

function aggregateCondition(condition) {
  return {
    sampleSize: 5,
    systemMetrics: systemMetrics(condition),
    uxMetrics: uxMetrics(condition),
    decision: `${modeForCondition(condition)} measured in pilot fixture`,
  };
}

function systemMetrics(condition) {
  return {
    g2MicSuccessRate: 1,
    phoneFallbackRate: 0,
    falseSilenceDetectionRatePerMinute: condition === 'A' ? 0.1 : 0.2,
    missedSpeechRate: 0,
    cueP50LatencyMs: condition === 'A' ? 0 : condition === 'B' ? 620 : 340,
    cueP95LatencyMs: condition === 'A' ? 0 : condition === 'B' ? 1100 : 690,
    crashCount: 0,
    reconnectCount: 0,
    batteryConsumptionPercent: 4,
  };
}

function uxMetrics(condition) {
  return {
    timeToFirstUtteranceMs: condition === 'A' ? 2600 : condition === 'B' ? 2100 : 1700,
    cueUsageRate: condition === 'A' ? 0 : condition === 'B' ? 0.5 : 0.8,
    cueDismissalRate: condition === 'A' ? 0 : condition === 'B' ? 0.3 : 0.1,
    falseCueRate: condition === 'A' ? 0 : condition === 'B' ? 0.2 : 0.1,
    phoneChecks: condition === 'C' ? 1 : 2,
    eyeContactBreaks: condition === 'C' ? 1 : 2,
    interruptionRating: condition === 'B' ? 4 : 2,
    trustRating: condition === 'C' ? 6 : 5,
    privacyConcernRating: 2,
  };
}

function vadEnvironment(name, vadSpeechThreshold, vadNoiseFloorRms, vadSpeechFloorRms, evidence) {
  return {
    name,
    metrics: {
      vadSpeechThreshold,
      vadNoiseFloorRms,
      vadSpeechFloorRms,
      falseStarts: 0,
      missedSpeechEvents: 0,
    },
    qaExportPath: evidence.vadQaExport(name),
    notes: `${name} calibration fixture`,
  };
}

function modeForCondition(condition) {
  if (condition === 'A') return 'No assistance';
  if (condition === 'B') return 'Full sentence suggestion';
  return '3-5 word cue';
}

function assertReadmeTarget(readme, marker, target) {
  const line = readme.split(/\r?\n/).find((candidate) => candidate.includes(marker));
  assert.ok(line, `missing marker ${marker}`);
  const match = line.match(/\[[^\]]+\]\(([^)\s]+)\)/);
  assert.equal(match?.[1], target);
}

function matchCount(value, pattern) {
  return value.split(pattern).length - 1;
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
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function repoRelative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}
