import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
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

test('rejects audio-source evidence that silently opens Phone Mic for G2 sessions', async () => {
  const template = JSON.parse(readFileSync(templatePath, 'utf8'));
  const invalidAudio = structuredClone(template);
  invalidAudio.audioSources.g2MicSession.selectedSource = 'G2 Mic';
  invalidAudio.audioSources.g2MicSession.vadAudioSource = 'bridge';
  invalidAudio.audioSources.g2MicSession.recognizerMode = 'hybrid';
  invalidAudio.audioSources.g2MicSession.webSpeechStarted = true;
  invalidAudio.audioSources.g2MicSession.phoneMicOpened = true;
  invalidAudio.audioSources.phoneMicSession.explicitlySelected = false;
  invalidAudio.audioSources.phoneMicSession.vadAudioSource = 'bridge';
  invalidAudio.audioSources.phoneMicSession.recognizerMode = 'hybrid';
  invalidAudio.audioSources.phoneMicSession.phoneMicOpened = false;
  invalidAudio.audioSources.g2Failure.phoneMicOpenedBeforeConsent = true;
  invalidAudio.audioSources.g2Failure.fallbackPromptShown = false;
  invalidAudio.audioSources.g2Failure.cancelKeepsAudioOff = false;

  const invalidAudioPath = path.join(tmpRoot, 'hardware-invalid-audio-sources.json');
  writeFileSync(invalidAudioPath, `${JSON.stringify(invalidAudio, null, 2)}\n`, 'utf8');

  const result = await runNode([
    'scripts/validate-hardware-qa.mjs',
    repoRelative(invalidAudioPath),
    '--allow-draft',
  ]);
  assert.notEqual(result.code, 0);
  const output = combinedOutput(result);
  assert.match(output, /audioSources\.g2MicSession\.recognizerMode: must be "bridge"/);
  assert.match(output, /audioSources\.g2MicSession\.webSpeechStarted: must be false/);
  assert.match(output, /audioSources\.g2MicSession\.phoneMicOpened: must be false/);
  assert.match(output, /audioSources\.phoneMicSession\.explicitlySelected: must be true/);
  assert.match(output, /audioSources\.phoneMicSession\.vadAudioSource: must be "browser"/);
  assert.match(output, /audioSources\.phoneMicSession\.recognizerMode: must be "browser"/);
  assert.match(output, /audioSources\.phoneMicSession\.phoneMicOpened: must be true/);
  assert.match(output, /audioSources\.g2Failure\.phoneMicOpenedBeforeConsent: must be false/);
  assert.match(output, /audioSources\.g2Failure\.fallbackPromptShown: must be true/);
  assert.match(output, /audioSources\.g2Failure\.cancelKeepsAudioOff: must be true/);
});

test('rejects wear-state evidence that treats connection as wearing', async () => {
  const template = JSON.parse(readFileSync(templatePath, 'utf8'));
  const invalidWear = structuredClone(template);
  invalidWear.wearingState.connectedWearing.inputStatus = {
    connectType: 'connected',
    isWearing: true,
  };
  invalidWear.wearingState.connectedWearing.parsedState = 'wearing';
  invalidWear.wearingState.connectedWearing.phoneLabel = 'Wearing';

  invalidWear.wearingState.connectedNotWearing.inputStatus = {
    connectType: 'connected',
    isWearing: true,
  };
  invalidWear.wearingState.connectedNotWearing.parsedState = 'wearing';
  invalidWear.wearingState.connectedNotWearing.phoneLabel = 'Wearing';

  invalidWear.wearingState.sensorUnavailable.inputStatus = {
    connectType: 'connected',
    isWearing: true,
  };
  invalidWear.wearingState.sensorUnavailable.parsedState = 'wearing';
  invalidWear.wearingState.sensorUnavailable.phoneLabel = 'Wearing';
  invalidWear.wearingState.connectedDoesNotForceWearing = false;

  const invalidWearPath = path.join(tmpRoot, 'hardware-invalid-wear-state.json');
  writeFileSync(invalidWearPath, `${JSON.stringify(invalidWear, null, 2)}\n`, 'utf8');

  const result = await runNode([
    'scripts/validate-hardware-qa.mjs',
    repoRelative(invalidWearPath),
    '--allow-draft',
  ]);
  assert.notEqual(result.code, 0);
  const output = combinedOutput(result);
  assert.match(output, /wearingState\.connectedNotWearing\.inputStatus\.isWearing: must be false/);
  assert.match(output, /wearingState\.connectedNotWearing\.parsedState: must be "not-wearing"/);
  assert.match(output, /wearingState\.connectedNotWearing\.phoneLabel: must include Not wearing/);
  assert.match(output, /wearingState\.sensorUnavailable\.inputStatus: must omit wear sensor fields for unavailable evidence/);
  assert.match(output, /wearingState\.sensorUnavailable\.parsedState: must be "unavailable"/);
  assert.match(output, /wearingState\.sensorUnavailable\.phoneLabel: must include Wear status unavailable/);
  assert.match(output, /wearingState\.connectedDoesNotForceWearing: must be true/);
});

test('rejects background lifecycle evidence without beta lock and cold-start recovery proof', async () => {
  const fixture = writeCompletedHardwareFixture('background-lifecycle');
  const invalidLifecycle = JSON.parse(readFileSync(path.join(repoRoot, fixture.manifestPath), 'utf8'));
  invalidLifecycle.backgroundLifecycle.lockDurationMinutes = 2;
  invalidLifecycle.backgroundLifecycle.glassesLaunchRendersAfterLock = false;
  invalidLifecycle.backgroundLifecycle.rootDoubleTapSystemExitDialogShown = false;
  invalidLifecycle.backgroundLifecycle.permissionDenialPathVerified = false;
  invalidLifecycle.backgroundLifecycle.androidColdStartRebuildsFromLocalStorage = false;
  invalidLifecycle.backgroundLifecycle.audioCaptureReenabledAfterForeground = false;
  invalidLifecycle.backgroundLifecycle.webSocketReconnectHandledOrNotUsed = false;
  invalidLifecycle.backgroundLifecycle.consoleSanityChecked = false;
  invalidLifecycle.backgroundLifecycle.videoEvidence = 'background-lifecycle-video.mp4';

  const invalidPath = path.join(tmpRoot, 'hardware-invalid-background-lifecycle.json');
  writeFileSync(invalidPath, `${JSON.stringify(invalidLifecycle, null, 2)}\n`, 'utf8');

  const result = await runNode([
    'scripts/validate-hardware-qa.mjs',
    repoRelative(invalidPath),
  ]);
  assert.notEqual(result.code, 0);
  const output = combinedOutput(result);
  assert.match(output, /backgroundLifecycle\.lockDurationMinutes: must be >= 5 for beta\/private locked-phone evidence/);
  assert.match(output, /backgroundLifecycle\.glassesLaunchRendersAfterLock: must be true/);
  assert.match(output, /backgroundLifecycle\.rootDoubleTapSystemExitDialogShown: must be true/);
  assert.match(output, /backgroundLifecycle\.permissionDenialPathVerified: must be true/);
  assert.match(output, /backgroundLifecycle\.androidColdStartRebuildsFromLocalStorage: must be true/);
  assert.match(output, /backgroundLifecycle\.audioCaptureReenabledAfterForeground: must be true/);
  assert.match(output, /backgroundLifecycle\.webSocketReconnectHandledOrNotUsed: must be true/);
  assert.match(output, /backgroundLifecycle\.consoleSanityChecked: must be true/);
  assert.match(output, /backgroundLifecycle\.videoEvidence: repo path evidence must point to an existing file/);
});

test('rejects Exit ECHO evidence without the explicit system shutdown call proof', async () => {
  const fixture = writeCompletedHardwareFixture('exit-echo-shutdown');
  const invalidExit = JSON.parse(readFileSync(path.join(repoRoot, fixture.manifestPath), 'utf8'));
  invalidExit.lifecycle.exitEchoRun.shutDownPageContainerCalled = false;
  invalidExit.lifecycle.exitEchoRun.shutdownTarget = 0;

  const invalidPath = path.join(tmpRoot, 'hardware-invalid-exit-echo.json');
  writeFileSync(invalidPath, `${JSON.stringify(invalidExit, null, 2)}\n`, 'utf8');

  const result = await runNode([
    'scripts/validate-hardware-qa.mjs',
    repoRelative(invalidPath),
  ]);
  assert.notEqual(result.code, 0);
  const output = combinedOutput(result);
  assert.match(output, /lifecycle\.exitEchoRun\.shutdownTarget: must be 1/);
  assert.match(output, /lifecycle\.exitEchoRun\.shutDownPageContainerCalled: must be true/);
});

test('rejects packaged hardware QA artifact evidence with unverifiable or mismatched SHA-256', async () => {
  const fixture = writeCompletedHardwareFixture('build-artifact-sha');
  const validResult = await runNode([
    'scripts/validate-hardware-qa.mjs',
    fixture.manifestPath,
  ]);
  assert.equal(validResult.code, 0, combinedOutput(validResult));

  const mismatched = JSON.parse(readFileSync(path.join(repoRoot, fixture.manifestPath), 'utf8'));
  mismatched.buildArtifact.sha256 = '0'.repeat(64);
  const mismatchedPath = path.join(tmpRoot, 'hardware-mismatched-package-sha.json');
  writeFileSync(mismatchedPath, `${JSON.stringify(mismatched, null, 2)}\n`, 'utf8');

  const mismatchedResult = await runNode([
    'scripts/validate-hardware-qa.mjs',
    repoRelative(mismatchedPath),
  ]);
  assert.notEqual(mismatchedResult.code, 0);
  assert.match(
    combinedOutput(mismatchedResult),
    /buildArtifact\.sha256: must match the SHA-256 digest of buildArtifact\.packagePath/,
  );

  const remotePackage = JSON.parse(readFileSync(path.join(repoRoot, fixture.manifestPath), 'utf8'));
  remotePackage.buildArtifact.packagePath = 'https://example.test/echo.ehpk';
  const remotePath = path.join(tmpRoot, 'hardware-remote-package.json');
  writeFileSync(remotePath, `${JSON.stringify(remotePackage, null, 2)}\n`, 'utf8');

  const remoteResult = await runNode([
    'scripts/validate-hardware-qa.mjs',
    repoRelative(remotePath),
  ]);
  assert.notEqual(remoteResult.code, 0);
  assert.match(
    combinedOutput(remoteResult),
    /buildArtifact\.packagePath: must be a repo-local file path so the artifact can be verified/,
  );
});

function writeCompletedHardwareFixture(name) {
  const fixtureDir = path.join(tmpRoot, name);
  mkdirSync(fixtureDir, { recursive: true });

  const evidenceRef = path.join(fixtureDir, 'evidence.json');
  const videoRef = path.join(fixtureDir, 'evidence.mp4');
  const debugLogRef = path.join(fixtureDir, 'debug.log');
  const reportRef = path.join(fixtureDir, 'bundle-report.json');
  const packagePath = path.join(fixtureDir, 'echo.ehpk');
  writeFileSync(evidenceRef, '{"ok":true}\n', 'utf8');
  writeFileSync(videoRef, 'video evidence placeholder\n', 'utf8');
  writeFileSync(debugLogRef, 'debug log placeholder\n', 'utf8');
  writeFileSync(reportRef, '{"ok":true}\n', 'utf8');
  writeFileSync(packagePath, 'packaged echo artifact\n', 'utf8');

  const evidence = repoRelative(evidenceRef);
  const video = repoRelative(videoRef);
  const debugLog = repoRelative(debugLogRef);
  const report = repoRelative(reportRef);
  const packageRelativePath = repoRelative(packagePath);
  const appVersion = JSON.parse(readFileSync(path.join(repoRoot, 'even-app/package.json'), 'utf8')).version;
  const packageSha = createHash('sha256').update(readFileSync(packagePath)).digest('hex');

  const manifest = {
    project: 'Project ECHO',
    runDate: '2026-06-19',
    evidenceStatus: 'complete',
    device: {
      name: 'Even Realities G2',
      firmwareVersion: 'firmware-qa',
      appVersion,
      bridgeVersion: 'bridge-qa',
    },
    buildArtifact: {
      packagePath: packageRelativePath,
      sha256: packageSha,
      packCommand: 'npx evenhub pack app.json dist -o echo.ehpk',
      sourceAppJson: 'even-app/app.json',
      sourceDistDir: 'even-app/dist',
      installedViaBetaOrPrivateBuild: true,
      sameArtifactUsedForHardwareQa: true,
      reviewerParityConfirmed: true,
      lockedPhoneFiveMinuteRun: true,
      evidenceRef: evidence,
    },
    backgroundLifecycle: {
      installedAsBetaOrPrivateBuild: true,
      lockDurationMinutes: 5,
      phoneLockedBackgrounded: true,
      glassesLaunchRendersAfterLock: true,
      noBlackScreenOrInfiniteSpinner: true,
      gestureOnlyCoreFlowCompleted: true,
      everyGestureShowsFeedback: true,
      rootDoubleTapSystemExitDialogShown: true,
      permissionDenialPathVerified: true,
      aliveAfterTwoMinutesIdle: true,
      unlockUseAnotherAppRelockUnaffected: true,
      androidColdStartRebuildsFromLocalStorage: true,
      audioCaptureReenabledAfterForeground: true,
      webSocketReconnectHandledOrNotUsed: true,
      firstPartyAppLaunchAfterExit: true,
      consoleSanityChecked: true,
      evidenceRef: evidence,
      videoEvidence: video,
    },
    wearingState: {
      connectedWearing: {
        inputStatus: { connectType: 'connected', isWearing: true },
        parsedState: 'wearing',
        phoneLabel: 'Wearing',
        evidenceRef: evidence,
      },
      connectedNotWearing: {
        inputStatus: { connectType: 'connected', isWearing: false },
        parsedState: 'not-wearing',
        phoneLabel: 'Not wearing',
        evidenceRef: evidence,
      },
      sensorUnavailable: {
        inputStatus: { connectType: 'connected' },
        parsedState: 'unavailable',
        phoneLabel: 'Wear status unavailable',
        evidenceRef: evidence,
      },
      connectedDoesNotForceWearing: true,
    },
    lifecycle: {
      tenCycleRuns: Array.from({ length: 10 }, (_, index) => ({
        cycle: index + 1,
        startG2MicSession: true,
        endPracticeSelected: true,
        standbyReturned: true,
        duplicateMicStreams: false,
        duplicateHudCallbacks: false,
        pendingTimers: false,
        evidenceRef: evidence,
        activeMicStreamsAfterEnd: 0,
        activeVadDetectorsAfterEnd: 0,
        pendingTimeoutCount: 0,
        pendingIntervalCount: 0,
        lateHudUpdatesAfterEnd: 0,
      })),
      exitEchoRun: {
        exitFromActiveSession: true,
        shutdownTarget: 1,
        shutDownPageContainerCalled: true,
        statusListenersCleared: true,
        audioCaptureStopped: true,
        lateResponsesIgnored: true,
        activeAudioCapturesAfterExit: 0,
        pendingTimeoutCount: 0,
        pendingIntervalCount: 0,
        lateHudUpdatesAfterExit: 0,
        evidenceRef: evidence,
      },
    },
    hud: {
      states: Object.fromEntries(
        ['READY', 'LISTENING', 'CUE', 'ACK', 'PAUSED'].map((state) => [
          state,
          { rendered: true, noOverlap: true, evidenceRef: evidence },
        ]),
      ),
      phoneDetailOnly: true,
      grammarHiddenOnG2: true,
      videoEvidence: video,
    },
    assist: {
      manualDefault: true,
      autoOptInOnly: true,
      doubleClickRequestsCue: true,
      swipeDismissesCue: true,
      speechClearsCue: true,
      silenceOnlyDoesNotAutoCue: true,
      breakdownSignalRequired: true,
      graceCancelWorks: true,
      autoCueLevelCap: true,
      manualLevelThreeRequiresExplicitRequest: true,
      twoDismissAutoPause: true,
      interventionCapEnforced: true,
      metricsCaptured: true,
      metrics: {
        manual_request_count: 1,
        auto_trigger_count: 1,
        cue_dismissed_count: 2,
        false_trigger_count: 0,
        cue_used_count: 1,
      },
      rawTranscriptInMetrics: false,
      evidenceRef: evidence,
    },
    audioSources: {
      g2MicSession: {
        selectedSource: 'G2 Mic',
        vadAudioSource: 'bridge',
        recognizerMode: 'bridge',
        webSpeechStarted: false,
        phoneMicOpened: false,
        evidenceRef: evidence,
      },
      phoneMicSession: {
        explicitlySelected: true,
        vadAudioSource: 'browser',
        recognizerMode: 'browser',
        phoneMicOpened: true,
        evidenceRef: evidence,
      },
      g2Failure: {
        phoneMicOpenedBeforeConsent: false,
        fallbackPromptShown: true,
        cancelKeepsAudioOff: true,
        evidenceRef: evidence,
      },
    },
    conversationTimeline: {
      g2MicSegmentation: timelineSegmentation('g2', evidence),
      phoneMicSegmentation: timelineSegmentation('phone', evidence),
      importSegmentation: {
        source: 'import',
        speakerPrefixesTested: true,
        learnerTurnCount: 1,
        partnerTurnCount: 1,
        malformedRowsSkipped: true,
        deterministicIds: true,
        evidenceRef: evidence,
      },
      translationReview: {
        koreanTranslationShown: true,
        failedTranslationNonBlocking: true,
        manualSpeakerCorrectionPersisted: true,
        correctedByUserExported: true,
        evidenceRef: evidence,
      },
      hudBoundary: {
        phoneTimelineVisible: true,
        g2ConversationHistoryHidden: true,
        g2TranslationHidden: true,
        g2SpeakerLabelsHidden: true,
        hudStatesCueOnly: true,
        evidenceRef: evidence,
        videoEvidence: video,
      },
    },
    delayedProxy: {
      scenarios: {
        endPractice: delayedScenario(evidence),
        pause: delayedScenario(evidence),
        exitEcho: delayedScenario(evidence),
      },
      latencyMetadataVisible: true,
      noRawTranscriptInLogs: true,
      debugLogRef: debugLog,
    },
    voiceRuntime: {
      voiceRuntimeOnDemand: true,
      initialChunksUnderLimit: true,
      distHtmlDoesNotPreloadVoiceRuntime: true,
      g2MicStartWorks: true,
      phoneMicStartWorks: true,
      pauseResumeWorks: true,
      endPracticeCleanupWorks: true,
      audioSourceSwitchWorks: true,
      noSilentPhoneFallback: true,
      bundleReportRef: report,
      deviceEvidenceRef: evidence,
      bundleMetrics: {
        largestInitialJsKb: 228.23,
        initialJsLimitKb: 500,
        voiceRuntimeJsKb: 781.72,
        voiceRuntimeGzipKb: 212.65,
        onnxWasmKb: 25014.75,
        onnxWasmGzipKb: 5855.26,
        voiceRuntimeLoad: 'on demand',
        onnxWasmLoad: 'on demand',
        distHtmlPreloadsVoiceRuntime: false,
      },
    },
  };

  const manifestPath = path.join(fixtureDir, 'hardware-complete.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    manifestPath: repoRelative(manifestPath),
    packagePath: packageRelativePath,
  };
}

function timelineSegmentation(source, evidenceRef) {
  return {
    source,
    speakerRolesCaptured: true,
    learnerTurnCount: 1,
    partnerTurnCount: 1,
    unknownTurnCount: 0,
    orderedTimingCaptured: true,
    finalityCaptured: true,
    confidencePolicyRecorded: true,
    evidenceRef,
  };
}

function delayedScenario(evidenceRef) {
  return {
    abortObserved: true,
    lateResponseIgnored: true,
    hudUnchanged: true,
    phoneCueUnchanged: true,
    latencyMetadata: {
      session_request_scope_id: 'scope-1',
      request_id: 'request-1',
      request_kind: 'cue',
      silence_detected_at: 1000,
      cue_request_started_at: 1100,
      cue_response_received_at: 6200,
      cue_displayed_at: null,
      network_latency_ms: 5000,
      generation_latency_ms: 100,
      hud_render_latency_ms: null,
      end_to_end_latency_ms: null,
      late_response_latency_ms: 5100,
      rawTranscriptInMetadata: false,
    },
    evidenceRef,
  };
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

function combinedOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}
