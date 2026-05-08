/**
 * Debrief View — Phase 3 UI
 * Uses Even Realities design system tokens.
 */

export function renderDebriefView(): string {
  return `
    <div class="phase-view" id="phase3-view">
      <div class="phase-indicator p3">● Phase 3 — Debrief</div>

      <div class="card">
        <div class="card-header">
          <div class="icon" style="background: var(--phase3-alpha); color: var(--phase3)">📋</div>
          <h3>Import Session Report</h3>
        </div>

        <p class="text-normal-body" style="color: var(--color-text-dim); margin-bottom: var(--spacing-cross); line-height: 1.5;">
          Paste the JSON report from your PC Gemini session.
        </p>

        <textarea class="textarea" id="debrief-input" placeholder='{
  "session_date": "2026-04-28",
  "fsi_stress_level": "High",
  "bottleneck_chunks": [
    {"target": "depends on the situation", "interval": [10, 60, 240]}
  ]
}'></textarea>

        <div id="debrief-error" style="display: none; color: var(--color-negative); font-size: 13px; margin-top: var(--spacing-same);"></div>

        <button class="btn btn-highlight btn-full" id="btn-import-debrief" style="margin-top: var(--spacing-cross);">
          Import & Generate Schedule
        </button>
      </div>

      <div class="card" id="debrief-result" style="display: none;">
        <div class="card-header">
          <div class="icon" style="background: var(--color-positive-alpha); color: var(--color-positive)">✓</div>
          <h3>Import Successful</h3>
        </div>

        <div class="stats-grid" style="margin-bottom: var(--spacing-cross);">
          <div class="stat-item">
            <div class="value" id="debrief-date" style="color: var(--phase3)">—</div>
            <div class="label">Date</div>
          </div>
          <div class="stat-item">
            <div class="value" id="debrief-stress" style="color: var(--color-negative)">—</div>
            <div class="label">Stress</div>
          </div>
          <div class="stat-item">
            <div class="value" id="debrief-chunks">—</div>
            <div class="label">Chunks</div>
          </div>
          <div class="stat-item">
            <div class="value" id="debrief-pushes" style="color: var(--phase4)">—</div>
            <div class="label">Pushes</div>
          </div>
        </div>

        <p class="text-subtitle" style="color: var(--color-text-dim); margin-bottom: var(--spacing-same);">Bottleneck Chunks</p>
        <ul class="hint-list" id="debrief-chunk-list"></ul>
      </div>

      <div class="card" id="session-export-card">
        <div class="card-header">
          <div class="icon" style="background: var(--phase3-alpha); color: var(--phase3)">📤</div>
          <h3>Export Session → Gemini Gem</h3>
        </div>

        <p class="text-normal-body" style="color: var(--color-text-dim); margin-bottom: var(--spacing-cross); line-height: 1.5;">
          Select a cached combat session to export as 3-stage JSON for Gemini Gem handoff.
        </p>

        <div id="session-export-list"></div>
        <div id="session-export-empty" style="color: var(--color-text-muted); text-align: center; padding: 16px 0; font-size: 13px;">
          No cached sessions yet. Complete a Combat session first.
        </div>
        <div id="session-export-status" style="display: none; margin-top: var(--spacing-same); padding: 10px; border-radius: var(--radius); text-align: center; font-size: 13px;"></div>
      </div>
    </div>
  `;
}
