#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PLACEHOLDER_PATTERNS = [
  /^$/,
  /^TBD$/i,
  /^TODO$/i,
  /^N\/A$/i,
  /^placeholder$/i,
  /^fill/i,
  /^https?:\/\/example\.com/i,
  /^<.*>$/,
];

const REQUIRED_SECTIONS = [
  'Rotation Date',
  'Rotated Provider Keys',
  'Production Log Review',
  'Deployment Smoke Evidence',
  'Artifact Scan Evidence',
  'Follow-up Owner',
];

const REQUIRED_FIELDS = [
  'Date',
  'Rotation owner',
  'Production proxy URL',
  'Client build or package version',
  'Provider',
  'Previous key location removed from',
  'New key location',
  'Server secret manager reference',
  'Browser artifact key scan result',
  'Reviewed time window',
  'Log source',
  'Log allowlist confirmation',
  'Raw transcript/audio log exclusion',
  'Deployment smoke command result',
  '/healthz configured true',
  'Allowed origin passed',
  'Untrusted origin blocked',
  'Safe non-echoing error response verified',
  'even-app/dist scan result',
  'even-app/echo.ehpk scan result',
  'Direct provider hostname scan result',
  'Development IP scan result',
  'Follow-up owner',
  'Follow-up issue or ticket',
  'Notes',
];

const TRUE_CONFIRMATION_FIELDS = [
  'Log allowlist confirmation',
  'Raw transcript/audio log exclusion',
  '/healthz configured true',
  'Allowed origin passed',
  'Untrusted origin blocked',
  'Safe non-echoing error response verified',
];

const CLEAN_SCAN_FIELDS = [
  'Browser artifact key scan result',
  'even-app/dist scan result',
  'even-app/echo.ehpk scan result',
  'Direct provider hostname scan result',
  'Development IP scan result',
];

const POSITIVE_EVIDENCE_PATTERNS = [
  /\btrue\b/i,
  /\bpass(?:ed)?\b/i,
  /\bconfirmed\b/i,
  /\bverified\b/i,
  /\byes\b/i,
];

const CLEAN_SCAN_PATTERNS = [
  /\b0\s+matches?\b/i,
  /\bno\s+matches?\b/i,
  /\bnone\s+found\b/i,
  /\bnot\s+found\b/i,
  /\bclean\b/i,
  /\bpass(?:ed)?\b/i,
];

const SECRET_PATTERNS = [
  { name: 'Gemini API key', pattern: /AIza[0-9A-Za-z_-]{20,}/ },
  { name: 'GitHub token', pattern: /gh[pousr]_[0-9A-Za-z_]{20,}/ },
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'bearer token', pattern: /\bBearer\s+[0-9A-Za-z._~+/=-]{20,}/i },
];

const args = process.argv.slice(2);
const allowDraft = args.includes('--allow-draft');
const verbose = args.includes('--verbose');
const wantsHelp = args.includes('--help') || args.includes('-h');
const targetArg = args.find((arg) => !arg.startsWith('--'));

if (wantsHelp || !targetArg) {
  console.info(`Usage: npm run validate:key-rotation-evidence -- <evidence.md> [--allow-draft] [--verbose]

Validates the Project ECHO production proxy/key-rotation evidence file.

Without --allow-draft, all required sections and fields must be filled with
non-placeholder values, production smoke evidence must avoid local-only smoke
flags, and the evidence must not contain raw provider keys or tokens.`);
  process.exit(wantsHelp ? 0 : 1);
}

const targetPath = path.resolve(process.cwd(), targetArg);
let text;

try {
  text = readFileSync(targetPath, 'utf8');
} catch (error) {
  console.error(`[key-rotation] could not read ${targetArg}: ${error.message}`);
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

function isPlaceholder(value) {
  const trimmed = String(value ?? '').trim();
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function extractHeadings(markdown) {
  return new Set(
    markdown
      .split(/\r?\n/)
      .map((line) => line.match(/^##\s+(.+?)\s*$/)?.[1])
      .filter(Boolean),
  );
}

function extractFields(markdown) {
  const fields = new Map();
  const lines = markdown.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith('- ')) continue;

    let bullet = line.slice(2).trim();
    let nextIndex = index + 1;
    while (
      nextIndex < lines.length &&
      /^\s+/.test(lines[nextIndex]) &&
      !lines[nextIndex].trim().startsWith('- ') &&
      !lines[nextIndex].trim().startsWith('#')
    ) {
      bullet += ` ${lines[nextIndex].trim()}`;
      nextIndex += 1;
    }
    index = nextIndex - 1;

    const colonIndex = bullet.indexOf(':');
    if (colonIndex === -1) continue;

    const key = bullet.slice(0, colonIndex).replace(/\s+/g, ' ').trim();
    const value = bullet.slice(colonIndex + 1).trim();
    fields.set(key, value);
  }

  return fields;
}

const headings = extractHeadings(text);
const fields = extractFields(text);

for (const section of REQUIRED_SECTIONS) {
  if (!headings.has(section)) {
    addError(`section.${section}`, 'missing required section');
  }
}

for (const field of REQUIRED_FIELDS) {
  if (!fields.has(field)) {
    addError(`field.${field}`, 'missing required field');
    continue;
  }

  const value = fields.get(field);
  if (isPlaceholder(value)) {
    if (allowDraft) {
      addWarning(`field.${field}`, 'draft placeholder remains');
    } else {
      addError(`field.${field}`, 'must be filled with non-placeholder evidence');
    }
  }
}

const proxyUrl = fields.get('Production proxy URL') ?? '';
validateProductionProxyUrl(proxyUrl);

const smokeValue = fields.get('Deployment smoke command result') ?? '';
if (!allowDraft && !/smoke:deploy/.test(smokeValue)) {
  addError('field.Deployment smoke command result', 'must include the smoke:deploy command/result');
}

if (
  !allowDraft
  && !isPlaceholder(proxyUrl)
  && !isPlaceholder(smokeValue)
  && !smokeValue.includes(proxyUrl)
) {
  addError('field.Deployment smoke command result', 'must reference the Production proxy URL');
}

const forbiddenSmokeFlags = ['--allow-http', '--allow-unconfigured', '--allow-qa-delay'];
for (const flag of forbiddenSmokeFlags) {
  if (text.includes(flag)) {
    addError('deploymentSmoke', `must not include local-only smoke flag ${flag}`);
  }
}

for (const field of TRUE_CONFIRMATION_FIELDS) {
  validatePositiveEvidenceField(field);
}

for (const field of CLEAN_SCAN_FIELDS) {
  validateCleanScanField(field);
}

for (const { name, pattern } of SECRET_PATTERNS) {
  if (pattern.test(text)) {
    addError('secrets', `must not contain raw ${name}`);
  }
}

function validateProductionProxyUrl(value) {
  const pointer = 'field.Production proxy URL';
  if (allowDraft && isPlaceholder(value)) return;

  let url;
  try {
    url = new URL(value);
  } catch {
    addError(pointer, 'must be a valid production HTTPS URL');
    return;
  }

  if (url.protocol !== 'https:') {
    addError(pointer, 'must use https');
    return;
  }

  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host === '127.0.0.1'
    || host === '::1'
    || isPrivateIpv4(host)
  ) {
    addError(pointer, 'must not point to localhost or a private network host');
  }
}

function isPrivateIpv4(host) {
  const parts = host.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
  );
}

function validatePositiveEvidenceField(field) {
  const value = fields.get(field) ?? '';
  if (allowDraft && isPlaceholder(value)) return;
  if (!POSITIVE_EVIDENCE_PATTERNS.some((pattern) => pattern.test(value))) {
    addError(`field.${field}`, 'must include a positive confirmation such as true, passed, confirmed, or verified');
  }
}

function validateCleanScanField(field) {
  const value = fields.get(field) ?? '';
  if (allowDraft && isPlaceholder(value)) return;
  if (!CLEAN_SCAN_PATTERNS.some((pattern) => pattern.test(value))) {
    addError(`field.${field}`, 'must include clean scan evidence such as 0 matches, no matches, none found, clean, or passed');
  }
}

const maxDisplayedFindings = verbose ? Number.POSITIVE_INFINITY : 25;

function printFindings(kind, findings, writer) {
  const visibleFindings = findings.slice(0, maxDisplayedFindings);
  for (const finding of visibleFindings) {
    writer(`[key-rotation] ${kind} ${finding}`);
  }
  if (findings.length > visibleFindings.length) {
    writer(
      `[key-rotation] ${findings.length - visibleFindings.length} more ${kind}(s) hidden; rerun with --verbose to print all`,
    );
  }
}

if (warnings.length > 0) {
  if (allowDraft && !verbose) {
    console.info(`[key-rotation] ${warnings.length} draft placeholder warning(s); rerun with --verbose to print all`);
  } else {
    printFindings('warning', warnings, console.warn);
  }
}

const displayPath = path.relative(process.cwd(), targetPath) || targetPath;
if (errors.length > 0) {
  printFindings('error', errors, console.error);
  console.error(`[key-rotation] ${errors.length} error(s) found in ${displayPath}`);
  process.exit(1);
}

const modeLabel = allowDraft ? 'draft template shape accepted' : 'final key-rotation evidence accepted';
console.info(`[key-rotation] ${modeLabel}: ${displayPath}`);
