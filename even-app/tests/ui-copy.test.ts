import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { renderAmbientView } from '../src/ui/ambient-view';
import { renderAppShell } from '../src/ui/app-shell';
import { renderCalibrationView } from '../src/ui/calibration-view';
import { renderCombatView } from '../src/ui/combat-view';
import { renderDebriefView } from '../src/ui/debrief-view';
import { renderTopicSelector } from '../src/ui/topic-selector-view';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '..');

const renderedTemplates = [
  ['app shell', renderAppShell()],
  ['calibration', renderCalibrationView()],
  ['live practice', renderCombatView()],
  ['review', renderDebriefView()],
  ['echo reminders', renderAmbientView()],
  ['topic selector', renderTopicSelector()],
] as const;

describe('Project ECHO UI copy', () => {
  it('keeps learner-facing templates free of malformed placeholder fragments', () => {
    for (const [name, html] of renderedTemplates) {
      expect(html, name).not.toMatch(/\?\?\/(?:span|div)>/);
      expect(html, name).not.toContain('\uFFFD');
      expect(html, name).not.toMatch(/[🎙📡⏰📭📈📊]/u);
    }
  });

  it('uses product-facing Live Practice and Review labels instead of internal phase labels', () => {
    expect(renderAppShell()).toContain('Calibration');
    expect(renderAppShell()).toContain('Live Practice');
    expect(renderAppShell()).toContain('Review');
    expect(renderAppShell()).toContain('Echo Reminders');

    expect(renderCombatView()).toContain('Live Practice');
    expect(renderDebriefView()).toContain('Review');

    for (const [name, html] of renderedTemplates) {
      expect(html, name).not.toMatch(/Phase\s+\d/i);
    }
  });

  it('keeps the phone conversation timeline mounted in Live Practice markup', () => {
    const html = renderCombatView();

    expect(html).toContain('id="live-conversation-timeline-container"');
    expect(html).toContain('id="live-conversation-timeline"');
    expect(html).toContain('Conversation Timeline');
  });

  it('shows schema-versioned review import and imported-item management surfaces', () => {
    const reviewHtml = renderDebriefView();
    const ambientHtml = renderAmbientView();

    expect(reviewHtml).toContain('"importKind": "echo_review_items"');
    expect(reviewHtml).toContain('"meaningKo": "다시 말해 달라고 요청하기"');
    expect(reviewHtml).not.toContain('?ㅼ떆');
    expect(reviewHtml).toContain('<div class="label">Source</div>');
    expect(reviewHtml).not.toContain('<div class="label">Intensity</div>');

    expect(ambientHtml).toContain('Imported Review Items');
    expect(ambientHtml).toContain('id="imported-review-list"');
    expect(ambientHtml).toContain('id="imported-review-count"');
    expect(ambientHtml).toContain('id="btn-recall-phone-speech-start"');
    expect(ambientHtml).toContain('id="btn-recall-g2-speech-start"');
    expect(ambientHtml).toContain('Reminder Log');
    expect(ambientHtml).not.toContain('Exposure Log');
  });

  it('keeps app shell metadata ASCII-safe for packaged output', () => {
    const indexHtml = readFileSync(path.join(appRoot, 'index.html'), 'utf8');

    expect(indexHtml).toContain('Project ECHO - 24/7 Immersion English Education');
    expect(indexHtml).toContain('href="/favicon.svg"');
    expect(indexHtml).not.toContain('\u2014');
    expect(indexHtml).not.toContain('\u2192');
  });

  it('keeps dynamic learner-facing copy calm and free of mojibake fragments', () => {
    const calibrationSource = readFileSync(
      path.join(appRoot, 'src', 'calibration', 'calibration-controller.ts'),
      'utf8',
    );
    const livePracticeSource = readFileSync(
      path.join(appRoot, 'src', 'live-practice', 'live-practice-controller.ts'),
      'utf8',
    );
    const debriefSource = readFileSync(
      path.join(appRoot, 'src', 'debrief', 'debrief-controller.ts'),
      'utf8',
    );
    const topicSelectorSource = readFileSync(
      path.join(appRoot, 'src', 'ui', 'topic-selector-view.ts'),
      'utf8',
    );
    const hudLifecycleSource = readFileSync(path.join(appRoot, 'src', 'hud', 'hud-lifecycle.ts'), 'utf8');
    const pitchSource = readFileSync(path.join(repoRoot, 'echo-pitch', 'src', 'main.js'), 'utf8');

    expect(calibrationSource).toContain('Voice detected');
    expect(calibrationSource).not.toContain('??Voice detected');
    expect(calibrationSource).not.toContain('\u25CF Voice detected');
    expect(calibrationSource).not.toContain('\uFFFD');

    expect(livePracticeSource).toContain('Nice recovery');
    expect(livePracticeSource).toContain('Try simpler');
    expect(livePracticeSource).toContain('G2 Mic');
    expect(livePracticeSource).toContain('Phone Mic');
    expect(livePracticeSource).toContain('data-live-speaker-turn');
    expect(livePracticeSource).toContain('correctConversationTurnSpeaker');
    expect(livePracticeSource).not.toContain('currentActiveHint');
    expect(livePracticeSource).not.toContain('markActiveHintUsedIfPresent');
    expect(livePracticeSource).not.toMatch(/\?[\uAC00-\uD7A3]/);
    expect(livePracticeSource).not.toContain('\uCA0C');
    expect(livePracticeSource).not.toContain('Great! You used');
    expect(livePracticeSource).not.toContain('Easier:');
    expect(livePracticeSource).not.toContain('innerHTML = renderTopicSelector');
    expect(livePracticeSource).not.toContain('innerHTML = renderScenarioGrid');

    expect(debriefSource).toContain('getDebriefImportSourceLabel');
    expect(debriefSource).toContain('legacy intervals');
    expect(debriefSource).not.toContain('fsi_stress_level ??');
    expect(debriefSource).not.toContain('`| intervals:');

    expect(topicSelectorSource).toContain('createTopicSelectorElement');
    expect(topicSelectorSource).toContain('fillScenarioGrid');
    expect(topicSelectorSource).toContain('replaceChildren');
    expect(topicSelectorSource).toContain('textContent');

    expect(hudLifecycleSource).toContain('replaceChildren');
    expect(hudLifecycleSource).toContain('textContent');
    expect(hudLifecycleSource).not.toContain('innerHTML');
    expect(hudLifecycleSource).not.toContain('\uFFFD');

    expect(pitchSource).toContain('Glanceable Fluency Coach');
    expect(pitchSource).not.toMatch(/Stealth Tutor|STEALTH TUTOR|PATTERN ACQUIRED|GREAT JOB|SILENCE DETECTED/);
  });
});
