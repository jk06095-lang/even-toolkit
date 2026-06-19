#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_HUD_STATES = ['READY', 'LISTENING', 'CUE', 'PAUSED'];
const REQUIRED_DELAYED_PROXY_SCENARIOS = ['endPractice', 'pause', 'exitEcho'];
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
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv'];
const LOG_EXTENSIONS = ['md', 'txt', 'log', 'json'];
const REPORT_EXTENSIONS = ['md', 'txt', 'log', 'json'];

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
    validateText(manifestObject.device, 'bridgeVersion', 'device');
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
  validateEvidenceLink(manifestObject.assist, 'evidenceRef', 'assist');
}

function validateDelayedProxy(manifestObject) {
  if (!validateObject(manifestObject.delayedProxy, 'delayedProxy')) return;
  if (!validateObject(manifestObject.delayedProxy.scenarios, 'delayedProxy.scenarios')) return;

  for (const scenario of REQUIRED_DELAYED_PROXY_SCENARIOS) {
    const pointer = `delayedProxy.scenarios.${scenario}`;
    if (!validateObject(manifestObject.delayedProxy.scenarios[scenario], pointer)) continue;
    validateExpected(manifestObject.delayedProxy.scenarios[scenario], 'abortObserved', true, pointer);
    validateExpected(manifestObject.delayedProxy.scenarios[scenario], 'lateResponseIgnored', true, pointer);
    validateExpected(manifestObject.delayedProxy.scenarios[scenario], 'hudUnchanged', true, pointer);
    validateExpected(manifestObject.delayedProxy.scenarios[scenario], 'phoneCueUnchanged', true, pointer);
    validateEvidenceLink(manifestObject.delayedProxy.scenarios[scenario], 'evidenceRef', pointer);
  }

  validateExpected(manifestObject.delayedProxy, 'latencyMetadataVisible', true, 'delayedProxy');
  validateExpected(manifestObject.delayedProxy, 'noRawTranscriptInLogs', true, 'delayedProxy');
  validateEvidenceLink(manifestObject.delayedProxy, 'debugLogRef', 'delayedProxy', {
    extensions: LOG_EXTENSIONS,
  });
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
}

validateManifestRoot(manifest);
validateLifecycle(manifest);
validateHud(manifest);
validateAssist(manifest);
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
