import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  HARDWARE_QA_EVIDENCE_ISSUES,
  READINESS_HANDOFF_PATH,
  validateReadmePortfolioLinks,
  validateProxySmokeEvidenceOut,
} from './echo-release-readiness.mjs';

const repoRoot = process.cwd();

test('accepts repo-local proxy smoke evidence JSON and converts it for echo-api-proxy cwd', () => {
  const result = validateProxySmokeEvidenceOut('docs/proxy-smoke-evidence.json', { repoRoot });

  assert.equal(result.ok, true);
  assert.equal(result.repoRelativePath, 'docs/proxy-smoke-evidence.json');
  assert.equal(result.proxyRelativePath, '../docs/proxy-smoke-evidence.json');
});

test('accepts nested repo-local evidence JSON paths', () => {
  const result = validateProxySmokeEvidenceOut('docs/evidence/proxy/smoke.json', { repoRoot });

  assert.equal(result.ok, true);
  assert.equal(result.repoRelativePath, 'docs/evidence/proxy/smoke.json');
  assert.equal(result.proxyRelativePath, '../docs/evidence/proxy/smoke.json');
});

test('rejects missing, non-json, absolute, and parent-traversal smoke evidence paths', () => {
  const cases = [
    '',
    'docs/proxy-smoke-evidence.md',
    '../outside.json',
    path.resolve(repoRoot, '..', 'outside.json'),
  ];

  for (const value of cases) {
    const result = validateProxySmokeEvidenceOut(value, { repoRoot });
    assert.equal(result.ok, false, `${value} should be rejected`);
    assert.match(result.detail, /ECHO_PROXY_SMOKE_EVIDENCE_OUT/);
  }
});

test('tracks only open issue numbers in the hardware QA evidence blocker', () => {
  assert.equal(HARDWARE_QA_EVIDENCE_ISSUES, '#2/#3/#6/#12/#13/#14/#28');
  assert.equal(HARDWARE_QA_EVIDENCE_ISSUES.includes('#4'), false);
});

test('points blocked readiness runs to the field handoff document', () => {
  assert.equal(READINESS_HANDOFF_PATH, 'docs/project-echo-readiness-handoff.md');
  const handoffPath = path.resolve(repoRoot, READINESS_HANDOFF_PATH);
  assert.equal(existsSync(handoffPath), true);

  const handoff = readFileSync(handoffPath, 'utf8');
  assert.match(handoff, /Remaining Evidence Gates/);
  assert.match(handoff, /Next Execution Order/);
  assert.match(handoff, /Do not fabricate/);
});

test('does not treat README marker prose as final portfolio links', () => {
  const findings = validateReadmePortfolioLinks(readmeMarkerProseFixture(), completedPilotFixture());

  assert.deepEqual(findings, ['Missing README portfolio evidence link block']);
});

test('validates README portfolio links only inside the generated block', () => {
  const pilot = completedPilotFixture();
  const findings = validateReadmePortfolioLinks(`
# even-toolkit

<!-- project-echo-portfolio-links:start -->
Final Project ECHO portfolio evidence links:
- [Project ECHO case study (KO)](${pilot.caseStudy.koreanCaseStudyUrl}) <!-- project-echo-case-study-ko -->
- [Project ECHO case study (EN)](${pilot.caseStudy.englishCaseStudyUrl}) <!-- project-echo-case-study-en -->
- [Project ECHO real G2 video](${pilot.caseStudy.realG2VideoUrl}) <!-- project-echo-real-g2-video -->
<!-- project-echo-portfolio-links:end -->

Final portfolio links must carry \`project-echo-case-study-ko\`,
\`project-echo-case-study-en\`, and \`project-echo-real-g2-video\`.
`, pilot);

  assert.deepEqual(findings, []);
});

function readmeMarkerProseFixture() {
  return `
# even-toolkit

## Project ECHO Evidence

Final portfolio links must be markdown links carrying the markers
\`project-echo-case-study-ko\`,
\`project-echo-case-study-en\`, and \`project-echo-real-g2-video\`.
`;
}

function completedPilotFixture() {
  return {
    caseStudy: {
      koreanCaseStudyUrl: 'https://portfolio.project-echo.test/project-echo-case-study.ko.md',
      englishCaseStudyUrl: 'https://portfolio.project-echo.test/project-echo-case-study.en.md',
      realG2VideoUrl: 'https://portfolio.project-echo.test/project-echo-real-g2-video.mp4',
    },
  };
}
