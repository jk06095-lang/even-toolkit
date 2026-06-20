import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

const repoRoot = process.cwd();
const resolvedRepoRoot = path.resolve(repoRoot);
const tmpRoot = path.join(repoRoot, '.tmp', `echo-evidence-drafts-${process.pid}`);

before(() => {
  mkdirSync(tmpRoot, { recursive: true });
});

after(() => {
  const resolvedTmpRoot = path.resolve(tmpRoot);
  if (resolvedTmpRoot.startsWith(`${resolvedRepoRoot}${path.sep}`) && existsSync(resolvedTmpRoot)) {
    rmSync(resolvedTmpRoot, { recursive: true, force: true });
  }
});

test('prepares draft evidence manifests without marking external evidence complete', async () => {
  const actionSpec = JSON.parse(readFileSync(path.join(repoRoot, 'integrations/chatgpt-action/openapi.json'), 'utf8'));
  const actionSmokePath = path.join(tmpRoot, 'chatgpt-action-oauth-smoke.json');
  const proxySmokePath = path.join(tmpRoot, 'proxy-smoke-evidence.json');
  writeFileSync(actionSmokePath, `${JSON.stringify(actionOauthSmokeFixture(actionSpec.servers[0].url), null, 2)}\n`, 'utf8');
  writeFileSync(proxySmokePath, `${JSON.stringify(proxySmokeFixture(), null, 2)}\n`, 'utf8');

  const result = await runNode([
    'scripts/prepare-echo-evidence-drafts.mjs',
    '--out-dir',
    repoRelative(tmpRoot),
    '--action-oauth-smoke',
    repoRelative(actionSmokePath),
    '--proxy-smoke-evidence',
    repoRelative(proxySmokePath),
  ]);
  assert.equal(result.code, 0, result.stderr);

  const hardwarePath = path.join(tmpRoot, 'project-echo-hardware-qa.draft.json');
  const pilotPath = path.join(tmpRoot, 'project-echo-pilot-evidence.draft.json');
  const actionPath = path.join(tmpRoot, 'project-echo-chatgpt-action-evidence.draft.json');
  const keyRotationPath = path.join(tmpRoot, 'key-rotation-evidence.draft.md');
  const caseStudyKoPath = path.join(tmpRoot, 'project-echo-case-study.ko.draft.md');
  const caseStudyEnPath = path.join(tmpRoot, 'project-echo-case-study.en.draft.md');
  const architecturePath = path.join(tmpRoot, 'project-echo-architecture.draft.md');
  const videoShotListPath = path.join(tmpRoot, 'project-echo-real-g2-video-shot-list.draft.md');
  const fieldRunbookPath = path.join(tmpRoot, 'project-echo-field-runbook.draft.md');
  const buildReportPath = path.join(tmpRoot, 'project-echo-build-artifact.md');

  for (const filePath of [
    hardwarePath,
    pilotPath,
    actionPath,
    keyRotationPath,
    caseStudyKoPath,
    caseStudyEnPath,
    architecturePath,
    videoShotListPath,
    fieldRunbookPath,
    buildReportPath,
  ]) {
    assert.equal(existsSync(filePath), true, `${filePath} should exist`);
  }

  const appVersion = JSON.parse(readFileSync(path.join(repoRoot, 'even-app/package.json'), 'utf8')).version;
  const hardware = JSON.parse(readFileSync(hardwarePath, 'utf8'));
  const pilot = JSON.parse(readFileSync(pilotPath, 'utf8'));
  const action = JSON.parse(readFileSync(actionPath, 'utf8'));

  assert.equal(hardware.evidenceStatus, 'draft');
  assert.equal(pilot.evidenceStatus, 'draft');
  assert.equal(action.evidenceStatus, 'draft');
  assert.notEqual(hardware.evidenceStatus, 'complete');
  assert.equal(hardware.device.appVersion, appVersion);
  assert.equal(pilot.hardware.appVersion, appVersion);
  assert.equal(pilot.outcomeMetrics.conversationRecoveryRate, null);
  assert.equal(pilot.outcomeMetrics.conversationRecoveryWindowSeconds, 8);
  assert.equal(pilot.outcomeMetrics.independentTransferRateDay1, null);
  assert.equal(pilot.outcomeMetrics.independentTransferRateDay7, null);
  assert.equal(pilot.outcomeMetrics.transferScenarioCount, null);
  assert.equal(pilot.outcomeMetrics.evidenceRef, 'TBD');
  assert.equal(hardware.buildArtifact.packagePath, 'even-app/echo.ehpk');
  assert.match(hardware.buildArtifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal(hardware.buildArtifact.installedViaBetaOrPrivateBuild, null);
  assert.equal(action.actionContractVersion, actionSpec.info.version);
  assert.equal(action.actionGpt.customGptConfigured, null);
  assert.equal(action.activeRecallDeviceEvidence.g2BridgeRecallCaptured, null);
  assert.equal(action.activeRecallDeviceEvidence.calibratedG2ThresholdUsed, null);
  assert.equal(action.activeRecallDeviceEvidence.twoSeparateRecallDaysProven, null);
  assert.equal(action.activeRecallDeviceEvidence.transferScenarioEvidenceCaptured, null);
  assert.equal(action.activeRecallDeviceEvidence.sameDayRepeatNotCountedAsTransfer, null);
  assert.deepEqual(action.activeRecallDeviceEvidence.recallTransferProof.recallDates, []);
  assert.deepEqual(action.activeRecallDeviceEvidence.recallTransferProof.independentRecallAttemptRefs, []);
  assert.deepEqual(action.activeRecallDeviceEvidence.recallTransferProof.transferScenarioIds, []);
  assert.equal(action.activeRecallDeviceEvidence.recallTransferProof.transferEvidenceRef, 'TBD');
  assert.equal(action.activeRecallDeviceEvidence.recallTransferProof.sameDayRepeatEvidenceRef, 'TBD');
  assert.equal(action.activeRecallDeviceEvidence.g2AudioLevelEvidence.captureSource, 'TBD');
  assert.equal(action.activeRecallDeviceEvidence.g2AudioLevelEvidence.speechThreshold, null);
  assert.equal(action.activeRecallDeviceEvidence.g2AudioLevelEvidence.speechFrameRatio, null);
  assert.equal(action.activeRecallDeviceEvidence.g2AudioLevelEvidence.totalFrames, null);
  assert.equal(action.activeRecallDeviceEvidence.g2AudioLevelEvidence.speechFrames, null);
  assert.equal(action.activeRecallDeviceEvidence.g2AudioLevelEvidence.rawAudioRetained, null);
  assert.equal(action.activeRecallDeviceEvidence.pronunciationScoringPolicy.scoringSource, 'TBD');
  assert.equal(action.activeRecallDeviceEvidence.pronunciationScoringPolicy.webSpeechConfidenceUsedForG2, null);
  assert.equal(action.activeRecallDeviceEvidence.pronunciationScoringPolicy.rawAudioRetained, null);
  assert.equal(action.oauth.authorizationCodeConfigured, true);
  assert.equal(action.oauth.evidenceRef, repoRelative(actionSmokePath));
  assert.match(action.oauth.tokenStorageBoundary, /token-free Action smoke evidence/);
  assert.match(action.oauth.tokenStorageBoundary, /hashed in memory/);
  assert.equal(action.oauth.providerSecretsInGpt, null);
  assert.equal(action.endpoints.learnerProfile.status, 200);
  assert.equal(action.endpoints.learnerProfile.schemaVersion, '2.0.0');
  assert.equal(action.endpoints.learnerProfile.rawTranscriptReturned, false);
  assert.equal(action.endpoints.reviewAttempt.writeAccepted, true);
  assert.equal(action.endpoints.roleplayResult.writeAccepted, true);
  assert.equal(action.endpoints.sessionImport.writeAccepted, true);
  assert.equal(action.privacy.rawTranscriptRejected, true);
  assert.equal(action.privacy.rawAudioRejected, true);
  assert.equal(action.privacy.directContactIdentifiersRejected, true);
  assert.equal(action.privacy.providerSecretsRejected, true);
  assert.equal(action.privacy.boundedLearningItemsMax, 30);
  assert.equal(action.privacy.evidenceRef, repoRelative(actionSmokePath));

  const keyRotation = readFileSync(keyRotationPath, 'utf8');
  assert.match(keyRotation, new RegExp(`Client build or package version: echo-app ${escapeRegExp(appVersion)}`));
  assert.match(keyRotation, /Provider: Gemini/);
  assert.match(keyRotation, /Production proxy URL: https:\/\/api\.project-echo\.app/);
  assert.match(keyRotation, /Session token issuer: server-side signed-token issuer verified by production smoke evidence/);
  assert.match(keyRotation, /Session token TTL: 3600 seconds/);
  assert.match(keyRotation, /Session token rotation cadence: 7 days/);
  assert.match(keyRotation, /Session token storage boundary: server secret manager \/ signed-token issuer verified by production smoke evidence/);
  assert.match(keyRotation, new RegExp(`Deployment smoke evidence JSON: ${escapeRegExp(repoRelative(proxySmokePath))}`));
  assert.match(keyRotation, /Deployment smoke command result: passed: npm --prefix echo-api-proxy run smoke:deploy/);
  assert.match(keyRotation, /--session-token <redacted>/);
  assert.match(keyRotation, /\/healthz configured true: passed/);
  assert.match(keyRotation, /Allowed origin passed: passed/);
  assert.match(keyRotation, /Untrusted origin blocked: passed/);
  assert.match(keyRotation, /Safe non-echoing error response verified: passed/);
  assert.doesNotMatch(keyRotation, /--allow-http|--allow-unconfigured|--allow-unauthenticated|--allow-qa-delay/);
  assert.match(keyRotation, /Browser artifact key scan result: \d+ matches across \d+ file\(s\): even-app\/dist, even-app\/echo\.ehpk/);
  assert.match(keyRotation, /Session token client artifact scan result: \d+ matches across \d+ file\(s\): even-app\/dist, even-app\/echo\.ehpk/);
  assert.match(keyRotation, /Development IP scan result: 0 matches across \d+ file\(s\): even-app\/dist, even-app\/echo\.ehpk/);
  assert.doesNotMatch(keyRotation, /Development IP scan result: .*(?:localhost|loopback IP)/);
  assert.match(keyRotation, /Follow-up issue or ticket: #1\/#27/);
  assert.doesNotMatch(keyRotation, /Date: \d{4}-\d{2}-\d{2}/);

  const caseStudyKo = readFileSync(caseStudyKoPath, 'utf8');
  const caseStudyEn = readFileSync(caseStudyEnPath, 'utf8');
  const architecture = readFileSync(architecturePath, 'utf8');
  const videoShotList = readFileSync(videoShotListPath, 'utf8');
  const fieldRunbook = readFileSync(fieldRunbookPath, 'utf8');

  assert.match(caseStudyKo, /\uCD08\uC548 \uC804\uC6A9/);
  assert.match(caseStudyKo, /\uC81C\uD488 \uBB38\uC81C/);
  assert.match(caseStudyKo, /project-echo-case-study-ko/);
  assert.match(caseStudyKo, new RegExp(`\\uC571 \\uBC84\\uC804: ${escapeRegExp(appVersion)}`));
  assert.match(caseStudyKo, /G2 HUD \uC0C1\uD0DC: READY, LISTENING, CUE, ACK, PAUSED/);
  assert.match(caseStudyEn, /Draft only/);
  assert.match(caseStudyEn, /project-echo-case-study-en/);
  assert.match(caseStudyEn, new RegExp(`App version: ${escapeRegExp(appVersion)}`));
  assert.match(caseStudyEn, /G2 HUD states: READY, LISTENING, CUE, ACK, PAUSED/);
  assert.match(architecture, /flowchart LR/);
  assert.match(architecture, /ECHO API proxy/);
  assert.match(architecture, /READY, LISTENING, CUE, ACK, and PAUSED/);
  assert.match(videoShotList, /project-echo-real-g2-video/);
  assert.match(videoShotList, /G2 shows READY/);
  assert.match(videoShotList, /shows ACK\/OK briefly/);
  assert.match(videoShotList, /Root double-tap shows the system exit confirmation dialog/);
  assert.match(videoShotList, /bridge\.shutDownPageContainer\(1\)/);
  assert.match(videoShotList, /Permission denial path shows recoverable phone-side guidance/);
  assert.match(videoShotList, /Partner turns are translated before learner\/unknown turns/);
  assert.match(videoShotList, /Low-confidence transcript shows a Korean-translation review warning/);
  assert.match(fieldRunbook, /Project ECHO Field Runbook Draft/);
  assert.match(fieldRunbook, /npm run readiness:echo/);
  assert.match(fieldRunbook, /Beta Testing is the reviewer-parity path/);
  assert.match(fieldRunbook, /permission-denial recovery/);
  assert.match(fieldRunbook, /console sanity/);
  assert.match(fieldRunbook, /bridge\.shutDownPageContainer\(1\)/);
  assert.match(fieldRunbook, /ECHO_PROXY_SMOKE_SESSION_TOKEN/);
  assert.match(fieldRunbook, new RegExp(`ECHO_PROXY_SMOKE_EVIDENCE_OUT=${escapeRegExp(repoRelative(proxySmokePath))}`));
  assert.match(fieldRunbook, new RegExp(`npm run prepare:echo-evidence-drafts -- --proxy-smoke-evidence ${escapeRegExp(repoRelative(proxySmokePath))}`));
  assert.match(fieldRunbook, /#2\/#3\/#6\/#12\/#13\/#14\/#28/);
  assert.doesNotMatch(fieldRunbook, /#2\/#3\/#4\/#6/);
  assert.match(fieldRunbook, /outcomeMetrics/);
  assert.match(fieldRunbook, /Conversation Recovery Rate/);
  assert.match(fieldRunbook, /Day 1 and Day 7 Independent Transfer Rates/);
  assert.match(fieldRunbook, /docs\/project-echo-chatgpt-action-evidence\.completed\.json/);
  assert.match(fieldRunbook, /Custom GPT Action OAuth Smoke/);
  assert.match(fieldRunbook, /Custom GPT Active Recall Evidence/);
  assert.match(fieldRunbook, /twoSeparateRecallDaysProven=true/);
  assert.match(fieldRunbook, /recallTransferProof\.recallDates/);
  assert.match(fieldRunbook, /g2AudioLevelEvidence\.speechThreshold/);
  assert.match(fieldRunbook, /calibratedG2ThresholdUsed=true/);
  assert.match(fieldRunbook, /pronunciationScoringPolicy\.webSpeechConfidenceUsedForG2=false/);
  assert.match(fieldRunbook, /pronunciationScoringPolicy\.rawAudioRetained=false/);
  assert.match(fieldRunbook, /sameDayRepeatNotCountedAsTransfer=true/);
  assert.match(fieldRunbook, /Conversation Timeline Evidence/);
  assert.match(fieldRunbook, /translationReview\.partnerTurnsPrioritized=true/);
  assert.match(fieldRunbook, /translationReview\.lowConfidenceTranslationWarningShown=true/);
  assert.match(fieldRunbook, /hudBoundary\.g2TranslationHidden=true/);
  assert.match(fieldRunbook, /hud\.ackBehavior\.durationMs/);
  assert.match(fieldRunbook, /assist\.minimumTwoSignalsForAutoCue=true/);
  assert.match(fieldRunbook, /assist\.partnerSpeechBlocksAutoCue=true/);
  assert.match(fieldRunbook, /assist\.recentDismissRateCheckedBeforeAutoCue=true/);
  assert.match(fieldRunbook, /partner-turn translation priority/);
  assert.match(fieldRunbook, /low-confidence translation warnings/);
  assert.match(fieldRunbook, /bounded ACK\/OK behavior/);
  assert.match(fieldRunbook, /smoke:action-oauth/);
  assert.match(fieldRunbook, new RegExp(escapeRegExp(`npm run prepare:echo-evidence-drafts -- --action-oauth-smoke ${repoRelative(actionSmokePath)}`)));
  assert.match(fieldRunbook, /Do not rename draft files to completed files without real external evidence/);
  assert.doesNotMatch(caseStudyKo, /\]\(docs\/project-echo-case-study\.ko\.md\)/);
  assert.doesNotMatch(caseStudyEn, /\]\(docs\/project-echo-case-study\.en\.md\)/);

  await assertValidatorPasses('scripts/validate-hardware-qa.mjs', hardwarePath);
  await assertValidatorPasses('scripts/validate-pilot-evidence.mjs', pilotPath);
  await assertValidatorPasses('scripts/validate-chatgpt-action-evidence.mjs', actionPath);
  await assertValidatorPasses('scripts/validate-key-rotation-evidence.mjs', keyRotationPath);
});

test('does not prefill key-rotation draft from non-production proxy smoke origins', async () => {
  const cases = [
    ['local-allowed-origin', { allowedOrigin: 'http://127.0.0.1:5173' }],
    ['ipv6-loopback-allowed-origin', { allowedOrigin: 'https://[::1]' }],
    ['path-allowed-origin', { allowedOrigin: 'https://echo-client.example.test/app' }],
    ['matching-cors-origins', { disallowedOrigin: 'https://echo-client.example.test' }],
  ];

  for (const [name, overrides] of cases) {
    const outDir = path.join(tmpRoot, `invalid-proxy-smoke-${name}`);
    const proxySmokePath = path.join(tmpRoot, `${name}.json`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(proxySmokePath, `${JSON.stringify(proxySmokeFixture(overrides), null, 2)}\n`, 'utf8');

    const result = await runNode([
      'scripts/prepare-echo-evidence-drafts.mjs',
      '--out-dir',
      repoRelative(outDir),
      '--proxy-smoke-evidence',
      repoRelative(proxySmokePath),
    ]);

    assert.equal(result.code, 0, result.stderr);

    const keyRotation = readFileSync(path.join(outDir, 'key-rotation-evidence.draft.md'), 'utf8');
    assert.doesNotMatch(keyRotation, /Deployment smoke command result: passed: npm --prefix echo-api-proxy run smoke:deploy/);
    assert.doesNotMatch(keyRotation, new RegExp(escapeRegExp(repoRelative(proxySmokePath))));
    assert.match(keyRotation, /^- Deployment smoke evidence JSON:\s*$/m);
    assert.match(keyRotation, /^- Allowed origin passed:\s*$/m);
  }
});

async function assertValidatorPasses(scriptPath, targetPath) {
  const result = await runNode([scriptPath, repoRelative(targetPath), '--allow-draft']);
  assert.equal(result.code, 0, result.stderr);
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function repoRelative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function actionOauthSmokeFixture(baseUrl) {
  const endpointCheck = (schemaVersion = '2.0.0', writeAccepted = undefined) => ({
    status: 200,
    schemaVersion,
    writeAccepted,
    corsOriginMatches: true,
    cacheControlNoStore: true,
    rawTranscriptReturned: false,
    rawAudioReturned: false,
    directIdentifierReturned: false,
  });

  return {
    schema: 'project-echo-action-oauth-smoke-v1',
    generatedAt: '2026-06-19T00:00:00.000Z',
    baseUrl,
    allowedOrigin: 'https://echo-client.example.test',
    redirectUri: 'https://chatgpt.com/aip/project-echo/oauth/callback',
    clientIdFingerprint: '0123456789abcdef',
    clientSecretProvided: true,
    accessTokenStoredInEvidence: false,
    requestedScopes: [
      'profile:read',
      'review:read',
      'review:write',
      'roleplay:write',
      'session:write',
    ],
    ok: true,
    checks: {
      healthz: {
        status: 200,
        actionOAuthConfigured: true,
        authorizationCode: true,
        tokenStorage: 'hashed_in_memory',
      },
      oauthAuthorize: {
        status: 302,
        codeReturned: true,
      },
      oauthToken: {
        status: 200,
        tokenTypeBearer: true,
        accessTokenReturned: true,
        accessTokenStoredInEvidence: false,
        responseEchoedClientSecret: false,
      },
      learnerProfile: endpointCheck(),
      reviewsNext: endpointCheck(),
      reviewAttempt: endpointCheck('2.0.0', true),
      roleplayStart: endpointCheck(),
      roleplayResult: endpointCheck('2.0.0', true),
      sessionImport: endpointCheck('2.0.0', true),
      privacy: {
        rawTranscriptRejected: { status: 400, rejected: true, responseEchoedSensitive: false },
        rawAudioRejected: { status: 400, rejected: true, responseEchoedSensitive: false },
        directContactIdentifiersRejected: { status: 400, rejected: true, responseEchoedSensitive: false },
        providerSecretsRejected: { status: 400, rejected: true, responseEchoedSensitive: false },
      },
    },
  };
}

function proxySmokeFixture(overrides = {}) {
  const base = {
    schema: 'project-echo-proxy-smoke-v1',
    generatedAt: '2026-06-19T00:00:00.000Z',
    baseUrl: 'https://api.project-echo.app',
    allowedOrigin: 'https://echo-client.example.test',
    disallowedOrigin: 'https://blocked.project-echo.invalid',
    allowHttp: false,
    allowUnconfigured: false,
    allowUnauthenticated: false,
    allowQaDelay: false,
    sessionTokenProvided: true,
    ok: true,
    checks: {
      healthz: {
        status: 200,
        ok: true,
        configured: true,
        authConfigured: true,
        qaDelayMs: 0,
        tokenPolicyConfigured: true,
        tokenPolicyIssuerPresent: true,
        tokenPolicyAudience: 'project-echo-api',
        tokenPolicyTtlSeconds: 3600,
        tokenPolicyRotationDays: 7,
        tokenPolicyActiveTokenCount: 1,
        tokenPolicySignedTokenConfigured: true,
        rateLimitWindowMs: 60000,
        rateLimitMax: 60,
        idempotencyTtlMs: 300000,
        idempotencyMaxEntries: 500,
        circuitBreakerFailureThreshold: 3,
        circuitBreakerCooldownMs: 30000,
        circuitBreakerOpen: false,
        corsOriginMatches: true,
        cacheControlNoStore: true,
      },
      options: {
        status: 204,
        corsOriginMatches: true,
        allowsPost: true,
        allowsAuthorization: true,
        allowsSessionToken: true,
        allowsIdempotencyKey: true,
      },
      missingSessionToken: {
        status: 401,
        errorCode: 'missing_session_token',
        corsOriginMatches: true,
      },
      disallowedOrigin: {
        status: 403,
        errorCode: 'origin_not_allowed',
        corsOriginAbsent: true,
      },
      safeError: {
        status: 503,
        errorCode: 'proxy_not_configured',
        errorCodePresent: true,
        responseEchoedSensitive: false,
        corsOriginMatches: true,
      },
    },
  };

  return deepMerge(base, overrides);
}

function deepMerge(base, overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && base[key]
      && typeof base[key] === 'object'
      && !Array.isArray(base[key])
    ) {
      merged[key] = deepMerge(base[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
