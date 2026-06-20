import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  DRAFT_SUPPORT_FILES,
  FINAL_EVIDENCE_GATES,
  buildEvidenceStatus,
  formatEvidenceStatus,
} from './echo-evidence-status.mjs';
import { READINESS_HANDOFF_PATH } from './echo-release-readiness.mjs';

test('reports missing final evidence without treating draft support as complete', () => {
  const availableFiles = new Set([
    READINESS_HANDOFF_PATH,
    ...DRAFT_SUPPORT_FILES.map((draft) => draft.path),
  ]);
  const status = buildEvidenceStatus({
    fileExists: (filePath) => availableFiles.has(filePath),
    readText: () => '# README without final portfolio links\n',
  });

  assert.equal(status.missingFinalCount, FINAL_EVIDENCE_GATES.length);
  assert.equal(status.missingDraftCount, 0);
  assert.equal(status.finalGates.every((gate) => gate.status === 'missing'), true);
  assert.equal(status.draftFiles.every((draft) => draft.status === 'available'), true);

  const formatted = formatEvidenceStatus(status);
  assert.match(formatted, /Informational only/);
  assert.match(formatted, /npm run readiness:echo/);
  assert.match(formatted, /MISSING #5\/#10: completed 5-user pilot manifest/);
  assert.match(formatted, /Draft support: docs\/evidence-drafts\/project-echo-pilot-evidence\.draft\.json \(available\)/);
});

test('detects present completed artifacts and README portfolio block', () => {
  const availableFiles = new Set([
    READINESS_HANDOFF_PATH,
    ...DRAFT_SUPPORT_FILES.map((draft) => draft.path),
    ...FINAL_EVIDENCE_GATES
      .filter((gate) => !gate.readmeBlock)
      .map((gate) => gate.artifact),
  ]);
  const readme = `
# README

<!-- project-echo-portfolio-links:start -->
- [Project ECHO case study (KO)](docs/project-echo-case-study.ko.md) <!-- project-echo-case-study-ko -->
- [Project ECHO case study (EN)](docs/project-echo-case-study.en.md) <!-- project-echo-case-study-en -->
- [Project ECHO real G2 video](docs/project-echo-real-g2-video.mp4) <!-- project-echo-real-g2-video -->
<!-- project-echo-portfolio-links:end -->
`;

  const status = buildEvidenceStatus({
    fileExists: (filePath) => availableFiles.has(filePath),
    readText: () => readme,
  });

  assert.equal(status.missingFinalCount, 0);
  assert.equal(status.finalGates.every((gate) => gate.status === 'present'), true);
  assert.match(formatEvidenceStatus(status), /Summary: 0 final gate\(s\) missing/);
});
