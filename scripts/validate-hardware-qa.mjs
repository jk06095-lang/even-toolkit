#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_HUD_STATES = ['READY', 'LISTENING', 'CUE', 'PAUSED'];
const REQUIRED_DELAYED_PROXY_SCENARIOS = ['endPractice', 'pause', 'exitEcho'];
const WEARING_STATE_CASES = [
  {
    key: 'connectedWearing',
    parsedState: 'wearing',
    labelIncludes: 'Wearing',
    expectedIsWearing: true,
  },
  {
    key: 'connectedNotWearing',
    parsedState: 'not-wearing',
    labelIncludes: 'Not wearing',
    expectedIsWearing: false,
  },
  {
    key: 'sensorUnavailable',
    parsedState: 'unavailable',
    labelIncludes: 'Wear status unavailable',
    expectNoWearSensor: true,
  },
];
const LIFECYCLE_CYCLE_ZERO_METRICS = [
  'activeMicStreamsAfterEnd',
  'activeVadDetectorsAfterEnd',
  'pendingTimeoutCount',
  'pendingIntervalCount',
  'lateHudUpdatesAfterEnd',
];
const LIFECYCLE_EXIT_ZERO_METRICS = [
  'activeAudioCapturesAfterExit',
  'pendingTimeoutCount',
  'pendingIntervalCount',
  'lateHudUpdatesAfterExit',
];
const ASSIST_METRICS = [
  { key: 'manual_request_count', min: 1 },
  { key: 'auto_trigger_count', min: 1 },
  { key: 'cue_dismissed_count', min: 2 },
  { key: 'false_trigger_count', min: 0 },
  { key: 'cue_used_count', min: 0 },
];
const DELAYED_PROXY_NUMERIC_METADATA = [
  'silence_detected_at',
  'cue_request_started_at',
  'cue_response_received_at',
  'network_latency_ms',
  'generation_latency_ms',
  'late_response_latency_ms',
];
const DELAYED_PROXY_NULLABLE_METADATA = [
  'cue_displayed_at',
  'hud_render_latency_ms',
  'end_to_end_latency_ms',
];
const DELAYED_PROXY_IGNORED_DISPLAY_METADATA = [
  'cue_displayed_at',
  'hud_render_latency_ms',
  'end_to_end_latency_ms',
];

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /^TBD$/i,
  /^TODO$/i,
  /^N\/A$/i,
  /^placeholder$/i,
  /^fill/i,
  /^https?:\/\/example\.com/i,
];

const EVIDENCE_EXTENSIONS = ['md', 'txt', 'log', 'json', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'mp4', 'mov', 'webm', 'mkv'];
const PACKAGE_EXTENSIONS = ['ehpk'];
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv'];
const LOG_EXTENSIONS = ['md', 'txt', 'log', 'json'];
const REPORT_EXTENSIONS = ['md', 'txt', 'log', 'json'];
const INITIAL_JS_LIMIT_KB = 500;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

const args = process.argv.slice(2);
const allowDraft = args.includes('--allow-draft');
const verbose = args.includes('--verbose');
const wantsHelp = args.includes('--help') || args.includes('-h');
const targetArg = args.find((arg) => !arg.startsWith('--'));

if (wantsHelp || !targetArg) {
  console.info(`Usage: npm run validate:hardware-qa -- <hardware-qa.json> [--allow-draft] [--verbose]

Validates the Project ECHO physical G2 hardware QA evidence manifest.

Without --allow-draft, placeholders, missing evidence references, invalid
evidence link/path values, and outcomes that do not match the expected
cleanup/HUD/assist/delayed-proxy behavior fail the command. Use --allow-draft
only for the checked-in template shape.`);
  process.exit(wantsHelp ? 0 : 1);
}

const targetPath = path.resolve(process.cwd(), targetArg);
let manifest;

try {
  manifest = JSON.parse(readFileSync(targetPath, 'utf8'));
} catch (error) {
  console.error(`[hardware-qa] could not read ${targetArg}: ${error.message}`);
  process.exit(1);
}

const errors = [];
const warnings = [];
let currentEchoAppVersion = null;

function addError(pointer, message) {
  errors.push(`${pointer}: ${message}`);
}

function addWarning(pointer, message) {
  warnings.push(`${pointer}: ${message}`);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPlaceholder(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function validateObject(value, pointer) {
  if (!isPlainObject(value)) {
    addError(pointer, 'expected an object');
    return false;
  }
  return true;
}

function validateText(object, key, pointer, options = {}) {
  const fieldPointer = `${pointer}.${key}`;
  if (!hasOwn(object, key)) {
    addError(fieldPointer, 'missing required field');
    return;
  }

  const value = object[key];
  if (allowDraft && (value === null || isPlaceholder(value))) {
    addWarning(fieldPointer, 'draft placeholder remains');
    return;
  }

  if (typeof value !== 'string' || isPlaceholder(value)) {
    addError(fieldPointer, 'must be filled with a non-placeholder string');
    return;
  }

  if (options.includes && !value.includes(options.includes)) {
    addError(fieldPointer, `must include ${options.includes}`);
  }
}

function validateSha256(object, key, pointer) {
  const fieldPointer = `${pointer}.${key}`;
  if (!hasOwn(object, key)) {
    addError(fieldPointer, 'missing required SHA-256 field');
    return;
  }

  const value = object[key];
  if (allowDraft && (value === null || isPlaceholder(value))) {
    addWarning(fieldPointer, 'draft SHA-256 placeholder remains');
    return;
  }

  if (typeof value !== 'string' || !SHA256_PATTERN.test(value.trim())) {
    addError(fieldPointer, 'must be a 64-character hex SHA-256 digest');
  }
}

function validateCurrentAppVersion(object, key, pointer) {
  const fieldPointer = `${pointer}.${key}`;
  if (!hasOwn(object, key)) {
    return;
  }

  const value = object[key];
  if (allowDraft && (value === null || isPlaceholder(value))) {
    return;
  }

  if (typeof value !== 'string' || isPlaceholder(value)) {
    return;
  }

  const expected = getCurrentEchoAppVersion();
  if (!expected) {
    addError('manifest.currentEchoAppVersion', 'could not read even-app/package.json version');
    return;
  }

  if (value !== expected) {
    addError(fieldPointer, `must match even-app/package.json version ${expected}`);
  }
}

function getCurrentEchoAppVersion() {
  if (currentEchoAppVersion !== null) {
    return currentEchoAppVersion;
  }

  try {
    const packagePath = path.resolve(process.cwd(), 'even-app/package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    currentEchoAppVersion = typeof packageJson.version === 'string' ? packageJson.version : '';
  } catch {
    currentEchoAppVersion = '';
  }
  return currentEchoAppVersion;
}

function validateEvidenceLink(object, key, pointer, options = {}) {
  const fieldPointer = `${pointer}.${key}`;
  if (!hasOwn(object, key)) {
    addError(fieldPointer, 'missing required field');
    return;
  }

  const value = object[key];
  if (allowDraft && (value === null || isPlaceholder(value))) {
    addWarning(fieldPointer, 'draft placeholder remains');
    return;
  }

  if (typeof value !== 'string' || isPlaceholder(value)) {
    addError(fieldPointer, 'must be filled with a non-placeholder evidence link or repo path');
    return;
  }

  const extensions = options.extensions ?? EVIDENCE_EXTENSIONS;
  if (!looksLikeEvidenceTarget(value, extensions)) {
    addError(
      fieldPointer,
      `must be an https URL or repo path ending in one of: ${extensions.join(', ')}`,
    );
    return;
  }

  if (!evidenceTargetExists(value)) {
    addError(fieldPointer, 'repo path evidence must point to an existing file');
  }
}

function looksLikeEvidenceTarget(value, extensions) {
  const trimmed = String(value ?? '').trim();
  if (/^https:\/\/\S+$/i.test(trimmed)) return true;
  if (/^http:\/\//i.test(trimmed)) return false;

  const escapedExtensions = extensions.map((extension) => extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const relativePathPattern = new RegExp(
    `^(?:\\.{1,2}/)?[A-Za-z0-9_.\\-/]+\\.(${escapedExtensions.join('|')})$`,
    'i',
  );
  return relativePathPattern.test(trimmed);
}

function evidenceTargetExists(value) {
  const trimmed = String(value ?? '').trim();
  if (/^https:\/\/\S+$/i.test(trimmed)) return true;
  const resolvedPath = path.resolve(process.cwd(), trimmed);
  const repoRoot = `${process.cwd()}${path.sep}`;
  if (resolvedPath !== process.cwd() && !resolvedPath.startsWith(repoRoot)) {
    return false;
  }
  return existsSync(resolvedPath);
}

function validateExpected(object, key, expected, pointer) {
  const fieldPointer = `${pointer}.${key}`;
  if (!hasOwn(object, key)) {
    addError(fieldPointer, `missing required value ${JSON.stringify(expected)}`);
    return;
  }

  const value = object[key];
  if (allowDraft && (value === null || value === 'TBD')) {
    addWarning(fieldPointer, `draft value must become ${JSON.stringify(expected)}`);
    return;
  }

  if (value !== expected) {
    addError(fieldPointer, `must be ${JSON.stringify(expected)}`);
  }
}

function validateExpectedNumber(object, key, expected, pointer) {
  const fieldPointer = `${pointer}.${key}`;
  if (!hasOwn(object, key)) {
    addError(fieldPointer, `missing required value ${expected}`);
    return;
  }

  const value = object[key];
  if (allowDraft && (value === null || value === 'TBD')) {
    addWarning(fieldPointer, `draft value must become ${expected}`);
    return;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    addError(fieldPointer, 'must be a finite number');
    return;
  }

  if (value !== expected) {
    addError(fieldPointer, `must be ${expected}`);
  }
}

function validateCountMetric(object, metric, pointer) {
  const fieldPointer = `${pointer}.${metric.key}`;
  if (!hasOwn(object, metric.key)) {
    addError(fieldPointer, 'missing required count metric');
    return;
  }

  const value = object[metric.key];
  if (allowDraft && (value === null || value === 'TBD')) {
    addWarning(fieldPointer, `draft count must become an integer >= ${metric.min}`);
    return;
  }

  if (!Number.isInteger(value)) {
    addError(fieldPointer, 'must be an integer count');
    return;
  }

  if (value < metric.min) {
    addError(fieldPointer, `must be >= ${metric.min}`);
  }
}

function validateNonNegativeNumber(object, key, pointer) {
  const fieldPointer = `${pointer}.${key}`;
  if (!hasOwn(object, key)) {
    addError(fieldPointer, 'missing required numeric field');
    return;
  }

  const value = object[key];
  if (allowDraft && (value === null || value === 'TBD')) {
    addWarning(fieldPointer, 'draft numeric field remains');
    return;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    addError(fieldPointer, 'must be a finite number');
    return;
  }

  if (value < 0) {
    addError(fieldPointer, 'must be >= 0');
  }
}

function validatePositiveNumber(object, key, pointer) {
  validateNonNegativeNumber(object, key, pointer);

  const value = object[key];
  if (allowDraft && (value === null || value === 'TBD')) {
    return;
  }

  if (typeof value === 'number' && Number.isFinite(value) && value <= 0) {
    addError(`${pointer}.${key}`, 'must be > 0');
  }
}

function validateNullableNonNegativeNumber(object, key, pointer) {
  const fieldPointer = `${pointer}.${key}`;
  if (!hasOwn(object, key)) {
    addError(fieldPointer, 'missing required nullable numeric field');
    return;
  }

  const value = object[key];
  if (allowDraft && (value === null || value === 'TBD')) {
    addWarning(fieldPointer, 'draft nullable numeric field remains');
    return;
  }

  if (value === null) {
    return;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    addError(fieldPointer, 'must be null or a finite number');
    return;
  }

  if (value < 0) {
    addError(fieldPointer, 'must be >= 0 when present');
  }
}

function validateAllowedKeys(object, allowedKeys, pointer) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      addError(`${pointer}.${key}`, `unexpected key; allowed keys: ${allowedKeys.join(', ')}`);
    }
  }
}

function validateManifestRoot(manifestObject) {
  if (!validateObject(manifestObject, 'manifest')) return;

  validateText(manifestObject, 'project', 'manifest', { includes: 'ECHO' });
  validateText(manifestObject, 'runDate', 'manifest');
  validateText(manifestObject, 'evidenceStatus', 'manifest');
  if (!allowDraft && manifestObject.evidenceStatus !== 'complete') {
    addError('manifest.evidenceStatus', 'must be "complete" for final hardware QA');
  }

  if (validateObject(manifestObject.device, 'device')) {
    validateText(manifestObject.device, 'name', 'device', { includes: 'G2' });
    validateText(manifestObject.device, 'firmwareVersion', 'device');
    validateText(manifestObject.device, 'appVersion', 'device');
    validateCurrentAppVersion(manifestObject.device, 'appVersion', 'device');
    validateText(manifestObject.device, 'bridgeVersion', 'device');
  }
}

function validateBuildArtifact(manifestObject) {
  if (!validateObject(manifestObject.buildArtifact, 'buildArtifact')) return;

  validateEvidenceLink(manifestObject.buildArtifact, 'packagePath', 'buildArtifact', {
    extensions: PACKAGE_EXTENSIONS,
  });
  validateSha256(manifestObject.buildArtifact, 'sha256', 'buildArtifact');
  validateText(manifestObject.buildArtifact, 'packCommand', 'buildArtifact', {
    includes: 'pack',
  });
  validateExpected(manifestObject.buildArtifact, 'sourceAppJson', 'even-app/app.json', 'buildArtifact');
  validateExpected(manifestObject.buildArtifact, 'sourceDistDir', 'even-app/dist', 'buildArtifact');
  validateExpected(manifestObject.buildArtifact, 'installedViaBetaOrPrivateBuild', true, 'buildArtifact');
  validateExpected(manifestObject.buildArtifact, 'sameArtifactUsedForHardwareQa', true, 'buildArtifact');
  validateExpected(manifestObject.buildArtifact, 'reviewerParityConfirmed', true, 'buildArtifact');
  validateExpected(manifestObject.buildArtifact, 'lockedPhoneFiveMinuteRun', true, 'buildArtifact');
  validateEvidenceLink(manifestObject.buildArtifact, 'evidenceRef', 'buildArtifact');
}

function validateWearingState(manifestObject) {
  if (!validateObject(manifestObject.wearingState, 'wearingState')) return;

  for (const testCase of WEARING_STATE_CASES) {
    const pointer = `wearingState.${testCase.key}`;
    const evidence = manifestObject.wearingState[testCase.key];
    if (!validateObject(evidence, pointer)) continue;

    if (validateObject(evidence.inputStatus, `${pointer}.inputStatus`)) {
      validateConnectedStatus(evidence.inputStatus, `${pointer}.inputStatus`);
      if (testCase.expectedIsWearing !== undefined) {
        validateExpected(
          evidence.inputStatus,
          'isWearing',
          testCase.expectedIsWearing,
          `${pointer}.inputStatus`,
        );
      }
      if (
        testCase.expectNoWearSensor
        && (
          hasOwn(evidence.inputStatus, 'isWearing')
          || hasOwn(evidence.inputStatus, 'wearing')
          || hasOwn(evidence.inputStatus, 'wearStatus')
          || hasOwn(evidence.inputStatus, 'wearingState')
        )
      ) {
        addError(`${pointer}.inputStatus`, 'must omit wear sensor fields for unavailable evidence');
      }
    }
    validateExpected(evidence, 'parsedState', testCase.parsedState, pointer);
    validateText(evidence, 'phoneLabel', pointer, {
      includes: testCase.labelIncludes,
    });
    validateEvidenceLink(evidence, 'evidenceRef', pointer);
  }

  validateExpected(manifestObject.wearingState, 'connectedDoesNotForceWearing', true, 'wearingState');
}

function validateConnectedStatus(status, pointer) {
  const fieldPointer = `${pointer}.connectType`;
  if (!hasOwn(status, 'connectType')) {
    addError(fieldPointer, 'missing required connected status');
    return;
  }

  const value = status.connectType;
  if (allowDraft && (value === null || value === 'TBD')) {
    addWarning(fieldPointer, 'draft connected status remains');
    return;
  }

  if (value !== 'connected' && value !== 1) {
    addError(fieldPointer, 'must be "connected" or 1');
  }
}

function validateLifecycle(manifestObject) {
  if (!validateObject(manifestObject.lifecycle, 'lifecycle')) return;

  const runs = manifestObject.lifecycle.tenCycleRuns;
  if (!Array.isArray(runs)) {
    addError('lifecycle.tenCycleRuns', 'expected an array with 10 completed cycles');
  } else {
    if (runs.length < 10) {
      addError('lifecycle.tenCycleRuns', 'must include at least 10 cycles');
    }
    runs.forEach((run, index) => {
      const pointer = `lifecycle.tenCycleRuns[${index}]`;
      if (!validateObject(run, pointer)) return;
      validateExpected(run, 'cycle', index + 1, pointer);
      validateExpected(run, 'startG2MicSession', true, pointer);
      validateExpected(run, 'endPracticeSelected', true, pointer);
      validateExpected(run, 'standbyReturned', true, pointer);
      validateExpected(run, 'duplicateMicStreams', false, pointer);
      validateExpected(run, 'duplicateHudCallbacks', false, pointer);
      validateExpected(run, 'pendingTimers', false, pointer);
      for (const metric of LIFECYCLE_CYCLE_ZERO_METRICS) {
        validateExpectedNumber(run, metric, 0, pointer);
      }
      validateEvidenceLink(run, 'evidenceRef', pointer);
    });
  }

  if (validateObject(manifestObject.lifecycle.exitEchoRun, 'lifecycle.exitEchoRun')) {
    const run = manifestObject.lifecycle.exitEchoRun;
    validateExpected(run, 'exitFromActiveSession', true, 'lifecycle.exitEchoRun');
    validateExpected(run, 'shutdownTarget', 1, 'lifecycle.exitEchoRun');
    validateExpected(run, 'statusListenersCleared', true, 'lifecycle.exitEchoRun');
    validateExpected(run, 'audioCaptureStopped', true, 'lifecycle.exitEchoRun');
    validateExpected(run, 'lateResponsesIgnored', true, 'lifecycle.exitEchoRun');
    for (const metric of LIFECYCLE_EXIT_ZERO_METRICS) {
      validateExpectedNumber(run, metric, 0, 'lifecycle.exitEchoRun');
    }
    validateEvidenceLink(run, 'evidenceRef', 'lifecycle.exitEchoRun');
  }
}

function validateHud(manifestObject) {
  if (!validateObject(manifestObject.hud, 'hud')) return;
  if (!validateObject(manifestObject.hud.states, 'hud.states')) return;

  validateAllowedKeys(manifestObject.hud.states, REQUIRED_HUD_STATES, 'hud.states');

  for (const state of REQUIRED_HUD_STATES) {
    const pointer = `hud.states.${state}`;
    if (!validateObject(manifestObject.hud.states[state], pointer)) continue;
    validateExpected(manifestObject.hud.states[state], 'rendered', true, pointer);
    validateExpected(manifestObject.hud.states[state], 'noOverlap', true, pointer);
    validateEvidenceLink(manifestObject.hud.states[state], 'evidenceRef', pointer);
  }

  validateExpected(manifestObject.hud, 'phoneDetailOnly', true, 'hud');
  validateExpected(manifestObject.hud, 'grammarHiddenOnG2', true, 'hud');
  validateEvidenceLink(manifestObject.hud, 'videoEvidence', 'hud', {
    extensions: VIDEO_EXTENSIONS,
  });
}

function validateAssist(manifestObject) {
  if (!validateObject(manifestObject.assist, 'assist')) return;

  for (const key of [
    'manualDefault',
    'autoOptInOnly',
    'doubleClickRequestsCue',
    'swipeDismissesCue',
    'speechClearsCue',
    'twoDismissAutoPause',
    'interventionCapEnforced',
    'metricsCaptured',
  ]) {
    validateExpected(manifestObject.assist, key, true, 'assist');
  }
  validateExpected(manifestObject.assist, 'rawTranscriptInMetrics', false, 'assist');
  if (validateObject(manifestObject.assist.metrics, 'assist.metrics')) {
    for (const metric of ASSIST_METRICS) {
      validateCountMetric(manifestObject.assist.metrics, metric, 'assist.metrics');
    }
  }
  validateEvidenceLink(manifestObject.assist, 'evidenceRef', 'assist');
}

function validateAudioSources(manifestObject) {
  if (!validateObject(manifestObject.audioSources, 'audioSources')) return;

  if (validateObject(manifestObject.audioSources.g2MicSession, 'audioSources.g2MicSession')) {
    const g2 = manifestObject.audioSources.g2MicSession;
    validateText(g2, 'selectedSource', 'audioSources.g2MicSession', { includes: 'G2' });
    validateExpected(g2, 'vadAudioSource', 'bridge', 'audioSources.g2MicSession');
    validateExpected(g2, 'recognizerMode', 'bridge', 'audioSources.g2MicSession');
    validateExpected(g2, 'webSpeechStarted', false, 'audioSources.g2MicSession');
    validateExpected(g2, 'phoneMicOpened', false, 'audioSources.g2MicSession');
    validateEvidenceLink(g2, 'evidenceRef', 'audioSources.g2MicSession');
  }

  if (validateObject(manifestObject.audioSources.phoneMicSession, 'audioSources.phoneMicSession')) {
    const phone = manifestObject.audioSources.phoneMicSession;
    validateExpected(phone, 'explicitlySelected', true, 'audioSources.phoneMicSession');
    validateExpected(phone, 'vadAudioSource', 'browser', 'audioSources.phoneMicSession');
    validateExpected(phone, 'recognizerMode', 'browser', 'audioSources.phoneMicSession');
    validateExpected(phone, 'phoneMicOpened', true, 'audioSources.phoneMicSession');
    validateEvidenceLink(phone, 'evidenceRef', 'audioSources.phoneMicSession');
  }

  if (validateObject(manifestObject.audioSources.g2Failure, 'audioSources.g2Failure')) {
    const failure = manifestObject.audioSources.g2Failure;
    validateExpected(failure, 'phoneMicOpenedBeforeConsent', false, 'audioSources.g2Failure');
    validateExpected(failure, 'fallbackPromptShown', true, 'audioSources.g2Failure');
    validateExpected(failure, 'cancelKeepsAudioOff', true, 'audioSources.g2Failure');
    validateEvidenceLink(failure, 'evidenceRef', 'audioSources.g2Failure');
  }
}

function validateDelayedProxy(manifestObject) {
  if (!validateObject(manifestObject.delayedProxy, 'delayedProxy')) return;
  if (!validateObject(manifestObject.delayedProxy.scenarios, 'delayedProxy.scenarios')) return;

  for (const scenario of REQUIRED_DELAYED_PROXY_SCENARIOS) {
    const pointer = `delayedProxy.scenarios.${scenario}`;
    const scenarioEvidence = manifestObject.delayedProxy.scenarios[scenario];
    if (!validateObject(scenarioEvidence, pointer)) continue;
    validateExpected(scenarioEvidence, 'abortObserved', true, pointer);
    validateExpected(scenarioEvidence, 'lateResponseIgnored', true, pointer);
    validateExpected(scenarioEvidence, 'hudUnchanged', true, pointer);
    validateExpected(scenarioEvidence, 'phoneCueUnchanged', true, pointer);
    validateDelayedProxyMetadata(scenarioEvidence.latencyMetadata, `${pointer}.latencyMetadata`);
    validateEvidenceLink(scenarioEvidence, 'evidenceRef', pointer);
  }

  validateExpected(manifestObject.delayedProxy, 'latencyMetadataVisible', true, 'delayedProxy');
  validateExpected(manifestObject.delayedProxy, 'noRawTranscriptInLogs', true, 'delayedProxy');
  validateEvidenceLink(manifestObject.delayedProxy, 'debugLogRef', 'delayedProxy', {
    extensions: LOG_EXTENSIONS,
  });
}

function validateDelayedProxyMetadata(metadata, pointer) {
  if (!validateObject(metadata, pointer)) return;

  validateText(metadata, 'session_request_scope_id', pointer);
  validateText(metadata, 'request_id', pointer);
  validateExpected(metadata, 'request_kind', 'cue', pointer);
  validateExpected(metadata, 'rawTranscriptInMetadata', false, pointer);

  for (const key of DELAYED_PROXY_NUMERIC_METADATA) {
    validateNonNegativeNumber(metadata, key, pointer);
  }

  for (const key of DELAYED_PROXY_NULLABLE_METADATA) {
    validateNullableNonNegativeNumber(metadata, key, pointer);
  }

  for (const key of DELAYED_PROXY_IGNORED_DISPLAY_METADATA) {
    validateExpected(metadata, key, null, pointer);
  }

  const startedAt = metadata.cue_request_started_at;
  const responseAt = metadata.cue_response_received_at;
  if (
    typeof startedAt === 'number'
    && Number.isFinite(startedAt)
    && typeof responseAt === 'number'
    && Number.isFinite(responseAt)
    && responseAt < startedAt
  ) {
    addError(`${pointer}.cue_response_received_at`, 'must be >= cue_request_started_at');
  }

  if (
    typeof startedAt === 'number'
    && Number.isFinite(startedAt)
    && typeof responseAt === 'number'
    && Number.isFinite(responseAt)
    && responseAt === startedAt
  ) {
    addError(`${pointer}.cue_response_received_at`, 'must be > cue_request_started_at for delayed proxy evidence');
  }
}

function validateVoiceRuntime(manifestObject) {
  if (!validateObject(manifestObject.voiceRuntime, 'voiceRuntime')) return;

  for (const key of [
    'voiceRuntimeOnDemand',
    'initialChunksUnderLimit',
    'distHtmlDoesNotPreloadVoiceRuntime',
    'g2MicStartWorks',
    'phoneMicStartWorks',
    'pauseResumeWorks',
    'endPracticeCleanupWorks',
    'audioSourceSwitchWorks',
    'noSilentPhoneFallback',
  ]) {
    validateExpected(manifestObject.voiceRuntime, key, true, 'voiceRuntime');
  }

  validateEvidenceLink(manifestObject.voiceRuntime, 'bundleReportRef', 'voiceRuntime', {
    extensions: REPORT_EXTENSIONS,
  });
  validateEvidenceLink(manifestObject.voiceRuntime, 'deviceEvidenceRef', 'voiceRuntime');
  validateVoiceRuntimeBundleMetrics(manifestObject.voiceRuntime.bundleMetrics, 'voiceRuntime.bundleMetrics');
}

function validateVoiceRuntimeBundleMetrics(metrics, pointer) {
  if (!validateObject(metrics, pointer)) return;

  validateNonNegativeNumber(metrics, 'largestInitialJsKb', pointer);
  validateExpectedNumber(metrics, 'initialJsLimitKb', INITIAL_JS_LIMIT_KB, pointer);
  validatePositiveNumber(metrics, 'voiceRuntimeJsKb', pointer);
  validatePositiveNumber(metrics, 'voiceRuntimeGzipKb', pointer);
  validatePositiveNumber(metrics, 'onnxWasmKb', pointer);
  validatePositiveNumber(metrics, 'onnxWasmGzipKb', pointer);
  validateExpected(metrics, 'voiceRuntimeLoad', 'on demand', pointer);
  validateExpected(metrics, 'onnxWasmLoad', 'on demand', pointer);
  validateExpected(metrics, 'distHtmlPreloadsVoiceRuntime', false, pointer);

  const largestInitialJsKb = metrics.largestInitialJsKb;
  if (
    typeof largestInitialJsKb === 'number'
    && Number.isFinite(largestInitialJsKb)
    && largestInitialJsKb > INITIAL_JS_LIMIT_KB
  ) {
    addError(`${pointer}.largestInitialJsKb`, `must be <= ${INITIAL_JS_LIMIT_KB}`);
  }

  validateSizePair(metrics, 'voiceRuntimeGzipKb', 'voiceRuntimeJsKb', pointer);
  validateSizePair(metrics, 'onnxWasmGzipKb', 'onnxWasmKb', pointer);
}

function validateSizePair(metrics, gzipKey, sizeKey, pointer) {
  const gzipValue = metrics[gzipKey];
  const sizeValue = metrics[sizeKey];
  if (
    typeof gzipValue === 'number'
    && Number.isFinite(gzipValue)
    && typeof sizeValue === 'number'
    && Number.isFinite(sizeValue)
    && gzipValue > sizeValue
  ) {
    addError(`${pointer}.${gzipKey}`, `must be <= ${sizeKey}`);
  }
}

validateManifestRoot(manifest);
validateBuildArtifact(manifest);
validateWearingState(manifest);
validateLifecycle(manifest);
validateHud(manifest);
validateAssist(manifest);
validateAudioSources(manifest);
validateDelayedProxy(manifest);
validateVoiceRuntime(manifest);

const maxDisplayedFindings = verbose ? Number.POSITIVE_INFINITY : 25;

function printFindings(kind, findings, writer) {
  const visibleFindings = findings.slice(0, maxDisplayedFindings);
  for (const finding of visibleFindings) {
    writer(`[hardware-qa] ${kind} ${finding}`);
  }
  if (findings.length > visibleFindings.length) {
    writer(
      `[hardware-qa] ${findings.length - visibleFindings.length} more ${kind}(s) hidden; rerun with --verbose to print all`,
    );
  }
}

if (warnings.length > 0) {
  if (allowDraft && !verbose) {
    console.info(`[hardware-qa] ${warnings.length} draft placeholder warning(s); rerun with --verbose to print all`);
  } else {
    printFindings('warning', warnings, console.warn);
  }
}

const displayPath = path.relative(process.cwd(), targetPath) || targetPath;
if (errors.length > 0) {
  printFindings('error', errors, console.error);
  console.error(`[hardware-qa] ${errors.length} error(s) found in ${displayPath}`);
  process.exit(1);
}

const modeLabel = allowDraft ? 'draft template shape accepted' : 'final hardware QA accepted';
console.info(`[hardware-qa] ${modeLabel}: ${displayPath}`);
