/**
 * Echo Display — ambient HUD flash controller.
 *
 * Shows a chunk on the G2 display for a brief duration,
 * then clears it. Used for Phase 4 guerrilla exposure.
 */

import type { HUDController } from '../hud/hud-controller';

const DEFAULT_ECHO_DURATION_MS = 2000;

export class EchoDisplay {
  private hud: HUDController | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private exposureLog: { chunk: string; time: number }[] = [];

  setHUD(hud: HUDController): void {
    this.hud = hud;
  }

  /**
   * Flash a chunk on the HUD for the given duration, then clear.
   */
  async flash(chunk: string, durationMs = DEFAULT_ECHO_DURATION_MS): Promise<void> {
    if (!this.hud) return;

    // Cancel any existing flash
    this.cancelFlash();

    // Display the chunk
    await this.hud.showAmbientEcho(chunk);

    // Log the exposure
    this.exposureLog.push({ chunk, time: Date.now() });

    // Auto-clear after duration
    this.flashTimer = setTimeout(async () => {
      await this.hud?.clearDisplay();
      this.flashTimer = null;
    }, durationMs);
  }

  /**
   * Cancel any active flash.
   */
  cancelFlash(): void {
    if (this.flashTimer) {
      clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }
  }

  /**
   * Get exposure statistics.
   */
  getExposureLog(): { chunk: string; time: number }[] {
    return [...this.exposureLog];
  }

  /**
   * Get unique chunks and their exposure counts.
   */
  getExposureStats(): Map<string, number> {
    const stats = new Map<string, number>();
    for (const entry of this.exposureLog) {
      stats.set(entry.chunk, (stats.get(entry.chunk) ?? 0) + 1);
    }
    return stats;
  }
}
