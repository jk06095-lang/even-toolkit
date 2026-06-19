import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HUDController,
  formatWearingStatePhoneLabel,
  parseWearingState,
  type HUDAction,
  type WearingState,
} from '../src/hud/hud-controller';

function createHudHarness() {
  const hud = new HUDController();
  const frames: string[] = [];
  const quickFrames: string[] = [];
  const actions: HUDAction[] = [];

  (hud as any).showText = async (content: string) => {
    frames.push(content);
  };
  (hud as any).quickUpdate = async (_containerId: number, _containerName: string, content: string) => {
    quickFrames.push(content);
  };
  hud.onAction((action) => actions.push(action));

  return {
    hud,
    frames,
    quickFrames,
    actions,
    async flushHudAction() {
      await Promise.resolve();
      await Promise.resolve();
    },
    handle(action: any) {
      (hud as any).handleHUDAction(action);
    },
  };
}

describe('HUDController simplified live HUD contract', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves explicit wear sensor states without forcing connected devices to wearing', () => {
    const cases: Array<[Record<string, unknown>, WearingState]> = [
      [{ connectType: 'connected', isWearing: true }, 'wearing'],
      [{ connectType: 'connected', isWearing: false }, 'not-wearing'],
      [{ connectType: 'connected', wearing: 1 }, 'wearing'],
      [{ connectType: 'connected', wearing: 0 }, 'not-wearing'],
      [{ connectType: 'connected', wearStatus: 'wearing' }, 'wearing'],
      [{ connectType: 'connected', wearStatus: 'not-wearing' }, 'not-wearing'],
      [{ connectType: 'connected', wearState: 'on_head' }, 'wearing'],
      [{ connectType: 'connected', wearState: 'off_head' }, 'not-wearing'],
      [{ connectType: 'connected', wearingState: 'worn' }, 'wearing'],
      [{ connectType: 'connected', wearingState: 'not_worn' }, 'not-wearing'],
      [{ connectType: 'connected', isWearing: 'true' }, 'wearing'],
      [{ connectType: 'connected', isWearing: 'false' }, 'not-wearing'],
      [{ connectType: 'connected', wearStatus: '1' }, 'wearing'],
      [{ connectType: 'connected', wearStatus: '0' }, 'not-wearing'],
      [{ connectType: 'connected' }, 'unavailable'],
      [{ connectType: 'connected', isWearing: null }, 'unavailable'],
      [{ connectType: 'connected', wearStatus: 'unknown' }, 'unavailable'],
      [{ connectType: 'connected', wearing: 2 }, 'unavailable'],
    ];

    for (const [status, expected] of cases) {
      expect(parseWearingState(status)).toBe(expected);
    }

    expect(formatWearingStatePhoneLabel('wearing')).toBe('Wearing');
    expect(formatWearingStatePhoneLabel('not-wearing')).toBe('Not wearing');
    expect(formatWearingStatePhoneLabel('unavailable')).toBe('Wear status unavailable');
  });

  it('renders READY, LISTENING, CUE, ACK, and PAUSED on the live G2 surface', async () => {
    vi.useFakeTimers();
    const { hud, frames } = createHudHarness();

    hud.setSessionActive(true);
    await hud.initCombatDisplay();
    expect(frames.at(-1)).toContain('READY');

    await hud.showListening();
    expect(frames.at(-1)).toContain('LISTENING');
    const listeningFrameCount = frames.length;

    await hud.showLiveTranscript('raw live transcript should stay on phone');
    await hud.showGrammarFeedback('grammar feedback should stay on phone');
    await hud.showGoodJob();
    expect(frames.at(-1)).toContain('ACK');
    expect(frames.at(-1)).toContain('OK');

    vi.advanceTimersByTime(750);
    await Promise.resolve();
    expect(frames.at(-1)).toContain('LISTENING');
    expect(frames.length).toBe(listeningFrameCount + 2);

    await hud.flashChunk('This is a deliberately long cue that should be clipped into a glanceable phrase for G2');
    const cueFrame = frames.at(-1) ?? '';
    expect(cueFrame).toContain('CUE');
    expect(cueFrame).not.toContain('raw live transcript');
    expect(cueFrame).not.toContain('grammar feedback');
    expect(cueFrame.split('\n').at(-1)?.trim().length).toBeLessThanOrEqual(50);

    await hud.showPaused();
    expect(frames.at(-1)).toContain('PAUSED');

    expect(frames.join('\n')).not.toContain('raw live transcript');
    expect(frames.join('\n')).not.toContain('grammar feedback');
    expect(frames.join('\n')).not.toContain('Good');
  });

  it('does not let the ACK timeout update the HUD after the session stops', async () => {
    vi.useFakeTimers();
    const { hud, frames } = createHudHarness();

    hud.setSessionActive(true);
    await hud.initCombatDisplay();
    await hud.showGoodJob();
    expect(frames.at(-1)).toContain('ACK');

    const ackFrameCount = frames.length;
    hud.setSessionActive(false);

    vi.advanceTimersByTime(750);
    await Promise.resolve();

    expect(frames.length).toBe(ackFrameCount);
    expect(frames.at(-1)).toContain('ACK');
  });

  it('clears a pending ACK return when the HUD returns to standby', async () => {
    vi.useFakeTimers();
    const { hud, frames } = createHudHarness();

    hud.setSessionActive(true);
    await hud.initCombatDisplay();
    await hud.showGoodJob();
    expect(frames.at(-1)).toContain('ACK');

    hud.setSessionActive(false);
    await hud.showStandbyScreen();
    expect(frames.at(-1)).toContain('READY');
    const standbyFrameCount = frames.length;

    vi.advanceTimersByTime(750);
    await Promise.resolve();

    expect(frames.length).toBe(standbyFrameCount);
    expect(frames.at(-1)).toContain('READY');
  });

  it('maps active-session gestures to manual cue, dismiss, end practice, and exit echo actions', async () => {
    const { hud, quickFrames, actions, handle, flushHudAction } = createHudHarness();

    handle({ type: 'REQUEST_CUE' });
    expect(actions).toEqual([]);

    hud.setSessionActive(true);
    handle({ type: 'REQUEST_CUE' });
    handle({ type: 'HIGHLIGHT_MOVE', direction: 'down' });
    expect(actions).toEqual(['request-cue', 'dismiss-cue']);

    handle({ type: 'SELECT_HIGHLIGHTED' });
    await flushHudAction();
    expect(quickFrames.at(-1)).toContain('RESUME');
    expect(quickFrames.at(-1)).toContain('END PRACTICE');
    expect(quickFrames.at(-1)).toContain('EXIT ECHO');

    handle({ type: 'HIGHLIGHT_MOVE', direction: 'down' });
    await flushHudAction();
    handle({ type: 'SELECT_HIGHLIGHTED' });
    expect(actions.at(-1)).toBe('end-practice');

    handle({ type: 'SELECT_HIGHLIGHTED' });
    await flushHudAction();
    handle({ type: 'HIGHLIGHT_MOVE', direction: 'down' });
    handle({ type: 'HIGHLIGHT_MOVE', direction: 'down' });
    await flushHudAction();
    handle({ type: 'SELECT_HIGHLIGHTED' });
    expect(actions.at(-1)).toBe('exit-echo');
  });
});
