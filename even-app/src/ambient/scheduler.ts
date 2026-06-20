/**
 * Echo Reminders scheduler.
 *
 * Polls IndexedDB for due review reminders. The scheduler never sends the
 * saved answer phrase to the HUD; the phone-side Active Recall panel owns
 * reveal and grading.
 */

import { getStoredDebriefs, markPushDelivered, type ScheduledPush } from '../debrief/json-parser';

export const ECHO_RECALL_REMINDER_TEXT = 'Review due. Open ECHO.';

export interface AmbientCallbacks {
  onEchoPush: (message: string) => void;
  onScheduleUpdate: (pending: PendingItem[]) => void;
}

export interface PendingItem {
  reminderText: string;
  scheduledTime: number;
  debriefIndex: number;
  pushIndex: number;
  timeUntilMs: number;
}

export class AmbientScheduler {
  private callbacks: AmbientCallbacks;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private _active = false;
  private _pendingItems: PendingItem[] = [];

  constructor(callbacks: AmbientCallbacks) {
    this.callbacks = callbacks;
  }

  get active(): boolean { return this._active; }
  get pendingItems(): PendingItem[] { return this._pendingItems; }

  /**
   * Start the scheduler. Polls every 10 seconds.
   */
  start(): void {
    if (this._active) return;
    this._active = true;
    this.poll(); // immediate first poll
    this.pollInterval = setInterval(() => this.poll(), 10_000);
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    this._active = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Force an immediate poll (e.g., after importing new debrief data).
   */
  async refresh(): Promise<void> {
    await this.poll();
  }

  private async poll(): Promise<void> {
    try {
      const debriefs = await getStoredDebriefs();
      const now = Date.now();
      const pending: PendingItem[] = [];

      for (let di = 0; di < debriefs.length; di++) {
        const debrief = debriefs[di]!;
        for (let pi = 0; pi < debrief.scheduledPushes.length; pi++) {
          const push = debrief.scheduledPushes[pi]!;
          if (push.pushed) continue;

          if (push.scheduledTime <= now) {
            await this.firePush(push, di, pi);
          } else {
            pending.push({
              reminderText: ECHO_RECALL_REMINDER_TEXT,
              scheduledTime: push.scheduledTime,
              debriefIndex: di,
              pushIndex: pi,
              timeUntilMs: push.scheduledTime - now,
            });
          }
        }
      }

      this._pendingItems = pending;
      this.callbacks.onScheduleUpdate(pending);
    } catch (err) {
      console.error('[Ambient] Poll error:', err);
    }
  }

  private async firePush(
    push: ScheduledPush,
    debriefIndex: number,
    pushIndex: number,
  ): Promise<void> {
    await markPushDelivered(debriefIndex, pushIndex);

    this.callbacks.onEchoPush(ECHO_RECALL_REMINDER_TEXT);
  }
}
