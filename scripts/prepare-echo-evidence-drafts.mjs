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
writeCaseStudyDrafts();
writeFieldRunbookDraft();

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

function writeCaseStudyDrafts() {
  writeText(
    path.join(outDir, 'project-echo-case-study.ko.draft.md'),
    caseStudyKoDraft(),
  );
  writeText(
    path.join(outDir, 'project-echo-case-study.en.draft.md'),
    caseStudyEnDraft(),
  );
  writeText(
    path.join(outDir, 'project-echo-architecture.draft.md'),
    architectureDraft(),
  );
  writeText(
    path.join(outDir, 'project-echo-real-g2-video-shot-list.draft.md'),
    realG2VideoShotListDraft(),
  );
}

function writeFieldRunbookDraft() {
  writeText(
    path.join(outDir, 'project-echo-field-runbook.draft.md'),
    fieldRunbookDraft(),
  );
}

function caseStudyKoDraft() {
  return `# Project ECHO Case Study Draft (KO)

Draft only. Do not link this file from README as project-echo-case-study-ko until
the completed pilot manifest passes validation and the final file is copied to a
stable non-draft path such as docs/project-echo-case-study.ko.md.

## 제품 문제

- 대상 사용자:
- 실제 회화 상황:
- 기존 문제:
- Project ECHO의 개입 방식:

## 빌드 범위

- App version: ${appVersion}
- G2 HUD states: READY, LISTENING, CUE, PAUSED
- Audio sources: G2 Mic, Phone Mic
- Privacy boundary: server-side ECHO API proxy, local fallback cues
- Evidence status: draft

## 파일럿 요약

| 항목 | 결과 |
| --- | --- |
| 참가자 수 | TBD |
| 조건 A: No assistance | TBD |
| 조건 B: Full sentence suggestion | TBD |
| 조건 C: 3-5 word cue | TBD |
| 가장 낮은 방해감 조건 | TBD |
| 가장 높은 신뢰 조건 | TBD |

## 정량 결과

| Metric | A | B | C |
| --- | ---: | ---: | ---: |
| Time to first utterance | TBD | TBD | TBD |
| Cue p50 latency | 0 | TBD | TBD |
| Cue p95 latency | 0 | TBD | TBD |
| Cue usage rate | 0 | TBD | TBD |
| False cue rate | 0 | TBD | TBD |
| Interruption rating | TBD | TBD | TBD |
| Trust rating | TBD | TBD | TBD |

## 실제 G2 증거

- Real G2 video: TBD
- Hardware QA manifest: TBD
- Pilot evidence manifest: TBD
- Architecture evidence: TBD

## 한계

- 표본 수:
- 통제된 시나리오:
- 영어 회화 초점:
- G2 하드웨어/Even Hub 제약:

## README 전환 조건

- Final manifest: docs/project-echo-pilot-evidence.completed.json
- Required marker: project-echo-case-study-ko
- Link only after README target matches the completed pilot manifest.
`;
}

function caseStudyEnDraft() {
  return `# Project ECHO Case Study Draft (EN)

Draft only. Do not link this file from README as project-echo-case-study-en until
the completed pilot manifest passes validation and the final file is copied to a
stable non-draft path such as docs/project-echo-case-study.en.md.

## Product Problem

- Target learner:
- Conversation setting:
- Current failure mode:
- Project ECHO intervention:

## Build Scope

- App version: ${appVersion}
- G2 HUD states: READY, LISTENING, CUE, PAUSED
- Audio sources: G2 Mic, Phone Mic
- Privacy boundary: server-side ECHO API proxy, local fallback cues
- Evidence status: draft

## Pilot Summary

| Item | Result |
| --- | --- |
| Participants | TBD |
| Condition A: No assistance | TBD |
| Condition B: Full sentence suggestion | TBD |
| Condition C: 3-5 word cue | TBD |
| Lowest-interruption condition | TBD |
| Highest-trust condition | TBD |

## Quantitative Results

| Metric | A | B | C |
| --- | ---: | ---: | ---: |
| Time to first utterance | TBD | TBD | TBD |
| Cue p50 latency | 0 | TBD | TBD |
| Cue p95 latency | 0 | TBD | TBD |
| Cue usage rate | 0 | TBD | TBD |
| False cue rate | 0 | TBD | TBD |
| Interruption rating | TBD | TBD | TBD |
| Trust rating | TBD | TBD | TBD |

## Real G2 Evidence

- Real G2 video: TBD
- Hardware QA manifest: TBD
- Pilot evidence manifest: TBD
- Architecture evidence: TBD

## Limitations

- Sample size:
- Controlled scenarios:
- English-practice focus:
- G2 hardware / Even Hub constraints:

## README Promotion Conditions

- Final manifest: docs/project-echo-pilot-evidence.completed.json
- Required marker: project-echo-case-study-en
- Link only after README target matches the completed pilot manifest.
`;
}

function architectureDraft() {
  return `# Project ECHO Architecture Draft

Draft only. This is a portfolio architecture evidence starting point, not final
release evidence. Copy to a stable non-draft path only after the pilot and
hardware QA manifests are complete.

## App Version

- echo-app: ${appVersion}
- Evidence status: draft

## Boundary Diagram

\`\`\`mermaid
flowchart LR
  Learner["Learner"] --> Phone["Phone-hosted Even Hub WebView"]
  Phone --> G2["Even Realities G2 HUD and input"]
  Phone --> Local["Local privacy controls and fallback cues"]
  Phone --> Proxy["ECHO API proxy"]
  Proxy --> Provider["Server-side AI/STT provider"]
  Phone --> Review["Review export and active recall"]
  Review --> CustomGPT["Manual Custom GPT handoff / Action evidence"]
\`\`\`

## Claims To Prove Before Portfolio Use

- The G2 HUD shows only READY, LISTENING, CUE, and PAUSED during live speech.
- G2 Mic and Phone Mic paths remain explicit; no silent phone microphone fallback.
- Raw transcripts/audio do not leave the client unless the user opted into cloud processing.
- Provider keys, session tokens, and direct provider hosts are absent from dist and .ehpk artifacts.
- The completed pilot manifest links this architecture artifact.
`;
}

function realG2VideoShotListDraft() {
  return `# Project ECHO Real G2 Video Shot List Draft

Draft only. This checklist helps capture the project-echo-real-g2-video evidence
required by issue #10. It is not a substitute for the final video file or HTTPS
video URL.

## Required Continuous Takes

| Take | Required proof | Captured |
| --- | --- | --- |
| 1 | Install/open the same echo.ehpk package used in hardware QA | TBD |
| 2 | G2 shows READY before a session starts | TBD |
| 3 | Start G2 Mic; phone mic permission remains closed | TBD |
| 4 | G2 shows LISTENING during live speech | TBD |
| 5 | Manual Assist request shows one short CUE on G2 | TBD |
| 6 | Swipe/dismiss clears the cue | TBD |
| 7 | Pause menu shows separate End Practice and Exit ECHO paths | TBD |
| 8 | End Practice returns to READY without duplicate audio capture | TBD |
| 9 | Exit ECHO shuts down the Even Hub page container | TBD |
| 10 | Phone review shows timeline/details while G2 stays minimal | TBD |

## File Requirements

- Final target marker: project-echo-real-g2-video
- Final evidence must be an HTTPS URL or repo path ending in mp4, mov, webm, or mkv.
- README must link the final target only after docs/project-echo-pilot-evidence.completed.json passes validation.
- Do not publish participant faces, names, raw transcripts, audio payloads, provider keys, or session tokens.
`;
}

function fieldRunbookDraft() {
  const packagePath = hardware?.buildArtifact?.packagePath ?? 'even-app/echo.ehpk';
  const packageSha = hardware?.buildArtifact?.sha256 ?? 'TBD';
  const packageEvidenceRef = hardware?.buildArtifact?.evidenceRef ?? 'docs/evidence-drafts/project-echo-build-artifact.md';
  const bundleReportRef = hardware?.voiceRuntime?.bundleReportRef ?? 'docs/evidence-drafts/project-echo-bundle-report.md';

  return `# Project ECHO Field Runbook Draft

Draft only. This file is generated by \`npm run prepare:echo-evidence-drafts\`
to gather the remaining release-readiness work into one operator checklist. It
does not replace completed evidence manifests, production smoke proof, Custom
GPT Action deployment proof, or real G2 video.

## Current Local Facts

- App version: ${appVersion}
- Package path: ${packagePath}
- Package SHA-256: ${packageSha}
- Package evidence draft: ${packageEvidenceRef}
- Bundle evidence draft: ${bundleReportRef}
- Evidence status: draft

## Official Even Hub Fidelity Boundary

- Simulator and Local Testing are useful for layout, logic, and rapid iteration,
  but they are not final hardware or reviewer-parity evidence.
- The final hardware run must use a real packaged \`.ehpk\` installed through
  Private Testing or Beta Testing, not a local dev server.
- Beta Testing is the reviewer-parity path for the 5-minute locked-phone test,
  root double-tap system exit dialog, permission denial paths, and console
  sanity checks.
- The same package digest recorded in \`buildArtifact.sha256\` must be the one
  installed for the hardware QA run.

References:

- https://hub.evenrealities.com/docs/test
- https://hub.evenrealities.com/docs/test/beta-testing
- https://hub.evenrealities.com/docs/reference/cli
- https://hub.evenrealities.com/docs/ship/app-submission

## Pre-Run Commands

\`\`\`bash
npm run verify:all
npm run prepare:echo-evidence-drafts
npm run readiness:echo
\`\`\`

\`readiness:echo\` is expected to fail before the field run. Use the blocker
list as the remaining evidence queue, not as a reason to fill placeholders.

## Production Proxy Smoke Env

Set these only after the HTTPS proxy is deployed and a short-lived signed smoke
token has been minted from the server-side secret manager. Do not commit token
values.

\`\`\`bash
ECHO_PROXY_BASE_URL=https://api.project-echo.app
ECHO_PROXY_SMOKE_ORIGIN=https://your-client-origin
ECHO_PROXY_SMOKE_SESSION_TOKEN=<short-lived signed smoke token>
ECHO_PROXY_SMOKE_EVIDENCE_OUT=docs/proxy-smoke-evidence.json
npm run readiness:echo
\`\`\`

The readiness command converts \`docs/proxy-smoke-evidence.json\` to the
\`../docs/proxy-smoke-evidence.json\` path expected by \`smoke:deploy\`, because
the smoke runner executes from \`echo-api-proxy\`.

## Evidence Queue

| Issues | Evidence artifact | Completion gate |
| --- | --- | --- |
| #1/#27 | \`docs/key-rotation-evidence.md\` and checked-in production proxy smoke JSON | \`npm run readiness:echo\` production proxy and key-rotation checks pass |
| #2/#3/#4/#6/#12/#13/#14/#28 | \`docs/project-echo-hardware-qa.completed.json\` | \`npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json\` |
| #5/#10 | \`docs/project-echo-pilot-evidence.completed.json\`, case studies, architecture, real G2 video | \`npm run validate:pilot-evidence -- docs/project-echo-pilot-evidence.completed.json\` |
| #10 | README portfolio links | \`npm run promote:echo-portfolio-links\` after the completed pilot manifest passes |
| #29 | \`docs/project-echo-chatgpt-action-evidence.completed.json\` | \`npm run validate:chatgpt-action-evidence -- docs/project-echo-chatgpt-action-evidence.completed.json\` |

## Field Sequence

1. Run \`npm run verify:all\` on a clean checkout.
2. Package the app with \`npm --prefix even-app run pack\`.
3. Record \`${packagePath}\`, its SHA-256, and install notes in the hardware QA
   build-artifact evidence.
4. Install the same \`.ehpk\` through the Even Hub private or beta path.
5. Run the 5-minute locked-phone beta/reviewer-parity check.
6. Capture hardware QA evidence for lifecycle, HUD states, Assist, audio source
   separation, delayed proxy behavior, voice runtime, wear status, and
   conversation timeline boundaries.
7. Run the 5-user A/B/C pilot and export privacy-safe QA data after each run.
8. Fill final Korean/English case studies, architecture evidence, and the real
   G2 video target.
9. Run production proxy smoke and key-rotation checks without local-only
   overrides.
10. Deploy the OAuth-backed Custom GPT Action API and capture privacy rejection
    plus G2/audio-level active-recall evidence.
11. Validate all completed manifests, then run \`npm run promote:echo-portfolio-links\`.
12. Run \`npm run readiness:echo\`; only close the remaining issues after it
    passes and the linked evidence is committed or stable.

## Non-Negotiables

- Do not rename draft files to completed files without real external evidence.
- Do not use simulator, local QR, or mock Action proof as final G2/OAuth proof.
- Do not publish raw transcripts, raw audio, participant contact identifiers,
  provider keys, session tokens, or local-only proxy URLs in evidence.
- Do not update README portfolio links until their targets match the completed
  pilot manifest and already exist.
`;
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
