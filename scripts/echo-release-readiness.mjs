#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const repoRoot = process.cwd();
const resolvedRepoRoot = path.resolve(repoRoot);
const checks = [];

function addCheck(name, status, detail, issue = '') {
  checks.push({ name, status, detail, issue });
}

function commandForNpm(args) {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...args],
    };
  }

  return { command: 'npm', args };
}

function runNpm(args, options = {}) {
  return new Promise((resolve) => {
    const invocation = commandForNpm(args);
    const child = spawn(invocation.command, invocation.args, {
      cwd: repoRoot,
      shell: false,
      env: { ...process.env, ...options.env },
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', (error) => {
      resolve({ code: 1, output: error.message });
    });
    child.on('exit', (code) => {
      resolve({ code: code ?? 1, output });
    });
  });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

const README_PORTFOLIO_LINKS = [
  {
    marker: 'project-echo-case-study-ko',
    manifestKey: 'koreanCaseStudyUrl',
    extensions: ['md', 'html', 'pdf'],
  },
  {
    marker: 'project-echo-case-study-en',
    manifestKey: 'englishCaseStudyUrl',
    extensions: ['md', 'html', 'pdf'],
  },
  {
    marker: 'project-echo-real-g2-video',
    manifestKey: 'realG2VideoUrl',
    extensions: ['mp4', 'mov', 'webm', 'mkv'],
  },
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
const OFFICIAL_EVENHUB_EDITION = '202601';
const OFFICIAL_EVENHUB_SDK_FLOOR = '0.0.10';
const PROXY_EVIDENCE_ISSUES = '#1/#27';
const OFFICIAL_EVENHUB_PERMISSION_NAMES = new Set([
  'album',
  'camera',
  'g2-microphone',
  'location',
  'network',
  'phone-microphone',
]);
const OFFICIAL_EVENHUB_LANGUAGES = new Set(['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'zh']);

async function validateFinalManifest({
  label,
  filePath,
  npmScript,
  issue,
  missingDetail,
}) {
  const absolutePath = path.resolve(repoRoot, filePath);
  if (!existsSync(absolutePath)) {
    addCheck(label, 'blocked', missingDetail, issue);
    return false;
  }

  const result = await runNpm(['run', npmScript, '--', filePath]);
  if (result.code !== 0) {
    addCheck(label, 'blocked', firstUsefulLine(result.output), issue);
    return false;
  }

  addCheck(label, 'passed', `${filePath} passed ${npmScript}`, issue);
  return true;
}

async function checkProxySmoke() {
  const baseUrl = process.env.ECHO_PROXY_BASE_URL || '';
  const allowedOrigin = process.env.ECHO_PROXY_SMOKE_ORIGIN || '';
  const sessionToken = process.env.ECHO_PROXY_SMOKE_SESSION_TOKEN || '';
  const evidenceOut = process.env.ECHO_PROXY_SMOKE_EVIDENCE_OUT || '';
  const evidenceOutPath = validateProxySmokeEvidenceOut(evidenceOut);

  const missingEnv = [
    ['ECHO_PROXY_BASE_URL', baseUrl],
    ['ECHO_PROXY_SMOKE_ORIGIN', allowedOrigin],
    ['ECHO_PROXY_SMOKE_SESSION_TOKEN', sessionToken],
    ['ECHO_PROXY_SMOKE_EVIDENCE_OUT', evidenceOut],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missingEnv.length > 0) {
    addCheck(
      'production proxy smoke',
      'blocked',
      `Set ${missingEnv.join(', ')}, then run readiness again. ECHO_PROXY_SMOKE_EVIDENCE_OUT should be a repo-local JSON path such as docs/proxy-smoke-evidence.json.`,
      PROXY_EVIDENCE_ISSUES,
    );
    return false;
  }

  if (!evidenceOutPath.ok) {
    addCheck(
      'production proxy smoke',
      'blocked',
      evidenceOutPath.detail,
      PROXY_EVIDENCE_ISSUES,
    );
    return false;
  }

  const result = await runNpm([
    '--prefix',
    'echo-api-proxy',
    'run',
    'smoke:deploy',
    '--',
    '--base-url',
    baseUrl,
    '--allowed-origin',
    allowedOrigin,
    '--evidence-out',
    evidenceOutPath.proxyRelativePath,
  ]);

  if (result.code !== 0) {
    addCheck('production proxy smoke', 'blocked', firstUsefulLine(result.output), PROXY_EVIDENCE_ISSUES);
    return false;
  }

  addCheck(
    'production proxy smoke',
    'passed',
    `smoke:deploy passed for ${baseUrl} and wrote ${evidenceOutPath.repoRelativePath}`,
    PROXY_EVIDENCE_ISSUES,
  );
  return true;
}

function validateProxySmokeEvidenceOut(value) {
  if (!value) {
    return {
      ok: false,
      detail: 'ECHO_PROXY_SMOKE_EVIDENCE_OUT is required.',
    };
  }

  if (!/^(?:\.{1,2}[\\/])?[A-Za-z0-9_.\-/\\]+\.json$/i.test(value)) {
    return {
      ok: false,
      detail: 'ECHO_PROXY_SMOKE_EVIDENCE_OUT must be a repo-local JSON path.',
    };
  }

  const resolvedPath = path.resolve(resolvedRepoRoot, value);
  const repoPrefix = `${resolvedRepoRoot}${path.sep}`;
  if (resolvedPath !== resolvedRepoRoot && !resolvedPath.startsWith(repoPrefix)) {
    return {
      ok: false,
      detail: 'ECHO_PROXY_SMOKE_EVIDENCE_OUT must stay inside the repository.',
    };
  }

  const repoRelativePath = path.relative(resolvedRepoRoot, resolvedPath).replace(/\\/g, '/');
  if (!repoRelativePath || repoRelativePath.startsWith('..') || path.isAbsolute(repoRelativePath)) {
    return {
      ok: false,
      detail: 'ECHO_PROXY_SMOKE_EVIDENCE_OUT must resolve to a file inside the repository.',
    };
  }

  const proxyRoot = path.resolve(resolvedRepoRoot, 'echo-api-proxy');
  const proxyRelativePath = path.relative(proxyRoot, resolvedPath).replace(/\\/g, '/');
  return {
    ok: true,
    repoRelativePath,
    proxyRelativePath,
  };
}

function checkReadmeLinks() {
  const readmePath = path.resolve(repoRoot, 'README.md');
  const readmeText = readFileSync(readmePath, 'utf8');
  let completedPilot = null;
  try {
    completedPilot = readCompletedPilotManifest();
  } catch (error) {
    addCheck(
      'README portfolio links',
      'blocked',
      `Could not read completed pilot manifest for README link comparison: ${error.message}`,
      '#10',
    );
    return false;
  }
  const findings = validateReadmePortfolioLinks(readmeText, completedPilot);

  if (findings.length > 0) {
    addCheck(
      'README portfolio links',
      'blocked',
      findings.slice(0, 3).join('; '),
      '#10',
    );
    return false;
  }

  addCheck('README portfolio links', 'passed', 'README links match the final case-study and real G2 video evidence.', '#10');
  return true;
}

async function checkKeyRotationEvidence() {
  const evidencePath = path.resolve(repoRoot, 'docs/key-rotation-evidence.md');
  if (!existsSync(evidencePath)) {
    addCheck(
      'provider key rotation evidence',
      'blocked',
      'Missing docs/key-rotation-evidence.md with rotation date, affected keys, deployment smoke JSON, session-token rotation evidence, artifact scan, and log review notes.',
      PROXY_EVIDENCE_ISSUES,
    );
    return false;
  }

  const result = await runNpm(['run', 'validate:key-rotation-evidence', '--', 'docs/key-rotation-evidence.md']);
  if (result.code !== 0) {
    addCheck('provider key rotation evidence', 'blocked', firstUsefulLine(result.output), PROXY_EVIDENCE_ISSUES);
    return false;
  }

  addCheck('provider key rotation evidence', 'passed', 'docs/key-rotation-evidence.md passed production evidence validation.', PROXY_EVIDENCE_ISSUES);
  return true;
}

function checkPortfolioAttributionDocs() {
  const readmePath = path.resolve(repoRoot, 'README.md');
  const creditsPath = path.resolve(repoRoot, 'CREDITS.md');
  const findings = [];

  if (!existsSync(readmePath)) {
    findings.push('Missing README.md');
  }

  if (!existsSync(creditsPath)) {
    findings.push('Missing CREDITS.md');
  }

  if (findings.length === 0) {
    const readmeText = readFileSync(readmePath, 'utf8');
    const creditsText = readFileSync(creditsPath, 'utf8');

    const readmeRequirements = [
      '## My role',
      'Product concept and UX architecture',
      'G2 HUD interaction design',
      'Audio/VAD integration',
      'AI cue policy',
      'Hardware usability testing',
      '## Built with',
      'Even Hub SDK',
      'even-toolkit, MIT License',
      'CREDITS.md',
    ];

    const creditsRequirements = [
      '## Original toolkit scope',
      'G2 bridge helpers',
      'Shared web components',
      'Shared icon catalog',
      'fabioglimb/even-toolkit',
      'MIT',
      '## Project ECHO contribution scope',
      'SessionEngine orchestration',
      'G2 microphone and VAD connection',
      'AI cue policy and fallback cue behavior',
      'Release-safety checks',
    ];

    for (const requirement of readmeRequirements) {
      if (!readmeText.includes(requirement)) {
        findings.push(`README.md must include ${requirement}`);
      }
    }

    for (const requirement of creditsRequirements) {
      if (!creditsText.includes(requirement)) {
        findings.push(`CREDITS.md must include ${requirement}`);
      }
    }
  }

  if (findings.length > 0) {
    addCheck('portfolio attribution docs', 'blocked', findings.slice(0, 3).join('; '), '#19');
    return false;
  }

  addCheck('portfolio attribution docs', 'passed', 'README and CREDITS distinguish original toolkit scope from Project ECHO contribution scope.', '#19');
  return true;
}

function checkEchoAppManifest() {
  const packagePath = path.resolve(repoRoot, 'even-app/package.json');
  const appPath = path.resolve(repoRoot, 'even-app/app.json');
  const publicAppPath = path.resolve(repoRoot, 'even-app/public/app.json');
  const findings = [];

  if (!existsSync(packagePath)) {
    findings.push('Missing even-app/package.json');
  }

  if (!existsSync(appPath)) {
    findings.push('Missing single-source even-app/app.json');
  }

  if (existsSync(publicAppPath)) {
    findings.push('Remove duplicated even-app/public/app.json');
  }

  if (findings.length === 0) {
    try {
      const packageJson = readJson(packagePath);
      const appJson = readJson(appPath);

      if (appJson.version !== packageJson.version) {
        findings.push(`app.json version ${appJson.version} must match package.json version ${packageJson.version}`);
      }

      validateOfficialEvenHubManifestShape(appJson, packageJson, findings);

      const permissions = Array.isArray(appJson.permissions) ? appJson.permissions : [];
      const permissionNames = permissions.map((permission) => permission?.name).filter(Boolean);
      for (const unusedPermission of ['camera', 'location']) {
        if (permissionNames.includes(unusedPermission)) {
          findings.push(`Remove unused ${unusedPermission} permission`);
        }
      }

      const networkPermission = permissions.find((permission) => permission?.name === 'network');
      const whitelist = Array.isArray(networkPermission?.whitelist)
        ? networkPermission.whitelist
        : [];

      if (!networkPermission) {
        findings.push('Missing network permission for ECHO API proxy');
      }

      if (!whitelist.includes('https://api.project-echo.app')) {
        findings.push('Network whitelist must include https://api.project-echo.app');
      }

      const unexpectedOrigins = whitelist.filter(
        (origin) => origin !== 'https://api.project-echo.app',
      );
      if (unexpectedOrigins.length > 0) {
        findings.push(`Network whitelist must only contain the ECHO API proxy origin; found ${unexpectedOrigins.join(', ')}`);
      }

      if (whitelist.some((origin) => /generativelanguage\.googleapis\.com|192\.168\./i.test(origin))) {
        findings.push('Network whitelist must not contain Google API or 192.168.* development origins');
      }
    } catch (error) {
      findings.push(`Could not validate even-app/app.json: ${error.message}`);
    }
  }

  if (findings.length > 0) {
    addCheck('single-source minimal app manifest', 'blocked', findings.slice(0, 3).join('; '), '#17');
    return false;
  }

  addCheck(
    'single-source minimal app manifest',
    'passed',
    'even-app/app.json is synchronized, unique, follows the official Even Hub manifest shape, and whitelists only the ECHO API proxy.',
    '#17',
  );
  return true;
}

function validateOfficialEvenHubManifestShape(appJson, packageJson, findings) {
  if (!/^([a-z][a-z0-9]*)(\.[a-z][a-z0-9]*)+$/.test(String(appJson.package_id ?? ''))) {
    findings.push('app.json package_id must use lowercase reverse-domain format with no hyphens or underscores');
  }

  if (appJson.edition !== OFFICIAL_EVENHUB_EDITION) {
    findings.push(`app.json edition must be ${OFFICIAL_EVENHUB_EDITION}`);
  }

  if (!isSemver(appJson.version)) {
    findings.push('app.json version must use x.y.z semver with no prefix or suffix');
  }

  if (typeof appJson.name !== 'string' || appJson.name.length === 0 || appJson.name.length > 20) {
    findings.push('app.json name must be 1-20 characters');
  }

  if (typeof appJson.name === 'string' && /even/i.test(appJson.name)) {
    findings.push('app.json name must not include Even without written approval');
  }

  if (appJson.entrypoint !== 'index.html') {
    findings.push('app.json entrypoint must be index.html for the packaged Vite build');
  }

  if (appJson.min_app_version !== '2.0.0') {
    findings.push('app.json min_app_version must be 2.0.0');
  }

  if (appJson.min_sdk_version !== OFFICIAL_EVENHUB_SDK_FLOOR) {
    findings.push(`app.json min_sdk_version must be ${OFFICIAL_EVENHUB_SDK_FLOOR}`);
  }

  if (packageJson.dependencies?.['@evenrealities/even_hub_sdk'] !== OFFICIAL_EVENHUB_SDK_FLOOR) {
    findings.push(`@evenrealities/even_hub_sdk must be pinned to ${OFFICIAL_EVENHUB_SDK_FLOOR}`);
  }

  if (!Array.isArray(appJson.supported_languages) || appJson.supported_languages.length === 0) {
    findings.push('app.json supported_languages must be a non-empty array');
  } else {
    for (const language of appJson.supported_languages) {
      if (!OFFICIAL_EVENHUB_LANGUAGES.has(language)) {
        findings.push(`app.json supported_languages contains unsupported language ${language}`);
      }
    }
  }

  if (!Array.isArray(appJson.permissions)) {
    findings.push('app.json permissions must be an array of permission objects');
    return;
  }

  for (const permission of appJson.permissions) {
    if (!permission || typeof permission !== 'object' || Array.isArray(permission)) {
      findings.push('app.json permissions must contain only objects');
      continue;
    }

    if (!OFFICIAL_EVENHUB_PERMISSION_NAMES.has(permission.name)) {
      findings.push(`app.json permission ${permission.name ?? '<missing>'} is not in the Even Hub permission set`);
    }

    if (typeof permission.desc !== 'string' || permission.desc.length < 1 || permission.desc.length > 300) {
      findings.push(`app.json permission ${permission.name ?? '<missing>'} must include a 1-300 character desc`);
    }

    if (permission.name === 'network') {
      if (!Array.isArray(permission.whitelist)) {
        findings.push('app.json network permission must include a whitelist array');
      } else {
        for (const origin of permission.whitelist) {
          if (!/^https:\/\/[^/?#]+$/i.test(String(origin))) {
            findings.push(`app.json network whitelist origin must be full https origin without path: ${origin}`);
          }
        }
      }
    }
  }
}

function isSemver(value) {
  return /^\d+\.\d+\.\d+$/.test(String(value ?? ''));
}

function checkManifestSummaries() {
  const pilotPath = path.resolve(repoRoot, 'docs/project-echo-pilot-evidence.completed.json');
  if (!existsSync(pilotPath)) return false;

  try {
    const pilot = readCompletedPilotManifest();
    if (pilot?.caseStudy?.readmeLinksUpdated !== true) {
      addCheck('pilot README link flag', 'blocked', 'Completed pilot manifest must set caseStudy.readmeLinksUpdated=true.', '#10');
      return false;
    }
    addCheck('pilot README link flag', 'passed', 'Completed pilot manifest marks README links updated.', '#10');
    return true;
  } catch (error) {
    addCheck('pilot README link flag', 'blocked', `Could not read completed pilot manifest: ${error.message}`, '#10');
    return false;
  }
}

function readCompletedPilotManifest() {
  const pilotPath = path.resolve(repoRoot, 'docs/project-echo-pilot-evidence.completed.json');
  if (!existsSync(pilotPath)) return null;
  return readJson(pilotPath);
}

function validateReadmePortfolioLinks(readmeText, completedPilot) {
  const findings = [];
  const lines = readmeText.split(/\r?\n/);

  for (const requirement of README_PORTFOLIO_LINKS) {
    const line = lines.find((candidate) => candidate.includes(requirement.marker));
    if (!line) {
      findings.push(`Missing README marker ${requirement.marker}`);
      continue;
    }

    const target = extractMarkdownLinkTarget(line);
    if (!target) {
      findings.push(`README marker ${requirement.marker} must be on a markdown link line`);
      continue;
    }

    if (!looksLikeEvidenceTarget(target, requirement.extensions)) {
      findings.push(`README marker ${requirement.marker} has invalid evidence target ${target}`);
      continue;
    }

    if (!evidenceTargetExists(target)) {
      findings.push(`README marker ${requirement.marker} repo path target must point to an existing file`);
      continue;
    }

    const manifestTarget = completedPilot?.caseStudy?.[requirement.manifestKey];
    if (manifestTarget && target !== manifestTarget) {
      findings.push(
        `README marker ${requirement.marker} must match completed pilot manifest target ${manifestTarget}`,
      );
    }
  }

  return findings;
}

function extractMarkdownLinkTarget(line) {
  const match = line.match(/\[[^\]]+\]\(([^)\s]+)\)/);
  return match?.[1] ?? null;
}

function looksLikeEvidenceTarget(value, extensions) {
  const trimmed = String(value ?? '').trim();
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;
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
  const resolvedPath = path.resolve(resolvedRepoRoot, trimmed);
  const repoPrefix = `${resolvedRepoRoot}${path.sep}`;
  if (resolvedPath !== resolvedRepoRoot && !resolvedPath.startsWith(repoPrefix)) {
    return false;
  }
  return existsSync(resolvedPath);
}

function firstUsefulLine(output) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('> '));
  return lines[0] || 'command failed';
}

function printReport() {
  console.info('# Project ECHO Release Readiness');
  console.info('');
  for (const check of checks) {
    const marker = check.status === 'passed' ? 'PASS' : 'BLOCKED';
    const issue = check.issue ? ` ${check.issue}` : '';
    console.info(`- ${marker}${issue}: ${check.name} - ${check.detail}`);
  }
  console.info('');
}

await validateFinalManifest({
  label: 'completed pilot evidence manifest',
  filePath: 'docs/project-echo-pilot-evidence.completed.json',
  npmScript: 'validate:pilot-evidence',
  issue: '#5/#10',
  missingDetail: 'Missing docs/project-echo-pilot-evidence.completed.json with 5-user real G2 pilot, VAD environment metrics, case-study links, and real G2 video evidence.',
});

checkEchoAppManifest();
checkPortfolioAttributionDocs();

await validateFinalManifest({
  label: 'completed hardware QA manifest',
  filePath: 'docs/project-echo-hardware-qa.completed.json',
  npmScript: 'validate:hardware-qa',
  issue: '#2/#3/#4/#6/#12/#13/#14/#28',
  missingDetail: 'Missing docs/project-echo-hardware-qa.completed.json with .ehpk build-artifact hash, physical G2 lifecycle, wear status, HUD, Assist, delayed-proxy, lazy-loaded voice runtime, explicit G2/Phone audio-source evidence, and two-speaker conversation timeline evidence.',
});

await validateFinalManifest({
  label: 'completed ChatGPT Action evidence manifest',
  filePath: 'docs/project-echo-chatgpt-action-evidence.completed.json',
  npmScript: 'validate:chatgpt-action-evidence',
  issue: '#29',
  missingDetail: 'Missing docs/project-echo-chatgpt-action-evidence.completed.json with deployed Custom GPT Action/OAuth endpoint proof, privacy rejection evidence, and G2/audio-level active-recall pronunciation evidence.',
});

checkManifestSummaries();
await checkProxySmoke();
await checkKeyRotationEvidence();
checkReadmeLinks();

printReport();

const blocked = checks.filter((check) => check.status !== 'passed');
if (blocked.length > 0) {
  console.error(`[readiness] ${blocked.length} blocker(s) remain`);
  process.exit(1);
}

console.info('[readiness] Project ECHO release evidence is complete');
