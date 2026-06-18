import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { renderCombatView } from '../src/ui/combat-view';
import { renderDebriefView } from '../src/ui/debrief-view';
import { renderTopicSelector } from '../src/ui/topic-selector-view';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const renderedTemplates = [
  ['live practice', renderCombatView()],
  ['review', renderDebriefView()],
  ['topic selector', renderTopicSelector()],
] as const;

describe('Project ECHO UI copy', () => {
  it('keeps learner-facing templates free of malformed placeholder fragments', () => {
    for (const [name, html] of renderedTemplates) {
      expect(html, name).not.toMatch(/\?\?\/(?:span|div)>/);
      expect(html, name).not.toContain('\uFFFD');
    }
  });

  it('uses product-facing Live Practice and Review labels instead of internal phase labels', () => {
    expect(renderCombatView()).toContain('Live Practice');
    expect(renderCombatView()).not.toContain('Phase 2');

    expect(renderDebriefView()).toContain('Review');
    expect(renderDebriefView()).not.toContain('Phase 3');
  });

  it('keeps app shell metadata ASCII-safe for packaged output', () => {
    const indexHtml = readFileSync(path.join(appRoot, 'index.html'), 'utf8');

    expect(indexHtml).toContain('Project ECHO - 24/7 Immersion English Education');
    expect(indexHtml).toContain('href="/favicon.svg"');
    expect(indexHtml).not.toContain('\u2014');
    expect(indexHtml).not.toContain('\u2192');
  });
});
