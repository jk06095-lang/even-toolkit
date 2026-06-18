export function renderAppShell(): string {
  return `
    <header style="padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; background: var(--color-surface); border-bottom: 1px solid var(--color-border); position: sticky; top: 0; z-index: 10;">
      <div>
        <h1 style="margin: 0; font-family: var(--font-display); font-size: 20px; font-weight: 500; letter-spacing: -0.6px; color: var(--color-text);">Project ECHO</h1>
        <p style="margin: 4px 0 0; font-size: 13px; color: var(--color-text-dim);">Everyday English practice companion</p>
      </div>
      <div class="connection-badge" id="g2-badge" style="margin: 0;">
        <span class="status-dot idle" id="g2-dot"></span>
        <span id="g2-badge-text">G2 Glasses: Connecting...</span>
      </div>
    </header>

    <div style="padding: 24px 20px; max-width: 600px; margin: 0 auto; width: 100%;">
      <nav class="phase-nav" id="phase-nav">
        <button class="phase-tab" data-phase="1">Phase 1: Calibration</button>
        <button class="phase-tab" data-phase="2">Phase 2: Live Practice</button>
        <button class="phase-tab" data-phase="3">Phase 3: Review</button>
        <button class="phase-tab" data-phase="4">Phase 4: Echoes</button>
      </nav>

      <main id="phase-content"></main>
    </div>
  `;
}
