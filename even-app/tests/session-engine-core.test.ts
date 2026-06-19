import { describe, expect, it } from 'vitest';
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
import type { ChunkRequest, ChunkResult } from '../src/combat/chunk-generator';
import type { HybridRecognizerCallbacks, HybridRecognizerOptions, HybridMode } from '../src/combat/hybrid-recognizer';
import type { SessionAnalysis } from '../src/combat/transcript-analyzer';
import type { SessionTranscript, TranscriptStoreOptions } from '../src/combat/transcript-store';
import {
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

    harness.clock.advance(2_200);
    await harness.vad.triggerSilence();

    expect(harness.cueProvider.generateCalls).toBe(0);
    expect(harness.chunks).toEqual([]);
    expect(harness.states).toContain('silence_detected');
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
      harness.clock.advance(5_200);
      await harness.vad.triggerSilence();
      await Promise.resolve();
      expect(harness.engine.dismissActiveCue()).toBe(true);
    }

    expect(harness.engine.currentAssistMetrics).toMatchObject({
      auto_trigger_count: 2,
      cue_dismissed_count: 2,
      false_trigger_count: 2,
      auto_assist_paused: true,
    });

    harness.clock.advance(5_200);
    await harness.vad.triggerSilence();

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
      harness.clock.advance(5_200);
      await harness.vad.triggerSilence();
      await Promise.resolve();
      harness.clock.advance(2_100);
    }

    harness.clock.advance(5_200);
    await harness.vad.triggerSilence();
    await Promise.resolve();

    expect(harness.engine.currentAssistMetrics.auto_trigger_count).toBe(3);
    expect(harness.cueProvider.generateCalls).toBe(3);
    expect(harness.chunks.map((chunk) => chunk.chunk)).toEqual([
      'Auto cue one',
      'Auto cue two',
      'Auto cue three',
    ]);
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
      request_id: 'echo-1000-test-scope:cue:1',
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
      cueId: 'echo-1000-test-scope:cue:1:cue',
      targetTurnId: 'turn-manual-cue-1',
      phrase: 'Could you say that again?',
    });
    expect(transcript?.assistEpisodes?.[0]).toMatchObject({
      id: 'echo-1000-test-scope:cue:1:cue:episode',
      targetTurnId: 'turn-manual-cue-1',
      trigger: 'manual',
      cueId: 'echo-1000-test-scope:cue:1:cue',
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

  it('emits live phone conversation timeline snapshots without writing transcript history to the HUD', async () => {
    const harness = createHarness({ audioSource: 'browser' });
    await harness.engine.start(harness.hud);

    harness.recognizers[0]!.emitFinalResult('Could you clarify the customer segment?', 0.87);

    const latest = harness.conversationSnapshots.at(-1);
    expect(latest?.conversationTurns?.at(-1)).toMatchObject({
      speaker: 'learner',
      source: 'phone',
      transcript: 'Could you clarify the customer segment?',
      confidence: 0.87,
      isFinal: true,
    });
    expect(harness.hud.events.some((event) => event.includes('conversation'))).toBe(false);
  });

  it('emits live G2 conversation timeline snapshots with the bridge source boundary', async () => {
    const harness = createHarness({ audioSource: 'bridge' });
    await harness.engine.start(harness.hud);

    harness.recognizers[0]!.emitFinalResult('I can start with the onboarding risk.', 0.81);

    const latest = harness.conversationSnapshots.at(-1);
    expect(latest?.conversationTurns?.at(-1)).toMatchObject({
      speaker: 'learner',
      source: 'g2',
      transcript: 'I can start with the onboarding risk.',
      confidence: 0.81,
      isFinal: true,
    });
    expect(harness.hud.events.some((event) => event.includes('conversation'))).toBe(false);
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
  simplifiedHint?: string | null;
  vadStartError?: Error;
  clock?: FakeClock;
  rejectChunkOnAbort?: boolean;
  transcriptOptions?: TranscriptStoreOptions;
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

function createCueProvider(options: {
  chunkResult?: ChunkResult;
  chunkResults?: ChunkResult[];
  pendingChunk?: Promise<ChunkResult>;
  simplifiedHint?: string | null;
  rejectChunkOnAbort?: boolean;
}) {
  const provider = {
    generateCalls: 0,
    simplifyCalls: 0,
    requests: [] as ChunkRequest[],
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
    async evaluateSpeech() {
      return null;
    },
    async simplifyHint() {
      this.simplifyCalls++;
      return options.simplifiedHint ?? null;
    },
  };

  return provider as CueProvider & {
    generateCalls: number;
    simplifyCalls: number;
    requests: ChunkRequest[];
    signals: AbortSignal[];
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
