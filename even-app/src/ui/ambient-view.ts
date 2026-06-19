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
          Use saved session evidence for active recall. Say the answer first, then reveal and grade it.
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

      <div class="card" id="active-recall-card">
        <div class="card-header">
          <div class="icon" style="background: var(--phase4-alpha); color: var(--phase4)">AR</div>
          <h3>Active Recall</h3>
          <span class="badge badge-accent" id="active-recall-count">0</span>
        </div>

        <div class="empty-state" id="active-recall-empty">
          <div class="icon">0</div>
          <p>No due recall items yet.<br/>Finish and save a Live Practice session first.</p>
        </div>

        <div class="active-recall-panel">
          <div class="active-recall-meta" id="active-recall-meta"></div>
          <div class="active-recall-prompt" id="active-recall-prompt"></div>
          <textarea
            class="textarea active-recall-attempt"
            id="active-recall-attempt"
            placeholder="Say it aloud first. Optionally type what you said."
          ></textarea>
          <div class="active-recall-actions">
            <button class="btn btn-highlight" id="btn-recall-reveal">Reveal Answer</button>
            <button class="btn btn-ghost" id="btn-refresh-recall">Refresh</button>
          </div>
          <div class="active-recall-answer" id="active-recall-answer" style="display: none;">
            <span>Answer</span>
            <strong id="active-recall-answer-text"></strong>
          </div>
          <div class="active-recall-grade-row" id="active-recall-grade-row" style="display: none;">
            <button class="btn btn-default" data-recall-grade="again">Again</button>
            <button class="btn btn-default" data-recall-grade="hard">Hard</button>
            <button class="btn btn-default" data-recall-grade="good">Good</button>
            <button class="btn btn-default" data-recall-grade="easy">Easy</button>
          </div>
          <div class="active-recall-status text-detail" id="active-recall-status"></div>
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
