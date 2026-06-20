/**
 * Echo Display ambient HUD flash controller.
 *
 * Shows a short reminder on the G2 display for a brief duration, then clears it.
 * Saved answer phrases stay hidden until phone-side Active Recall reveal.
 */

import type { HUDController } from '../hud/hud-controller';

const DEFAULT_ECHO_DURATION_MS = 2000;

export class EchoDisplay {
  private hud: HUDController | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private reminderLog: { message: string; time: number }[] = [];

  setHUD(hud: HUDController): void {
    this.hud = hud;
  }

  /**
   * Flash a reminder on the HUD for the given duration, then clear.
   */
  async flash(message: string, durationMs = DEFAULT_ECHO_DURATION_MS): Promise<void> {
    if (!this.hud) return;

    this.cancelFlash();
    await this.hud.showAmbientEcho(message);

    this.reminderLog.push({ message, time: Date.now() });

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
   * Get delivered reminder history.
   */
  getReminderLog(): { message: string; time: number }[] {
    return [...this.reminderLog];
  }

  /**
   * Get unique reminder messages and their delivered counts.
   */
  getReminderStats(): Map<string, number> {
    const stats = new Map<string, number>();
    for (const entry of this.reminderLog) {
      stats.set(entry.message, (stats.get(entry.message) ?? 0) + 1);
    }
    return stats;
  }

  getExposureLog(): { chunk: string; time: number }[] {
    return this.reminderLog.map((entry) => ({ chunk: entry.message, time: entry.time }));
  }

  getExposureStats(): Map<string, number> {
    return this.getReminderStats();
  }
}
