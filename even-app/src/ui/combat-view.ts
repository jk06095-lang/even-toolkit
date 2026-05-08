/**
 * Combat View — Phase 2 UI
 * Uses Even Realities design system tokens.
 *
 * Layout: Mode Selector -> (General Practice OR Scenario Training) -> Combat Session -> Stats
 * Enhanced with: real-time waveform, expression tracking, scenario context
 */

import { WEEK_CONFIGS } from '../combat/session-engine';

export function renderCombatView(): string {
  const weekOptions = Object.values(WEEK_CONFIGS)
    .map((w) => `<button class="week-btn" data-week="${w.week}">W${w.week}</button>`)
    .join('');

  // Generate 16 waveform bars for smoother visualization
  const waveBars = Array.from({ length: 16 }, (_, i) =>
    `<div class="waveform-bar" id="wb-${i}" style="width: 3px; height: 4px; background: var(--color-positive); border-radius: 2px; transition: height 0.08s ease;"></div>`
  ).join('');

  return `
    <div class="phase-view" id="phase2-view">
      <div class="phase-indicator p2">● Active Training</div>

      <!-- Mode Selector -->
      <div class="card" id="mode-selector-card">
        <div class="card-header">
          <div class="icon" style="background: var(--phase2-alpha); color: var(--phase2)">🎯</div>
          <h3>Select Training Mode</h3>
        </div>
        <div style="display: flex; gap: var(--spacing-same); margin-top: var(--spacing-same);">
          <div class="mode-card" id="btn-mode-general" style="flex: 1; padding: 16px; background: var(--color-surface-light); border: 2px solid transparent; border-radius: var(--radius); cursor: pointer; text-align: center; transition: border-color 0.2s ease;">
            <div style="font-size: 24px; margin-bottom: 8px;">🧠</div>
            <div class="text-normal-body" style="font-weight: 600; color: var(--color-text);">General Practice</div>
            <div class="text-detail" style="color: var(--color-text-muted); margin-top: 4px;">Curriculum-based random hints</div>
          </div>
          <div class="mode-card" id="btn-mode-scenario" style="flex: 1; padding: 16px; background: var(--color-surface-light); border: 2px solid transparent; border-radius: var(--radius); cursor: pointer; text-align: center; transition: border-color 0.2s ease;">
            <div style="font-size: 24px; margin-bottom: 8px;">🎭</div>
            <div class="text-normal-body" style="font-weight: 600; color: var(--color-text);">Scenario Training</div>
            <div class="text-detail" style="color: var(--color-text-muted); margin-top: 4px;">Focused idiom & situation practice</div>
          </div>
        </div>
      </div>

      <!-- General Practice View -->
      <div id="general-practice-area" style="display: none;">
        <div class="card">
          <div class="card-header">
            <div class="icon" style="background: var(--color-surface-light)">📅</div>
            <h3>Curriculum Week</h3>
          </div>
          <div class="week-selector" id="week-selector">${weekOptions}</div>
          <p class="text-detail" id="week-desc" style="text-align: center; color: var(--color-text-dim);"></p>
        </div>
        <div style="margin-top: var(--spacing-cross);">
          <button class="btn btn-highlight btn-full" id="btn-start-general">Start Curriculum Session</button>
        </div>
      </div>

      <!-- Scenario Practice View -->
      <div id="scenario-practice-area" style="display: none;">
        <div id="topic-selector-area"></div>
        
        <div class="card" id="selected-topic-card" style="display: none;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span id="selected-topic-emoji" style="font-size: 24px;"></span>
              <div>
                <div class="text-normal-body" id="selected-topic-label" style="color: var(--color-text); font-weight: 600;"></div>
                <div class="text-detail" id="selected-topic-situation" style="color: var(--color-text-muted);"></div>
              </div>
            </div>
            <button class="btn" id="btn-change-topic" style="padding: 4px 10px; font-size: 11px; min-width: auto;">Change</button>
          </div>
          <div style="margin-top: var(--spacing-cross);">
             <button class="btn btn-highlight btn-full" id="btn-start-scenario">Start Scenario Session</button>
          </div>
        </div>
      </div>

      <!-- Combat Session Card -->
      <div class="card" id="session-card" style="display: none;">
        <div class="card-header">
          <div class="icon" style="background: var(--phase2-alpha); color: var(--phase2)">⚔</div>
          <h3>Combat Session</h3>
          <span class="badge badge-neutral" id="session-status">Standby</span>
        </div>

        <!-- Real-time Waveform Visualizer -->
        <div id="waveform-panel" style="display: none; background: var(--color-surface); border-radius: var(--radius); padding: 12px; margin-bottom: var(--spacing-same); text-align: center;">
          <div style="display: flex; align-items: center; justify-content: center; gap: 6px; margin-bottom: 6px;">
            <span class="status-dot listening" id="vad-dot" style="width: 8px; height: 8px;"></span>
            <span class="text-detail" id="vad-label" style="color: var(--color-text-dim);">VAD Inactive</span>
            <span class="text-detail" id="audio-source-label" style="color: var(--color-text-muted); background: var(--color-surface-light); padding: 2px 6px; border-radius: 3px; display: none;">—</span>
          </div>
          <div id="waveform-container" style="display: flex; align-items: center; justify-content: center; gap: 2px; height: 40px; padding: 4px 0;" title="Mic Volume">
            ${waveBars}
          </div>
          <div class="text-detail" id="waveform-status" style="color: var(--color-text-muted); margin-top: 4px;">Waiting for audio...</div>
        </div>

        <!-- Live Transcript -->
        <div id="live-transcript-container" style="display: none; background: var(--color-accent-alpha); padding: 10px 12px; border-radius: var(--radius); margin-bottom: var(--spacing-same); border-left: 3px solid var(--color-accent); min-height: 36px; transition: all 0.15s ease;">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
            <span class="status-dot listening" style="width: 6px; height: 6px;"></span>
            <span class="text-detail" style="color: var(--color-text-dim);">Speaking now...</span>
          </div>
          <span id="live-transcript-text" class="text-normal-body" style="color: var(--color-text);"></span>
        </div>

        <!-- Recognized Transcript -->
        <div id="transcript-display" style="display: none; background: var(--color-surface-light); padding: 10px 12px; border-radius: var(--radius); margin-bottom: var(--spacing-same); border-left: 3px solid var(--color-positive); transition: all 0.2s ease;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <span class="text-detail" style="color: var(--color-text-dim);">Recognized:</span>
            <span class="text-detail" id="speech-timing" style="color: var(--color-text-muted); font-family: var(--font-mono);">—</span>
          </div>
          <span id="transcript-text" class="text-normal-body" style="color: var(--color-text); font-style: italic;"></span>
        </div>

        <!-- Expression Usage Tracker -->
        <div id="expression-tracker" style="display: none; background: var(--color-surface-light); padding: 10px 12px; border-radius: var(--radius); margin-bottom: var(--spacing-same); border-left: 3px solid var(--phase1);">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <span class="text-detail" style="color: var(--color-text-dim);">Expression Tracking</span>
            <span class="text-detail" id="expr-score" style="color: var(--phase1);">0/0 used</span>
          </div>
          <div id="expr-list" style="font-size: 12px;"></div>
        </div>

        <!-- Silence Meter -->
        <div class="silence-meter">
          <div class="fill" id="silence-fill" style="width: 0%"></div>
        </div>
        <div class="flex justify-between" style="margin-top: 2px;">
          <span class="text-detail" style="color: var(--color-text-muted)">0s</span>
          <span class="text-detail" style="color: var(--color-text-muted)" id="silence-threshold-label">3s threshold</span>
        </div>

        <!-- Chunk Display -->
        <div id="chunk-display" style="display: none;"></div>

        <!-- Action Buttons -->
        <div style="margin-top: var(--spacing-cross); display: flex; gap: var(--spacing-same);">
          <button class="btn btn-neutral btn-full" id="btn-pause-session">Pause</button>
          <button class="btn btn-danger btn-full" id="btn-stop-session">Stop Session</button>
        </div>
      </div>

      <!-- Live Stats -->
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

      <!-- Hint History -->
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
