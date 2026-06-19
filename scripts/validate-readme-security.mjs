#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const readmePath = path.resolve(repoRoot, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const errors = [];

function sectionBetween(startMarker, endMarker) {
  const start = readme.indexOf(startMarker);
  if (start === -1) {
    errors.push(`README missing ${startMarker}`);
    return '';
  }

  const end = readme.indexOf(endMarker, start + startMarker.length);
  if (end === -1) {
    errors.push(`README missing ${endMarker} after ${startMarker}`);
    return readme.slice(start);
  }

  return readme.slice(start, end);
}

function requireMatch(text, pattern, message) {
  if (!pattern.test(text)) errors.push(message);
}

function rejectMatch(text, pattern, message) {
  if (pattern.test(text)) errors.push(message);
}

const sttSection = sectionBetween('## Speech-to-Text (STT)', '## SDK 0.0.9 Support');
const productionSection = sectionBetween(
  '### Production Even Hub Pattern',
  '### Local Development Direct Provider',
);
const localDevSection = sectionBetween(
  '### Local Development Direct Provider',
  '### Audio Sources',
);

requireMatch(
  sttSection,
  /server-side STT\/AI proxy/,
  'STT docs must lead with the server-side proxy boundary.',
);
requireMatch(
  sttSection,
  /network\.whitelist/,
  'STT docs must mention app.json network whitelist for the proxy origin.',
);
requireMatch(
  sttSection,
  /whitelist is not a CORS bypass/,
  'STT docs must preserve the Even networking CORS warning.',
);
requireMatch(
  sttSection,
  /\.ehpk/,
  'STT docs must mention that packaged .ehpk artifacts cannot contain provider keys.',
);

rejectMatch(
  productionSection,
  /\bapiKey\s*:/,
  'Production STT pattern must not show a direct provider apiKey option.',
);
rejectMatch(
  productionSection,
  /your-(?:soniox|deepgram|openai|provider)-key/i,
  'Production STT pattern must not show placeholder provider keys.',
);
rejectMatch(
  productionSection,
  /\bVITE_[A-Z0-9_]*(?:API|KEY|TOKEN|SECRET)[A-Z0-9_]*\b/,
  'Production STT pattern must not suggest VITE provider key/token variables.',
);

requireMatch(
  productionSection,
  /Authorization:\s*`Bearer \$\{sessionToken\}`/,
  'Production STT pattern must show short-lived bearer session-token usage.',
);
requireMatch(
  localDevSection,
  /Local development only/,
  'Direct provider section must label apiKey usage as local development only.',
);
requireMatch(
  localDevSection,
  /Never ship|never ship/,
  'Direct provider section must explicitly say not to ship provider keys.',
);

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`[readme-security] ${error}`);
  }
  console.error(`[readme-security] ${errors.length} README security error(s) found`);
  process.exit(1);
}

console.info('[readme-security] README STT examples keep provider keys out of production Even Hub builds');
