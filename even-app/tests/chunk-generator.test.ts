import { beforeEach, describe, expect, it, vi } from 'vitest';

const echoApiMock = vi.hoisted(() => ({
  configured: true,
  requestCue: vi.fn(),
}));

vi.mock('../src/services/echo-api', () => ({
  isEchoApiConfigured: () => echoApiMock.configured,
  requestCue: echoApiMock.requestCue,
  requestSessionAnalysis: vi.fn(),
  requestTranscription: vi.fn(),
}));

import { generateChunk } from '../src/combat/chunk-generator';

describe('generateChunk fallback behavior', () => {
  beforeEach(() => {
    echoApiMock.configured = true;
    echoApiMock.requestCue.mockReset();
  });

  it('uses a local fallback cue without calling the proxy when cloud processing is disabled', async () => {
    const result = await generateChunk({
      topic: 'Travel',
      week: 1,
      category: 'travel',
      allowCloudProcessing: false,
    });

    expect(result.source).toBe('fallback');
    expect(result.chunk.length).toBeGreaterThan(0);
    expect(echoApiMock.requestCue).not.toHaveBeenCalled();
  });

  it('uses a local fallback cue without calling the proxy when the proxy is unconfigured', async () => {
    echoApiMock.configured = false;

    const result = await generateChunk({
      topic: 'Business',
      week: 2,
      category: 'business',
      allowCloudProcessing: true,
    });

    expect(result.source).toBe('fallback');
    expect(result.chunk.length).toBeGreaterThan(0);
    expect(echoApiMock.requestCue).not.toHaveBeenCalled();
  });

  it('falls back locally when the proxy cue request fails', async () => {
    echoApiMock.requestCue.mockRejectedValueOnce(new Error('proxy unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = await generateChunk({
        topic: 'Food',
        week: 1,
        category: 'food',
        allowCloudProcessing: true,
        clientSessionId: 'echo-session',
        requestId: 'echo-session:cue:1',
      });

      expect(echoApiMock.requestCue).toHaveBeenCalledTimes(1);
      expect(result.source).toBe('fallback');
      expect(result.chunk.length).toBeGreaterThan(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('labels duplicate proxy cue replacements as fallback cues', async () => {
    echoApiMock.requestCue.mockResolvedValueOnce({ cue: 'Repeated proxy cue' });

    const result = await generateChunk({
      topic: 'General',
      week: 1,
      category: 'general',
      allowCloudProcessing: true,
      usedHints: ['Repeated proxy cue'],
    });

    expect(echoApiMock.requestCue).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('fallback');
    expect(result.chunk).not.toBe('Repeated proxy cue');
  });
});
