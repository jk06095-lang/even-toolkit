#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const wantsHelp = args.includes('--help') || args.includes('-h');
const outDirArg = readOption('--out-dir') || 'docs/evidence-drafts';
const actionOauthSmokeArg = readOption('--action-oauth-smoke') || 'docs/chatgpt-action-oauth-smoke.json';
const proxySmokeEvidenceArg = readOption('--proxy-smoke-evidence') || 'docs/proxy-smoke-evidence.json';
const repoRoot = process.cwd();
const outDir = path.resolve(repoRoot, outDirArg);

if (wantsHelp) {
  console.info(`Usage: npm run prepare:echo-evidence-drafts -- [--out-dir docs/evidence-drafts] [--action-oauth-smoke docs/chatgpt-action-oauth-smoke.json] [--proxy-smoke-evidence docs/proxy-smoke-evidence.json]

Creates draft evidence manifests for the remaining Project ECHO readiness gates.
The command fills only local, reproducible fields such as app version, package
SHA-256, and bundle metrics when available. It does not create completed
evidence files and does not mark real-device, deployment, or key-rotation checks
as passed.

If an Action OAuth smoke JSON is present, the ChatGPT Action draft is prefilled
with endpoint and privacy smoke metadata while staying in draft status. If a
production proxy smoke JSON is present, the key-rotation draft is prefilled with
deployment-smoke metadata while staying in draft status.`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

const appVersion = readJson('even-app/package.json')?.version ?? 'TBD';
const actionSpec = readJson('integrations/chatgpt-action/openapi.json') ?? {};
const hardware = readJson('docs/project-echo-hardware-qa.template.json');
const pilot = readJson('docs/project-echo-pilot-evidence.template.json');
const action = readJson('docs/project-echo-chatgpt-action-evidence.template.json');
const actionOauthSmokePath = path.resolve(repoRoot, actionOauthSmokeArg);
const actionOauthSmoke = readOptionalJson(actionOauthSmokePath);
const proxySmokeEvidencePath = path.resolve(repoRoot, proxySmokeEvidenceArg);
const proxySmokeEvidence = readOptionalJson(proxySmokeEvidencePath);
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
writeReviewerParityChecklistDraft();
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

  const packagePath = 'even-app/echo.ehpk';
  const packageAbs = path.resolve(repoRoot, packagePath);
  const buildReportPath = writeBuildArtifactReport(packagePath, packageAbs);
  if (existsSync(packageAbs) && manifest.buildArtifact) {
    manifest.buildArtifact.packagePath = packagePath;
    manifest.buildArtifact.sha256 = sha256File(packageAbs);
    manifest.buildArtifact.packCommand = 'npm --prefix even-app run pack';
    manifest.buildArtifact.evidenceRef = repoRelative(buildReportPath);
  }
}

function prepareActionDraft(manifest, spec) {
  manifest.evidenceStatus = 'draft';
  manifest.actionApiBaseUrl = String(spec.servers?.[0]?.url ?? manifest.actionApiBaseUrl ?? 'TBD');
  manifest.actionContractVersion = String(spec.info?.version ?? manifest.actionContractVersion ?? 'TBD');
  const packagePath = 'even-app/echo.ehpk';
  const packageAbs = path.resolve(repoRoot, packagePath);
  const buildReportPath = writeBuildArtifactReport(packagePath, packageAbs);
  if (existsSync(packageAbs) && manifest.buildArtifact) {
    manifest.buildArtifact.packagePath = packagePath;
    manifest.buildArtifact.sha256 = sha256File(packageAbs);
    manifest.buildArtifact.packCommand = 'npm --prefix even-app run pack';
    manifest.buildArtifact.evidenceRef = repoRelative(buildReportPath);
  }
  if (manifest.privacy) {
    manifest.privacy.boundedLearningItemsMax = readLearnerProfileItemLimit(spec) ?? manifest.privacy.boundedLearningItemsMax;
  }

  applyActionOauthSmoke(manifest, actionOauthSmoke, actionOauthSmokePath);
}

function prepareKeyRotationDraft(template) {
  const distScan = scanArtifactPath('even-app/dist', CLIENT_SECRET_PATTERNS);
  const packageScan = scanArtifactPath('even-app/echo.ehpk', CLIENT_SECRET_PATTERNS);
  const providerHostScan = scanArtifactPaths(ARTIFACT_SCAN_PATHS, PROVIDER_HOST_PATTERNS);
  const devHostScan = scanArtifactPaths(ARTIFACT_SCAN_PATHS, DEVELOPMENT_HOST_PATTERNS);
  const sessionTokenScan = scanArtifactPaths(ARTIFACT_SCAN_PATHS, SESSION_TOKEN_PATTERNS);
  const browserArtifactScan = combineScans([distScan, packageScan]);

  const values = {
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
  };

  applyProxySmokeDraftValues(values, proxySmokeEvidence, proxySmokeEvidencePath);

  const draft = replaceFieldValues(template, values);

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

function writeReviewerParityChecklistDraft() {
  writeText(
    path.join(outDir, 'project-echo-reviewer-parity-checklist.draft.md'),
    reviewerParityChecklistDraft(),
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

초안 전용 파일입니다. 완료된 파일을 docs/project-echo-case-study.ko.md 같은
안정적인 비초안 경로로 복사하고, completed pilot manifest 검증이 통과하기
전까지 README의 project-echo-case-study-ko 링크로 연결하지 마세요.

## 제품 문제

- 대상 학습자:
- 실제 대화 상황:
- 기존 실패 패턴:
- Project ECHO 개입 방식:

## 빌드 범위

- 앱 버전: ${appVersion}
- G2 HUD 상태: READY, LISTENING, CUE, ACK, PAUSED
- 오디오 소스: G2 Mic, Phone Mic
- 개인정보 경계: 서버 측 ECHO API 프록시, 로컬 fallback cue
- 증거 상태: draft

## 파일럿 요약

| 항목 | 결과 |
| --- | --- |
| 참여자 수 | TBD |
| 조건 A: No assistance | TBD |
| 조건 B: Full sentence suggestion | TBD |
| 조건 C: 3-5 word cue | TBD |
| 방해감이 가장 낮은 조건 | TBD |
| 신뢰도가 가장 높은 조건 | TBD |

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

- 실제 G2 영상: TBD
- 하드웨어 QA manifest: TBD
- 파일럿 evidence manifest: TBD
- 아키텍처 evidence: TBD

## 한계

- 표본 수:
- 통제된 시나리오:
- 영어 회화 초점:
- G2 하드웨어 / Even Hub 제약:

## README 전환 조건

- 최종 manifest: docs/project-echo-pilot-evidence.completed.json
- 필수 marker: project-echo-case-study-ko
- README 링크는 completed pilot manifest의 target과 일치할 때만 연결하세요.
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
- G2 HUD states: READY, LISTENING, CUE, ACK, PAUSED
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

- The G2 HUD shows only READY, LISTENING, CUE, ACK, and PAUSED during live speech.
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
| 7 | Successful assisted/adapted cue use shows ACK/OK briefly | TBD |
| 8 | Auto Assist stays quiet on silence alone | TBD |
| 9 | Auto Assist shows a cue only after a breakdown phrase plus silence | TBD |
| 10 | Auto Assist cancels the pending cue when speech resumes within the grace window | TBD |
| 11 | Auto and speech-evaluation cues stay at level 2 or lower | TBD |
| 12 | Level 3/full-structure cue appears only after an explicit Manual Assist request | TBD |
| 13 | Pause menu shows separate End Practice and Exit ECHO paths | TBD |
| 14 | End Practice returns to READY without duplicate audio capture | TBD |
| 15 | Root double-tap shows the system exit confirmation dialog | TBD |
| 16 | Exit ECHO calls bridge.shutDownPageContainer(1) and closes the page container | TBD |
| 17 | Permission denial path shows recoverable phone-side guidance | TBD |
| 18 | Phone review shows ordered two-speaker timeline/details while G2 stays minimal | TBD |
| 19 | Partner turns are translated before learner/unknown turns in a mixed pending batch | TBD |
| 20 | Low-confidence transcript shows a Korean-translation review warning beside the phone timeline turn | TBD |

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
  const actionSmokeRef = action?.oauth?.evidenceRef && action.oauth.evidenceRef !== 'TBD'
    ? action.oauth.evidenceRef
    : 'docs/chatgpt-action-oauth-smoke.json';
  const proxySmokeRef = keyRotationProxySmokeRef() ?? 'docs/proxy-smoke-evidence.json';

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
- Reviewer-parity checklist draft: docs/evidence-drafts/project-echo-reviewer-parity-checklist.draft.md
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
npm run prepare:echo-field-run
npm run verify:all
npm run prepare:echo-evidence-drafts
npm run readiness:echo
\`\`\`

\`prepare:echo-field-run\` packages the app, refreshes draft evidence, checks
the workspace \`.ehpk\` SHA against those drafts, prints the final-gate status,
and writes \`docs/evidence-drafts/project-echo-field-run-prep-report.draft.md\`
without promoting any draft evidence. \`readiness:echo\` is expected to fail
before the field run. Use the blocker list as the remaining evidence queue, not
as a reason to fill placeholders.

## Production Proxy Smoke Env

Set these only after the HTTPS proxy is deployed and a short-lived signed smoke
token has been minted from the server-side secret manager. Do not commit token
values. \`ECHO_PROXY_SMOKE_ORIGIN\` must be the deployed public HTTPS client
origin only; localhost, private-network hosts, paths, queries, and hashes are
local/test inputs and cannot satisfy #1/#27 release evidence.
The app build may contain \`VITE_ECHO_API_BASE_URL\`, but it must not contain a
\`VITE_*\` session token. Inject only the short-lived token into the running
WebView as \`globalThis.__PROJECT_ECHO_SESSION_TOKEN__\` or
\`sessionStorage["projectEcho.sessionToken"]\`, and confirm the production proxy
sees it as \`Authorization: Bearer <token>\`.

\`\`\`bash
ECHO_PROXY_BASE_URL=https://api.project-echo.app
ECHO_PROXY_SMOKE_ORIGIN=https://your-client-origin
ECHO_PROXY_SMOKE_SESSION_TOKEN=<short-lived signed smoke token>
ECHO_PROXY_SMOKE_EVIDENCE_OUT=${proxySmokeRef}
npm run readiness:echo
npm run prepare:echo-evidence-drafts -- --proxy-smoke-evidence ${proxySmokeRef}
\`\`\`

The readiness command converts \`docs/proxy-smoke-evidence.json\` to the
\`../docs/proxy-smoke-evidence.json\` path expected by \`smoke:deploy\`, because
the smoke runner executes from \`echo-api-proxy\`.

## Custom GPT Action OAuth Smoke

After the deployed proxy reports \`actionOAuth.configured: true\`, collect the
token-free Action OAuth endpoint evidence. Keep the client secret in the shell
environment or secret manager; the smoke output must not contain it.

\`\`\`bash
npm --prefix echo-api-proxy run smoke:action-oauth -- --base-url https://api.project-echo.app --allowed-origin https://your-client-origin --client-id "$ECHO_ACTION_OAUTH_CLIENT_ID" --client-secret "$ECHO_ACTION_OAUTH_CLIENT_SECRET" --redirect-uri https://chatgpt.com/aip/project-echo/oauth/callback --evidence-out ../${actionSmokeRef}
npm run prepare:echo-evidence-drafts -- --action-oauth-smoke ${actionSmokeRef}
\`\`\`

The generated Action draft may prefill endpoint and privacy smoke fields, but it
must remain \`draft\` until Custom GPT configuration screenshots/exports and
G2/audio-level recall evidence are also captured.

## Custom GPT Active Recall Evidence

The completed #29 manifest must prove the learning boundary, not only endpoint
availability:

- \`buildArtifact.packagePath\` and \`buildArtifact.sha256\`: the repo-local
  \`.ehpk\` package used for G2 active-recall evidence. The SHA-256 must match
  the actual file, and \`sameArtifactAsHardwareQa=true\` must tie it to the
  hardware QA artifact.
- \`twoSeparateRecallDaysProven=true\`: a hidden meaning-to-expression item is
  recalled successfully on Day 1 and transferred again on Day 7.
- \`recallTransferProof.day1RecallDate\` and \`day7TransferDate\`: YYYY-MM-DD
  dates proving a Day 1 independent recall and a Day 7 transfer attempt at
  least six calendar days later. Both dates must also appear in
  \`recallTransferProof.recallDates\`, with evidence refs for each attempt.
- \`transferScenarioEvidenceCaptured=true\`: a transfer review or roleplay
  write-back records a bounded transfer scenario ID for that item.
- \`recallTransferProof.transferScenarioIds\`: bounded scenario IDs that match
  the transfer review or roleplay write-back evidence.
- \`sameDayRepeatNotCountedAsTransfer=true\`: repeated same-day reveal/grade
  loops do not unlock transfer or count as independent transfer evidence.
- \`webSpeechOnlyMarkedInsufficient=true\`: phone Web Speech evidence is clearly
  separated from G2 bridge audio-level recall evidence.
- \`calibratedG2ThresholdUsed=true\`: G2 bridge recall evidence records the same
  calibration-derived speech threshold used by the active recall audio-level
  capture path, or the documented fallback threshold when calibration evidence
  is legitimately unavailable.
- \`g2AudioLevelEvidence.speechThreshold\`, \`speechFrameRatio\`, \`totalFrames\`,
  and \`speechFrames\`: numeric audio-level evidence from G2 bridge PCM frames,
  without storing raw audio.
- \`pronunciationScoringPolicy.webSpeechConfidenceUsedForG2=false\`: Web Speech
  confidence is not reused as G2 pronunciation evidence.
- \`pronunciationScoringPolicy.rawAudioRetained=false\`: scoring evidence uses
  bounded G2 PCM metrics or a reviewed evaluator output, not retained raw audio.
- \`tutorBehavior.maxOneCorrectionPerTurn=true\`,
  \`tutorBehavior.cueLadderOrderVerified=true\`, and
  \`tutorBehavior.maxLearningItemsPerSession<=3\`: the live Custom GPT follows
  the ECHO tutoring rules instead of turning roleplay into an unbounded
  correction transcript.
- \`tutorBehavior.roleplayResultWritesBoundedItemIds=true\` and
  \`tutorBehavior.transferWriteBackUsesScenarioId=true\`: roleplay write-back
  cites bounded learning item IDs and transfer scenario IDs without raw
  transcript text.

## Conversation Timeline Evidence

The completed #28 hardware QA package must prove the phone-side review surface
without moving heavy review text onto the glasses:

- G2 Mic, Phone Mic, and import flows each produce ordered \`ConversationTurn\`
  records with source, timing, finality, language, and confidence-policy
  metadata.
- Manual speaker correction persists \`correctedByUser=true\` and is present in
  the export.
- \`translationReview.partnerTurnsPrioritized=true\`: when partner, learner, and
  unknown turns are queued together, partner turns are translated first.
- \`translationReview.lowConfidenceTranslationWarningShown=true\`: a final turn
  with STT confidence below 0.7 keeps its Korean translation visible but shows a
  phone-side warning to review the original text.
- \`hudBoundary.g2ConversationHistoryHidden=true\`,
  \`hudBoundary.g2TranslationHidden=true\`, and
  \`hudBoundary.g2SpeakerLabelsHidden=true\`: G2 stays READY/LISTENING/CUE/ACK/
  PAUSED only.
- \`hud.ackBehavior.durationMs\` stays between 600 and 900 ms, shows OK only
  after assisted cue use, returns to LISTENING, and clears its timer on stop or
  standby.
- \`assist.minimumTwoSignalsForAutoCue=true\`,
  \`assist.partnerSpeechBlocksAutoCue=true\`, and
  \`assist.recentDismissRateCheckedBeforeAutoCue=true\` prove Auto Assist does
  not fire from a single ambiguous silence or while the partner is speaking.

## Evidence Queue

| Issues | Evidence artifact | Completion gate |
| --- | --- | --- |
| #1/#27 | \`docs/key-rotation-evidence.md\` and checked-in production proxy smoke JSON | \`npm run readiness:echo\` production proxy and key-rotation checks pass |
| #2/#3/#6/#12/#13/#14/#28 | \`docs/project-echo-hardware-qa.completed.json\` | \`npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json\` |
| #5/#10 | \`docs/project-echo-pilot-evidence.completed.json\`, case studies, architecture, real G2 video | \`npm run validate:pilot-evidence -- docs/project-echo-pilot-evidence.completed.json\` |
| #10 | README portfolio links | \`npm run promote:echo-portfolio-links\` after the completed pilot manifest passes |
| #29 | \`docs/project-echo-chatgpt-action-evidence.completed.json\` | \`npm run validate:chatgpt-action-evidence -- docs/project-echo-chatgpt-action-evidence.completed.json\` |

## Field Sequence

1. Run \`npm run prepare:echo-field-run\` on a clean checkout, review
   \`docs/evidence-drafts/project-echo-field-run-prep-report.draft.md\`, then
   run \`npm run verify:all\` before committing any regenerated package/draft
   updates.
2. Confirm the package step inside field prep completed with
   \`npm --prefix even-app run pack\`.
3. Record \`${packagePath}\`, its SHA-256, and install notes in the hardware QA
   build-artifact evidence.
4. Install the same \`.ehpk\` through the Even Hub private or beta path.
5. Run the 5-minute locked-phone beta/reviewer-parity check, including
   glasses launch after lock, gesture-only core flow, 2-minute idle
   responsiveness, unlock/use-another-app/re-lock continuity, Android
   cold-start rebuild from localStorage, foreground audio-capture re-enable,
   WebSocket reconnect handling or explicit non-use, root double-tap system
   exit dialog, permission-denial recovery, and console sanity.
6. Capture hardware QA evidence for lifecycle, HUD states, Assist, audio source
   separation, delayed proxy behavior, voice runtime, wear status, and
   conversation timeline boundaries. For the timeline, prove G2 Mic, Phone Mic,
   and import segmentation, manual speaker correction persistence,
   partner-turn translation priority, low-confidence translation warnings,
   bounded ACK/OK behavior, and the phone-only timeline / cue-only G2 HUD
   boundary. For Exit ECHO, preserve
   proof that the app called \`bridge.shutDownPageContainer(1)\` from the root-page exit path.
   For Assist, prove silence-only Auto stays
   quiet, at least two trigger signals are required before Auto shows a cue,
   partner speech blocks automatic cues, recent dismiss behavior is checked, and
   the 400 ms grace window cancels the pending cue when speech resumes. Also
   prove Auto and speech-evaluation cues stay at level 2 or lower, while level
   3/full structure appears only after an explicit Manual Assist request.
7. Run the 5-user A/B/C pilot with the same repo-local \`.ehpk\` digest recorded
   in the pilot \`buildArtifact\` block, then export privacy-safe QA data after
   each run.
8. For each VAD environment, run \`npm --prefix even-app run qa:summarize-export -- <export.json>\`
   and preserve both the raw \`qaExportPath\` and human-readable
   \`qaSummaryPath\`. The summary must show \`Calibrated at\`, and the pilot
   manifest must record the same ISO \`calibratedAt\` value for that environment.
9. Fill \`outcomeMetrics\` with Conversation Recovery Rate using the fixed
   8-second window, Day 1 and Day 7 Independent Transfer Rates, integer
   transfer scenario count, and the pilot scorecard evidence ref.
10. Fill final Korean/English case studies, architecture evidence, and the real
   G2 video target.
11. Run production proxy smoke and key-rotation checks without local-only
   overrides.
12. Deploy the OAuth-backed Custom GPT Action API and capture privacy rejection
    plus G2/audio-level active-recall evidence, including Day 1 independent
    recall, Day 7 transfer at least six calendar days later, and at least one
    bounded transfer scenario or roleplay write-back.
    Capture tutor behavior evidence proving one correction per turn, keyword
    to sentence-starter to full-sentence cue ladder, at most three saved
    learning items, and bounded roleplay write-back IDs.
13. Validate all completed manifests, then run \`npm run promote:echo-portfolio-links\`.
14. Run \`npm run readiness:echo\`; only close the remaining issues after it
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
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

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

function applyProxySmokeDraftValues(values, smoke, smokePath) {
  if (!isValidProxySmokeForDraft(smoke)) return;
  const evidenceRef = repoEvidenceRef(smokePath);
  if (!evidenceRef) return;
  const healthz = smoke.checks.healthz;

  values['Production proxy URL'] = smoke.baseUrl;
  values['Session token issuer'] = 'server-side signed-token issuer verified by production smoke evidence';
  values['Session token TTL'] = `${healthz.tokenPolicyTtlSeconds} seconds`;
  values['Session token rotation cadence'] = `${healthz.tokenPolicyRotationDays} days`;
  values['Session token storage boundary'] = 'server secret manager / signed-token issuer verified by production smoke evidence';
  values['Deployment smoke command result'] = `passed: npm --prefix echo-api-proxy run smoke:deploy -- --base-url ${smoke.baseUrl} --allowed-origin ${smoke.allowedOrigin} --session-token <redacted> --evidence-out ../${evidenceRef}`;
  values['Deployment smoke evidence JSON'] = evidenceRef;
  values['/healthz configured true'] = 'passed: /healthz configured=true and authConfigured=true';
  values['Allowed origin passed'] = `passed: ${smoke.allowedOrigin}`;
  values['Untrusted origin blocked'] = `passed: ${smoke.disallowedOrigin}`;
  values['Safe non-echoing error response verified'] = 'passed: safe error response did not echo sensitive learner text';
}

function isValidProxySmokeForDraft(smoke) {
  if (!smoke || typeof smoke !== 'object' || Array.isArray(smoke)) return false;
  if (smoke.schema !== 'project-echo-proxy-smoke-v1' || smoke.ok !== true) return false;
  if (smoke.allowHttp !== false || smoke.allowUnconfigured !== false || smoke.allowUnauthenticated !== false || smoke.allowQaDelay !== false) return false;
  if (smoke.sessionTokenProvided !== true) return false;
  if (!/^https:\/\/[^/]+/i.test(String(smoke.baseUrl || ''))) return false;
  if (isLocalEvidenceHost(smoke.baseUrl)) return false;
  if (!isProductionEvidenceOrigin(smoke.allowedOrigin) || !isProductionEvidenceOrigin(smoke.disallowedOrigin)) return false;
  if (normalizeEvidenceOrigin(smoke.allowedOrigin) === normalizeEvidenceOrigin(smoke.disallowedOrigin)) return false;

  const healthz = smoke.checks?.healthz;
  if (healthz?.status !== 200 || healthz?.ok !== true || healthz?.configured !== true || healthz?.authConfigured !== true) return false;
  if (healthz?.tokenPolicyConfigured !== true || healthz?.tokenPolicySignedTokenConfigured !== true || healthz?.tokenPolicyIssuerPresent !== true) return false;
  if (!Number.isFinite(healthz?.tokenPolicyTtlSeconds) || healthz.tokenPolicyTtlSeconds < 1 || healthz.tokenPolicyTtlSeconds > 86_400) return false;
  if (!Number.isFinite(healthz?.tokenPolicyRotationDays) || healthz.tokenPolicyRotationDays < 1 || healthz.tokenPolicyRotationDays > 30) return false;
  if (!Number.isFinite(healthz?.rateLimitWindowMs) || healthz.rateLimitWindowMs < 1 || healthz.rateLimitWindowMs > 86_400_000) return false;
  if (!Number.isFinite(healthz?.rateLimitMax) || healthz.rateLimitMax < 1 || healthz.rateLimitMax > 100_000) return false;
  if (!Number.isFinite(healthz?.idempotencyTtlMs) || healthz.idempotencyTtlMs < 1 || healthz.idempotencyTtlMs > 86_400_000) return false;
  if (!Number.isFinite(healthz?.idempotencyMaxEntries) || healthz.idempotencyMaxEntries < 1 || healthz.idempotencyMaxEntries > 100_000) return false;
  if (!Number.isFinite(healthz?.circuitBreakerFailureThreshold) || healthz.circuitBreakerFailureThreshold < 1 || healthz.circuitBreakerFailureThreshold > 100) return false;
  if (!Number.isFinite(healthz?.circuitBreakerCooldownMs) || healthz.circuitBreakerCooldownMs < 1 || healthz.circuitBreakerCooldownMs > 3_600_000) return false;
  if (healthz?.circuitBreakerOpen !== false) return false;
  if (healthz?.corsOriginMatches !== true || healthz?.cacheControlNoStore !== true) return false;
  if (smoke.checks?.options?.status !== 204 || smoke.checks.options.corsOriginMatches !== true) return false;
  if (smoke.checks.options.allowsIdempotencyKey !== true) return false;
  if (smoke.checks?.missingSessionToken?.status !== 401 || smoke.checks.missingSessionToken.errorCode !== 'missing_session_token') return false;
  if (smoke.checks?.disallowedOrigin?.status !== 403 || smoke.checks.disallowedOrigin.errorCode !== 'origin_not_allowed') return false;
  if (![400, 503].includes(smoke.checks?.safeError?.status)) return false;
  if (smoke.checks.safeError.responseEchoedSensitive !== false) return false;
  return true;
}

function isLocalEvidenceHost(value) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '127.0.0.1' || host === '::1') return true;
    const parts = host.split('.').map((part) => Number.parseInt(part, 10));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  } catch {
    return true;
  }
}

function isProductionEvidenceOrigin(value) {
  const origin = normalizeEvidenceOrigin(value);
  return Boolean(origin) && !isLocalEvidenceHost(origin);
}

function normalizeEvidenceOrigin(value) {
  if (typeof value !== 'string') return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return '';
    if (parsed.origin !== value.replace(/\/$/, '')) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

function reviewerParityChecklistDraft() {
  const packagePath = 'even-app/echo.ehpk';
  const packageAbs = path.resolve(repoRoot, packagePath);
  const packageSha = existsSync(packageAbs) ? sha256File(packageAbs) : 'TBD';
  const packageBytes = existsSync(packageAbs) ? statSync(packageAbs).size : 'TBD';
  const packageEvidenceRef = hardware?.buildArtifact?.evidenceRef ?? 'docs/evidence-drafts/project-echo-build-artifact.md';

  return `# Project ECHO Even Hub Reviewer-Parity Checklist Draft

Draft only. This checklist is generated by \`npm run prepare:echo-evidence-drafts\`
and is a capture aid for the hardware QA run. It is not final evidence and must
not be referenced by completed manifests until the captured artifacts are copied
to stable non-draft paths.

## Package Under Test

- App version: ${appVersion}
- Package path: ${packagePath}
- Package bytes: ${packageBytes}
- Package SHA-256: ${packageSha}
- Package evidence draft: ${packageEvidenceRef}
- Field runbook draft: docs/evidence-drafts/project-echo-field-runbook.draft.md
- Field prep report draft: docs/evidence-drafts/project-echo-field-run-prep-report.draft.md

## Official Boundary

- Use the packaged \`.ehpk\`, not a dev server, for final hardware evidence.
- Install through Even Hub Private Testing or Beta Testing for reviewer-parity evidence.
- Treat simulator/local testing as pre-submission smoke only.
- Keep provider keys and session tokens out of the package and out of logs.

References:

- https://hub.evenrealities.com/docs/get-started/overview
- https://hub.evenrealities.com/docs/test
- https://hub.evenrealities.com/docs/test/beta-testing
- https://hub.evenrealities.com/docs/ship/app-submission

## Reviewer-Parity Capture Matrix

| Check | Required artifact | Manifest field(s) |
| --- | --- | --- |
| Private/Beta install uses this exact .ehpk digest | Install screenshot or export plus package SHA | buildArtifact.installedViaBetaOrPrivateBuild, buildArtifact.sameArtifactUsedForHardwareQa, buildArtifact.reviewerParityConfirmed |
| Five-minute locked-phone run survives backgrounding | Video or observer notes from physical G2 | buildArtifact.lockedPhoneFiveMinuteRun, backgroundLifecycle.lockDurationMinutes |
| Glasses launch after lock without black screen/spinner | Video evidence | backgroundLifecycle.glassesLaunchRendersAfterLock, backgroundLifecycle.noBlackScreenOrInfiniteSpinner |
| Gesture-only core flow gives feedback for every gesture | Video plus QA notes | backgroundLifecycle.gestureOnlyCoreFlowCompleted, backgroundLifecycle.everyGestureShowsFeedback |
| Root double-tap shows system exit dialog and exits with target 1 | Video plus bridge log | backgroundLifecycle.rootDoubleTapSystemExitDialogShown, lifecycle.exitEchoRun.shutDownPageContainerCalled, lifecycle.exitEchoRun.shutdownTarget |
| Permission denial path is recoverable and phone-side | Screenshot/video plus notes | backgroundLifecycle.permissionDenialPathVerified |
| Idle, unlock/use-other-app/re-lock, cold-start recovery work | Observer notes plus QA export | backgroundLifecycle.aliveAfterTwoMinutesIdle, backgroundLifecycle.unlockUseAnotherAppRelockUnaffected, backgroundLifecycle.androidColdStartRebuildsFromLocalStorage |
| Foreground audio capture and reconnect/non-use behavior are explicit | QA export/log note | backgroundLifecycle.audioCaptureReenabledAfterForeground, backgroundLifecycle.webSocketReconnectHandledOrNotUsed |
| Console sanity has no release-blocking errors | Redacted console export | backgroundLifecycle.consoleSanityChecked |

## G2 HUD And Phone Boundary

| Check | Required artifact | Manifest field(s) |
| --- | --- | --- |
| G2 shows only READY, LISTENING, CUE, ACK, PAUSED | Real G2 video or simulator plus physical confirmation | hud.states, hud.phoneDetailOnly, hud.grammarHiddenOnG2 |
| ACK/OK appears briefly only after assisted cue use | Real G2 video | hud.ackBehavior |
| Phone keeps transcript, speaker correction, translation, and review surfaces | Phone screenshots/export | conversationTimeline, hudBoundary |
| G2 Mic and Phone Mic paths remain explicit | QA export and permission evidence | audioSources.g2MicSession, audioSources.phoneMicSession, audioSources.g2Failure |
| Wear status distinguishes connected/wearing/not-wearing/unavailable | Device status capture | wearingState |

## Evidence Closure Rules

- Open hardware QA issues: #2/#3/#6/#12/#13/#14/#28.
- Final artifact: \`docs/project-echo-hardware-qa.completed.json\`.
- Validator: \`npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json\`.
- Do not close any issue from this draft file.
- Do not use \`docs/evidence-drafts/\`, \`.draft.\`, or \`.template.\` paths as completed evidence refs.
- Run \`npm run readiness:echo\` and \`npm run preflight:echo-open-issues\` before closing issues.
`;
}

function keyRotationProxySmokeRef() {
  const resolved = path.resolve(proxySmokeEvidencePath);
  return existsSync(resolved) ? repoEvidenceRef(resolved) : null;
}

function applyActionOauthSmoke(manifest, smoke, smokePath) {
  if (!isValidActionOauthSmokeForDraft(manifest, smoke)) return;
  const evidenceRef = repoEvidenceRef(smokePath);
  if (!evidenceRef) return;

  if (manifest.oauth) {
    manifest.oauth.authorizationCodeConfigured = true;
    manifest.oauth.authorizationUrl = `${manifest.actionApiBaseUrl}/oauth/authorize`;
    manifest.oauth.tokenUrl = `${manifest.actionApiBaseUrl}/oauth/token`;
    manifest.oauth.scopesGranted = Array.isArray(smoke.requestedScopes)
      ? smoke.requestedScopes
      : manifest.oauth.scopesGranted;
    const tokenStorage = smoke.checks?.healthz?.tokenStorage === 'hashed_in_memory'
      ? ' hashed in memory on the proxy'
      : ' kept server-side on the proxy';
    manifest.oauth.tokenStorageBoundary = `Server-side OAuth authorization-code flow verified by token-free Action smoke evidence; access tokens are${tokenStorage}, and access tokens/client secrets are not stored in evidence.`;
    manifest.oauth.evidenceRef = evidenceRef;
  }

  const endpointMappings = {
    learnerProfile: { key: 'learnerProfile', write: false },
    reviewsNext: { key: 'reviewsNext', write: false },
    reviewAttempt: { key: 'reviewAttempt', write: true },
    roleplayStart: { key: 'roleplayStart', write: false },
    roleplayResult: { key: 'roleplayResult', write: true },
    sessionImport: { key: 'sessionImport', write: true },
  };
  for (const [manifestKey, mapping] of Object.entries(endpointMappings)) {
    const source = smoke.checks?.[mapping.key];
    const target = manifest.endpoints?.[manifestKey];
    if (!source || !target) continue;
    target.status = source.status;
    target.schemaVersion = source.schemaVersion ?? '2.0.0';
    if (mapping.write) target.writeAccepted = source.writeAccepted === true;
    target.rawTranscriptReturned = source.rawTranscriptReturned === true ? true : false;
    target.rawAudioReturned = source.rawAudioReturned === true ? true : false;
    target.directIdentifierReturned = source.directIdentifierReturned === true ? true : false;
    target.evidenceRef = evidenceRef;
  }

  if (manifest.privacy && smoke.checks?.privacy) {
    manifest.privacy.rawTranscriptRejected = smoke.checks.privacy.rawTranscriptRejected?.rejected === true;
    manifest.privacy.rawAudioRejected = smoke.checks.privacy.rawAudioRejected?.rejected === true;
    manifest.privacy.directContactIdentifiersRejected = smoke.checks.privacy.directContactIdentifiersRejected?.rejected === true;
    manifest.privacy.providerSecretsRejected = smoke.checks.privacy.providerSecretsRejected?.rejected === true;
    manifest.privacy.boundedLearningItemsMax = readLearnerProfileItemLimit(actionSpec) ?? manifest.privacy.boundedLearningItemsMax;
    manifest.privacy.evidenceRef = evidenceRef;
  }
}

function isValidActionOauthSmokeForDraft(manifest, smoke) {
  if (!smoke || typeof smoke !== 'object' || Array.isArray(smoke)) return false;
  if (smoke.schema !== 'project-echo-action-oauth-smoke-v1' || smoke.ok !== true) return false;
  if (String(smoke.baseUrl || '').replace(/\/+$/, '') !== String(manifest.actionApiBaseUrl || '').replace(/\/+$/, '')) {
    return false;
  }
  if (smoke.accessTokenStoredInEvidence !== false) return false;
  if (smoke.checks?.oauthToken?.accessTokenStoredInEvidence !== false) return false;
  if (smoke.checks?.oauthToken?.responseEchoedClientSecret !== false) return false;
  if (smoke.checks?.healthz?.actionOAuthConfigured !== true) return false;
  if (smoke.checks?.healthz?.tokenStorage !== 'hashed_in_memory') return false;
  if (smoke.checks?.oauthAuthorize?.codeReturned !== true) return false;
  if (smoke.checks?.oauthToken?.tokenTypeBearer !== true) return false;

  for (const key of ['learnerProfile', 'reviewsNext', 'reviewAttempt', 'roleplayStart', 'roleplayResult', 'sessionImport']) {
    if (smoke.checks?.[key]?.status !== 200) return false;
    if (smoke.checks[key].rawTranscriptReturned !== false) return false;
    if (smoke.checks[key].rawAudioReturned !== false) return false;
    if (smoke.checks[key].directIdentifierReturned !== false) return false;
  }
  for (const key of ['rawTranscriptRejected', 'rawAudioRejected', 'directContactIdentifiersRejected', 'providerSecretsRejected']) {
    if (smoke.checks?.privacy?.[key]?.rejected !== true) return false;
  }
  return true;
}

function readLearnerProfileItemLimit(spec) {
  const value = spec.components?.schemas?.LearnerProfileResponse?.properties?.learningItems?.maxItems;
  return Number.isInteger(value) && value > 0 ? value : null;
}

function repoEvidenceRef(filePath) {
  const resolved = path.resolve(filePath);
  const rootWithSep = `${path.resolve(repoRoot)}${path.sep}`;
  if (resolved !== path.resolve(repoRoot) && !resolved.startsWith(rootWithSep)) return null;
  return repoRelative(resolved);
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

function readOptionalJson(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(fileName, value) {
  const outputPath = path.join(outDir, fileName);
  writeText(outputPath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(outputPath, value) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, value, 'utf8');
  if (!written.includes(outputPath)) {
    written.push(outputPath);
  }
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
