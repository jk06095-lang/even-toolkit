#!/usr/bin/env node
import { readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const appRoot = process.cwd();
const assetsDir = path.resolve(appRoot, 'dist', 'assets');
const indexHtmlPath = path.resolve(appRoot, 'dist', 'index.html');
const args = process.argv.slice(2);
const checkMode = args.includes('--check');
const INITIAL_JS_LIMIT_BYTES = 500 * 1024;

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(2)} kB`;
}

function assetKind(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.js') return 'js';
  if (ext === '.css') return 'css';
  if (ext === '.wasm') return 'wasm';
  return ext.replace(/^\./, '') || 'asset';
}

async function readInitialAssetNames() {
  const indexHtml = await readFile(indexHtmlPath, 'utf8');
  const matches = indexHtml.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g);
  return new Set([...matches].map((match) => match[1]));
}

async function readAssetRows() {
  const initialAssetNames = await readInitialAssetNames();
  const entries = await readdir(assetsDir);
  const rows = [];

  for (const name of entries) {
    const filePath = path.join(assetsDir, name);
    const info = await stat(filePath);
    if (!info.isFile()) continue;

    const kind = assetKind(name);
    const gzipBytes = kind === 'js' || kind === 'css' || kind === 'wasm'
      ? gzipSync(await readFile(filePath)).byteLength
      : null;

    rows.push({
      name,
      kind,
      bytes: info.size,
      gzipBytes,
      isInitial: initialAssetNames.has(name),
    });
  }

  return rows.sort((a, b) => b.bytes - a.bytes);
}

function printMarkdown(rows) {
  const jsRows = rows.filter((row) => row.kind === 'js');
  const largestJs = jsRows[0] ?? null;
  const initialJsRows = jsRows.filter((row) => row.isInitial);
  const largestInitialJs = initialJsRows[0] ?? null;
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  const totalGzipBytes = rows.reduce((sum, row) => sum + (row.gzipBytes ?? 0), 0);

  console.info('# Project ECHO Bundle Size Report');
  console.info('');
  console.info(`- Assets directory: \`${path.relative(appRoot, assetsDir)}\``);
  console.info(`- Total asset size: ${formatKb(totalBytes)}`);
  console.info(`- Total gzip size: ${formatKb(totalGzipBytes)}`);
  if (largestJs) {
    console.info(`- Largest JS chunk: \`${largestJs.name}\` (${formatKb(largestJs.bytes)}, gzip ${formatKb(largestJs.gzipBytes ?? 0)})`);
  }
  if (largestInitialJs) {
    console.info(`- Largest initial JS chunk: \`${largestInitialJs.name}\` (${formatKb(largestInitialJs.bytes)}, gzip ${formatKb(largestInitialJs.gzipBytes ?? 0)})`);
  }
  console.info('');
  console.info('| Asset | Kind | Load | Size | Gzip |');
  console.info('| --- | --- | --- | ---: | ---: |');
  for (const row of rows) {
    const load = row.isInitial ? 'initial' : 'on demand';
    console.info(`| \`${row.name}\` | ${row.kind} | ${load} | ${formatKb(row.bytes)} | ${row.gzipBytes === null ? 'n/a' : formatKb(row.gzipBytes)} |`);
  }
}

function checkPolicy(rows) {
  const errors = [];
  const initialJsRows = rows.filter((row) => row.kind === 'js' && row.isInitial);
  const largestInitialJs = initialJsRows[0] ?? null;
  const oversizeInitialJs = initialJsRows.filter((row) => row.bytes > INITIAL_JS_LIMIT_BYTES);
  const voiceRuntimeRows = rows.filter((row) => /^voice-runtime[-.].*\.js$/i.test(row.name));
  const runtimeRows = rows.filter((row) =>
    /^voice-runtime[-.].*\.js$/i.test(row.name) ||
    /^ort-wasm.*\.wasm$/i.test(row.name)
  );

  for (const row of oversizeInitialJs) {
    errors.push(
      `initial JS chunk ${row.name} is ${formatKb(row.bytes)}, above ${formatKb(INITIAL_JS_LIMIT_BYTES)}`,
    );
  }

  for (const row of runtimeRows.filter((runtimeRow) => runtimeRow.isInitial)) {
    errors.push(`runtime asset ${row.name} is loaded initially; it must remain on demand`);
  }

  if (voiceRuntimeRows.length === 0) {
    errors.push('voice-runtime JS chunk was not found; lazy-load evidence cannot be verified');
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`[bundle:check] ${error}`);
    }
    process.exit(1);
  }

  const runtimeSummary = runtimeRows
    .map((row) => `${row.name}:${row.isInitial ? 'initial' : 'on demand'}`)
    .join(', ');
  const largestInitialSummary = largestInitialJs
    ? `${largestInitialJs.name} ${formatKb(largestInitialJs.bytes)}`
    : 'none';

  console.info(`[bundle:check] passed: largest initial JS ${largestInitialSummary}; runtime assets ${runtimeSummary}`);
}

try {
  const rows = await readAssetRows();
  if (checkMode) {
    checkPolicy(rows);
  } else {
    printMarkdown(rows);
  }
} catch (error) {
  console.error(`[bundle:report] ${error instanceof Error ? error.message : String(error)}`);
  console.error('[bundle:report] Run `npm run build` before generating the bundle report.');
  process.exit(1);
}
