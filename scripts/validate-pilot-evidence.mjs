#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_CONDITIONS = ['A', 'B', 'C'];
const REQUIRED_VAD_ENVIRONMENTS = ['quiet_room', 'cafe_background', 'air_conditioner', 'outdoor_wind'];
const NOISY_VAD_ENVIRONMENTS = ['cafe_background', 'air_conditioner', 'outdoor_wind'];

const SYSTEM_METRICS = [
  { key: 'g2MicSuccessRate', min: 0, max: 1 },
  { key: 'phoneFallbackRate', min: 0, max: 1 },
  { key: 'falseSilenceDetectionRatePerMinute', min: 0 },
  { key: 'missedSpeechRate', min: 0, max: 1 },
  { key: 'cueP50LatencyMs', min: 0 },
  { key: 'cueP95LatencyMs', min: 0 },
  { key: 'crashCount', min: 0 },
  { key: 'reconnectCount', min: 0 },
  { key: 'batteryConsumptionPercent', min: 0, max: 100 },
];

const UX_METRICS = [
  { key: 'timeToFirstUtteranceMs', min: 0 },
  { key: 'cueUsageRate', min: 0, max: 1 },
  { key: 'cueDismissalRate', min: 0, max: 1 },
  { key: 'falseCueRate', min: 0, max: 1 },
  { key: 'phoneChecks', min: 0 },
  { key: 'eyeContactBreaks', min: 0 },
  { key: 'interruptionRating', min: 1, max: 7 },
  { key: 'trustRating', min: 1, max: 7 },
  { key: 'privacyConcernRating', min: 1, max: 7 },
];

const VAD_METRICS = [
  { key: 'vadSpeechThreshold', min: 0 },
  { key: 'vadNoiseFloorRms', min: 0 },
  { key: 'vadSpeechFloorRms', min: 0 },
  { key: 'falseStarts', min: 0 },
  { key: 'missedSpeechEvents', min: 0 },
];

const NO_ASSIST_SYSTEM_ZERO_METRICS = ['cueP50LatencyMs', 'cueP95LatencyMs'];
const NO_ASSIST_UX_ZERO_METRICS = ['cueUsageRate', 'cueDismissalRate', 'falseCueRate'];
const CONDITION_MODE_REQUIREMENTS = {
  A: /no\s+assistance/i,
  B: /full\s+sentence\s+suggestion/i,
  C: /3\s*[-–]\s*5\s+word\s+cue/i,
};

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /^TBD$/i,
  /^TODO$/i,
  /^N\/A$/i,
  /^placeholder$/i,
  /^fill/i,
  /^https?:\/\/example\.com/i,
];

const CASE_STUDY_EXTENSIONS = ['md', 'html', 'pdf'];
const ARCHITECTURE_EXTENSIONS = ['md', 'html', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'svg'];
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv'];

const args = process.argv.slice(2);
const allowDraft = args.includes('--allow-draft');
const verbose = args.includes('--verbose');
const wantsHelp = args.includes('--help') || args.includes('-h');
const targetArg = args.find((arg) => !arg.startsWith('--'));

if (wantsHelp || !targetArg) {
  console.info(`Usage: npm run validate:pilot-evidence -- <pilot-evidence.json> [--allow-draft] [--verbose]

Validates the Project ECHO real-device pilot evidence manifest.

Without --allow-draft, placeholders, missing metric values, missing artifact
links, and incomplete case-study links fail the command. Use --allow-draft only
for the checked-in template shape. Use --verbose to print every finding.`);
  process.exit(wantsHelp ? 0 : 1);
}

const targetPath = path.resolve(process.cwd(), targetArg);
let manifest;

try {
  manifest = JSON.parse(readFileSync(targetPath, 'utf8'));
} catch (error) {
  console.error(`[pilot-evidence] could not read ${targetArg}: ${error.message}`);
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlaceholder(value) {
  if (typeof value !== 'string') {
    return false;
  }
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

  const extensions = options.extensions ?? CASE_STUDY_EXTENSIONS;
  if (!looksLikeEvidenceLink(value, extensions)) {
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

function looksLikeEvidenceLink(value, extensions) {
  const trimmed = value.trim();
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

function validateBooleanTrue(object, key, pointer) {
  const fieldPointer = `${pointer}.${key}`;
  if (!hasOwn(object, key)) {
    addError(fieldPointer, 'missing required field');
    return;
  }

  if (object[key] === true) {
    return;
  }

  if (allowDraft) {
    addWarning(fieldPointer, 'draft value is not true yet');
    return;
  }

  addError(fieldPointer, 'must be true for final evidence');
}

function validateNumberMetric(object, metric, pointer) {
  const fieldPointer = `${pointer}.${metric.key}`;
  if (!hasOwn(object, metric.key)) {
    addError(fieldPointer, 'missing required metric');
    return;
  }

  const value = object[metric.key];
  if (allowDraft && (value === null || value === 'TBD')) {
    addWarning(fieldPointer, 'draft metric is not filled yet');
    return;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    addError(fieldPointer, 'must be a finite number');
    return;
  }

  if (metric.min !== undefined && value < metric.min) {
    addError(fieldPointer, `must be >= ${metric.min}`);
  }

  if (metric.max !== undefined && value > metric.max) {
    addError(fieldPointer, `must be <= ${metric.max}`);
  }
}

function validateMetricGroup(object, metrics, pointer) {
  if (!validateObject(object, pointer)) {
    return;
  }

  for (const metric of metrics) {
    validateNumberMetric(object, metric, pointer);
  }
}

function validateMetricEquals(object, key, expected, pointer) {
  const fieldPointer = `${pointer}.${key}`;
  if (!isPlainObject(object) || !hasOwn(object, key)) {
    return;
  }

  const value = object[key];
  if (allowDraft && (value === null || value === 'TBD')) {
    return;
  }

  if (typeof value === 'number' && Number.isFinite(value) && value !== expected) {
    addError(fieldPointer, `must be ${expected} for condition A no-assistance evidence`);
  }
}

function validateConditionSemantics(condition, systemMetrics, uxMetrics, pointer) {
  validateCueLatencyConsistency(condition, systemMetrics, `${pointer}.systemMetrics`);

  if (condition === 'A') {
    for (const key of NO_ASSIST_SYSTEM_ZERO_METRICS) {
      validateMetricEquals(systemMetrics, key, 0, `${pointer}.systemMetrics`);
    }

    for (const key of NO_ASSIST_UX_ZERO_METRICS) {
      validateMetricEquals(uxMetrics, key, 0, `${pointer}.uxMetrics`);
    }
  }
}

function validateCueLatencyConsistency(condition, systemMetrics, pointer) {
  if (!isPlainObject(systemMetrics)) {
    return;
  }

  const p50 = systemMetrics.cueP50LatencyMs;
  const p95 = systemMetrics.cueP95LatencyMs;

  if (allowDraft && ([p50, p95].some((value) => value === null || value === 'TBD'))) {
    return;
  }

  if (
    typeof p50 === 'number'
    && Number.isFinite(p50)
    && typeof p95 === 'number'
    && Number.isFinite(p95)
  ) {
    if (p95 < p50) {
      addError(`${pointer}.cueP95LatencyMs`, 'must be >= cueP50LatencyMs');
    }

    if (condition !== 'A' && p50 <= 0) {
      addError(`${pointer}.cueP50LatencyMs`, `must be > 0 for condition ${condition} assist evidence`);
    }

    if (condition !== 'A' && p95 <= 0) {
      addError(`${pointer}.cueP95LatencyMs`, `must be > 0 for condition ${condition} assist evidence`);
    }
  }
}

function validateConditionMode(condition, mode, pointer) {
  const requirement = CONDITION_MODE_REQUIREMENTS[condition];
  if (!requirement) {
    return;
  }

  if (allowDraft && (mode === null || isPlaceholder(mode))) {
    return;
  }

  if (typeof mode !== 'string' || !requirement.test(mode)) {
    addError(`${pointer}.mode`, `must match condition ${condition} expected mode`);
  }
}

function validateAggregateSampleSize(conditionAggregate, condition, pointer, participants) {
  const fieldPointer = `${pointer}.sampleSize`;
  if (!hasOwn(conditionAggregate, 'sampleSize')) {
    addError(fieldPointer, 'missing required sample size');
    return;
  }

  const value = conditionAggregate.sampleSize;
  if (allowDraft && (value === null || value === 'TBD')) {
    addWarning(fieldPointer, 'draft sample size is not filled yet');
    return;
  }

  if (!Number.isInteger(value)) {
    addError(fieldPointer, 'must be an integer');
    return;
  }

  if (value < 5) {
    addError(fieldPointer, 'must be >= 5');
  }

  const runCount = countParticipantRunsForCondition(participants, condition);
  if (runCount !== null && value !== runCount) {
    addError(fieldPointer, `must equal participant run count ${runCount}`);
  }
}

function countParticipantRunsForCondition(participants, condition) {
  if (!Array.isArray(participants)) return null;

  let count = 0;
  for (const participant of participants) {
    if (!participant || !Array.isArray(participant.runs)) continue;
    count += participant.runs.filter((run) => run && run.condition === condition).length;
  }
  return count;
}

function requireConditionSet(values, pointer) {
  if (!Array.isArray(values)) {
    addError(pointer, 'expected an array');
    return;
  }

  if (values.length !== REQUIRED_CONDITIONS.length) {
    addError(pointer, `must contain exactly ${REQUIRED_CONDITIONS.length} conditions`);
  }

  for (const condition of REQUIRED_CONDITIONS) {
    const count = values.filter((value) => value === condition).length;
    if (count === 0) {
      addError(pointer, `missing condition ${condition}`);
    } else if (count > 1) {
      addError(pointer, `condition ${condition} must appear exactly once`);
    }
  }

  for (const value of values) {
    if (!REQUIRED_CONDITIONS.includes(value)) {
      addError(pointer, `unexpected condition ${String(value)}`);
    }
  }
}

function validateRun(run, pointer) {
  if (!validateObject(run, pointer)) {
    return;
  }

  validateText(run, 'condition', pointer);
  if (typeof run.condition === 'string' && !REQUIRED_CONDITIONS.includes(run.condition)) {
    addError(`${pointer}.condition`, 'must be one of A, B, or C');
  }

  validateText(run, 'mode', pointer);
  validateConditionMode(run.condition, run.mode, pointer);
  validateMetricGroup(run.systemMetrics, SYSTEM_METRICS, `${pointer}.systemMetrics`);
  validateMetricGroup(run.uxMetrics, UX_METRICS, `${pointer}.uxMetrics`);
  validateConditionSemantics(run.condition, run.systemMetrics, run.uxMetrics, pointer);

  if (validateObject(run.artifacts, `${pointer}.artifacts`)) {
    validateText(run.artifacts, 'qaExportPath', `${pointer}.artifacts`);
    validateText(run.artifacts, 'observerNotesPath', `${pointer}.artifacts`);
    validateEvidenceLink(run.artifacts, 'videoEvidence', `${pointer}.artifacts`, {
      extensions: VIDEO_EXTENSIONS,
    });
  }
}

function validateParticipant(participant, index) {
  const pointer = `participants[${index}]`;
  if (!validateObject(participant, pointer)) {
    return;
  }

  validateText(participant, 'id', pointer);
  validateBooleanTrue(participant, 'consentRecorded', pointer);
  validateText(participant, 'scenario', pointer);
  requireConditionSet(participant.order, `${pointer}.order`);

  if (!Array.isArray(participant.runs)) {
    addError(`${pointer}.runs`, 'expected an array');
    return;
  }

  requireConditionSet(
    participant.runs.map((run) => run && run.condition),
    `${pointer}.runs[].condition`,
  );

  participant.runs.forEach((run, runIndex) => validateRun(run, `${pointer}.runs[${runIndex}]`));
}

function validateAggregate(manifestObject) {
  if (!validateObject(manifestObject.aggregate, 'aggregate')) {
    return;
  }

  if (!validateObject(manifestObject.aggregate.conditions, 'aggregate.conditions')) {
    return;
  }

  for (const condition of REQUIRED_CONDITIONS) {
    const conditionPointer = `aggregate.conditions.${condition}`;
    const conditionAggregate = manifestObject.aggregate.conditions[condition];
    if (!validateObject(conditionAggregate, conditionPointer)) {
      continue;
    }
    validateAggregateSampleSize(conditionAggregate, condition, conditionPointer, manifestObject.participants);
    validateMetricGroup(conditionAggregate.systemMetrics, SYSTEM_METRICS, `${conditionPointer}.systemMetrics`);
    validateMetricGroup(conditionAggregate.uxMetrics, UX_METRICS, `${conditionPointer}.uxMetrics`);
    validateConditionSemantics(
      condition,
      conditionAggregate.systemMetrics,
      conditionAggregate.uxMetrics,
      conditionPointer,
    );
    validateText(conditionAggregate, 'decision', conditionPointer);
  }
}

function validateVadCalibration(manifestObject) {
  if (!validateObject(manifestObject.vadCalibration, 'vadCalibration')) {
    return;
  }

  if (!Array.isArray(manifestObject.vadCalibration.environments)) {
    addError('vadCalibration.environments', 'expected an array');
    return;
  }

  const environmentNames = manifestObject.vadCalibration.environments.map(
    (environment) => environment && environment.name,
  );

  for (const environmentName of REQUIRED_VAD_ENVIRONMENTS) {
    if (!environmentNames.includes(environmentName)) {
      addError('vadCalibration.environments', `missing environment ${environmentName}`);
    }
  }

  manifestObject.vadCalibration.environments.forEach((environment, index) => {
    const pointer = `vadCalibration.environments[${index}]`;
    if (!validateObject(environment, pointer)) {
      return;
    }

    validateText(environment, 'name', pointer);
    if (typeof environment.name === 'string' && !REQUIRED_VAD_ENVIRONMENTS.includes(environment.name)) {
      addError(`${pointer}.name`, `must be one of ${REQUIRED_VAD_ENVIRONMENTS.join(', ')}`);
    }

    validateMetricGroup(environment.metrics, VAD_METRICS, `${pointer}.metrics`);
    validateVadMetricRelationships(environment.metrics, `${pointer}.metrics`);
    validateText(environment, 'qaExportPath', pointer);
    validateText(environment, 'notes', pointer);
  });

  validateVadEnvironmentRelationships(manifestObject.vadCalibration.environments);
}

function validateVadMetricRelationships(metrics, pointer) {
  if (!isPlainObject(metrics)) return;

  const {
    vadSpeechThreshold,
    vadNoiseFloorRms,
    vadSpeechFloorRms,
  } = metrics;

  if (
    allowDraft
    && [vadSpeechThreshold, vadNoiseFloorRms, vadSpeechFloorRms].some(
      (value) => value === null || value === 'TBD',
    )
  ) {
    return;
  }

  if (
    ![vadSpeechThreshold, vadNoiseFloorRms, vadSpeechFloorRms].every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    )
  ) {
    return;
  }

  if (vadSpeechFloorRms <= vadNoiseFloorRms) {
    addError(`${pointer}.vadSpeechFloorRms`, 'must be greater than vadNoiseFloorRms');
  }

  if (vadSpeechThreshold < vadNoiseFloorRms) {
    addError(`${pointer}.vadSpeechThreshold`, 'must be >= vadNoiseFloorRms');
  }

  if (vadSpeechThreshold > vadSpeechFloorRms) {
    addError(`${pointer}.vadSpeechThreshold`, 'must be <= vadSpeechFloorRms');
  }
}

function validateVadEnvironmentRelationships(environments) {
  const byName = new Map();
  for (const environment of environments) {
    if (environment && typeof environment.name === 'string') {
      byName.set(environment.name, environment);
    }
  }

  const quiet = byName.get('quiet_room');
  if (!quiet || !isPlainObject(quiet.metrics)) return;

  const quietNoise = quiet.metrics.vadNoiseFloorRms;
  const quietThreshold = quiet.metrics.vadSpeechThreshold;
  if (
    ![quietNoise, quietThreshold].every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    )
  ) {
    return;
  }

  for (const environmentName of NOISY_VAD_ENVIRONMENTS) {
    const environment = byName.get(environmentName);
    if (!environment || !isPlainObject(environment.metrics)) continue;

    const pointer = `vadCalibration.environments.${environmentName}.metrics`;
    const noise = environment.metrics.vadNoiseFloorRms;
    const threshold = environment.metrics.vadSpeechThreshold;

    if (typeof noise === 'number' && Number.isFinite(noise) && noise < quietNoise) {
      addError(`${pointer}.vadNoiseFloorRms`, 'must be >= quiet_room vadNoiseFloorRms');
    }

    if (typeof threshold === 'number' && Number.isFinite(threshold) && threshold < quietThreshold) {
      addError(`${pointer}.vadSpeechThreshold`, 'must be >= quiet_room vadSpeechThreshold');
    }
  }
}

function validateManifest(manifestObject) {
  if (!validateObject(manifestObject, 'manifest')) {
    return;
  }

  validateText(manifestObject, 'project', 'manifest', { includes: 'ECHO' });
  validateText(manifestObject, 'pilotDate', 'manifest');
  validateText(manifestObject, 'evidenceStatus', 'manifest');

  if (!allowDraft && manifestObject.evidenceStatus !== 'complete') {
    addError('manifest.evidenceStatus', 'must be "complete" for final evidence');
  }

  if (validateObject(manifestObject.hardware, 'hardware')) {
    validateText(manifestObject.hardware, 'device', 'hardware', { includes: 'G2' });
    validateText(manifestObject.hardware, 'firmwareVersion', 'hardware');
    validateText(manifestObject.hardware, 'appVersion', 'hardware');
    validateText(manifestObject.hardware, 'bridgeVersion', 'hardware');
  }

  if (!Array.isArray(manifestObject.participants)) {
    addError('participants', 'expected an array with at least 5 users');
  } else {
    if (manifestObject.participants.length < 5) {
      addError('participants', 'must include at least 5 real-device users');
    }

    const seenIds = new Set();
    manifestObject.participants.forEach((participant, index) => {
      validateParticipant(participant, index);
      if (participant && typeof participant.id === 'string') {
        if (seenIds.has(participant.id)) {
          addError(`participants[${index}].id`, 'participant id must be unique');
        }
        seenIds.add(participant.id);
      }
    });
  }

  validateVadCalibration(manifestObject);
  validateAggregate(manifestObject);

  if (validateObject(manifestObject.caseStudy, 'caseStudy')) {
    validateEvidenceLink(manifestObject.caseStudy, 'koreanCaseStudyUrl', 'caseStudy');
    validateEvidenceLink(manifestObject.caseStudy, 'englishCaseStudyUrl', 'caseStudy');
    validateEvidenceLink(manifestObject.caseStudy, 'architectureDiagramUrl', 'caseStudy', {
      extensions: ARCHITECTURE_EXTENSIONS,
    });
    validateEvidenceLink(manifestObject.caseStudy, 'realG2VideoUrl', 'caseStudy', {
      extensions: VIDEO_EXTENSIONS,
    });
    validateBooleanTrue(manifestObject.caseStudy, 'readmeLinksUpdated', 'caseStudy');
  }
}

validateManifest(manifest);

const displayPath = path.relative(process.cwd(), targetPath) || targetPath;
const maxDisplayedFindings = verbose ? Number.POSITIVE_INFINITY : 25;

function printFindings(kind, findings, writer) {
  const visibleFindings = findings.slice(0, maxDisplayedFindings);
  for (const finding of visibleFindings) {
    writer(`[pilot-evidence] ${kind} ${finding}`);
  }

  if (findings.length > visibleFindings.length) {
    writer(
      `[pilot-evidence] ${findings.length - visibleFindings.length} more ${kind}(s) hidden; rerun with --verbose to print all`,
    );
  }
}

if (warnings.length > 0) {
  if (allowDraft && !verbose) {
    console.info(
      `[pilot-evidence] ${warnings.length} draft placeholder warning(s); rerun with --verbose to print all`,
    );
  } else {
    printFindings('warning', warnings, console.warn);
  }
}

if (errors.length > 0) {
  printFindings('error', errors, console.error);
  console.error(`[pilot-evidence] ${errors.length} error(s) found in ${displayPath}`);
  process.exit(1);
}

const modeLabel = allowDraft ? 'draft template shape accepted' : 'final evidence accepted';
console.info(`[pilot-evidence] ${modeLabel}: ${displayPath}`);
