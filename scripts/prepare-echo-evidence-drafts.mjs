#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const wantsHelp = args.includes('--help') || args.includes('-h');
const outDirArg = readOption('--out-dir') || 'docs/evidence-drafts';
const repoRoot = process.cwd();
const outDir = path.resolve(repoRoot, outDirArg);

if (wantsHelp) {
  console.info(`Usage: npm run prepare:echo-evidence-drafts -- [--out-dir docs/evidence-drafts]

Creates draft evidence manifests for the remaining Project ECHO readiness gates.
The command fills only local, reproducible fields such as app version, package
SHA-256, and bundle metrics when available. It does not create completed
evidence files and does not mark real-device, deployment, or key-rotation checks
as passed.`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

const appVersion = readJson('even-app/package.json')?.version ?? 'TBD';
const actionSpec = readJson('integrations/chatgpt-action/openapi.json') ?? {};
const hardware = readJson('docs/project-echo-hardware-qa.template.json');
const pilot = readJson('docs/project-echo-pilot-evidence.template.json');
const action = readJson('docs/project-echo-chatgpt-action-evidence.template.json');
const keyRotationTemplate = readFileSync(path.resolve(repoRoot, 'docs/key-rotation-evidence.template.md'), 'utf8');

const ARTIFACT_SCAN_PATHS = ['even-app/dist', 'even-app/echo.ehpk'];
const CLIENT_SECRET_PATTERNS = [
  { label: 'Gemini API key', pattern: /AIza[0-9A-Za-z_-]{20,}/g },
  { label: 'OpenAI-style API key', pattern: /sk-[A-Za-z0-9]{20,}/g },
  { label: 'bearer token', pattern: /\bBearer\s+[0-9A-Za-z._~+/=-]{20,}/gi },
  { label: 'Project ECHO signed session token', pattern: /echo1\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g },
  { label: 'VITE_GEMINI_API_KEY reference', pattern: /\bVITE_GEMINI_API_KEY\b/g },
];
const SESSION_TOKEN_PATTERNS = [
  { label: 'Project ECHO signed session token', pattern: /echo1\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g },
];
const PROVIDER_HOST_PATTERNS = [
  { label: 'direct Gemini API hostname', pattern: /generativelanguage\.googleapis\.com/gi },
  { label: 'direct Google GenAI package reference', pattern: /@google\/genai/gi },
];
const DEVELOPMENT_HOST_PATTERNS = [
  { label: 'localhost', pattern: /\blocalhost\b/gi },
  { label: 'loopback IP', pattern: /\b127\.0\.0\.1\b/g },
  { label: 'private 10.x IP', pattern: /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g },
  { label: 'private 172.16-31.x IP', pattern: /\b172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}\b/g },
  { label: 'private 192.168.x IP', pattern: /\b192\.168\.\d{1,3}\.\d{1,3}\b/g },
];

const written = [];

prepareHardwareDraft(hardware);
preparePilotDraft(pilot);
prepareActionDraft(action, actionSpec);
prepareKeyRotationDraft(keyRotationTemplate);

writeJson('project-echo-hardware-qa.draft.json', hardware);
writeJson('project-echo-pilot-evidence.draft.json', pilot);
writeJson('project-echo-chatgpt-action-evidence.draft.json', action);

console.info('[echo-evidence] draft evidence prepared');
for (const filePath of written) {
  console.info(`- ${repoRelative(filePath)}`);
}

function prepareHardwareDraft(manifest) {
  manifest.evidenceStatus = 'draft';
  if (manifest.device) {
    manifest.device.appVersion = appVersion;
  }

  const packagePath = 'even-app/echo.ehpk';
  const packageAbs = path.resolve(repoRoot, packagePath);
  const buildReportPath = writeBuildArtifactReport(packagePath, packageAbs);
  if (existsSync(packageAbs) && manifest.buildArtifact) {
    manifest.buildArtifact.packagePath = packagePath;
    manifest.buildArtifact.sha256 = sha256File(packageAbs);
    manifest.buildArtifact.packCommand = 'npm --prefix even-app run pack';
    manifest.buildArtifact.evidenceRef = repoRelative(buildReportPath);
  }

  const bundleMetrics = readBundleMetrics();
  if (bundleMetrics && manifest.voiceRuntime) {
    const bundleReportPath = writeBundleReport(bundleMetrics);
    manifest.voiceRuntime.voiceRuntimeOnDemand = bundleMetrics.voiceRuntimeLoad === 'on demand';
    manifest.voiceRuntime.initialChunksUnderLimit = bundleMetrics.largestInitialJsKb <= 500;
    manifest.voiceRuntime.distHtmlDoesNotPreloadVoiceRuntime = !bundleMetrics.distHtmlPreloadsVoiceRuntime;
    manifest.voiceRuntime.bundleReportRef = repoRelative(bundleReportPath);
    manifest.voiceRuntime.bundleMetrics = {
      largestInitialJsKb: bundleMetrics.largestInitialJsKb,
      initialJsLimitKb: 500,
      voiceRuntimeJsKb: bundleMetrics.voiceRuntimeJsKb,
      voiceRuntimeGzipKb: bundleMetrics.voiceRuntimeGzipKb,
      onnxWasmKb: bundleMetrics.onnxWasmKb,
      onnxWasmGzipKb: bundleMetrics.onnxWasmGzipKb,
      voiceRuntimeLoad: bundleMetrics.voiceRuntimeLoad,
      onnxWasmLoad: bundleMetrics.onnxWasmLoad,
      distHtmlPreloadsVoiceRuntime: bundleMetrics.distHtmlPreloadsVoiceRuntime,
    };
  }
}

function preparePilotDraft(manifest) {
  manifest.evidenceStatus = 'draft';
  if (manifest.hardware) {
    manifest.hardware.appVersion = appVersion;
  }
}

function prepareActionDraft(manifest, spec) {
  manifest.evidenceStatus = 'draft';
  manifest.actionApiBaseUrl = String(spec.servers?.[0]?.url ?? manifest.actionApiBaseUrl ?? 'TBD');
  manifest.actionContractVersion = String(spec.info?.version ?? manifest.actionContractVersion ?? 'TBD');
}

function prepareKeyRotationDraft(template) {
  const distScan = scanArtifactPath('even-app/dist', CLIENT_SECRET_PATTERNS);
  const packageScan = scanArtifactPath('even-app/echo.ehpk', CLIENT_SECRET_PATTERNS);
  const providerHostScan = scanArtifactPaths(ARTIFACT_SCAN_PATHS, PROVIDER_HOST_PATTERNS);
  const devHostScan = scanArtifactPaths(ARTIFACT_SCAN_PATHS, DEVELOPMENT_HOST_PATTERNS);
  const sessionTokenScan = scanArtifactPaths(ARTIFACT_SCAN_PATHS, SESSION_TOKEN_PATTERNS);
  const browserArtifactScan = combineScans([distScan, packageScan]);

  const draft = replaceFieldValues(template, {
    'Client build or package version': `echo-app ${appVersion}`,
    Provider: 'Gemini',
    'Browser artifact key scan result': formatDraftCleanScanResult(browserArtifactScan),
    'Session token client artifact scan result': formatDraftCleanScanResult(sessionTokenScan),
    'even-app/dist scan result': formatDraftCleanScanResult(distScan),
    'even-app/echo.ehpk scan result': formatDraftCleanScanResult(packageScan),
    'Direct provider hostname scan result': formatDraftCleanScanResult(providerHostScan),
    'Development IP scan result': formatDraftCleanScanResult(devHostScan),
    'Follow-up issue or ticket': '#1/#27',
    Notes: 'Draft generated by npm run prepare:echo-evidence-drafts; rotation, deployment smoke, and log-review fields still require production evidence.',
  });

  writeText(path.join(outDir, 'key-rotation-evidence.draft.md'), draft);
}

function writeBuildArtifactReport(packagePath, packageAbs) {
  const outputPath = path.join(outDir, 'project-echo-build-artifact.md');
  const lines = [
    '# Project ECHO Build Artifact Draft Evidence',
    '',
    'This file is generated by `npm run prepare:echo-evidence-drafts`.',
    'It records local package facts only; it is not physical G2 install evidence.',
    '',
    `- App version: ${appVersion}`,
    `- Package path: ${packagePath}`,
    `- Package exists: ${existsSync(packageAbs)}`,
  ];

  if (existsSync(packageAbs)) {
    lines.push(`- Package SHA-256: ${sha256File(packageAbs)}`);
    lines.push(`- Package bytes: ${statSync(packageAbs).size}`);
  }

  lines.push('- Packaging command: npm --prefix even-app run pack');
  lines.push('- Physical install evidence: TBD');
  lines.push('');

  writeText(outputPath, lines.join('\n'));
  return outputPath;
}

function writeBundleReport(metrics) {
  const outputPath = path.join(outDir, 'project-echo-bundle-report.md');
  const lines = [
    '# Project ECHO Bundle Draft Evidence',
    '',
    'This file is generated by `npm run prepare:echo-evidence-drafts`.',
    'It records local bundle facts only; it is not physical device QA evidence.',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Largest initial JS kB | ${metrics.largestInitialJsKb.toFixed(2)} |`,
    `| Initial JS limit kB | 500.00 |`,
    `| Voice runtime JS kB | ${metrics.voiceRuntimeJsKb.toFixed(2)} |`,
    `| Voice runtime gzip kB | ${metrics.voiceRuntimeGzipKb.toFixed(2)} |`,
    `| ONNX/WASM kB | ${metrics.onnxWasmKb.toFixed(2)} |`,
    `| ONNX/WASM gzip kB | ${metrics.onnxWasmGzipKb.toFixed(2)} |`,
    `| Voice runtime load | ${metrics.voiceRuntimeLoad} |`,
    `| ONNX/WASM load | ${metrics.onnxWasmLoad} |`,
    `| dist/index.html preloads voice runtime | ${metrics.distHtmlPreloadsVoiceRuntime} |`,
    '',
  ];
  writeText(outputPath, lines.join('\n'));
  return outputPath;
}

function readBundleMetrics() {
  const assetsDir = path.resolve(repoRoot, 'even-app/dist/assets');
  const indexHtmlPath = path.resolve(repoRoot, 'even-app/dist/index.html');
  if (!existsSync(assetsDir) || !existsSync(indexHtmlPath)) return null;

  const initialAssets = readInitialAssetNames(indexHtmlPath);
  const rows = readdirSync(assetsDir)
    .map((name) => {
      const filePath = path.join(assetsDir, name);
      const info = statSync(filePath);
      if (!info.isFile()) return null;
      const kind = assetKind(name);
      const gzipBytes = ['js', 'css', 'wasm'].includes(kind)
        ? gzipSync(readFileSync(filePath)).byteLength
        : null;
      return {
        name,
        kind,
        bytes: info.size,
        gzipBytes,
        load: initialAssets.has(name) ? 'initial' : 'on demand',
      };
    })
    .filter(Boolean);

  const initialJsRows = rows.filter((row) => row.kind === 'js' && row.load === 'initial');
  const largestInitialJs = initialJsRows.sort((a, b) => b.bytes - a.bytes)[0] ?? null;
  const voiceRuntime = rows.find((row) => /^voice-runtime[-.].*\.js$/i.test(row.name));
  const onnxWasm = rows.find((row) => /^ort-wasm.*\.wasm$/i.test(row.name));
  if (!largestInitialJs || !voiceRuntime || !onnxWasm) return null;

  const indexHtml = readFileSync(indexHtmlPath, 'utf8');
  return {
    largestInitialJsKb: kb(largestInitialJs.bytes),
    voiceRuntimeJsKb: kb(voiceRuntime.bytes),
    voiceRuntimeGzipKb: kb(voiceRuntime.gzipBytes ?? 0),
    onnxWasmKb: kb(onnxWasm.bytes),
    onnxWasmGzipKb: kb(onnxWasm.gzipBytes ?? 0),
    voiceRuntimeLoad: voiceRuntime.load,
    onnxWasmLoad: onnxWasm.load,
    distHtmlPreloadsVoiceRuntime: /(?:src|href)="\/assets\/voice-runtime[-.][^"]+\.js"/i.test(indexHtml),
  };
}

function replaceFieldValues(markdown, values) {
  const lines = markdown.split(/\r?\n/);
  return `${lines.map((line) => {
    const match = line.match(/^(-\s+)([^:]+):(.*)$/);
    if (!match) return line;
    const [, prefix, key] = match;
    if (!Object.hasOwn(values, key)) return line;
    return `${prefix}${key}: ${values[key]}`;
  }).join('\n')}\n`;
}

function scanArtifactPaths(relativePaths, patterns) {
  return combineScans(relativePaths.map((relativePath) => scanArtifactPath(relativePath, patterns)));
}

function scanArtifactPath(relativePath, patterns) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return {
      exists: false,
      paths: [relativePath],
      filesScanned: 0,
      matches: 0,
      labels: [],
    };
  }

  const filePaths = listFiles(absolutePath);
  const labels = new Set();
  let matches = 0;
  for (const filePath of filePaths) {
    const text = readFileSync(filePath).toString('utf8');
    for (const { label, pattern } of patterns) {
      pattern.lastIndex = 0;
      const count = [...text.matchAll(pattern)].length;
      if (count > 0) {
        matches += count;
        labels.add(label);
      }
    }
  }

  return {
    exists: true,
    paths: [relativePath],
    filesScanned: filePaths.length,
    matches,
    labels: [...labels],
  };
}

function combineScans(scans) {
  const labels = new Set();
  for (const scan of scans) {
    for (const label of scan.labels) labels.add(label);
  }
  return {
    exists: scans.some((scan) => scan.exists),
    paths: scans.flatMap((scan) => scan.paths),
    filesScanned: scans.reduce((sum, scan) => sum + scan.filesScanned, 0),
    matches: scans.reduce((sum, scan) => sum + scan.matches, 0),
    labels: [...labels],
  };
}

function listFiles(absolutePath) {
  const info = statSync(absolutePath);
  if (info.isFile()) return [absolutePath];
  if (!info.isDirectory()) return [];

  return readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const nextPath = path.join(absolutePath, entry.name);
    if (entry.isDirectory()) return listFiles(nextPath);
    return entry.isFile() ? [nextPath] : [];
  });
}

function formatScanResult(scan) {
  if (!scan.exists) {
    return `TBD - ${scan.paths.join(', ')} not present in local workspace`;
  }

  const labelSuffix = scan.labels.length > 0 ? ` (${scan.labels.join(', ')})` : '';
  return `${scan.matches} matches across ${scan.filesScanned} file(s): ${scan.paths.join(', ')}${labelSuffix}`;
}

function formatDraftCleanScanResult(scan) {
  if (!scan.exists) return formatScanResult(scan);
  if (scan.matches === 0) return formatScanResult(scan);
  return `TBD - local scan found ${scan.matches} potential match(es) across ${scan.filesScanned} file(s): ${scan.paths.join(', ')} (${scan.labels.join(', ') || 'review required'})`;
}

function readInitialAssetNames(indexHtmlPath) {
  const indexHtml = readFileSync(indexHtmlPath, 'utf8');
  const matches = indexHtml.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g);
  return new Set([...matches].map((match) => match[1]));
}

function assetKind(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.js') return 'js';
  if (ext === '.css') return 'css';
  if (ext === '.wasm') return 'wasm';
  return ext.replace(/^\./, '') || 'asset';
}

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return '';
  return args[index + 1] || '';
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.resolve(repoRoot, relativePath), 'utf8'));
}

function writeJson(fileName, value) {
  const outputPath = path.join(outDir, fileName);
  writeText(outputPath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(outputPath, value) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, value, 'utf8');
  written.push(outputPath);
}

function sha256File(filePath) {
  return createHash('sha256')
    .update(readFileSync(filePath))
    .digest('hex');
}

function kb(bytes) {
  return Number((bytes / 1024).toFixed(2));
}

function repoRelative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}
