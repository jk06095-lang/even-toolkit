import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStoredDebriefs: vi.fn(),
  markPushDelivered: vi.fn(),
}));

vi.mock('../src/debrief/json-parser', () => ({
  getStoredDebriefs: mocks.getStoredDebriefs,
  markPushDelivered: mocks.markPushDelivered,
}));

import { AmbientScheduler, ECHO_RECALL_REMINDER_TEXT } from '../src/ambient/scheduler';
import type { PendingItem } from '../src/ambient/scheduler';

describe('AmbientScheduler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getStoredDebriefs.mockReset();
    mocks.markPushDelivered.mockReset();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
  });

  it('fires due reminders without exposing saved answer text', async () => {
    const savedAnswer = 'Could you repeat that?';
    const pushedMessages: string[] = [];

    mocks.getStoredDebriefs.mockResolvedValue([
      {
        scheduledPushes: [
          {
            chunk: savedAnswer,
            scheduledTime: 900,
            pushed: false,
            learningItemId: 'item-1',
          },
        ],
      },
    ]);

    const scheduler = new AmbientScheduler({
      onEchoPush: (message) => pushedMessages.push(message),
      onScheduleUpdate: vi.fn(),
    });

    await scheduler.refresh();

    expect(mocks.markPushDelivered).toHaveBeenCalledWith(0, 0);
    expect(pushedMessages).toEqual([ECHO_RECALL_REMINDER_TEXT]);
    expect(JSON.stringify(pushedMessages)).not.toContain(savedAnswer);
  });

  it('reports pending reminders without exposing future answer text', async () => {
    const savedAnswer = 'Future answer phrase';
    let pendingItems: PendingItem[] = [];

    mocks.getStoredDebriefs.mockResolvedValue([
      {
        scheduledPushes: [
          {
            chunk: savedAnswer,
            scheduledTime: 5_000,
            pushed: false,
            learningItemId: 'item-2',
          },
        ],
      },
    ]);

    const scheduler = new AmbientScheduler({
      onEchoPush: vi.fn(),
      onScheduleUpdate: (items) => {
        pendingItems = items;
      },
    });

    await scheduler.refresh();

    expect(mocks.markPushDelivered).not.toHaveBeenCalled();
    expect(pendingItems).toHaveLength(1);
    expect(pendingItems[0]?.reminderText).toBe(ECHO_RECALL_REMINDER_TEXT);
    expect(pendingItems[0]?.timeUntilMs).toBe(4_000);
    expect(JSON.stringify(pendingItems)).not.toContain(savedAnswer);
  });
});
