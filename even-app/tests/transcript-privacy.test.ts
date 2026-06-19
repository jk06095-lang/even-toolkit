import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRIVACY_SETTINGS, loadPrivacySettings } from '../src/privacy/settings';
import { TranscriptStore, type SessionTranscript } from '../src/combat/transcript-store';
import {
  ECHO_DOMAIN_V2_SCHEMA_VERSION,
  isAssistEpisode,
  isConversationTurn,
  isCue,
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

    store.addSpeech('store this sentence', 'live_final', true, 0.82);

    const transcript = store.finalize();
    const turn = transcript?.conversationTurns?.[0];
    expect(turn).toMatchObject({
      schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
      id: '00000000-0000-4000-8000-000000000001',
      sessionId: transcript?.sessionId,
      speaker: 'unknown',
      startedAt: now,
      endedAt: now,
      source: 'phone',
      language: 'en-US',
      transcript: 'store this sentence',
      confidence: 0.82,
      isFinal: true,
      piiFlags: [],
      inputEvidence: {
        inputMode: 'phone_web_speech',
        speakerAttribution: 'single_stream_unresolved',
      },
    });
    expect(isConversationTurn(turn)).toBe(true);
  });

  it('lets live speech choose a conversation turn source explicitly', () => {
    const store = new TranscriptStore(2, 'Saved Topic', 'business', {
      saveRawTranscript: true,
      retentionPolicy: '7d',
      now: () => now,
      defaultTurnSource: 'g2',
      idFactory: () => '00000000-0000-4000-8000-000000000002',
    });

    store.addSpeech('phone mic sentence', 'live_final', true, undefined, 'phone');

    const transcript = store.finalize();
    expect(transcript?.conversationTurns?.[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000002',
      speaker: 'unknown',
      source: 'phone',
      transcript: 'phone mic sentence',
      inputEvidence: {
        inputMode: 'phone_web_speech',
        speakerAttribution: 'single_stream_unresolved',
      },
    });
  });

  it('adds explicit partner conversation turns with Korean translation metadata', () => {
    const store = new TranscriptStore(2, 'Saved Topic', 'business', {
      saveRawTranscript: true,
      retentionPolicy: '7d',
      now: () => now,
      idFactory: () => 'partner-turn-0001',
    });

    const turn = store.addConversationTurn({
      speaker: 'partner',
      transcript: 'What problem are you solving first?',
      startedAt: now + 1_000,
      endedAt: now + 2_000,
      source: 'phone',
      language: 'en-US',
      translationKo: '<b>먼저 어떤 문제를 해결하려고 하나요?</b>',
      confidence: 0.87,
      correctedByUser: true,
      piiFlags: ['redacted-name'],
      inputEvidence: {
        inputMode: 'phone_web_speech',
        speakerAttribution: 'user_corrected',
      },
    });

    expect(turn).toMatchObject({
      schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
      id: 'partner-turn-0001',
      speaker: 'partner',
      startedAt: now + 1_000,
      endedAt: now + 2_000,
      source: 'phone',
      language: 'en-US',
      transcript: 'What problem are you solving first?',
      translationKo: '먼저 어떤 문제를 해결하려고 하나요?',
      confidence: 0.87,
      correctedByUser: true,
      piiFlags: ['redacted-name'],
    });
    expect(isConversationTurn(turn)).toBe(true);

    const transcript = store.finalize();
    expect(transcript?.conversationTurns?.[0]).toMatchObject({
      id: 'partner-turn-0001',
      speaker: 'partner',
      translationKo: '먼저 어떤 문제를 해결하려고 하나요?',
    });
    expect(JSON.stringify(transcript?.conversationTurns)).not.toContain('<b>');
  });

  it('updates persisted conversation turn speaker corrections and translations', () => {
    localStorage.setItem('echo_transcripts', JSON.stringify([
      {
        ...makeSession('correction-session', now),
        conversationTurns: [
          {
            schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
            id: 'turn-unknown',
            sessionId: 'correction-session',
            speaker: 'unknown',
            startedAt: now - 5_000,
            endedAt: now - 4_000,
            source: 'phone',
            language: 'en-US',
            transcript: 'Could you clarify the customer segment?',
            confidence: 0.61,
            isFinal: true,
            piiFlags: [],
          },
        ],
      },
    ]));

    const updated = TranscriptStore.updateConversationTurn('correction-session', 'turn-unknown', {
      speaker: 'partner',
      correctedByUser: true,
      translationKo: '<span>고객 세그먼트를 명확히 해 주시겠어요?</span>',
      confidence: 0.93,
    });

    expect(updated).toMatchObject({
      speaker: 'partner',
      correctedByUser: true,
      translationKo: '고객 세그먼트를 명확히 해 주시겠어요?',
      confidence: 0.93,
    });
    expect(isConversationTurn(updated)).toBe(true);

    const [stored] = TranscriptStore.loadAll();
    expect(stored?.conversationTurns?.[0]).toMatchObject({
      id: 'turn-unknown',
      speaker: 'partner',
      correctedByUser: true,
      translationKo: '고객 세그먼트를 명확히 해 주시겠어요?',
      confidence: 0.93,
    });
    expect(JSON.stringify(stored?.conversationTurns)).not.toContain('<span>');
  });

  it('persists validated ECHO domain v2 Cue and AssistEpisode records', () => {
    const store = new TranscriptStore(2, 'Saved Topic', 'business', {
      saveRawTranscript: true,
      retentionPolicy: '7d',
      now: () => now,
      idFactory: () => 'turn-0001',
    });

    store.addSpeech('Can you repeat that?', 'live_final');
    const targetTurnId = store.getLatestConversationTurnId();
    expect(targetTurnId).toBe('turn-0001');

    const cue = store.addCue({
      schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
      cueId: 'cue-0001',
      speechAct: 'ask_repeat',
      level: 2,
      phrase: 'Could you say that again?',
      meaningKo: 'Meaning unavailable',
      alternatives: ['Can you repeat it?'],
      expiresAfterMs: 2000,
      targetTurnId: targetTurnId!,
    });
    expect(isCue(cue)).toBe(true);

    const episode = store.addAssistEpisode({
      schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
      id: 'episode-0001',
      sessionId: store.sessionId,
      targetTurnId: targetTurnId!,
      trigger: 'manual',
      decision: {
        action: 'show',
        confidence: 1,
        trigger: 'manual',
        maxCueLevel: 2,
      },
      cueId: 'cue-0001',
      cueLevelUsed: 2,
      speechAct: 'ask_repeat',
      requestedAt: now,
      shownAt: now + 10,
      outcome: 'partial',
    });
    expect(isAssistEpisode(episode)).toBe(true);

    store.updateAssistEpisode('episode-0001', {
      resolvedAt: now + 100,
      acknowledgedAt: now + 100,
      outcome: 'assisted_adapted',
      userAttempt: 'Sorry, can you repeat it?',
    });

    const transcript = store.finalize();
    expect(transcript?.cues?.[0]).toMatchObject({
      cueId: 'cue-0001',
      targetTurnId: 'turn-0001',
    });
    expect(transcript?.assistEpisodes?.[0]).toMatchObject({
      id: 'episode-0001',
      cueId: 'cue-0001',
      outcome: 'assisted_adapted',
      userAttempt: 'Sorry, can you repeat it?',
    });
    expect(isCue(transcript?.cues?.[0])).toBe(true);
    expect(isAssistEpisode(transcript?.assistEpisodes?.[0])).toBe(true);
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
        cues: [
          {
            schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
            cueId: 'bad-cue',
            speechAct: 'answer',
            level: 1,
            phrase: '<script>alert(1)</script>',
            meaningKo: 'bad',
            alternatives: [],
            expiresAfterMs: 2000,
            targetTurnId: 'legacy:turn:1',
          },
        ],
        assistEpisodes: [
          {
            schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
            id: 'bad-episode',
            sessionId: 'legacy',
            targetTurnId: 'legacy:turn:1',
            trigger: 'manual',
            decision: {
              action: 'show',
              confidence: 1,
              trigger: 'manual',
              maxCueLevel: 1,
            },
            cueLevelUsed: 1,
            requestedAt: now,
            outcome: 'failed',
            userAttempt: '<script>alert(1)</script>',
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
      speaker: 'unknown',
      source: 'g2',
      language: 'en-US',
      transcript: 'legacy',
      isFinal: true,
      piiFlags: [],
    });
    expect(isConversationTurn(stored?.conversationTurns?.[0])).toBe(true);
    expect(JSON.stringify(stored?.conversationTurns)).not.toContain('<script>');
    expect(stored?.cues).toEqual([]);
    expect(stored?.assistEpisodes).toEqual([]);
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
