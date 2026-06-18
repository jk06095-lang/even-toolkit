#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_CONDITIONS = ['A', 'B', 'C'];

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

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /^TBD$/i,
  /^TODO$/i,
  /^N\/A$/i,
  /^placeholder$/i,
  /^fill/i,
  /^https?:\/\/example\.com/i,
];

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

function requireConditionSet(values, pointer) {
  if (!Array.isArray(values)) {
    addError(pointer, 'expected an array');
    return;
  }

  for (const condition of REQUIRED_CONDITIONS) {
    if (!values.includes(condition)) {
      addError(pointer, `missing condition ${condition}`);
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
  validateMetricGroup(run.systemMetrics, SYSTEM_METRICS, `${pointer}.systemMetrics`);
  validateMetricGroup(run.uxMetrics, UX_METRICS, `${pointer}.uxMetrics`);

  if (validateObject(run.artifacts, `${pointer}.artifacts`)) {
    validateText(run.artifacts, 'qaExportPath', `${pointer}.artifacts`);
    validateText(run.artifacts, 'observerNotesPath', `${pointer}.artifacts`);
    validateText(run.artifacts, 'videoEvidence', `${pointer}.artifacts`);
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
    validateMetricGroup(conditionAggregate.systemMetrics, SYSTEM_METRICS, `${conditionPointer}.systemMetrics`);
    validateMetricGroup(conditionAggregate.uxMetrics, UX_METRICS, `${conditionPointer}.uxMetrics`);
    validateText(conditionAggregate, 'decision', conditionPointer);
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

  validateAggregate(manifestObject);

  if (validateObject(manifestObject.caseStudy, 'caseStudy')) {
    validateText(manifestObject.caseStudy, 'koreanCaseStudyUrl', 'caseStudy');
    validateText(manifestObject.caseStudy, 'englishCaseStudyUrl', 'caseStudy');
    validateText(manifestObject.caseStudy, 'architectureDiagramUrl', 'caseStudy');
    validateText(manifestObject.caseStudy, 'realG2VideoUrl', 'caseStudy');
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
