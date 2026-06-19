import { beforeEach, describe, expect, it } from 'vitest';
import {
  SessionEngine,
  type AudioDetector,
  type AudioDetectorFactory,
  type Clock,
  type CueProvider,
  type GlassDisplay,
  type SessionCallbacks,
  type SessionLog,
  type SpeechRecognizerDriver,
  type SpeechRecognizerFactory,
} from '../src/combat/session-engine';
import type { VADConfig } from '../src/combat/vad-manager';
import type { ChunkRequest, ChunkResult, SpeechEvaluationResult } from '../src/combat/chunk-generator';
import type { HybridRecognizerCallbacks, HybridRecognizerOptions, HybridMode } from '../src/combat/hybrid-recognizer';
import type { SessionAnalysis } from '../src/combat/transcript-analyzer';
import type { SessionTranscript, TranscriptStoreOptions } from '../src/combat/transcript-store';
import type { TranslationApiRequest, TranslationApiResponse } from '../src/services/echo-api';
import { clearConversationTranslationJobs } from '../src/combat/translation-queue';
import {
  ECHO_DOMAIN_V2_SCHEMA_VERSION,
  isAssistEpisode,
  isCue,
} from '@toolkit/echo-domain-v2';

class FakeClock implements Clock {
  current = 1_000;
  private nextId = 1;
  private timeouts = new Map<number, { at: number; callback: () => void }>();
  private intervals = new Map<number, { nextAt: number; delay: number; callback: () => void }>();

  now(): number {
    return this.current;
  }

  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const id = this.nextId++;
    this.timeouts.set(id, { at: this.current + delayMs, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  }

  clearTimeout(handle: ReturnType<typeof setTimeout>): void {
    this.timeouts.delete(handle as unknown as number);
  }

  setInterval(callback: () => void, delayMs: number): ReturnType<typeof setInterval> {
    const id = this.nextId++;
    this.intervals.set(id, { nextAt: this.current + delayMs, delay: delayMs, callback });
    return id as unknown as ReturnType<typeof setInterval>;
  }

  clearInterval(handle: ReturnType<typeof setInterval>): void {
    this.intervals.delete(handle as unknown as number);
  }

  activeIntervalCount(): number {
    return this.intervals.size;
  }

  activeTimeoutCount(): number {
    return this.timeouts.size;
  }

  activeTimerCount(): number {
    return this.timeouts.size + this.intervals.size;
  }

  advance(ms: number): void {
    const target = this.current + ms;

    while (true) {
      let nextDue = Number.POSITIVE_INFINITY;
      for (const timeout of this.timeouts.values()) {
        nextDue = Math.min(nextDue, timeout.at);
      }
      for (const interval of this.intervals.values()) {
        nextDue = Math.min(nextDue, interval.nextAt);
      }
      if (nextDue > target) break;

      this.current = nextDue;

      for (const [id, timeout] of [...this.timeouts]) {
        if (timeout.at <= this.current) {
          this.timeouts.delete(id);
          timeout.callback();
        }
      }

      for (const interval of this.intervals.values()) {
        if (interval.nextAt <= this.current) {
          interval.callback();
          interval.nextAt += interval.delay;
        }
      }
    }

    this.current = target;
  }
}

class FakeAudioDetector implements AudioDetector {
  audioSource: string;
  active = false;
  startCount = 0;
  stopCount = 0;
  pauseCount = 0;
  resumeCount = 0;
  updateThresholdCount = 0;
  restartCount = 0;

  constructor(
    private readonly config: VADConfig,
    source: 'bridge' | 'browser' = 'bridge',
    private readonly startError: Error | null = null,
  ) {
    this.audioSource = source;
  }

  async start(): Promise<void> {
    this.startCount++;
    this.active = true;
    if (this.startError) throw this.startError;
  }

  async stop(): Promise<void> {
    this.stopCount++;
    this.active = false;
  }

  async pause(): Promise<void> {
    this.pauseCount++;
  }

  async resume(): Promise<void> {
    this.resumeCount++;
  }

  updateThreshold(): void {
    this.updateThresholdCount++;
  }

  simulateSilenceRestart(): void {
    this.restartCount++;
  }

  async triggerSilence(): Promise<void> {
    await Promise.resolve((this.config.onSilenceThreshold as () => unknown)());
  }

  async triggerSpeechEnd(audio = new Float32Array(16_000)): Promise<void> {
    await Promise.resolve(this.config.onSpeechEnd(audio));
  }

  triggerSpeech(): void {
    this.config.onSpeechDetected();
  }
}

class FakeSpeechRecognizer implements SpeechRecognizerDriver {
  mode: HybridMode = 'hybrid';
  startCount = 0;
  startBridgeCount = 0;
  startHybridCount = 0;
  stopCount = 0;
  feedCount = 0;
  speechStartCount = 0;
  speechEndCount = 0;

  constructor(private readonly callbacks: HybridRecognizerCallbacks) {}

  start(): boolean {
    this.startCount++;
    this.mode = 'browser';
    return true;
  }

  startBridge(): boolean {
    this.startBridgeCount++;
    this.mode = 'bridge';
    return true;
  }

  startHybrid(): boolean {
    this.startHybridCount++;
    this.mode = 'hybrid';
    return true;
  }

  stop(): void {
    this.stopCount++;
  }

  feedPCM(): void {
    this.feedCount++;
  }

  notifySpeechStart(): void {
    this.speechStartCount++;
  }

  async notifySpeechEnd(): Promise<void> {
    this.speechEndCount++;
  }

  emitInterimResult(text: string, confidence?: number): void {
    this.callbacks.onInterimResult(text, confidence);
  }

  emitFinalResult(text: string, confidence?: number): void {
    this.callbacks.onFinalResult(text, confidence);
  }

  emitError(error: string): void {
    this.callbacks.onError?.(error);
  }
}

class FakeHud implements GlassDisplay {
  events: string[] = [];

  initCombatDisplay(): void {
    this.events.push('initCombatDisplay');
  }

  showSpeechActive(): void {
    this.events.push('showSpeechActive');
  }

  showLiveTranscript(text: string): void {
    this.events.push(`showLiveTranscript:${text}`);
  }

  showGrammarFeedback(correction: string): void {
    this.events.push(`showGrammarFeedback:${correction}`);
  }

  showSilenceCountdown(secondsLeft: number): void {
    this.events.push(`showSilenceCountdown:${secondsLeft}`);
  }

  showListening(): void {
    this.events.push('showListening');
  }

  showPaused(): void {
    this.events.push('showPaused');
  }

  showGoodJob(): void {
    this.events.push('showGoodJob');
  }
}

describe('SessionEngine core behavior with injected dependencies', () => {
  beforeEach(() => {
    clearConversationTranslationJobs();
  });

  it('defaults to Manual Assist and records silence without auto-generating a cue', async () => {
    const harness = createHarness();
    await harness.engine.start(harness.hud);

    expect(harness.engine.currentAssistMode).toBe('manual');

    harness.clock.advance(5_200);
    await harness.vad.triggerSilence();

    expect(harness.cueProvider.generateCalls).toBe(0);
    expect(harness.chunks).toEqual([]);
    expect(harness.states).toContain('silence_detected');
    expect(harness.engine.currentAssistMetrics).toMatchObject({
      manual_request_count: 0,
      auto_trigger_count: 0,
      cue_dismissed_count: 0,
      false_trigger_count: 0,
      cue_used_count: 0,
      auto_assist_paused: false,
    });
  });

  it('skips auto cue generation during Week 4 blackout', async () => {
    const harness = createHarness({
      week: 4,
      randomValue: 0.1,
    });
    harness.engine.setAssistMode('auto');
    await harness.engine.start(harness.hud);

    harness.recognizers[0]!.emitFinalResult('I think maybe...');
    await triggerAutoSilence(harness, 2_200);

    expect(harness.cueProvider.generateCalls).toBe(0);
    expect(harness.chunks).toEqual([]);
    expect(harness.states).toContain('silence_detected');
  });

  it('does not auto-generate a cue from silence alone without a breakdown signal', async () => {
    const harness = createHarness();
    harness.engine.setAssistMode('auto');
    await harness.engine.start(harness.hud);

    await triggerAutoSilence(harness);

    expect(harness.cueProvider.generateCalls).toBe(0);
    expect(harness.chunks).toEqual([]);
    expect(harness.engine.currentAssistMetrics.auto_trigger_count).toBe(0);
  });

  it('cancels Auto Assist during the grace period when speech resumes', async () => {
    const harness = createHarness();
    harness.engine.setAssistMode('auto');
    await harness.engine.start(harness.hud);

    harness.recognizers[0]!.emitFinalResult('I think maybe...');
    harness.clock.advance(5_200);
    await harness.vad.triggerSilence();
    harness.vad.triggerSpeech();
    harness.clock.advance(500);
    await Promise.resolve();

    expect(harness.cueProvider.generateCalls).toBe(0);
    expect(harness.chunks).toEqual([]);
    expect(harness.engine.currentAssistMetrics.auto_trigger_count).toBe(0);
  });

  it('does not auto-generate a cue for partner-marked speech breakdowns', async () => {
    const harness = createHarness();
    harness.engine.setAssistMode('auto');
    await harness.engine.start(harness.hud);

    harness.recognizers[0]!.emitFinalResult('I think maybe...');
    const latestTurnId = harness.conversationSnapshots.at(-1)?.conversationTurns?.at(-1)?.id;
    expect(latestTurnId).toBeTruthy();
    expect(harness.engine.correctConversationTurnSpeaker(latestTurnId!, 'partner')).toBe(true);

    await triggerAutoSilence(harness);

    expect(harness.cueProvider.generateCalls).toBe(0);
    expect(harness.chunks).toEqual([]);
    expect(harness.engine.currentAssistMetrics.auto_trigger_count).toBe(0);
  });

  it('pauses Auto Assist after two dismissed auto cues', async () => {
    const harness = createHarness({
      chunkResults: [
        { chunk: 'First auto cue', source: 'gemini', latencyMs: 5 },
        { chunk: 'Second auto cue', source: 'gemini', latencyMs: 5 },
        { chunk: 'Should not appear', source: 'gemini', latencyMs: 5 },
      ],
    });
    harness.engine.setAssistMode('auto');
    await harness.engine.start(harness.hud);

    for (let i = 0; i < 2; i++) {
      harness.recognizers[0]!.emitFinalResult('I think maybe...');
      await triggerAutoSilence(harness);
      expect(harness.engine.dismissActiveCue()).toBe(true);
    }

    expect(harness.engine.currentAssistMetrics).toMatchObject({
      auto_trigger_count: 2,
      cue_dismissed_count: 2,
      false_trigger_count: 2,
      auto_assist_paused: true,
    });

    harness.recognizers[0]!.emitFinalResult('I think maybe...');
    await triggerAutoSilence(harness);

    expect(harness.cueProvider.generateCalls).toBe(2);
    expect(harness.chunks.map((chunk) => chunk.chunk)).toEqual([
      'First auto cue',
      'Second auto cue',
    ]);
  });

  it('caps Auto Assist at three automatic cue generations per session', async () => {
    const harness = createHarness({
      chunkResults: [
        { chunk: 'Auto cue one', source: 'gemini', latencyMs: 5 },
        { chunk: 'Auto cue two', source: 'gemini', latencyMs: 5 },
        { chunk: 'Auto cue three', source: 'gemini', latencyMs: 5 },
        { chunk: 'Should not generate', source: 'gemini', latencyMs: 5 },
      ],
    });
    harness.engine.setAssistMode('auto');
    await harness.engine.start(harness.hud);

    for (let i = 0; i < 3; i++) {
      harness.recognizers[0]!.emitFinalResult('I think maybe...');
      await triggerAutoSilence(harness);
      harness.clock.advance(2_100);
    }

    harness.recognizers[0]!.emitFinalResult('I think maybe...');
    await triggerAutoSilence(harness);

    expect(harness.engine.currentAssistMetrics.auto_trigger_count).toBe(3);
    expect(harness.cueProvider.generateCalls).toBe(3);
    expect(harness.chunks.map((chunk) => chunk.chunk)).toEqual([
      'Auto cue one',
      'Auto cue two',
      'Auto cue three',
    ]);
  });

  it('caps Auto Assist cue levels and visible text at 2 even when provider returns level 3', async () => {
    const clock = new FakeClock();
    const harness = createHarness({
      week: 4,
      clock,
      chunkResult: {
        chunk: 'Could you explain the full renewal timeline?',
        source: 'gemini',
        latencyMs: 5,
        cue: {
          schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
          cueId: 'provider-auto-level-3',
          speechAct: 'answer',
          level: 3,
          phrase: 'Could you explain the full renewal timeline?',
          meaningKo: 'Meaning unavailable',
          alternatives: ['Could you explain the full renewal plan?'],
          expiresAfterMs: 1200,
          targetTurnId: 'turn-auto-cap-1',
        },
      },
      transcriptOptions: {
        saveRawTranscript: true,
        retentionPolicy: '7d',
        now: () => clock.now(),
        idFactory: () => 'turn-auto-cap-1',
      },
    });
    harness.engine.setAssistMode('auto');
    await harness.engine.start(harness.hud);

    harness.recognizers[0]!.emitFinalResult('I think maybe...');
    await triggerAutoSilence(harness, 2_200);

    expect(harness.cueProvider.requests[0]?.adaptiveDifficulty).toBe(2);
    expect(harness.cueProvider.requests[0]?.maxCueLevel).toBe(2);
    expect(harness.chunks[0]?.cue?.cueId).toBe('provider-auto-level-3');
    expect(harness.chunks[0]?.cue?.level).toBe(2);
    expect(harness.chunks[0]?.chunk).toBe('Could you explain the full...');
    expect(harness.chunks[0]?.cue?.phrase).toBe('Could you explain the full...');
    expect(harness.chunks[0]?.chunk).not.toContain('timeline?');
  });

  it('keeps level 3 available for explicit Manual Assist requests', async () => {
    const harness = createHarness({
      week: 4,
      chunkResult: {
        chunk: 'Could you explain the full renewal timeline?',
        source: 'gemini',
        latencyMs: 5,
        cue: {
          schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
          cueId: 'provider-manual-level-3',
          speechAct: 'answer',
          level: 3,
          phrase: 'Could you explain the full renewal timeline?',
          meaningKo: 'Meaning unavailable',
          alternatives: [],
          expiresAfterMs: 1200,
          targetTurnId: 'turn-manual-1',
        },
      },
      transcriptOptions: {
        idFactory: () => 'turn-manual-1',
      },
    });
    await harness.engine.start(harness.hud);

    await harness.engine.requestManualCue();

    expect(harness.cueProvider.requests[0]?.adaptiveDifficulty).toBe(3);
    expect(harness.cueProvider.requests[0]?.maxCueLevel).toBe(3);
    expect(harness.chunks[0]?.cue?.level).toBe(3);
    expect(harness.chunks[0]?.chunk).toBe('Could you explain the full renewal timeline?');
  });

  it('caps speech-evaluation cue levels and visible text at 2', async () => {
    const harness = createHarness({
      week: 4,
      cloudProcessingEnabled: true,
      speechEvaluationResult: {
        transcript: 'I think maybe',
        chunk: 'Could you explain the full renewal timeline?',
        source: 'gemini',
        latencyMs: 8,
        networkLatencyMs: 6,
        generationLatencyMs: 2,
        confidence: 0.84,
      },
    });
    await harness.engine.start(harness.hud);

    await harness.vad.triggerSpeechEnd();

    expect(harness.cueProvider.evaluateCalls).toBe(1);
    expect(harness.cueProvider.evaluationRequests[0]?.adaptiveDifficulty).toBe(2);
    expect(harness.cueProvider.evaluationRequests[0]?.maxCueLevel).toBe(2);
    expect(harness.chunks[0]?.cue?.level).toBe(2);
    expect(harness.chunks[0]?.chunk).toBe('Could you explain the full...');
  });

  it('reconciles live final and speech-evaluation transcripts into one conversation turn', async () => {
    const transcript = 'I need a moment to check.';
    const harness = createHarness({
      speechEvaluationResult: {
        transcript,
        chunk: null,
        source: 'gemini',
        latencyMs: 8,
        confidence: 0.86,
      },
    });
    await harness.engine.start(harness.hud);

    harness.recognizers[0]!.emitFinalResult(transcript, 0.86);
    await harness.vad.triggerSpeechEnd();

    const latest = harness.conversationSnapshots.at(-1);
    const turns = latest?.conversationTurns?.filter((turn) => turn.transcript === transcript) ?? [];
    const speechEntries = latest?.entries.filter((entry) => (
      entry.type === 'user_speech' &&
      entry.text === transcript
    )) ?? [];

    expect(harness.cueProvider.evaluateCalls).toBe(1);
    expect(turns).toHaveLength(1);
    expect(speechEntries).toHaveLength(1);
    expect(latest?.entries.some((entry) => entry.text === '[speech detected]')).toBe(false);
  });

  it('records a speech-evaluation transcript once when no live final arrives first', async () => {
    const transcript = 'Let me answer the renewal question.';
    const harness = createHarness({
      speechEvaluationResult: {
        transcript,
        chunk: null,
        source: 'gemini',
        latencyMs: 8,
        confidence: 0.82,
      },
    });
    await harness.engine.start(harness.hud);

    await harness.vad.triggerSpeechEnd();

    const latest = harness.conversationSnapshots.at(-1);
    expect(harness.liveTranscripts).toContainEqual({ text: transcript, isFinal: true });
    expect(latest?.conversationTurns?.filter((turn) => turn.transcript === transcript)).toHaveLength(1);
    expect(latest?.entries.filter((entry) => (
      entry.type === 'user_speech' &&
      entry.text === transcript &&
      entry.source === 'gemini_eval'
    ))).toHaveLength(1);
  });

  it('does not add a speech-detected placeholder after a live final transcript', async () => {
    const transcript = 'I can explain the onboarding risk.';
    const harness = createHarness({
      speechEvaluationResult: null,
    });
    await harness.engine.start(harness.hud);

    harness.recognizers[0]!.emitFinalResult(transcript, 0.81);
    await harness.vad.triggerSpeechEnd();

    const latest = harness.conversationSnapshots.at(-1);
    expect(harness.cueProvider.evaluateCalls).toBe(1);
    expect(latest?.conversationTurns?.filter((turn) => turn.transcript === transcript)).toHaveLength(1);
    expect(latest?.entries.some((entry) => entry.text === '[speech detected]')).toBe(false);
  });

  it('shows a fallback manual cue without real hardware', async () => {
    const harness = createHarness({
      chunkResult: {
        chunk: 'Use a local fallback cue',
        source: 'fallback',
        latencyMs: 0,
      },
    });
    await harness.engine.start(harness.hud);

    await harness.engine.requestManualCue();

    expect(harness.cueProvider.generateCalls).toBe(1);
    expect(harness.chunks.map((chunk) => chunk.chunk)).toEqual(['Use a local fallback cue']);
    expect(harness.states).toContain('hud_flash');
  });

  it('records cue latency metadata without raw transcript text', async () => {
    const sensitiveTranscript = 'my private lunch order and phone number should not be in latency metadata';
    const harness = createHarness({
      chunkResult: {
        chunk: 'Latency-safe cue',
        source: 'gemini',
        latencyMs: 42,
        networkLatencyMs: 31,
        generationLatencyMs: 11,
      },
    });
    await harness.engine.start(harness.hud);

    harness.recognizers[0]!.emitFinalResult(sensitiveTranscript);
    await harness.engine.requestManualCue();
    await harness.engine.stop();

    const log = harness.logs[0]!;
    expect(log.cueLatencyRecords).toHaveLength(1);
    expect(log.cueLatencyRecords[0]).toEqual({
      session_request_scope_id: 'echo-1000-test-scope',
      request_id: 'echo-1000-test-scope:cue:2',
      request_kind: 'cue',
      trigger: 'manual',
      silence_detected_at: null,
      cue_request_started_at: 1000,
      cue_response_received_at: 1000,
      cue_displayed_at: 1000,
      network_latency_ms: 31,
      generation_latency_ms: 11,
      hud_render_latency_ms: 0,
      end_to_end_latency_ms: 0,
      source: 'gemini',
    });
    expect(JSON.stringify(log.cueLatencyRecords)).not.toContain(sensitiveTranscript);
    expect(harness.cueProvider.requests[0]?.lastUtterance).toBe(sensitiveTranscript);
  });

  it('passes speaker-labeled conversation turns to cue generation context', async () => {
    const harness = createHarness({
      audioSource: 'browser',
    });
    await harness.engine.start(harness.hud);

    harness.recognizers[0]!.emitFinalResult('Could you clarify the customer segment?', 0.88);
    const partnerTurnId = harness.conversationSnapshots.at(-1)?.conversationTurns?.at(-1)?.id;
    expect(partnerTurnId).toBeTruthy();
    expect(harness.engine.correctConversationTurnSpeaker(partnerTurnId!, 'partner')).toBe(true);

    harness.recognizers[0]!.emitFinalResult('I can explain the segment.', 0.9);
    const learnerTurnId = harness.conversationSnapshots.at(-1)?.conversationTurns?.at(-1)?.id;
    expect(learnerTurnId).toBeTruthy();
    expect(harness.engine.correctConversationTurnSpeaker(learnerTurnId!, 'learner')).toBe(true);

    harness.recognizers[0]!.emitFinalResult('The renewal timeline is still unclear.', 0.8);

    await harness.engine.requestManualCue();

    expect(harness.cueProvider.requests[0]?.conversationContext).toBe([
      'Partner: Could you clarify the customer segment?',
      'Learner: I can explain the segment.',
      'Unknown speaker: The renewal timeline is still unclear.',
    ].join('\n'));
    expect(harness.cueProvider.requests[0]?.conversationContext).not.toContain('User said');
  });

  it('persists ECHO domain v2 Cue and AssistEpisode records for shown cues', async () => {
    const clock = new FakeClock();
    const harness = createHarness({
      clock,
      chunkResult: {
        chunk: 'Could you say that again?',
        source: 'gemini',
        latencyMs: 42,
      },
      transcriptOptions: {
        saveRawTranscript: true,
        retentionPolicy: '7d',
        now: () => clock.now(),
        idFactory: () => 'turn-manual-cue-1',
      },
    });
    await harness.engine.start(harness.hud);

    harness.recognizers[0]!.emitFinalResult('I need help');
    await harness.engine.requestManualCue();
    await harness.engine.stop();

    const transcript = harness.logs[0]?.transcript;
    expect(transcript?.cues).toHaveLength(1);
    expect(transcript?.assistEpisodes).toHaveLength(1);
    expect(transcript?.cues?.[0]).toMatchObject({
      cueId: 'echo-1000-test-scope:cue:2:cue',
      targetTurnId: 'turn-manual-cue-1',
      phrase: 'Could you say that again?',
    });
    expect(transcript?.assistEpisodes?.[0]).toMatchObject({
      id: 'echo-1000-test-scope:cue:2:cue:episode',
      targetTurnId: 'turn-manual-cue-1',
      trigger: 'manual',
      cueId: 'echo-1000-test-scope:cue:2:cue',
      outcome: 'failed',
      shownAt: 1000,
      resolvedAt: 1000,
    });
    expect(isCue(transcript?.cues?.[0])).toBe(true);
    expect(isAssistEpisode(transcript?.assistEpisodes?.[0])).toBe(true);
  });

  it('prevents duplicate cue requests while one is in flight', async () => {
    const deferredCue = deferred<ChunkResult>();
    const harness = createHarness({ pendingChunk: deferredCue.promise });
    await harness.engine.start(harness.hud);

    const first = harness.engine.requestManualCue();
    await harness.engine.requestManualCue();

    expect(harness.cueProvider.generateCalls).toBe(1);
    deferredCue.resolve({
      chunk: 'Only one cue',
      source: 'gemini',
      latencyMs: 12,
    });
    await first;

    expect(harness.chunks.map((chunk) => chunk.chunk)).toEqual(['Only one cue']);
  });

  it('passes prior cue text to the provider so duplicate cue content can be avoided', async () => {
    const harness = createHarness({
      chunkResults: [
        { chunk: 'Previously shown cue', source: 'gemini', latencyMs: 5 },
        { chunk: 'Fresh cue', source: 'gemini', latencyMs: 5 },
      ],
    });
    await harness.engine.start(harness.hud);

    await harness.engine.requestManualCue();
    await harness.engine.requestManualCue();

    expect(harness.cueProvider.generateCalls).toBe(2);
    expect(harness.cueProvider.requests[1]?.usedHints).toContain('Previously shown cue');
    expect(harness.chunks.map((chunk) => chunk.chunk)).toEqual([
      'Previously shown cue',
      'Fresh cue',
    ]);
  });

  it('clears a visible cue when speech is detected', async () => {
    const harness = createHarness({
      chunkResult: {
        chunk: 'Cue to clear',
        source: 'gemini',
        latencyMs: 8,
      },
    });
    await harness.engine.start(harness.hud);
    await harness.engine.requestManualCue();

    harness.vad.triggerSpeech();

    expect(harness.hud.events).toContain('showListening');
    expect(harness.engine.dismissActiveCue()).toBe(false);
  });

  it('does not count ordinary listening speech as an independent recovery', async () => {
    const harness = createHarness();
    await harness.engine.start(harness.hud);

    harness.vad.triggerSpeech();
    await harness.engine.stop();

    expect(harness.logs[0]).toMatchObject({
      totalSpeechEvents: 1,
      selfResponseRate: 0,
    });
  });

  it('records simplified hints as simplified instead of missed', async () => {
    const harness = createHarness({
      chunkResult: {
        chunk: 'Complex original cue',
        source: 'gemini',
        latencyMs: 8,
      },
      simplifiedHint: 'Simple cue',
    });
    harness.engine.setAssistMode('auto');
    await harness.engine.start(harness.hud);

    await harness.engine.requestManualCue();
    harness.clock.advance(2_100);
    harness.clock.advance(5_200);
    await harness.vad.triggerSilence();
    await Promise.resolve();

    expect(harness.cueProvider.simplifyCalls).toBe(1);

    harness.recognizers[0]!.emitFinalResult('simple cue');
    await harness.engine.stop();

    expect(harness.analyses[0]).toMatchObject({
      totalHints: 2,
      hintsUsed: 1,
      hintsMissed: 0,
      hintsSimplified: 1,
    });
  });

  it('counts adapted speech-act cue usage and shows ACK', async () => {
    const harness = createHarness({
      chunkResult: {
        chunk: 'Could you say that again?',
        source: 'gemini',
        latencyMs: 8,
      },
    });
    await harness.engine.start(harness.hud);

    await harness.engine.requestManualCue();
    harness.recognizers[0]!.emitFinalResult('Sorry, can you repeat it?');
    await harness.engine.stop();

    expect(harness.hud.events).toContain('showGoodJob');
    expect(harness.engine.currentAssistMetrics.cue_used_count).toBe(1);
    expect(harness.hintResults[0]).toMatchObject({
      hint: 'Could you say that again?',
      status: 'used',
      outcome: 'assisted_adapted',
    });
    expect(harness.analyses[0]).toMatchObject({
      totalHints: 1,
      hintsUsed: 1,
      hintsMissed: 0,
    });
  });

  it('does not count unrelated three-word speech as cue recovery', async () => {
    const harness = createHarness({
      chunkResult: {
        chunk: 'Could you say that again?',
        source: 'gemini',
        latencyMs: 8,
      },
    });
    await harness.engine.start(harness.hud);

    await harness.engine.requestManualCue();
    harness.recognizers[0]!.emitFinalResult('I maybe tomorrow');
    await harness.engine.stop();

    expect(harness.hud.events).not.toContain('showGoodJob');
    expect(harness.engine.currentAssistMetrics.cue_used_count).toBe(0);
    expect(harness.hintResults).toEqual([]);
    expect(harness.analyses[0]).toMatchObject({
      totalHints: 1,
      hintsUsed: 0,
      hintsMissed: 1,
    });
  });

  it('ignores late cue responses after session stop', async () => {
    const deferredCue = deferred<ChunkResult>();
    const harness = createHarness({ pendingChunk: deferredCue.promise });
    await harness.engine.start(harness.hud);

    const request = harness.engine.requestManualCue();
    expect(harness.cueProvider.signals[0]?.aborted).toBe(false);

    await harness.engine.stop();
    expect(harness.cueProvider.signals[0]?.aborted).toBe(true);

    deferredCue.resolve({
      chunk: 'Too late',
      source: 'gemini',
      latencyMs: 20,
    });
    await request;

    expect(harness.chunks).toEqual([]);
    expect(harness.logs).toHaveLength(1);
    expect(harness.states[harness.states.length - 1]).toBe('session_end');
  });

  it('aborts delayed cue generation and keeps the HUD paused when pause interrupts proxy work', async () => {
    const harness = createHarness({ rejectChunkOnAbort: true });
    await harness.engine.start(harness.hud);

    const request = harness.engine.requestManualCue();
    expect(harness.states[harness.states.length - 1]).toBe('chunk_generating');
    expect(harness.cueProvider.signals[0]?.aborted).toBe(false);

    await harness.engine.pause();
    await request;

    expect(harness.cueProvider.signals[0]?.aborted).toBe(true);
    expect(harness.vad.pauseCount).toBe(1);
    expect(harness.recognizers[0]?.stopCount).toBe(1);
    expect(harness.chunks).toEqual([]);
    expect(harness.clock.activeTimerCount()).toBe(0);
    expect(harness.states[harness.states.length - 1]).toBe('paused');
    expect(harness.hud.events[harness.hud.events.length - 1]).toBe('showPaused');
  });

  it('does not duplicate silence countdown timers across pause and resume', async () => {
    const harness = createHarness();
    await harness.engine.start(harness.hud);
    const recognizer = harness.recognizers[0]!;

    expect(harness.clock.activeIntervalCount()).toBe(1);
    expect(recognizer.startBridgeCount).toBe(1);
    expect(recognizer.startHybridCount).toBe(0);

    await harness.engine.pause();
    expect(harness.clock.activeIntervalCount()).toBe(0);

    await harness.engine.resume();
    expect(harness.clock.activeIntervalCount()).toBe(1);
    expect(recognizer.startBridgeCount).toBe(2);
    expect(recognizer.startHybridCount).toBe(0);

    await harness.engine.pause();
    await harness.engine.resume();
    expect(harness.clock.activeIntervalCount()).toBe(1);
    expect(recognizer.startBridgeCount).toBe(3);
    expect(recognizer.startHybridCount).toBe(0);
  });

  it('surfaces G2 mic start failure without starting recognition', async () => {
    const startError = new Error('G2 mic unavailable');
    const harness = createHarness({ vadStartError: startError });

    await expect(harness.engine.start(harness.hud)).rejects.toThrow('G2 mic unavailable');
    expect(harness.vad.startCount).toBe(1);
    expect(harness.recognizers).toHaveLength(0);
    expect(harness.states).toEqual(['loading_vad']);
  });

  it('starts bridge-only recognition for G2 Mic sessions', async () => {
    const harness = createHarness({ audioSource: 'bridge' });

    await harness.engine.start(harness.hud);

    const recognizer = harness.recognizers[0]!;
    expect(recognizer.startBridgeCount).toBe(1);
    expect(recognizer.startHybridCount).toBe(0);
    expect(recognizer.startCount).toBe(0);
    expect(recognizer.mode).toBe('bridge');
  });

  it('starts browser recognition only for explicit Phone Mic sessions', async () => {
    const harness = createHarness({ audioSource: 'browser' });

    await harness.engine.start(harness.hud);

    const recognizer = harness.recognizers[0]!;
    expect(recognizer.startCount).toBe(1);
    expect(recognizer.startBridgeCount).toBe(0);
    expect(recognizer.startHybridCount).toBe(0);
    expect(recognizer.mode).toBe('browser');
  });

  it('passes session-scoped transcription metadata to the live recognizer', async () => {
    const harness = createHarness();

    await harness.engine.start(harness.hud);

    const options = harness.recognizerOptions[0]!;
    expect(options.clientSessionId).toBe('echo-1000-test-scope');
    expect(options.createRequestId?.('transcription')).toBe('echo-1000-test-scope:transcription:1');
  });

  it('keeps grammar analysis out of live final transcript handling', async () => {
    const harness = createHarness();
    await harness.engine.start(harness.hud);

    harness.recognizers[0]!.emitFinalResult('I need a little more time');

    expect(harness.liveTranscripts).toEqual([
      { text: 'I need a little more time', isFinal: true },
    ]);
    expect(harness.hud.events.some((event) => event.startsWith('showGrammarFeedback:'))).toBe(false);
  });

  it('updates live interim and final text on the same conversation turn', async () => {
    const harness = createHarness({ audioSource: 'browser' });
    await harness.engine.start(harness.hud);

    harness.recognizers[0]!.emitInterimResult('Could you', 0.44);
    const firstPartial = harness.conversationSnapshots.at(-1)?.conversationTurns?.at(-1);

    expect(firstPartial).toMatchObject({
      transcript: 'Could you',
      source: 'phone',
      confidence: 0.44,
      isFinal: false,
    });
    expect(harness.conversationSnapshots.at(-1)?.entries.filter((entry) => entry.type === 'user_speech')).toHaveLength(0);

    harness.recognizers[0]!.emitInterimResult('Could you clarify', 0.58);
    const secondPartial = harness.conversationSnapshots.at(-1)?.conversationTurns?.at(-1);

    expect(secondPartial).toMatchObject({
      id: firstPartial?.id,
      transcript: 'Could you clarify',
      confidence: 0.58,
      isFinal: false,
    });

    harness.recognizers[0]!.emitFinalResult('Could you clarify the timeline?', 0.88);
    const finalTurn = harness.conversationSnapshots.at(-1)?.conversationTurns?.at(-1);
    const speechEntries = harness.conversationSnapshots.at(-1)?.entries.filter((entry) => entry.type === 'user_speech') ?? [];

    expect(finalTurn).toMatchObject({
      id: firstPartial?.id,
      transcript: 'Could you clarify the timeline?',
      confidence: 0.88,
      isFinal: true,
    });
    expect(speechEntries).toHaveLength(1);
    expect(speechEntries[0]).toMatchObject({
      text: 'Could you clarify the timeline?',
      source: 'live_final',
      isFinal: true,
      confidence: 0.88,
    });
    expect(harness.hud.events.some((event) => event.startsWith('showLiveTranscript:'))).toBe(false);
  });

  it('emits live phone conversation timeline snapshots with unknown speaker until corrected', async () => {
    const harness = createHarness({ audioSource: 'browser' });
    await harness.engine.start(harness.hud);

    harness.recognizers[0]!.emitFinalResult('Could you clarify the customer segment?', 0.87);

    const latest = harness.conversationSnapshots.at(-1);
    expect(latest?.conversationTurns?.at(-1)).toMatchObject({
      speaker: 'unknown',
      source: 'phone',
      transcript: 'Could you clarify the customer segment?',
      confidence: 0.87,
      isFinal: true,
      inputEvidence: {
        inputMode: 'phone_web_speech',
        speakerAttribution: 'single_stream_unresolved',
      },
    });
    expect(harness.hud.events.some((event) => event.includes('conversation'))).toBe(false);
  });

  it('emits live G2 conversation timeline snapshots with source boundary and unknown speaker', async () => {
    const harness = createHarness({ audioSource: 'bridge' });
    await harness.engine.start(harness.hud);

    harness.recognizers[0]!.emitFinalResult('I can start with the onboarding risk.', 0.81);

    const latest = harness.conversationSnapshots.at(-1);
    expect(latest?.conversationTurns?.at(-1)).toMatchObject({
      speaker: 'unknown',
      source: 'g2',
      transcript: 'I can start with the onboarding risk.',
      confidence: 0.81,
      isFinal: true,
      inputEvidence: {
        inputMode: 'g2_bridge_pcm',
        speakerAttribution: 'single_stream_unresolved',
        sampleRateHz: 16000,
        channelCount: 1,
        encoding: 'pcm_s16le_mono',
      },
    });
    expect(harness.hud.events.some((event) => event.includes('conversation'))).toBe(false);
  });

  it('writes Korean translations back to the active phone conversation timeline', async () => {
    const harness = createHarness({
      audioSource: 'browser',
      cloudProcessingEnabled: true,
      translationResult: {
        translationKo: '<b>고객 세그먼트를 명확히 해 주시겠어요?</b>',
        source: 'proxy',
        latencyMs: 42,
      },
    });
    await harness.engine.start(harness.hud);

    harness.recognizers[0]!.emitFinalResult('Could you clarify the customer segment?', 0.88);
    await flushPromises();

    expect(harness.translationProvider.translateCalls).toBe(1);
    expect(harness.translationProvider.requests[0]).toMatchObject({
      clientSessionId: 'echo-1000-test-scope',
      requestId: 'echo-1000-test-scope:translation:1',
      sourceLanguage: 'en-US',
      targetLanguage: 'ko-KR',
      text: 'Could you clarify the customer segment?',
    });
    expect(harness.conversationSnapshots.at(-1)?.conversationTurns?.at(-1)).toMatchObject({
      transcript: 'Could you clarify the customer segment?',
      translationKo: '고객 세그먼트를 명확히 해 주시겠어요?',
    });
    expect(harness.hud.events.some((event) => event.includes('고객 세그먼트'))).toBe(false);
  });

  it('does not send live conversation text for translation when cloud processing is disabled', async () => {
    const harness = createHarness({
      audioSource: 'browser',
      cloudProcessingEnabled: false,
      translationResult: {
        translationKo: '고객 세그먼트를 명확히 해 주시겠어요?',
      },
    });
    await harness.engine.start(harness.hud);

    await harness.vad.triggerSpeechEnd();
    await flushPromises();

    expect(harness.translationProvider.translateCalls).toBe(0);
    expect(harness.conversationSnapshots.at(-1)?.conversationTurns?.at(-1)).not.toHaveProperty('translationKo');
  });

  it('persists live speaker corrections on the active conversation turn', async () => {
    const harness = createHarness({ audioSource: 'browser' });
    await harness.engine.start(harness.hud);

    harness.recognizers[0]!.emitFinalResult('Could you clarify the customer segment?', 0.87);
    const turnId = harness.conversationSnapshots.at(-1)?.conversationTurns?.at(-1)?.id;
    expect(turnId).toBeTruthy();

    const updated = harness.engine.correctConversationTurnSpeaker(turnId!, 'partner');

    expect(updated).toBe(true);
    const latest = harness.conversationSnapshots.at(-1);
    expect(latest?.conversationTurns?.at(-1)).toMatchObject({
      id: turnId,
      speaker: 'partner',
      correctedByUser: true,
      source: 'phone',
      transcript: 'Could you clarify the customer segment?',
      inputEvidence: {
        inputMode: 'phone_web_speech',
        speakerAttribution: 'user_corrected',
      },
    });
  });

  it('stops audio detector and recognizer during cleanup', async () => {
    const harness = createHarness();
    await harness.engine.start(harness.hud);

    await harness.engine.stop();

    expect(harness.vad.stopCount).toBe(1);
    expect(harness.recognizers[0]?.stopCount).toBe(1);
    expect(harness.clock.activeIntervalCount()).toBe(0);
    expect(harness.states[harness.states.length - 1]).toBe('session_end');
  });

  it('ignores late speech recognizer callbacks after cleanup', async () => {
    const harness = createHarness();
    await harness.engine.start(harness.hud);
    const recognizer = harness.recognizers[0]!;

    await harness.engine.stop();
    const hudEventCountAfterStop = harness.hud.events.length;

    recognizer.emitInterimResult('late interim');
    recognizer.emitFinalResult('late final');
    recognizer.emitError('late error');

    expect(harness.liveTranscripts).toEqual([]);
    expect(harness.hud.events).toHaveLength(hudEventCountAfterStop);
    expect(harness.clock.activeTimerCount()).toBe(0);
  });

  it('cleans audio, recognizers, timers, and stale callbacks across ten session cycles', async () => {
    const sharedClock = new FakeClock();
    const detectors: FakeAudioDetector[] = [];
    const recognizers: FakeSpeechRecognizer[] = [];

    for (let cycle = 0; cycle < 10; cycle++) {
      const harness = createHarness({ clock: sharedClock });
      await harness.engine.start(harness.hud);
      const recognizer = harness.recognizers[0]!;

      expect(harness.vad.active).toBe(true);
      expect(sharedClock.activeIntervalCount()).toBe(1);

      await harness.engine.stop();

      expect(harness.vad.active).toBe(false);
      expect(harness.vad.stopCount).toBe(1);
      expect(recognizer.stopCount).toBe(1);
      expect(sharedClock.activeTimerCount()).toBe(0);

      const hudEventCountAfterStop = harness.hud.events.length;
      recognizer.emitFinalResult(`late final ${cycle}`);
      harness.vad.triggerSpeech();
      await harness.vad.triggerSilence();

      expect(harness.liveTranscripts).toEqual([]);
      expect(harness.hud.events).toHaveLength(hudEventCountAfterStop);
      expect(sharedClock.activeTimerCount()).toBe(0);

      detectors.push(harness.vad);
      recognizers.push(recognizer);
    }

    expect(detectors).toHaveLength(10);
    expect(recognizers).toHaveLength(10);
    expect(detectors.every((detector) => detector.startCount === 1 && detector.stopCount === 1 && !detector.active)).toBe(true);
    expect(recognizers.every((recognizer) => recognizer.startBridgeCount === 1 && recognizer.startHybridCount === 0 && recognizer.stopCount === 1)).toBe(true);
  });
});

function createHarness(options: {
  week?: number;
  audioSource?: 'bridge' | 'browser';
  randomValue?: number;
  chunkResult?: ChunkResult;
  chunkResults?: ChunkResult[];
  pendingChunk?: Promise<ChunkResult>;
  speechEvaluationResult?: SpeechEvaluationResult | null;
  translationResult?: TranslationApiResponse | string | null;
  translationReject?: Error;
  simplifiedHint?: string | null;
  vadStartError?: Error;
  clock?: FakeClock;
  rejectChunkOnAbort?: boolean;
  transcriptOptions?: TranscriptStoreOptions;
  cloudProcessingEnabled?: boolean;
} = {}) {
  const clock = options.clock ?? new FakeClock();
  const states: string[] = [];
  const chunks: ChunkResult[] = [];
  const logs: SessionLog[] = [];
  const analyses: SessionAnalysis[] = [];
  const hintResults: Array<{
    hint: string;
    status: 'used' | 'missed' | 'simplified';
    outcome?: string;
    simplifiedTo?: string;
  }> = [];
  const liveTranscripts: { text: string; isFinal: boolean }[] = [];
  const conversationSnapshots: SessionTranscript[] = [];
  const hud = new FakeHud();
  let vad!: FakeAudioDetector;

  const audioDetectorFactory: AudioDetectorFactory = (config) => {
    vad = new FakeAudioDetector(config, options.audioSource ?? 'bridge', options.vadStartError ?? null);
    return vad;
  };

  const recognizers: FakeSpeechRecognizer[] = [];
  const recognizerOptions: HybridRecognizerOptions[] = [];
  const speechRecognizerFactory: SpeechRecognizerFactory = {
    create: (callbacks: HybridRecognizerCallbacks, options?: HybridRecognizerOptions) => {
      recognizerOptions.push(options ?? {});
      const recognizer = new FakeSpeechRecognizer(callbacks);
      recognizers.push(recognizer);
      return recognizer;
    },
    isWebSpeechSupported: () => true,
  };

  const cueProvider = createCueProvider(options);
  const translationProvider = createTranslationProvider(options);
  const callbacks: SessionCallbacks = {
    onStateChange: (state) => states.push(state),
    onChunkGenerated: (chunk) => {
      chunks.push(chunk);
    },
    onSpeechDetected: () => {},
    onSilenceStart: () => {},
    onSessionLog: (log) => logs.push(log),
    onLiveTranscript: (text, isFinal) => {
      liveTranscripts.push({ text, isFinal });
    },
    onSessionAnalysis: (analysis) => {
      analyses.push(analysis);
    },
    onHintUsageResult: (result) => {
      hintResults.push(result);
    },
    onConversationTimeline: (snapshot) => {
      conversationSnapshots.push(snapshot);
    },
  };

  const engine = new SessionEngine(
    options.week ?? 1,
    callbacks,
    options.audioSource ?? 'bridge',
    null,
    {
      clock,
      random: {
        next: () => options.randomValue ?? 0.9,
        uuid: () => 'test-scope',
      },
      audioDetectorFactory,
      speechRecognizerFactory,
      cueProvider,
      translationProvider,
      cloudProcessingEnabled: options.cloudProcessingEnabled ?? true,
      transcriptOptions: options.transcriptOptions ?? {
        saveRawTranscript: false,
        retentionPolicy: 'immediate',
        now: () => clock.now(),
      },
    },
  );

  return {
    engine,
    clock,
    cueProvider,
    translationProvider,
    get vad() {
      return vad;
    },
    hud,
    states,
    chunks,
    logs,
    analyses,
    hintResults,
    liveTranscripts,
    conversationSnapshots,
    recognizers,
    recognizerOptions,
  };
}

async function triggerAutoSilence(
  harness: ReturnType<typeof createHarness>,
  silenceMs = 5_200,
): Promise<void> {
  harness.clock.advance(silenceMs);
  await harness.vad.triggerSilence();
  harness.clock.advance(500);
  await Promise.resolve();
  await Promise.resolve();
}

function createCueProvider(options: {
  chunkResult?: ChunkResult;
  chunkResults?: ChunkResult[];
  pendingChunk?: Promise<ChunkResult>;
  speechEvaluationResult?: SpeechEvaluationResult | null;
  simplifiedHint?: string | null;
  rejectChunkOnAbort?: boolean;
}) {
  const provider = {
    generateCalls: 0,
    evaluateCalls: 0,
    simplifyCalls: 0,
    requests: [] as ChunkRequest[],
    evaluationRequests: [] as ChunkRequest[],
    signals: [] as AbortSignal[],
    async generateChunk(req: ChunkRequest, signal?: AbortSignal): Promise<ChunkResult> {
      this.generateCalls++;
      this.requests.push(req);
      if (signal) this.signals.push(signal);
      if (options.rejectChunkOnAbort) {
        return new Promise<ChunkResult>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error('aborted cue'));
            return;
          }
          signal?.addEventListener('abort', () => reject(new Error('aborted cue')), { once: true });
        });
      }
      if (options.pendingChunk) return options.pendingChunk;
      if (options.chunkResults) {
        return options.chunkResults[this.generateCalls - 1] ?? options.chunkResults[options.chunkResults.length - 1]!;
      }
      return options.chunkResult ?? {
        chunk: 'Injected cue',
        source: 'gemini',
        latencyMs: 10,
      };
    },
    async evaluateSpeech(_audio: Float32Array, req: ChunkRequest, signal?: AbortSignal) {
      this.evaluateCalls++;
      this.evaluationRequests.push(req);
      if (signal) this.signals.push(signal);
      return options.speechEvaluationResult ?? null;
    },
    async simplifyHint() {
      this.simplifyCalls++;
      return options.simplifiedHint ?? null;
    },
  };

  return provider as CueProvider & {
    generateCalls: number;
    evaluateCalls: number;
    simplifyCalls: number;
    requests: ChunkRequest[];
    evaluationRequests: ChunkRequest[];
    signals: AbortSignal[];
  };
}

function createTranslationProvider(options: {
  translationResult?: TranslationApiResponse | string | null;
  translationReject?: Error;
}) {
  const provider = {
    translateCalls: 0,
    requests: [] as TranslationApiRequest[],
    signals: [] as AbortSignal[],
    async translate(req: TranslationApiRequest, signal?: AbortSignal): Promise<TranslationApiResponse | string> {
      this.translateCalls++;
      this.requests.push(req);
      if (signal) this.signals.push(signal);
      if (options.translationReject) throw options.translationReject;
      return options.translationResult ?? '';
    },
  };

  const translate = provider.translate.bind(provider) as typeof provider.translate & {
    translateCalls: number;
    requests: TranslationApiRequest[];
    signals: AbortSignal[];
  };
  Object.defineProperties(translate, {
    translateCalls: { get: () => provider.translateCalls },
    requests: { get: () => provider.requests },
    signals: { get: () => provider.signals },
  });
  return translate;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
