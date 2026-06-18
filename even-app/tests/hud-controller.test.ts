import { describe, expect, it } from 'vitest';
import { HUDController, type HUDAction } from '../src/hud/hud-controller';

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
  it('renders only READY, LISTENING, CUE, and PAUSED on the live G2 surface', async () => {
    const { hud, frames } = createHudHarness();

    await hud.initCombatDisplay();
    expect(frames.at(-1)).toContain('READY');

    await hud.showListening();
    expect(frames.at(-1)).toContain('LISTENING');
    const listeningFrameCount = frames.length;

    await hud.showLiveTranscript('raw live transcript should stay on phone');
    await hud.showGrammarFeedback('grammar feedback should stay on phone');
    await hud.showGoodJob();
    expect(frames).toHaveLength(listeningFrameCount);

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
