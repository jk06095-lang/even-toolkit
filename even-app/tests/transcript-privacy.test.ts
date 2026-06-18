import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRIVACY_SETTINGS, loadPrivacySettings } from '../src/privacy/settings';
import { TranscriptStore, type SessionTranscript } from '../src/combat/transcript-store';

class MemoryStorage {
  private data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }
}

function installStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
}

describe('transcript privacy controls', () => {
  const now = Date.UTC(2026, 5, 19, 10, 0, 0);

  beforeEach(() => {
    installStorage();
  });

  it('defaults microphone, cloud processing, and transcript saving to off', () => {
    expect(loadPrivacySettings()).toEqual(DEFAULT_PRIVACY_SETTINGS);
  });

  it('does not persist raw transcript text without explicit save opt-in', () => {
    const store = new TranscriptStore(1, 'Private Topic', 'general', {
      now: () => now,
    });

    store.addSpeech('my private sentence', 'live_final');
    store.addHint('try this phrase', 'gemini_eval');
    const transcript = store.finalize();

    expect(transcript).toBeNull();
    expect(localStorage.getItem('echo_transcripts')).toBeNull();
    expect(sessionStorage.getItem('echo_transcript_buffer')).toBeNull();

    const analytics = TranscriptStore.loadAnalytics();
    expect(analytics).toHaveLength(1);
    expect(analytics[0]).toMatchObject({
      speechCount: 1,
      hintCount: 1,
      rawTranscriptSaved: false,
    });
    expect(JSON.stringify(analytics)).not.toContain('my private sentence');
    expect(JSON.stringify(analytics)).not.toContain('try this phrase');
  });

  it('persists raw transcript text only after save opt-in', () => {
    const store = new TranscriptStore(2, 'Saved Topic', 'business', {
      saveRawTranscript: true,
      retentionPolicy: '7d',
      now: () => now,
    });

    store.addSpeech('store this sentence', 'live_final');
    expect(sessionStorage.getItem('echo_transcript_buffer')).toContain('store this sentence');

    const transcript = store.finalize();
    expect(transcript?.entries[0]?.text).toBe('store this sentence');
    expect(sessionStorage.getItem('echo_transcript_buffer')).toBeNull();

    const stored = TranscriptStore.loadAll();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.entries[0]?.text).toBe('store this sentence');
    expect(TranscriptStore.loadAnalytics()[0]?.rawTranscriptSaved).toBe(true);
  });

  it('supports delete-after-session retention', () => {
    const store = new TranscriptStore(3, 'Ephemeral Topic', 'travel', {
      saveRawTranscript: true,
      retentionPolicy: 'immediate',
      now: () => now,
    });

    store.addSpeech('temporary sentence', 'live_final');
    expect(sessionStorage.getItem('echo_transcript_buffer')).toContain('temporary sentence');

    expect(store.finalize()).toBeNull();
    expect(localStorage.getItem('echo_transcripts')).toBeNull();
    expect(sessionStorage.getItem('echo_transcript_buffer')).toBeNull();
  });

  it('prunes saved transcripts by retention policy', () => {
    const oldSession = makeSession('old', now - 8 * 24 * 60 * 60 * 1000);
    const freshSession = makeSession('fresh', now - 1 * 24 * 60 * 60 * 1000);
    localStorage.setItem('echo_transcripts', JSON.stringify([oldSession, freshSession]));

    TranscriptStore.applyRetention('7d', now);

    const stored = TranscriptStore.loadAll();
    expect(stored.map((session) => session.sessionId)).toEqual(['fresh']);
  });
});

function makeSession(sessionId: string, endTime: number): SessionTranscript {
  return {
    sessionId,
    startTime: endTime - 60_000,
    endTime,
    week: 1,
    topic: 'Topic',
    category: 'general',
    entries: [
      {
        t: endTime - 30_000,
        type: 'user_speech',
        text: sessionId,
      },
    ],
  };
}
