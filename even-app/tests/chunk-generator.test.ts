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
import {
  ECHO_DOMAIN_V2_SCHEMA_VERSION,
  isCue,
} from '@toolkit/echo-domain-v2';

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

  it('wraps proxy cue responses in ECHO domain v2 Cue records when target turn is known', async () => {
    echoApiMock.requestCue.mockResolvedValueOnce({
      cueId: 'proxy-cue-1',
      cue: '<b>Could you say that again?</b>',
      speechAct: 'ask_repeat',
      level: 2,
      meaningKo: 'Meaning unavailable',
      alternatives: ['Can you repeat it?'],
      expiresAfterMs: 1800,
    });

    const result = await generateChunk({
      topic: 'General',
      week: 2,
      category: 'general',
      allowCloudProcessing: true,
      requestId: 'request-1',
      targetTurnId: 'turn-1',
    });

    expect(result.chunk).toBe('Could you say that again?');
    expect(result.cue).toMatchObject({
      schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
      cueId: 'proxy-cue-1',
      speechAct: 'ask_repeat',
      level: 2,
      phrase: 'Could you say that again?',
      targetTurnId: 'turn-1',
    });
    expect(isCue(result.cue)).toBe(true);
  });
});
