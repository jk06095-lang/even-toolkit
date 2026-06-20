import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

const repoRoot = process.cwd();
const resolvedRepoRoot = path.resolve(repoRoot);
const tmpRoot = path.join(repoRoot, '.tmp', `chatgpt-action-evidence-${process.pid}`);
const actionApiBaseUrl = 'https://api.project-echo.app';

before(() => {
  mkdirSync(tmpRoot, { recursive: true });
  writeFileSync(path.join(tmpRoot, 'action-oauth-smoke.json'), '{"ok":true}\n', 'utf8');
  writeFileSync(path.join(tmpRoot, 'action-gpt-config.png'), 'png evidence placeholder\n', 'utf8');
  writeFileSync(path.join(tmpRoot, 'g2-recall-evidence.json'), '{"ok":true}\n', 'utf8');
  writeFileSync(path.join(tmpRoot, 'recall-day-1.json'), '{"ok":true,"day":"2026-06-18"}\n', 'utf8');
  writeFileSync(path.join(tmpRoot, 'recall-day-7.json'), '{"ok":true,"day":"2026-06-25"}\n', 'utf8');
  writeFileSync(path.join(tmpRoot, 'transfer-evidence.json'), '{"ok":true,"scenarioId":"transfer:travel:repeat:1"}\n', 'utf8');
  writeFileSync(path.join(tmpRoot, 'same-day-repeat.json'), '{"ok":true,"countedAsTransfer":false}\n', 'utf8');
  writeFileSync(path.join(tmpRoot, 'tutor-instructions-evidence.md'), '# Tutor instructions evidence\n', 'utf8');
  writeFileSync(path.join(tmpRoot, 'roleplay-writeback-evidence.json'), '{"ok":true,"boundedItemIds":["li_001"]}\n', 'utf8');
});

after(() => {
  const resolvedTmpRoot = path.resolve(tmpRoot);
  if (resolvedTmpRoot.startsWith(`${resolvedRepoRoot}${path.sep}`) && existsSync(resolvedTmpRoot)) {
    rmSync(resolvedTmpRoot, { recursive: true, force: true });
  }
});

test('accepts completed Action evidence with hashed OAuth token storage boundary', async () => {
  const manifestPath = writeManifest('valid', completeManifest({
    tokenStorageBoundary: 'Server-side OAuth tokens are stored as hashed fingerprints in proxy memory; raw access tokens and client secrets are not stored in evidence.',
  }));
  const result = await runValidator(manifestPath);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /final ChatGPT Action evidence accepted/);
});

test('rejects completed Action evidence that claims raw OAuth token storage', async () => {
  const manifestPath = writeManifest('raw-token-storage', completeManifest({
    tokenStorageBoundary: 'Server stores raw bearer tokens in memory for lookup.',
  }));
  const result = await runValidator(manifestPath);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /oauth\.tokenStorageBoundary/);
  assert.match(result.stderr, /raw or plaintext token storage/);
});

test('rejects completed Action evidence that omits a non-raw storage mechanism', async () => {
  const manifestPath = writeManifest('weak-token-storage', completeManifest({
    tokenStorageBoundary: 'Server-side OAuth token boundary is configured.',
  }));
  const result = await runValidator(manifestPath);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /oauth\.tokenStorageBoundary/);
  assert.match(result.stderr, /non-raw token storage/);
});

test('rejects completed Action evidence without spaced-recall transfer proof', async () => {
  const manifest = completeManifest({
    tokenStorageBoundary: 'Server-side OAuth tokens are stored as hashed fingerprints in proxy memory; raw access tokens and client secrets are not stored in evidence.',
  });
  manifest.activeRecallDeviceEvidence.twoSeparateRecallDaysProven = false;
  manifest.activeRecallDeviceEvidence.transferScenarioEvidenceCaptured = false;
  manifest.activeRecallDeviceEvidence.recallTransferProof.recallDates = ['2026-06-19'];
  manifest.activeRecallDeviceEvidence.recallTransferProof.transferScenarioIds = [];
  const manifestPath = writeManifest('missing-transfer-proof', manifest);
  const result = await runValidator(manifestPath);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /activeRecallDeviceEvidence\.twoSeparateRecallDaysProven/);
  assert.match(result.stderr, /activeRecallDeviceEvidence\.transferScenarioEvidenceCaptured/);
  assert.match(result.stderr, /activeRecallDeviceEvidence\.recallTransferProof\.recallDates/);
  assert.match(result.stderr, /activeRecallDeviceEvidence\.recallTransferProof\.transferScenarioIds/);
});

test('rejects completed Action evidence without a day 7 transfer window', async () => {
  const manifest = completeManifest({
    tokenStorageBoundary: 'Server-side OAuth tokens are stored as hashed fingerprints in proxy memory; raw access tokens and client secrets are not stored in evidence.',
  });
  manifest.activeRecallDeviceEvidence.recallTransferProof.day7TransferDate = '2026-06-20';
  manifest.activeRecallDeviceEvidence.recallTransferProof.recallDates = ['2026-06-18', '2026-06-20'];
  const manifestPath = writeManifest('missing-day-7-transfer-window', manifest);
  const result = await runValidator(manifestPath);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /activeRecallDeviceEvidence\.recallTransferProof\.day7TransferDate/);
  assert.match(result.stderr, /at least six calendar days after day1RecallDate/);
});

test('rejects completed Action evidence without calibrated G2 threshold proof', async () => {
  const manifest = completeManifest({
    tokenStorageBoundary: 'Server-side OAuth tokens are stored as hashed fingerprints in proxy memory; raw access tokens and client secrets are not stored in evidence.',
  });
  manifest.activeRecallDeviceEvidence.calibratedG2ThresholdUsed = false;
  manifest.activeRecallDeviceEvidence.g2AudioLevelEvidence.speechThreshold = 0;
  const manifestPath = writeManifest('missing-calibrated-g2-threshold', manifest);
  const result = await runValidator(manifestPath);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /activeRecallDeviceEvidence\.calibratedG2ThresholdUsed/);
  assert.match(result.stderr, /activeRecallDeviceEvidence\.g2AudioLevelEvidence\.speechThreshold/);
});

test('rejects completed Action evidence with inconsistent G2 audio-level counts', async () => {
  const manifest = completeManifest({
    tokenStorageBoundary: 'Server-side OAuth tokens are stored as hashed fingerprints in proxy memory; raw access tokens and client secrets are not stored in evidence.',
  });
  manifest.activeRecallDeviceEvidence.g2AudioLevelEvidence.totalFrames = 20;
  manifest.activeRecallDeviceEvidence.g2AudioLevelEvidence.speechFrames = 21;
  manifest.activeRecallDeviceEvidence.g2AudioLevelEvidence.clippedFrameCount = 25;
  const manifestPath = writeManifest('invalid-g2-audio-counts', manifest);
  const result = await runValidator(manifestPath);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /activeRecallDeviceEvidence\.g2AudioLevelEvidence\.speechFrames/);
  assert.match(result.stderr, /activeRecallDeviceEvidence\.g2AudioLevelEvidence\.clippedFrameCount/);
});

test('rejects completed Action evidence that uses Web Speech confidence as G2 scoring', async () => {
  const manifest = completeManifest({
    tokenStorageBoundary: 'Server-side OAuth tokens are stored as hashed fingerprints in proxy memory; raw access tokens and client secrets are not stored in evidence.',
  });
  manifest.activeRecallDeviceEvidence.pronunciationScoringPolicy.scoringSource = 'web_speech_confidence';
  manifest.activeRecallDeviceEvidence.pronunciationScoringPolicy.webSpeechConfidenceUsedForG2 = true;
  const manifestPath = writeManifest('web-speech-g2-scoring', manifest);
  const result = await runValidator(manifestPath);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /activeRecallDeviceEvidence\.pronunciationScoringPolicy\.scoringSource/);
  assert.match(result.stderr, /activeRecallDeviceEvidence\.pronunciationScoringPolicy\.webSpeechConfidenceUsedForG2/);
});

test('rejects completed Action evidence that retains raw audio for scoring proof', async () => {
  const manifest = completeManifest({
    tokenStorageBoundary: 'Server-side OAuth tokens are stored as hashed fingerprints in proxy memory; raw access tokens and client secrets are not stored in evidence.',
  });
  manifest.activeRecallDeviceEvidence.pronunciationScoringPolicy.rawAudioRetained = true;
  const manifestPath = writeManifest('raw-audio-pronunciation-policy', manifest);
  const result = await runValidator(manifestPath);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /activeRecallDeviceEvidence\.pronunciationScoringPolicy\.rawAudioRetained/);
});

test('rejects completed Action evidence without bounded tutor behavior proof', async () => {
  const manifest = completeManifest({
    tokenStorageBoundary: 'Server-side OAuth tokens are stored as hashed fingerprints in proxy memory; raw access tokens and client secrets are not stored in evidence.',
  });
  manifest.tutorBehavior.maxOneCorrectionPerTurn = false;
  manifest.tutorBehavior.cueLadderOrderVerified = false;
  manifest.tutorBehavior.immediateRepeatNotMastery = false;
  manifest.tutorBehavior.maxLearningItemsPerSession = 5;
  manifest.tutorBehavior.roleplayResultOmitsRawTranscript = false;
  manifest.tutorBehavior.transferWriteBackUsesScenarioId = false;
  manifest.tutorBehavior.roleplayEvidenceRef = 'roleplay checked';
  const manifestPath = writeManifest('missing-tutor-behavior-proof', manifest);
  const result = await runValidator(manifestPath);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /tutorBehavior\.maxOneCorrectionPerTurn/);
  assert.match(result.stderr, /tutorBehavior\.cueLadderOrderVerified/);
  assert.match(result.stderr, /tutorBehavior\.immediateRepeatNotMastery/);
  assert.match(result.stderr, /tutorBehavior\.maxLearningItemsPerSession/);
  assert.match(result.stderr, /tutorBehavior\.roleplayResultOmitsRawTranscript/);
  assert.match(result.stderr, /tutorBehavior\.transferWriteBackUsesScenarioId/);
  assert.match(result.stderr, /tutorBehavior\.roleplayEvidenceRef: must be an https URL or repo path/);
});

function writeManifest(name, manifest) {
  const fixtureDir = path.join(tmpRoot, name);
  mkdirSync(fixtureDir, { recursive: true });

  const manifestPath = path.join(fixtureDir, 'project-echo-chatgpt-action-evidence.completed.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return repoRelative(manifestPath);
}

function completeManifest({ tokenStorageBoundary }) {
  const actionEvidenceRef = repoRelative(path.join(tmpRoot, 'action-oauth-smoke.json'));
  const gptEvidenceRef = repoRelative(path.join(tmpRoot, 'action-gpt-config.png'));
  const deviceEvidenceRef = repoRelative(path.join(tmpRoot, 'g2-recall-evidence.json'));
  const pronunciationPolicyRef = repoRelative(path.join(tmpRoot, 'g2-recall-evidence.json'));
  const recallDay1Ref = repoRelative(path.join(tmpRoot, 'recall-day-1.json'));
  const recallDay7Ref = repoRelative(path.join(tmpRoot, 'recall-day-7.json'));
  const transferEvidenceRef = repoRelative(path.join(tmpRoot, 'transfer-evidence.json'));
  const sameDayRepeatEvidenceRef = repoRelative(path.join(tmpRoot, 'same-day-repeat.json'));
  const tutorInstructionsEvidenceRef = repoRelative(path.join(tmpRoot, 'tutor-instructions-evidence.md'));
  const roleplayEvidenceRef = repoRelative(path.join(tmpRoot, 'roleplay-writeback-evidence.json'));
  const endpoints = {
    learnerProfile: endpoint('/v1/learner/profile', 'GET', actionEvidenceRef),
    reviewsNext: endpoint('/v1/reviews/next', 'GET', actionEvidenceRef),
    reviewAttempt: endpoint('/v1/reviews/attempt', 'POST', actionEvidenceRef, true),
    roleplayStart: endpoint('/v1/roleplays/start', 'POST', actionEvidenceRef),
    roleplayResult: endpoint('/v1/roleplays/result', 'POST', actionEvidenceRef, true),
    sessionImport: endpoint('/v1/sessions/import-summary', 'POST', actionEvidenceRef, true),
  };

  return {
    project: 'Project ECHO',
    evidenceStatus: 'complete',
    runDate: '2026-06-19',
    actionApiBaseUrl,
    actionContractVersion: '0.1.0',
    actionGpt: {
      customGptConfigured: true,
      openapiSchemaUploaded: true,
      privacyPolicyConfigured: true,
      actionsAndAppsNotMixed: true,
      evidenceRef: gptEvidenceRef,
    },
    oauth: {
      authorizationCodeConfigured: true,
      authorizationUrl: `${actionApiBaseUrl}/oauth/authorize`,
      tokenUrl: `${actionApiBaseUrl}/oauth/token`,
      scopesGranted: [
        'profile:read',
        'review:read',
        'review:write',
        'roleplay:write',
        'session:write',
      ],
      tokenStorageBoundary,
      providerSecretsInGpt: false,
      evidenceRef: actionEvidenceRef,
    },
    endpoints,
    privacy: {
      rawTranscriptRejected: true,
      rawAudioRejected: true,
      directContactIdentifiersRejected: true,
      providerSecretsRejected: true,
      boundedLearningItemsMax: 30,
      evidenceRef: actionEvidenceRef,
    },
    activeRecallDeviceEvidence: {
      g2BridgeRecallCaptured: true,
      audioLevelPronunciationScoring: true,
      calibratedG2ThresholdUsed: true,
      webSpeechOnlyMarkedInsufficient: true,
      twoSeparateRecallDaysProven: true,
      transferScenarioEvidenceCaptured: true,
      sameDayRepeatNotCountedAsTransfer: true,
      recallTransferProof: {
        day1RecallDate: '2026-06-18',
        day7TransferDate: '2026-06-25',
        recallDates: ['2026-06-18', '2026-06-25'],
        independentRecallAttemptRefs: [recallDay1Ref, recallDay7Ref],
        transferScenarioIds: ['transfer:travel:repeat:1'],
        transferEvidenceRef,
        sameDayRepeatEvidenceRef,
      },
      g2AudioLevelEvidence: {
        captureSource: 'g2_bridge',
        speechThreshold: 0.035,
        speechFrameRatio: 0.42,
        totalFrames: 160,
        speechFrames: 67,
        clippedFrameCount: 0,
        rawAudioRetained: false,
        evidenceRef: deviceEvidenceRef,
      },
      pronunciationScoringPolicy: {
        scoringSource: 'g2_audio_level_policy',
        webSpeechConfidenceUsedForG2: false,
        rawAudioRetained: false,
        g2BridgePcmEvidencePresent: true,
        calibratedThresholdInEvidence: true,
        evidenceRef: pronunciationPolicyRef,
      },
      evidenceRef: deviceEvidenceRef,
    },
    tutorBehavior: {
      flowBeforeCorrection: true,
      maxOneCorrectionPerTurn: true,
      cueLadderOrderVerified: true,
      koreanExplanationBrief: true,
      immediateRepeatNotMastery: true,
      masteryRequiresTwoDaysAndTransfer: true,
      maxLearningItemsPerSession: 3,
      roleplayResultWritesBoundedItemIds: true,
      roleplayResultOmitsRawTranscript: true,
      roleplayResultIncludesOutcomeSummary: true,
      transferWriteBackUsesScenarioId: true,
      instructionsEvidenceRef: tutorInstructionsEvidenceRef,
      roleplayEvidenceRef,
    },
  };
}

function endpoint(endpointPath, method, evidenceRef, writeAccepted = false) {
  return {
    path: endpointPath,
    method,
    status: 200,
    schemaVersion: '2.0.0',
    ...(writeAccepted ? { writeAccepted: true } : {}),
    rawTranscriptReturned: false,
    rawAudioReturned: false,
    directIdentifierReturned: false,
    evidenceRef,
  };
}

function runValidator(manifestPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/validate-chatgpt-action-evidence.mjs', manifestPath], {
      cwd: repoRoot,
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
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

function repoRelative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}
