import { afterEach, describe, expect, it, vi } from 'vitest';
import { HUDController, parseWearingState, type HUDAction } from '../src/hud/hud-controller';

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
    expect(parseWearingState({ connectType: 'connected', isWearing: true })).toBe('wearing');
    expect(parseWearingState({ connectType: 'connected', isWearing: false })).toBe('not-wearing');
    expect(parseWearingState({ connectType: 'connected', wearing: 1 })).toBe('wearing');
    expect(parseWearingState({ connectType: 'connected', wearing: 0 })).toBe('not-wearing');
    expect(parseWearingState({ connectType: 'connected', wearStatus: 'wearing' })).toBe('wearing');
    expect(parseWearingState({ connectType: 'connected', wearStatus: 'not-wearing' })).toBe('not-wearing');
    expect(parseWearingState({ connectType: 'connected' })).toBe('unavailable');
    expect(parseWearingState({ connectType: 'connected', isWearing: null })).toBe('unavailable');
  });

  it('renders READY, LISTENING, CUE, ACK, and PAUSED on the live G2 surface', async () => {
    vi.useFakeTimers();
    const { hud, frames } = createHudHarness();

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
