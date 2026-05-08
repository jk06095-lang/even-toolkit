/**
 * Topic Selector View — inline topic selection before combat session.
 * Shows category tabs and scenario cards with situation descriptions.
 * Uses existing design system tokens only.
 */

import { SCENARIOS, CATEGORY_META, getScenariosByCategory, getCategories, type TopicCategory, type TopicScenario } from '../combat/topic-registry';

/**
 * Render the full topic selector (categories + scenario cards).
 * Returns HTML string to be inserted into the combat phase area.
 */
export function renderTopicSelector(selectedId?: string): string {
  const categories = getCategories();
  const firstCat = categories[0] ?? 'daily';

  const categoryTabs = categories
    .map((cat) => {
      const meta = CATEGORY_META[cat];
      return `<button class="week-btn topic-cat-tab" data-cat="${cat}">${meta.emoji} ${meta.label}</button>`;
    })
    .join('');

  return `
    <div id="topic-selector">
      <div class="card">
        <div class="card-header">
          <div class="icon" style="background: var(--color-surface-light)">🎯</div>
          <h3>Choose Your Scenario</h3>
        </div>

        <div class="week-selector" id="topic-category-tabs" style="flex-wrap: wrap; gap: 6px;">
          ${categoryTabs}
        </div>

        <div id="topic-scenario-grid" style="margin-top: var(--spacing-cross);"></div>
      </div>

      <div id="topic-detail-card" class="card" style="display: none;">
        <div class="card-header">
          <div class="icon" id="topic-detail-emoji" style="background: var(--phase2-alpha); color: var(--phase2); font-size: 20px;"></div>
          <h3 id="topic-detail-label"></h3>
        </div>
        <div style="margin-bottom: var(--spacing-same);">
          <div class="text-normal-body" id="topic-detail-situation" style="color: var(--color-text); line-height: 1.6; margin-bottom: 8px;"></div>
          <div style="display: flex; gap: 12px; margin-bottom: 8px;">
            <span class="badge badge-accent" id="topic-detail-role"></span>
            <span class="badge badge-neutral" id="topic-detail-goal" style="flex: 1; text-align: left; white-space: normal; height: auto;"></span>
          </div>
        </div>
        <div style="margin-bottom: var(--spacing-cross);">
          <p class="text-subtitle" style="color: var(--color-text-dim); margin-bottom: 6px;">Key Expressions</p>
          <ul id="topic-detail-expressions" style="list-style: none; padding: 0; margin: 0;"></ul>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render scenario cards for a given category.
 */
export function renderScenarioGrid(category: TopicCategory, selectedId?: string): string {
  const scenarios = getScenariosByCategory(category);
  return scenarios
    .map((s) => {
      const isSelected = s.id === selectedId;
      const border = isSelected ? 'border: 2px solid var(--phase2);' : 'border: 1px solid var(--color-border);';
      return `
        <div class="topic-scenario-card" data-scenario="${s.id}" 
             style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; margin-bottom: 6px; 
                    background: var(--color-surface-light); border-radius: var(--radius); cursor: pointer; 
                    ${border} transition: border-color 0.15s ease;">
          <span style="font-size: 22px; flex-shrink: 0;">${s.emoji}</span>
          <div style="flex: 1; min-width: 0;">
            <div class="text-normal-body" style="color: var(--color-text); font-weight: 500;">${s.label}</div>
            <div class="text-detail" style="color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${s.situation}</div>
          </div>
        </div>
      `;
    })
    .join('');
}

/**
 * Populate the detail card with a specific scenario's data.
 */
export function fillTopicDetail(scenario: TopicScenario): void {
  const el = (id: string) => document.getElementById(id);
  const card = el('topic-detail-card');
  if (!card) return;
  card.style.display = 'block';

  const emoji = el('topic-detail-emoji');
  if (emoji) emoji.textContent = scenario.emoji;

  const label = el('topic-detail-label');
  if (label) label.textContent = scenario.label;

  const situation = el('topic-detail-situation');
  if (situation) situation.textContent = scenario.situation;

  const role = el('topic-detail-role');
  if (role) role.textContent = `Partner: ${scenario.partnerRole}`;

  const goal = el('topic-detail-goal');
  if (goal) goal.textContent = `Goal: ${scenario.userGoal}`;

  const exprList = el('topic-detail-expressions');
  if (exprList) {
    exprList.innerHTML = scenario.keyExpressions
      .map((expr) => `<li style="padding: 4px 0; color: var(--color-text); font-size: 13px; border-bottom: 1px solid var(--color-border);">
        <span style="color: var(--phase2); margin-right: 6px;">▸</span>${expr}
      </li>`)
      .join('');
  }
}
