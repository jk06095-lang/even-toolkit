#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function percent(part, total) {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

function formatMs(value) {
  return Number.isFinite(value) ? `${Math.round(value)}ms` : 'n/a';
}

function formatNumber(value, digits = 4) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : 'n/a';
}

function formatTimestamp(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : 'n/a';
}

function sessionWeight(session) {
  return Math.max(1, numberOrNull(session.cueLatencyCount) ?? 0);
}

function weightedAverage(sessions, field) {
  let weightedTotal = 0;
  let weightTotal = 0;
  for (const session of sessions) {
    const value = numberOrNull(session[field]);
    if (value === null) continue;
    const weight = sessionWeight(session);
    weightedTotal += value * weight;
    weightTotal += weight;
  }
  return weightTotal ? weightedTotal / weightTotal : null;
}

function groupBy(sessions, keyFn) {
  const groups = new Map();
  for (const session of sessions) {
    const key = keyFn(session);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(session);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function safeSessions(exportPayloads) {
  return exportPayloads.flatMap((payload) => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.eventAnalytics)) return payload.eventAnalytics;
    return [];
  }).filter((session) => session && typeof session === 'object');
}

function summarizeSessions(sessions) {
  const sessionCount = sessions.length;
  const bridgeCount = sessions.filter((s) => s.audioSource === 'bridge').length;
  const browserCount = sessions.filter((s) => s.audioSource === 'browser').length;
  const cueLatencyMaxValues = sessions
    .map((s) => numberOrNull(s.cueLatencyMaxMs))
    .filter((value) => value !== null);
  const cueLatencyMax = cueLatencyMaxValues.length > 0
    ? Math.max(...cueLatencyMaxValues)
    : null;

  return {
    sessionCount,
    bridgeCount,
    browserCount,
    g2MicSuccessRate: percent(bridgeCount, sessionCount),
    phoneFallbackRate: percent(browserCount, sessionCount),
    speechCount: sum(sessions.map((s) => numberOrNull(s.speechCount) ?? 0)),
    silenceCount: sum(sessions.map((s) => numberOrNull(s.silenceCount) ?? 0)),
    cueCount: sum(sessions.map((s) => numberOrNull(s.hintCount) ?? 0)),
    cueUsedCount: sum(sessions.map((s) => numberOrNull(s.cueUsedCount ?? s.hintUsedCount) ?? 0)),
    cueDismissedCount: sum(sessions.map((s) => numberOrNull(s.cueDismissedCount) ?? 0)),
    falseTriggerCount: sum(sessions.map((s) => numberOrNull(s.falseTriggerCount) ?? 0)),
    autoAssistSignalEvidenceCount: sum(sessions.map((s) => numberOrNull(s.autoAssistSignalEvidenceCount) ?? 0)),
    autoAssistBlockedCount: sum(sessions.map((s) => (
      (numberOrNull(s.autoAssistInsufficientSignalCount) ?? 0) +
      (numberOrNull(s.autoAssistPartnerBlockedCount) ?? 0) +
      (numberOrNull(s.autoAssistDismissBlockedCount) ?? 0) +
      (numberOrNull(s.autoAssistSessionCapBlockedCount) ?? 0)
    ))),
    avgCueP50Ms: weightedAverage(sessions, 'cueLatencyP50Ms'),
    avgCueP95Ms: weightedAverage(sessions, 'cueLatencyP95Ms'),
    cueLatencyMaxMs: cueLatencyMax,
    avgSilenceDurationMs: weightedAverage(sessions, 'avgSilenceDurationMs'),
    avgSelfResponseRate: weightedAverage(sessions, 'selfResponseRate'),
  };
}

function summarizeCalibration(sessions) {
  return sessions
    .filter((session) => numberOrNull(session.vadSpeechThreshold) !== null)
    .map((session) => ({
      sessionId: session.sessionId ?? 'unknown',
      topic: session.topic ?? 'unknown',
      audioSource: session.audioSource ?? 'unknown',
      threshold: numberOrNull(session.vadSpeechThreshold),
      noiseFloor: numberOrNull(session.vadNoiseFloorRms),
      speechFloor: numberOrNull(session.vadSpeechFloorRms),
      calibratedAt: numberOrNull(session.vadCalibratedAt),
    }));
}

export function buildQaExportSummary(exportPayloads) {
  const sessions = safeSessions(exportPayloads);
  return {
    generatedAt: new Date().toISOString(),
    overall: summarizeSessions(sessions),
    byCategory: groupBy(sessions, (session) => session.category ?? 'unknown')
      .map(([category, groupedSessions]) => ({
        category,
        ...summarizeSessions(groupedSessions),
      })),
    byTopic: groupBy(sessions, (session) => session.topic ?? 'unknown')
      .map(([topic, groupedSessions]) => ({
        topic,
        ...summarizeSessions(groupedSessions),
      })),
    calibration: summarizeCalibration(sessions),
  };
}

function renderSummaryRow(label, summary) {
  return [
    label,
    String(summary.sessionCount),
    summary.g2MicSuccessRate,
    summary.phoneFallbackRate,
    formatMs(summary.avgCueP50Ms),
    formatMs(summary.avgCueP95Ms),
    formatMs(summary.cueLatencyMaxMs),
    String(summary.cueUsedCount),
    String(summary.cueDismissedCount),
    String(summary.falseTriggerCount),
    String(summary.autoAssistSignalEvidenceCount),
    String(summary.autoAssistBlockedCount),
    formatMs(summary.avgSilenceDurationMs),
    Number.isFinite(summary.avgSelfResponseRate) ? `${Math.round(summary.avgSelfResponseRate)}%` : 'n/a',
  ].join(' | ');
}

export function renderQaExportMarkdown(summary) {
  const lines = [
    '# ECHO QA Export Summary',
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    '## Overall',
    '',
    '| Segment | Sessions | G2 mic | Phone fallback | Cue p50 | Cue p95 | Cue max | Cue used | Cue dismissed | False cues | Auto evals | Auto blocked | Avg silence | Self response |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${renderSummaryRow('All sessions', summary.overall)} |`,
    '',
    '## By Category',
    '',
    '| Category | Sessions | G2 mic | Phone fallback | Cue p50 | Cue p95 | Cue max | Cue used | Cue dismissed | False cues | Auto evals | Auto blocked | Avg silence | Self response |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...summary.byCategory.map((row) => `| ${renderSummaryRow(row.category, row)} |`),
    '',
    '## By Topic',
    '',
    '| Topic | Sessions | G2 mic | Phone fallback | Cue p50 | Cue p95 | Cue max | Cue used | Cue dismissed | False cues | Auto evals | Auto blocked | Avg silence | Self response |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...summary.byTopic.map((row) => `| ${renderSummaryRow(row.topic, row)} |`),
    '',
    '## Calibration Evidence',
    '',
    '| Session | Topic | Audio | VAD threshold | Noise floor | Speech floor | Calibrated at |',
    '| --- | --- | --- | ---: | ---: | ---: | --- |',
    ...summary.calibration.map((row) => [
      row.sessionId,
      row.topic,
      row.audioSource,
      formatNumber(row.threshold),
      formatNumber(row.noiseFloor),
      formatNumber(row.speechFloor),
      formatTimestamp(row.calibratedAt),
    ].join(' | ')).map((row) => `| ${row} |`),
  ];

  if (summary.calibration.length === 0) {
    lines.push('| n/a | n/a | n/a | n/a | n/a | n/a | n/a |');
  }

  lines.push(
    '',
    'Note: cue p50/p95 are session-weighted summaries from exported eventAnalytics. Raw utterances, cue text, and audio payloads are not read or printed by this tool.',
  );

  return `${lines.join('\n')}\n`;
}

async function readJsonFile(filePath) {
  const raw = (await readFile(filePath, 'utf8')).replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

async function main(argv) {
  const files = argv.filter((arg) => !arg.startsWith('-'));
  if (files.length === 0) {
    console.error('Usage: node scripts/summarize-qa-export.mjs <echo_my_data.json> [more.json]');
    process.exitCode = 1;
    return;
  }

  const payloads = [];
  for (const file of files) {
    payloads.push(await readJsonFile(file));
  }

  const summary = buildQaExportSummary(payloads);
  process.stdout.write(renderQaExportMarkdown(summary));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
