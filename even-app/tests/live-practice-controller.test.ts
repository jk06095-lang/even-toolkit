import { describe, expect, it } from 'vitest';

import {
  AUTO_ASSIST_CONFIRM_PROMPT,
  G2_MIC_FALLBACK_PROMPT,
  normalizeAudioSource,
  shouldApplyAssistModeChange,
  shouldOfferPhoneMicFallback,
} from '../src/live-practice/live-practice-controller';

describe('Live Practice audio fallback gating', () => {
  it('offers Phone Mic fallback only after a G2 Mic start failure', () => {
    const g2Error = new Error('G2 microphone unavailable. Select Phone Mic to use the phone microphone.');

    expect(shouldOfferPhoneMicFallback(g2Error, 'bridge')).toBe(true);
    expect(shouldOfferPhoneMicFallback(g2Error, 'browser')).toBe(false);
    expect(shouldOfferPhoneMicFallback(new Error('SECURE_ORIGIN_REQUIRED'), 'bridge')).toBe(false);
    expect(shouldOfferPhoneMicFallback('G2 microphone unavailable', 'bridge')).toBe(false);
  });

  it('keeps persisted audio source values explicit and conservative', () => {
    expect(normalizeAudioSource('browser')).toBe('browser');
    expect(normalizeAudioSource('bridge')).toBe('bridge');
    expect(normalizeAudioSource('hybrid')).toBe('bridge');
    expect(normalizeAudioSource(null)).toBe('bridge');
  });

  it('uses a confirmation prompt before opening Phone Mic fallback', () => {
    expect(G2_MIC_FALLBACK_PROMPT).toContain('G2 microphone unavailable.');
    expect(G2_MIC_FALLBACK_PROMPT).toContain('Use Phone Mic instead?');
    expect(G2_MIC_FALLBACK_PROMPT).toContain('only after you confirm');
  });

  it('requires an explicit confirmation before switching from Manual to Auto Assist', () => {
    const prompts: string[] = [];
    const cancelled = shouldApplyAssistModeChange('manual', 'auto', (message) => {
      prompts.push(message);
      return false;
    });
    expect(cancelled).toBe(false);
    expect(prompts).toEqual([AUTO_ASSIST_CONFIRM_PROMPT]);
    expect(AUTO_ASSIST_CONFIRM_PROMPT).toContain('Auto Assist is experimental.');
  });

  it('does not prompt when staying in Auto Assist or switching back to Manual', () => {
    const prompts: string[] = [];
    const confirm = (message: string) => {
      prompts.push(message);
      return true;
    };

    expect(shouldApplyAssistModeChange('auto', 'auto', confirm)).toBe(true);
    expect(shouldApplyAssistModeChange('auto', 'manual', confirm)).toBe(true);
    expect(prompts).toEqual([]);
  });
});
