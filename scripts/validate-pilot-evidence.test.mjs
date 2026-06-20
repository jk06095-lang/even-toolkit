import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

const repoRoot = process.cwd();
const resolvedRepoRoot = path.resolve(repoRoot);
const tmpRoot = path.join(repoRoot, '.tmp', `pilot-evidence-validator-${process.pid}`);

before(() => {
  mkdirSync(tmpRoot, { recursive: true });
});

after(() => {
  const resolvedTmpRoot = path.resolve(tmpRoot);
  if (resolvedTmpRoot.startsWith(`${resolvedRepoRoot}${path.sep}`) && existsSync(resolvedTmpRoot)) {
    rmSync(resolvedTmpRoot, { recursive: true, force: true });
  }
});

test('accepts completed pilot evidence with real artifact refs', async () => {
  const fixture = writeCompletedPilotFixture('valid');
  const result = await runValidator(fixture.manifestPath);

  assert.equal(result.code, 0, combinedOutput(result));
  assert.match(result.stdout, /final evidence accepted/);
});

test('rejects pilot run artifact fields that are only status text', async () => {
  const fixture = writeCompletedPilotFixture('weak-run-artifacts');
  const manifest = readFixture(fixture.manifestPath);
  manifest.participants[0].runs[0].artifacts.qaExportPath = 'export saved';
  manifest.participants[0].runs[0].artifacts.observerNotesPath = 'notes done';
  writeFixtureManifest(fixture.manifestPath, manifest);

  const result = await runValidator(fixture.manifestPath);

  assert.notEqual(result.code, 0);
  const output = combinedOutput(result);
  assert.match(output, /participants\[0\]\.runs\[0\]\.artifacts\.qaExportPath: must be an https URL or repo path/);
  assert.match(output, /participants\[0\]\.runs\[0\]\.artifacts\.observerNotesPath: must be an https URL or repo path/);
});

test('rejects VAD calibration evidence with missing QA export files', async () => {
  const fixture = writeCompletedPilotFixture('missing-vad-export');
  const manifest = readFixture(fixture.manifestPath);
  manifest.vadCalibration.environments[1].qaExportPath = 'docs/missing-cafe-export.json';
  writeFixtureManifest(fixture.manifestPath, manifest);

  const result = await runValidator(fixture.manifestPath);

  assert.notEqual(result.code, 0);
  assert.match(
    combinedOutput(result),
    /vadCalibration\.environments\[1\]\.qaExportPath: repo path evidence must point to an existing file/,
  );
});

test('rejects VAD calibration evidence without calibrated time and QA summary', async () => {
  const fixture = writeCompletedPilotFixture('missing-vad-summary');
  const manifest = readFixture(fixture.manifestPath);
  manifest.vadCalibration.environments[0].calibratedAt = '2026-06-19 09:00';
  manifest.vadCalibration.environments[0].qaSummaryPath = 'summary captured';
  writeFixtureManifest(fixture.manifestPath, manifest);

  const result = await runValidator(fixture.manifestPath);
  const output = combinedOutput(result);

  assert.notEqual(result.code, 0);
  assert.match(output, /vadCalibration\.environments\[0\]\.calibratedAt: must be a valid ISO date-time ending in Z/);
  assert.match(output, /vadCalibration\.environments\[0\]\.qaSummaryPath: must be an https URL or repo path/);
});

test('rejects duplicate participant IDs in completed pilot evidence', async () => {
  const fixture = writeCompletedPilotFixture('duplicate-participant');
  const manifest = readFixture(fixture.manifestPath);
  manifest.participants[4].id = manifest.participants[0].id;
  writeFixtureManifest(fixture.manifestPath, manifest);

  const result = await runValidator(fixture.manifestPath);

  assert.notEqual(result.code, 0);
  assert.match(combinedOutput(result), /participants\[4\]\.id: participant id must be unique/);
});

test('rejects completed pilot evidence without core outcome KPI proof', async () => {
  const fixture = writeCompletedPilotFixture('missing-outcome-kpis');
  const manifest = readFixture(fixture.manifestPath);
  manifest.outcomeMetrics.conversationRecoveryWindowSeconds = 10;
  manifest.outcomeMetrics.independentTransferRateDay7 = null;
  manifest.outcomeMetrics.transferScenarioCount = 0.5;
  manifest.outcomeMetrics.evidenceRef = 'metrics summarized';
  writeFixtureManifest(fixture.manifestPath, manifest);

  const result = await runValidator(fixture.manifestPath);
  const output = combinedOutput(result);

  assert.notEqual(result.code, 0);
  assert.match(output, /outcomeMetrics\.conversationRecoveryWindowSeconds/);
  assert.match(output, /outcomeMetrics\.independentTransferRateDay7/);
  assert.match(output, /outcomeMetrics\.transferScenarioCount/);
  assert.match(output, /outcomeMetrics\.evidenceRef: must be an https URL or repo path/);
});

function writeCompletedPilotFixture(name) {
  const fixtureDir = path.join(tmpRoot, name);
  mkdirSync(fixtureDir, { recursive: true });

  const refs = createEvidenceRefs(fixtureDir);
  const appVersion = JSON.parse(readFileSync(path.join(repoRoot, 'even-app/package.json'), 'utf8')).version;
  const participants = Array.from({ length: 5 }, (_, index) => participantFixture(index + 1, refs));

  const manifest = {
    project: 'Project ECHO',
    pilotDate: '2026-06-19',
    evidenceStatus: 'complete',
    hardware: {
      device: 'Even Realities G2',
      firmwareVersion: 'firmware-qa',
      appVersion,
      bridgeVersion: 'bridge-qa',
    },
    participants,
    vadCalibration: {
      environments: [
        vadEnvironment('quiet_room', 0.01, 0.02, 0.04, refs.qaExport, refs.qaSummary),
        vadEnvironment('cafe_background', 0.02, 0.03, 0.06, refs.qaExport, refs.qaSummary),
        vadEnvironment('air_conditioner', 0.025, 0.035, 0.07, refs.qaExport, refs.qaSummary),
        vadEnvironment('outdoor_wind', 0.03, 0.04, 0.08, refs.qaExport, refs.qaSummary),
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
      conversationRecoveryRate: 0.72,
      conversationRecoveryWindowSeconds: 8,
      independentTransferRateDay1: 0.48,
      independentTransferRateDay7: 0.36,
      transferScenarioCount: 10,
      evidenceRef: refs.outcomeSummary,
      notes: 'Conversation recovery and independent transfer outcomes reviewed from pilot scorecard.',
    },
    caseStudy: {
      koreanCaseStudyUrl: refs.caseStudyKo,
      englishCaseStudyUrl: refs.caseStudyEn,
      architectureDiagramUrl: refs.architecture,
      realG2VideoUrl: refs.video,
      readmeLinksUpdated: true,
    },
  };

  const manifestPath = path.join(fixtureDir, 'pilot-complete.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    manifestPath: repoRelative(manifestPath),
  };
}

function createEvidenceRefs(fixtureDir) {
  const files = {
    qaExport: path.join(fixtureDir, 'qa-export.json'),
    qaSummary: path.join(fixtureDir, 'qa-summary.md'),
    observerNotes: path.join(fixtureDir, 'observer-notes.md'),
    outcomeSummary: path.join(fixtureDir, 'outcome-summary.md'),
    video: path.join(fixtureDir, 'real-g2-video.mp4'),
    caseStudyKo: path.join(fixtureDir, 'case-study.ko.md'),
    caseStudyEn: path.join(fixtureDir, 'case-study.en.md'),
    architecture: path.join(fixtureDir, 'architecture.md'),
  };

  for (const [key, filePath] of Object.entries(files)) {
    const content = key === 'qaExport' ? '{"eventAnalytics":{}}\n' : `${key} evidence\n`;
    writeFileSync(filePath, content, 'utf8');
  }

  return Object.fromEntries(
    Object.entries(files).map(([key, filePath]) => [key, repoRelative(filePath)]),
  );
}

function participantFixture(index, refs) {
  const orders = [
    ['A', 'B', 'C'],
    ['B', 'C', 'A'],
    ['C', 'A', 'B'],
    ['A', 'C', 'B'],
    ['B', 'A', 'C'],
  ];

  return {
    id: `P${String(index).padStart(2, '0')}`,
    consentRecorded: true,
    scenario: `Scenario ${index}`,
    order: orders[(index - 1) % orders.length],
    runs: ['A', 'B', 'C'].map((condition) => runFixture(condition, refs)),
  };
}

function runFixture(condition, refs) {
  return {
    condition,
    mode: modeForCondition(condition),
    systemMetrics: systemMetrics(condition),
    uxMetrics: uxMetrics(condition),
    artifacts: {
      qaExportPath: refs.qaExport,
      observerNotesPath: refs.observerNotes,
      videoEvidence: refs.video,
    },
  };
}

function aggregateCondition(condition) {
  return {
    sampleSize: 5,
    systemMetrics: systemMetrics(condition),
    uxMetrics: uxMetrics(condition),
    decision: `${modeForCondition(condition)} evidence reviewed`,
  };
}

function modeForCondition(condition) {
  if (condition === 'A') return 'No assistance';
  if (condition === 'B') return 'Full sentence suggestion';
  return '3-5 word cue';
}

function systemMetrics(condition) {
  const cueP50LatencyMs = condition === 'A' ? 0 : 900;
  const cueP95LatencyMs = condition === 'A' ? 0 : 1300;
  return {
    g2MicSuccessRate: 1,
    phoneFallbackRate: 0,
    falseSilenceDetectionRatePerMinute: 0.1,
    missedSpeechRate: 0.05,
    cueP50LatencyMs,
    cueP95LatencyMs,
    crashCount: 0,
    reconnectCount: 0,
    batteryConsumptionPercent: 4,
  };
}

function uxMetrics(condition) {
  return {
    timeToFirstUtteranceMs: 1800,
    cueUsageRate: condition === 'A' ? 0 : 0.6,
    cueDismissalRate: condition === 'A' ? 0 : 0.2,
    falseCueRate: condition === 'A' ? 0 : 0.1,
    phoneChecks: 1,
    eyeContactBreaks: 1,
    interruptionRating: 3,
    trustRating: 6,
    privacyConcernRating: 2,
  };
}

function vadEnvironment(name, noise, threshold, speech, qaExportPath, qaSummaryPath) {
  return {
    name,
    calibratedAt: '2026-06-19T09:00:00.000Z',
    metrics: {
      vadSpeechThreshold: threshold,
      vadNoiseFloorRms: noise,
      vadSpeechFloorRms: speech,
      falseStarts: 0,
      missedSpeechEvents: 0,
    },
    qaExportPath,
    qaSummaryPath,
    notes: `${name} calibration evidence reviewed`,
  };
}

function readFixture(manifestPath) {
  return JSON.parse(readFileSync(path.join(repoRoot, manifestPath), 'utf8'));
}

function writeFixtureManifest(manifestPath, manifest) {
  writeFileSync(path.join(repoRoot, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function runValidator(manifestPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/validate-pilot-evidence.mjs', manifestPath], {
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
