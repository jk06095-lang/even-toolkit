/**
 * Combat View — Phase 2 UI
 * Uses Even Realities design system tokens.
 */

import { WEEK_CONFIGS } from '../combat/session-engine';

export function renderCombatView(): string {
  const weekOptions = Object.values(WEEK_CONFIGS)
    .map((w) => `<button class="week-btn" data-week="${w.week}">W${w.week}</button>`)
    .join('');

  return `
    <div class="phase-view" id="phase2-view">
      <div class="phase-indicator p2">● Phase 2 — Live Combat</div>

      <div class="card">
        <div class="card-header">
          <div class="icon" style="background: var(--color-surface-light)">📅</div>
          <h3>Week</h3>
        </div>
        <div class="week-selector" id="week-selector">${weekOptions}</div>
        <p class="text-detail" id="week-desc" style="text-align: center; color: var(--color-text-dim);"></p>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="icon" style="background: var(--color-surface-light)">🎯</div>
          <h3>Topic</h3>
        </div>
        <div class="select-group">
          <select id="topic-select">
            <option value="general">General Practice</option>
            <option value="nampodong" selected>남포동 Local Guide</option>
            <option value="business">Business Meeting</option>
            <option value="travel">Travel & Directions</option>
            <option value="food">Food & Restaurant</option>
          </select>
        </div>
      </div>

      <div class="card" id="session-card">
        <div class="card-header">
          <div class="icon" style="background: var(--phase2-alpha); color: var(--phase2)">⚔</div>
          <h3>Combat Session</h3>
          <span class="badge badge-neutral" id="session-status">Standby</span>
        </div>

        <div style="display: flex; align-items: center; margin-bottom: var(--spacing-same); justify-content: space-between;">
          <div style="display: flex; align-items: center;">
            <span class="status-dot idle" id="vad-dot"></span>
            <span class="text-normal-body" style="color: var(--color-text-dim)" id="vad-label">VAD Inactive</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="text-detail" id="audio-source-label" style="color: var(--color-text-muted); background: var(--color-surface-light); padding: 2px 6px; border-radius: 3px; display: none;">—</span>
            <div class="waveform-container" id="waveform-container" title="Mic Volume">
              <div class="waveform-bar" id="wb-0"></div>
              <div class="waveform-bar" id="wb-1"></div>
              <div class="waveform-bar" id="wb-2"></div>
              <div class="waveform-bar" id="wb-3"></div>
              <div class="waveform-bar" id="wb-4"></div>
            </div>
          </div>
        </div>

        <div id="live-transcript-container" style="display: none; background: var(--color-accent-alpha); padding: 10px 12px; border-radius: var(--radius); margin-bottom: var(--spacing-same); border-left: 3px solid var(--color-accent); min-height: 36px; transition: all 0.15s ease;">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
            <span class="status-dot listening" style="width: 6px; height: 6px;"></span>
            <span class="text-detail" style="color: var(--color-text-dim);">Speaking now...</span>
          </div>
          <span id="live-transcript-text" class="text-normal-body" style="color: var(--color-text);"></span>
        </div>

        <div id="transcript-display" style="display: none; background: var(--color-surface-light); padding: 10px 12px; border-radius: var(--radius); margin-bottom: var(--spacing-same); border-left: 3px solid var(--color-positive); transition: all 0.2s ease;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <span class="text-detail" style="color: var(--color-text-dim);">Recognized:</span>
            <span class="text-detail" id="speech-timing" style="color: var(--color-text-muted); font-family: var(--font-mono);">—</span>
          </div>
          <span id="transcript-text" class="text-normal-body" style="color: var(--color-text); font-style: italic;"></span>
        </div>

        <div class="silence-meter">
          <div class="fill" id="silence-fill" style="width: 0%"></div>
        </div>
        <div class="flex justify-between" style="margin-top: 2px;">
          <span class="text-detail" style="color: var(--color-text-muted)">0s</span>
          <span class="text-detail" style="color: var(--color-text-muted)" id="silence-threshold-label">3s threshold</span>
        </div>

        <div id="chunk-display" style="display: none;"></div>

        <div style="margin-top: var(--spacing-cross); display: flex; gap: var(--spacing-same);">
          <button class="btn btn-highlight btn-full" id="btn-start-session">Start Session</button>
          <button class="btn btn-danger" id="btn-stop-session" style="display: none;">Stop</button>
        </div>
      </div>

      <div class="card" id="live-stats-card" style="display: none;">
        <div class="card-header">
          <div class="icon" style="background: var(--color-surface-light)">📊</div>
          <h3>Session Stats</h3>
        </div>
        <div class="stats-grid">
          <div class="stat-item">
            <div class="value" id="stat-hints">0</div>
            <div class="label">Hints</div>
          </div>
          <div class="stat-item">
            <div class="value" style="color: var(--color-positive)" id="stat-speeches">0</div>
            <div class="label">Speeches</div>
          </div>
          <div class="stat-item">
            <div class="value" style="color: var(--color-negative)" id="stat-silences">0</div>
            <div class="label">Silences</div>
          </div>
          <div class="stat-item">
            <div class="value" style="color: var(--phase1)" id="stat-self-rate">0%</div>
            <div class="label">Self Rate</div>
          </div>
        </div>
      </div>

      <div class="card" id="hint-history-card" style="display: none;">
        <div class="card-header">
          <div class="icon" style="background: var(--color-surface-light)">💬</div>
          <h3>Hint History</h3>
        </div>
        <ul class="hint-list" id="hint-list"></ul>
      </div>
    </div>
  `;
}
