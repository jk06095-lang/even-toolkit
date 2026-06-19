/**
 * Echo Reminders View.
 * Uses Even Realities design system tokens.
 */

export function renderAmbientView(): string {
  return `
    <div class="phase-view" id="phase4-view">
      <div class="phase-indicator p4">Echo Reminders</div>

      <div class="card">
        <div class="card-header">
          <div class="icon" style="background: var(--phase4-alpha); color: var(--phase4)">ER</div>
          <h3>Echo Reminders</h3>
          <span class="badge badge-neutral" id="ambient-status">Inactive</span>
        </div>

        <p class="text-normal-body" style="color: var(--color-text-dim); margin-bottom: var(--spacing-cross); line-height: 1.5;">
          Review phrases from your saved sessions will flash on G2 glasses at spaced intervals.
        </p>

        <div style="display: flex; gap: var(--spacing-same);">
          <button class="btn btn-highlight btn-full" id="btn-start-ambient">Start Reminders</button>
          <button class="btn btn-danger" id="btn-stop-ambient" style="display: none;">Pause</button>
        </div>
      </div>

      <div class="card" id="pending-card">
        <div class="card-header">
          <div class="icon" style="background: var(--color-surface-light)">PE</div>
          <h3>Pending Echoes</h3>
          <span class="badge badge-accent" id="pending-count">0</span>
        </div>

        <div id="pending-list-container">
          <div class="empty-state" id="pending-empty">
            <div class="icon">0</div>
            <p>No pending echoes.<br/>Import a review report first.</p>
          </div>
          <ul class="schedule-list" id="pending-list" style="display: none;"></ul>
        </div>
      </div>

      <div class="card" id="exposure-card">
        <div class="card-header">
          <div class="icon" style="background: var(--color-surface-light)">EX</div>
          <h3>Exposure Log</h3>
        </div>
        <div id="exposure-stats">
          <div class="empty-state">
            <div class="icon">0</div>
            <p>No exposures yet.</p>
          </div>
        </div>
      </div>
    </div>
  `;
}
