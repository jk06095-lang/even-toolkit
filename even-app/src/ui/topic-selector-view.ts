/**
 * Topic Selector View - inline topic selection before live practice.
 * Shows category tabs and scenario cards with situation descriptions.
 * Uses existing design system tokens only.
 */

import {
  CATEGORY_META,
  getCategories,
  getScenariosByCategory,
  type TopicCategory,
  type TopicScenario,
} from '../combat/topic-registry';

/**
 * Render the full topic selector (categories + scenario cards).
 * Returns static HTML for template checks. Runtime mounting uses
 * createTopicSelectorElement() so scenario data is assigned via textContent.
 */
export function renderTopicSelector(selectedId?: string): string {
  const categories = getCategories();

  const categoryTabs = categories
    .map((cat) => {
      const meta = CATEGORY_META[cat];
      return `<button class="week-btn topic-cat-tab" data-cat="${escapeHtmlAttribute(cat)}">${escapeHtml(meta.emoji)} ${escapeHtml(meta.label)}</button>`;
    })
    .join('');

  return `
    <div id="topic-selector">
      <div class="card">
        <div class="card-header">
          <div class="icon" style="background: var(--color-surface-light)">SC</div>
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
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <button class="btn btn-highlight btn-full" id="btn-start-scenario">Start Scenario Practice</button>
          <button class="btn btn-neutral btn-full" id="btn-change-topic" style="background: transparent; color: var(--color-text-dim);">Change Topic</button>
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
        <div class="topic-scenario-card" data-scenario="${escapeHtmlAttribute(s.id)}"
             style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; margin-bottom: 6px;
                    background: var(--color-surface-light); border-radius: var(--radius); cursor: pointer;
                    ${border} transition: border-color 0.15s ease;">
          <span style="font-size: 22px; flex-shrink: 0;">${escapeHtml(s.emoji)}</span>
          <div style="flex: 1; min-width: 0;">
            <div class="text-normal-body" style="color: var(--color-text); font-weight: 500;">${escapeHtml(s.label)}</div>
            <div class="text-detail" style="color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(s.situation)}</div>
          </div>
        </div>
      `;
    })
    .join('');
}

/**
 * Build the runtime topic selector using DOM APIs. Dynamic category/scenario
 * strings never pass through innerHTML.
 */
export function createTopicSelectorElement(): HTMLElement {
  const root = document.createElement('div');
  root.id = 'topic-selector';

  const selectorCard = document.createElement('div');
  selectorCard.className = 'card';

  const header = document.createElement('div');
  header.className = 'card-header';

  const icon = document.createElement('div');
  icon.className = 'icon';
  icon.style.background = 'var(--color-surface-light)';
  icon.textContent = 'SC';

  const title = document.createElement('h3');
  title.textContent = 'Choose Your Scenario';
  header.append(icon, title);

  const tabs = document.createElement('div');
  tabs.className = 'week-selector';
  tabs.id = 'topic-category-tabs';
  tabs.style.flexWrap = 'wrap';
  tabs.style.gap = '6px';

  tabs.replaceChildren(...getCategories().map((cat) => {
    const meta = CATEGORY_META[cat];
    const button = document.createElement('button');
    button.className = 'week-btn topic-cat-tab';
    button.dataset.cat = cat;
    button.textContent = `${meta.emoji} ${meta.label}`;
    return button;
  }));

  const grid = document.createElement('div');
  grid.id = 'topic-scenario-grid';
  grid.style.marginTop = 'var(--spacing-cross)';

  selectorCard.append(header, tabs, grid);
  root.append(selectorCard, createTopicDetailCard());
  return root;
}

export function fillScenarioGrid(
  grid: HTMLElement,
  category: TopicCategory,
  selectedId?: string,
): void {
  grid.replaceChildren(...getScenariosByCategory(category).map((scenario) => {
    const card = document.createElement('div');
    card.className = 'topic-scenario-card';
    card.dataset.scenario = scenario.id;
    card.style.cssText = [
      'display: flex',
      'align-items: center',
      'gap: 10px',
      'padding: 10px 12px',
      'margin-bottom: 6px',
      'background: var(--color-surface-light)',
      'border-radius: var(--radius)',
      'cursor: pointer',
      scenario.id === selectedId
        ? 'border: 2px solid var(--phase2)'
        : 'border: 1px solid var(--color-border)',
      'transition: border-color 0.15s ease',
    ].join('; ');

    const emoji = document.createElement('span');
    emoji.style.fontSize = '22px';
    emoji.style.flexShrink = '0';
    emoji.textContent = scenario.emoji;

    const body = document.createElement('div');
    body.style.flex = '1';
    body.style.minWidth = '0';

    const label = document.createElement('div');
    label.className = 'text-normal-body';
    label.style.color = 'var(--color-text)';
    label.style.fontWeight = '500';
    label.textContent = scenario.label;

    const situation = document.createElement('div');
    situation.className = 'text-detail';
    situation.style.color = 'var(--color-text-muted)';
    situation.style.whiteSpace = 'nowrap';
    situation.style.overflow = 'hidden';
    situation.style.textOverflow = 'ellipsis';
    situation.textContent = scenario.situation;

    body.append(label, situation);
    card.append(emoji, body);
    return card;
  }));
}

function createTopicDetailCard(): HTMLElement {
  const card = document.createElement('div');
  card.id = 'topic-detail-card';
  card.className = 'card';
  card.style.display = 'none';

  const header = document.createElement('div');
  header.className = 'card-header';

  const icon = document.createElement('div');
  icon.className = 'icon';
  icon.id = 'topic-detail-emoji';
  icon.style.background = 'var(--phase2-alpha)';
  icon.style.color = 'var(--phase2)';
  icon.style.fontSize = '20px';

  const title = document.createElement('h3');
  title.id = 'topic-detail-label';
  header.append(icon, title);

  const detail = document.createElement('div');
  detail.style.marginBottom = 'var(--spacing-same)';

  const situation = document.createElement('div');
  situation.className = 'text-normal-body';
  situation.id = 'topic-detail-situation';
  situation.style.color = 'var(--color-text)';
  situation.style.lineHeight = '1.6';
  situation.style.marginBottom = '8px';

  const badges = document.createElement('div');
  badges.style.display = 'flex';
  badges.style.gap = '12px';
  badges.style.marginBottom = '8px';

  const role = document.createElement('span');
  role.className = 'badge badge-accent';
  role.id = 'topic-detail-role';

  const goal = document.createElement('span');
  goal.className = 'badge badge-neutral';
  goal.id = 'topic-detail-goal';
  goal.style.flex = '1';
  goal.style.textAlign = 'left';
  goal.style.whiteSpace = 'normal';
  goal.style.height = 'auto';
  badges.append(role, goal);
  detail.append(situation, badges);

  const expressions = document.createElement('div');
  expressions.style.marginBottom = 'var(--spacing-cross)';

  const expressionTitle = document.createElement('p');
  expressionTitle.className = 'text-subtitle';
  expressionTitle.style.color = 'var(--color-text-dim)';
  expressionTitle.style.marginBottom = '6px';
  expressionTitle.textContent = 'Key Expressions';

  const expressionList = document.createElement('ul');
  expressionList.id = 'topic-detail-expressions';
  expressionList.style.listStyle = 'none';
  expressionList.style.padding = '0';
  expressionList.style.margin = '0';
  expressions.append(expressionTitle, expressionList);

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.flexDirection = 'column';
  actions.style.gap = '8px';

  const startButton = document.createElement('button');
  startButton.className = 'btn btn-highlight btn-full';
  startButton.id = 'btn-start-scenario';
  startButton.textContent = 'Start Scenario Practice';

  const changeButton = document.createElement('button');
  changeButton.className = 'btn btn-neutral btn-full';
  changeButton.id = 'btn-change-topic';
  changeButton.style.background = 'transparent';
  changeButton.style.color = 'var(--color-text-dim)';
  changeButton.textContent = 'Change Topic';
  actions.append(startButton, changeButton);

  card.append(header, detail, expressions, actions);
  return card;
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
    exprList.replaceChildren(...scenario.keyExpressions.map((expr) => {
      const item = document.createElement('li');
      item.style.padding = '4px 0';
      item.style.color = 'var(--color-text)';
      item.style.fontSize = '13px';
      item.style.borderBottom = '1px solid var(--color-border)';

      const bullet = document.createElement('span');
      bullet.style.color = 'var(--phase2)';
      bullet.style.marginRight = '6px';
      bullet.textContent = '-';

      item.append(bullet, document.createTextNode(expr));
      return item;
    }));
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value);
}
