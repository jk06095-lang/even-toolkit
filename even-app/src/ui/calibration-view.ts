/**
 * Calibration View — Phase 1 UI
 * Uses Even Realities design system tokens.
 */

export function renderCalibrationView(): string {
  return `
    <div class="phase-view" id="phase1-view">
      <div class="phase-indicator p1">● Phase 1 — Calibration</div>

      <div class="card">
        <div class="card-header">
          <div class="icon" style="background: var(--phase1-alpha); color: var(--phase1)">🎙</div>
          <h3>Voice Calibration</h3>
          <span class="badge badge-neutral" id="cal-status">Ready</span>
        </div>

        <p style="font-size: 15px; color: var(--color-text-dim); margin-bottom: var(--spacing-cross); line-height: 1.5;">
          Say <strong style="color: var(--color-text)">"Test, one two three"</strong> to calibrate your voice frequency.
        </p>

        <div class="calibration-ring" id="cal-ring">
          <div style="text-align: center">
            <div class="freq" id="cal-freq">—</div>
            <div class="unit">Hz</div>
          </div>
        </div>

        <div id="cal-progress" style="display: none">
          <div class="silence-meter">
            <div class="fill" id="cal-progress-bar" style="width: 0%"></div>
          </div>
          <p class="text-detail" style="text-align: center; color: var(--color-text-dim); margin-top: var(--spacing-same);">Sampling voice...</p>
        </div>

        <div id="cal-result" style="display: none; margin-top: var(--spacing-cross);">
          <div class="stats-grid">
            <div class="stat-item">
              <div class="value" id="cal-f0" style="color: var(--phase1)">—</div>
              <div class="label">Fundamental F0</div>
            </div>
            <div class="stat-item">
              <div class="value" id="cal-range" style="color: var(--phase1)">—</div>
              <div class="label">Voice Range</div>
            </div>
            <div class="stat-item">
              <div class="value" id="cal-persona" style="color: var(--color-text)">—</div>
              <div class="label">AI Persona</div>
            </div>
            <div class="stat-item">
              <div class="value" id="cal-filter" style="color: var(--color-text)">—</div>
              <div class="label">Filter Type</div>
            </div>
          </div>
        </div>

        <div style="margin-top: var(--spacing-cross); display: flex; gap: var(--spacing-same);">
          <button class="btn btn-highlight btn-full" id="btn-calibrate">Start Calibration</button>
          <button class="btn btn-ghost" id="btn-skip-cal">Skip</button>
        </div>
      </div>
    </div>
  `;
}
