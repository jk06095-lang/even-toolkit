import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRIVACY_SETTINGS, loadPrivacySettings } from '../src/privacy/settings';
import { TranscriptStore, type SessionTranscript } from '../src/combat/transcript-store';
import {
  ECHO_DOMAIN_V2_SCHEMA_VERSION,
  isConversationTurn,
} from '@toolkit/echo-domain-v2';

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
    expect(DEFAULT_PRIVACY_SETTINGS).toMatchObject({
      useMicrophone: false,
      allowCloudProcessing: false,
      saveTranscripts: false,
      transcriptRetention: 'immediate',
    });
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

  it('exports privacy-safe QA telemetry without raw transcript text', () => {
    const store = new TranscriptStore(1, 'QA Topic', 'general', {
      now: () => now,
    });

    store.addSpeech('sensitive utterance', 'live_final');
    store.addHint('sensitive cue text', 'gemini_eval');
    store.setSessionEventTelemetry({
      audioSource: 'bridge',
      avgSilenceDurationMs: 2400,
      selfResponseRate: 50,
      cueLatencyCount: 2,
      cueLatencyP50Ms: 180,
      cueLatencyP95Ms: 420,
      cueLatencyMaxMs: 420,
      manualCueRequestCount: 1,
      autoCueTriggerCount: 1,
      cueDismissedCount: 0,
      falseTriggerCount: 0,
      cueUsedCount: 1,
      autoAssistPaused: false,
      vadSpeechThreshold: 0.032,
      vadNoiseFloorRms: 0.009,
      vadSpeechFloorRms: 0.061,
      vadCalibratedAt: now - 5_000,
    });
    store.finalize();

    const exportData = TranscriptStore.exportUserData();
    expect(exportData.rawTranscripts).toEqual([]);
    expect(exportData.eventAnalytics[0]).toMatchObject({
      audioSource: 'bridge',
      avgSilenceDurationMs: 2400,
      selfResponseRate: 50,
      cueLatencyCount: 2,
      cueLatencyP50Ms: 180,
      cueLatencyP95Ms: 420,
      cueLatencyMaxMs: 420,
      manualCueRequestCount: 1,
      autoCueTriggerCount: 1,
      cueUsedCount: 1,
      vadSpeechThreshold: 0.032,
      vadNoiseFloorRms: 0.009,
      vadSpeechFloorRms: 0.061,
      rawTranscriptSaved: false,
    });
    expect(JSON.stringify(exportData)).not.toContain('sensitive utterance');
    expect(JSON.stringify(exportData)).not.toContain('sensitive cue text');
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

  it('writes ECHO domain v2 ConversationTurn records for saved speech', () => {
    const store = new TranscriptStore(2, 'Saved Topic', 'business', {
      saveRawTranscript: true,
      retentionPolicy: '7d',
      now: () => now,
      defaultTurnSource: 'phone',
      idFactory: () => '00000000-0000-4000-8000-000000000001',
    });

    store.addSpeech('store this sentence', 'live_final');

    const transcript = store.finalize();
    const turn = transcript?.conversationTurns?.[0];
    expect(turn).toMatchObject({
      schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
      id: '00000000-0000-4000-8000-000000000001',
      sessionId: transcript?.sessionId,
      speaker: 'learner',
      startedAt: now,
      endedAt: now,
      source: 'phone',
      language: 'en-US',
      transcript: 'store this sentence',
      isFinal: true,
      piiFlags: [],
    });
    expect(isConversationTurn(turn)).toBe(true);
  });

  it('migrates legacy transcripts to v2 turns and rejects malformed turn records', () => {
    const legacy = makeSession('legacy', now);
    localStorage.setItem('echo_transcripts', JSON.stringify([
      {
        ...legacy,
        conversationTurns: [
          {
            schemaVersion: 'bad',
            id: 'bad',
            transcript: '<script>alert(1)</script>',
          },
        ],
      },
    ]));

    const [stored] = TranscriptStore.loadAll();
    expect(stored?.conversationTurns).toHaveLength(1);
    expect(stored?.conversationTurns?.[0]).toMatchObject({
      schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
      id: 'legacy:turn:1',
      sessionId: 'legacy',
      speaker: 'learner',
      source: 'g2',
      language: 'en-US',
      transcript: 'legacy',
      isFinal: true,
      piiFlags: [],
    });
    expect(isConversationTurn(stored?.conversationTurns?.[0])).toBe(true);
    expect(JSON.stringify(stored?.conversationTurns)).not.toContain('<script>');
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

  it('uses delete-after-session retention when TranscriptStore is constructed without a retention policy', () => {
    const store = new TranscriptStore(3, 'Default Retention Topic', 'travel', {
      saveRawTranscript: true,
      now: () => now,
    });

    store.addSpeech('default retention sentence', 'live_final');

    expect(store.metadata.retentionPolicy).toBe('immediate');
    expect(store.finalize()).toBeNull();
    expect(localStorage.getItem('echo_transcripts')).toBeNull();
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
