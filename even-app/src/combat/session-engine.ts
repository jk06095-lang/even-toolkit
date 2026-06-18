/**
 * Session Engine — Phase 2 main orchestrator.
 *
 * State machine that coordinates VAD → Silence Detection → Chunk Generation → HUD Flash.
 * Manages Week-based progression and collects session analytics.
 */

import { VADManager } from './vad-manager';
import { generateChunk, evaluateSpeech, evaluateGrammar, simplifyHint, type ChunkResult } from './chunk-generator';
import type { ChunkCategory } from './fallback-chunks';
import type { HUDController } from '../hud/hud-controller';
import type { VadCalibration } from '../dsp/calibration';
import { HybridRecognizer } from './hybrid-recognizer';
import { TranscriptStore, type SessionTranscript } from './transcript-store';
import { TranscriptAnalyzer, type SessionAnalysis } from './transcript-analyzer';

// ── Types ──

export type SessionState =
  | 'idle'
  | 'calibrated'
  | 'loading_vad'
  | 'listening'
  | 'silence_detected'
  | 'chunk_generating'
  | 'hud_flash'
  | 'paused'
  | 'session_end';

export type AssistMode = 'manual' | 'auto';
type CueTrigger = 'manual' | 'auto' | 'speech-evaluation' | 'simplified';

export interface AssistMetrics {
  manual_request_count: number;
  auto_trigger_count: number;
  cue_dismissed_count: number;
  false_trigger_count: number;
  cue_used_count: number;
  auto_assist_paused: boolean;
}

export interface WeekConfig {
  week: number;
  silenceThresholdMs: number;
  hintFlashDurationMs: number;
  blackoutProbability: number; // Week 4: 0.0 - 1.0
  label: string;
}

export const WEEK_CONFIGS: Record<number, WeekConfig> = {
  1: { week: 1, silenceThresholdMs: 5000, hintFlashDurationMs: 2000, blackoutProbability: 0,    label: 'Cognitive Break' },
  2: { week: 2, silenceThresholdMs: 5000, hintFlashDurationMs: 1800, blackoutProbability: 0,    label: 'Chunk Expansion' },
  3: { week: 3, silenceThresholdMs: 2000, hintFlashDurationMs: 1500, blackoutProbability: 0,    label: 'Stress Inoculation' },
  4: { week: 4, silenceThresholdMs: 2000, hintFlashDurationMs: 1200, blackoutProbability: 0.4,  label: 'Blackout Protocol' },
};

export interface SessionLog {
  startTime: number;
  endTime: number;
  week: number;
  topic: string;
  totalHints: number;
  totalSpeechEvents: number;
  totalSilenceEvents: number;
  avgSilenceDurationMs: number;
  selfResponseRate: number; // % of times user spoke without hint
  hintHistory: { chunk: string; source: string; timestamp: number }[];
  silenceDurations: number[];
  assistMetrics: AssistMetrics;
  /** Full transcript saved to cache — available for export */
  transcript?: SessionTranscript;
}

export interface SessionCallbacks {
  onStateChange: (state: SessionState) => void;
  onChunkGenerated: (result: ChunkResult) => void;
  onSpeechDetected: () => void;
  onSilenceStart: () => void;
  onSessionLog: (log: SessionLog) => void;
  onTranscript?: (transcript: string) => void;
  onVolume?: (volume: number) => void;
  /** Real-time interim text from HybridRecognizer */
  onLiveTranscript?: (text: string, isFinal: boolean) => void;
  /** Notifies which audio source is active */
  onAudioSource?: (source: string) => void;
  /** Fired when hint usage is resolved (used, missed, or simplified) */
  onHintUsageResult?: (result: { hint: string; status: 'used' | 'missed' | 'simplified'; simplifiedTo?: string }) => void;
  /** Fired at session end with full analysis */
  onSessionAnalysis?: (analysis: SessionAnalysis) => void;
  /** Fired when assist mode metrics change */
  onAssistMetrics?: (metrics: AssistMetrics) => void;
}

// ── Engine ──

export class SessionEngine {
  private vad: VADManager | null = null;
  private weekConfig: WeekConfig;
  private callbacks: SessionCallbacks;
  private _state: SessionState = 'idle';
  private _topic = 'General English Practice';
  private _category: ChunkCategory = 'general';
  private _scenarioId = '';
  private _scenarioContext = '';

  // Analytics
  private sessionStartTime = 0;
  private hintCount = 0;
  private speechCount = 0;
  private silenceCount = 0;
  private silenceDurations: number[] = [];
  private hintHistory: { chunk: string; source: string; timestamp: number }[] = [];
  private usedHintChunks: string[] = []; // Track all hint texts to avoid repeats
  private lastSilenceStart = 0;
  private selfResponses = 0;
  private isGenerating = false;
  private hudRef: HUDController | null = null;
  private silenceCountdownInterval: ReturnType<typeof setInterval> | null = null;
  private lastVolume = 0;
  private speechRecognizer: HybridRecognizer | null = null;
  private lastLiveTranscript = '';
  private transcriptStore: TranscriptStore | null = null;
  private analyzer: TranscriptAnalyzer | null = null;
  private lastTranscriptActivityTime = 0;
  private showingCountdown = false;
  private preferredAudioSource: 'bridge' | 'browser' = 'bridge';
  private vadCalibration: VadCalibration | null = null;
  private lifecycleToken = 0;
  private activeRequestControllers = new Set<AbortController>();
  private pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private assistMode: AssistMode = 'manual';
  private assistMetrics: AssistMetrics = {
    manual_request_count: 0,
    auto_trigger_count: 0,
    cue_dismissed_count: 0,
    false_trigger_count: 0,
    cue_used_count: 0,
    auto_assist_paused: false,
  };
  private autoDismissStreak = 0;
  private readonly maxAutoTriggersPerSession = 3;
  private activeCueTrigger: CueTrigger | null = null;
  private cueVisible = false;

  constructor(
    week: number,
    callbacks: SessionCallbacks,
    preferredAudioSource: 'bridge' | 'browser' = 'bridge',
    vadCalibration?: VadCalibration | null,
  ) {
    this.weekConfig = WEEK_CONFIGS[week] ?? WEEK_CONFIGS[1]!;
    this.callbacks = callbacks;
    this.preferredAudioSource = preferredAudioSource;
    this.vadCalibration = vadCalibration ?? null;
  }

  /** Whether VAD is running in simulation (keyboard) mode */
  get state(): SessionState { return this._state; }
  get topic(): string { return this._topic; }
  get week(): number { return this.weekConfig.week; }
  get currentAssistMode(): AssistMode { return this.assistMode; }
  get currentAssistMetrics(): AssistMetrics { return { ...this.assistMetrics }; }
  get stats() {
    return {
      hints: this.hintCount,
      speeches: this.speechCount,
      silences: this.silenceCount,
      selfResponseRate: this.speechCount > 0
        ? Math.round((this.selfResponses / this.speechCount) * 100)
        : 0,
    };
  }

  private setState(state: SessionState): void {
    this._state = state;
    this.callbacks.onStateChange(state);
  }

  setAssistMode(mode: AssistMode): void {
    this.assistMode = mode;
    if (mode === 'manual') {
      this.assistMetrics.auto_assist_paused = false;
      this.autoDismissStreak = 0;
    }
    this.emitAssistMetrics();
  }

  setVadCalibration(vadCalibration: VadCalibration | null): void {
    this.vadCalibration = vadCalibration;
  }

  private emitAssistMetrics(): void {
    this.callbacks.onAssistMetrics?.({ ...this.assistMetrics });
  }

  private resetAssistMetrics(): void {
    this.assistMetrics = {
      manual_request_count: 0,
      auto_trigger_count: 0,
      cue_dismissed_count: 0,
      false_trigger_count: 0,
      cue_used_count: 0,
      auto_assist_paused: false,
    };
    this.autoDismissStreak = 0;
    this.activeCueTrigger = null;
    this.cueVisible = false;
    this.emitAssistMetrics();
  }

  private markCueVisible(trigger: CueTrigger): void {
    this.activeCueTrigger = trigger;
    this.cueVisible = true;
  }

  private clearDisplayedCue(): void {
    this.cueVisible = false;
    this.activeCueTrigger = null;
  }

  private beginRequest(): { token: number; controller: AbortController } {
    const controller = new AbortController();
    this.activeRequestControllers.add(controller);
    return { token: this.lifecycleToken, controller };
  }

  private finishRequest(controller: AbortController): void {
    this.activeRequestControllers.delete(controller);
  }

  private isCurrentRequest(token: number): boolean {
    return token === this.lifecycleToken && this._state !== 'session_end';
  }

  private abortActiveRequests(): void {
    for (const controller of this.activeRequestControllers) {
      controller.abort();
    }
    this.activeRequestControllers.clear();
  }

  private scheduleTimeout(callback: () => void, delayMs: number): void {
    const timeout = setTimeout(() => {
      this.pendingTimeouts.delete(timeout);
      callback();
    }, delayMs);
    this.pendingTimeouts.add(timeout);
  }

  private clearPendingTimeouts(): void {
    for (const timeout of this.pendingTimeouts) {
      clearTimeout(timeout);
    }
    this.pendingTimeouts.clear();
  }

  /**
   * Configure the session topic and category before starting.
   */
  setTopic(topic: string, category: ChunkCategory = 'general', scenarioId = '', scenarioContext = ''): void {
    this._topic = topic;
    this._category = category;
    this._scenarioId = scenarioId;
    this._scenarioContext = scenarioContext;
  }

  /**
   * Change the current week (adjusts thresholds live).
   */
  setWeek(week: number): void {
    this.weekConfig = WEEK_CONFIGS[week] ?? WEEK_CONFIGS[1]!;
    this.vad?.updateThreshold(this.weekConfig.silenceThresholdMs);
  }

  /**
   * Start the combat session — initializes VAD and begins listening.
   */
  async start(hud?: any): Promise<void> {
    if (this._state !== 'idle' && this._state !== 'calibrated') return;

    this.lifecycleToken++;
    this.abortActiveRequests();
    this.clearPendingTimeouts();
    this.sessionStartTime = Date.now();
    this.hintCount = 0;
    this.speechCount = 0;
    this.silenceCount = 0;
    this.silenceDurations = [];
    this.hintHistory = [];
    this.usedHintChunks = [];
    this.selfResponses = 0;
    this.lastLiveTranscript = '';
    this.resetAssistMetrics();

    // Initialize transcript cache
    this.transcriptStore = new TranscriptStore(
      this.weekConfig.week,
      this._topic,
      this._scenarioId || this._category,
    );

    // Initialize transcript analyzer for hint tracking
    this.analyzer = new TranscriptAnalyzer(this.weekConfig.week);

    this.vad = new VADManager({
      silenceThresholdMs: this.weekConfig.silenceThresholdMs,
      hud,
      preferredSource: this.preferredAudioSource,
      calibration: this.vadCalibration,

      onSilenceThreshold: () => {
        this.handleSilenceThreshold();
      },

      onSpeechDetected: () => {
        this.handleSpeechDetected();
      },

      onVolumeChange: (volume: number) => {
        this.lastVolume = volume;
        if (this.callbacks.onVolume) {
          this.callbacks.onVolume(volume);
        }
        // Real-time volume visualization on HUD
        if (this.hudRef && this._state === 'listening') {
          this.hudRef.showSpeechActive(volume);
        }
      },

      onSpeechEnd: async (audio: Float32Array) => {
        // Evaluate the speech for poor grammar/nonsense while silence timer ticks
        if (this.isGenerating || this._state !== 'listening') return;

        this.isGenerating = true;
        const request = this.beginRequest();
        try {
          const result = await evaluateSpeech(audio, {
            topic: this._topic,
            week: this.weekConfig.week,
            category: this._category,
            lastUtterance: this.lastLiveTranscript || undefined,
            usedHints: this.usedHintChunks,
            scenarioContext: this._scenarioContext || undefined,
          }, request.controller.signal);

          if (!this.isCurrentRequest(request.token)) return;

          if (result) {
            // Forward the transcript to the UI
            if (this.callbacks.onTranscript) {
              this.callbacks.onTranscript(result.transcript);
            }

            // Record to cache
            this.transcriptStore?.addSpeech(result.transcript, 'gemini_eval');

            // If the audio source is 'bridge', reuse this transcript as the final recognized speech if not already finalized
            if (this.vad?.audioSource === 'bridge') {
              const alreadyFinalized = this.lastLiveTranscript && !this.lastLiveTranscript.startsWith('🎤');
              if (!alreadyFinalized) {
                this.lastLiveTranscript = result.transcript;
                this.callbacks.onLiveTranscript?.(result.transcript, true);
                const trimmed = result.transcript.trim();
                if (trimmed) {
                  this.transcriptStore?.addSpeech(trimmed, 'live_final');
                  this.resetTranscriptActivity();
                  if (this.hudRef) {
                    this.hudRef.showLiveTranscript(`✓ ${trimmed}`);
                    
                    // Trigger grammar evaluation asynchronously
                    (async () => {
                      await this.showGrammarFeedbackIfCurrent(trimmed);
                    })();
                  }
                }
              } else {
                console.log('[Session] Bridge transcript already finalized by fast speech recognizer.');
              }
            }

            // If Gemini returned a hint chunk (meaning speech was bad) and we are still listening
            if (result.chunk) {
              this.hintCount++;
              this.usedHintChunks.push(result.chunk);
              this.markCueVisible('speech-evaluation');
              this.hintHistory.push({
                chunk: result.chunk,
                source: result.source,
                timestamp: Date.now(),
              });

              // Record hint to cache
              this.transcriptStore?.addHint(result.chunk, result.source === 'gemini' ? 'gemini_eval' : 'fallback');

              // Check if session was stopped during evaluation
              if ((this._state as any) === 'session_end') return;

              this.setState('hud_flash');
              this.callbacks.onChunkGenerated({
                chunk: result.chunk,
                source: result.source,
                latencyMs: result.latencyMs,
              });

              // Auto-clear after flash duration, then restart silence cycle
              this.scheduleTimeout(() => {
                if (this._state === 'hud_flash') {
                  this.cueVisible = false;
                  this.setState('listening');
                  this.resetTranscriptActivity();
                  // Restore gauge on glasses
                  this.hudRef?.showListening();
                }
              }, this.weekConfig.hintFlashDurationMs);
            }
          } else {
            // Gemini evaluation returned null — still record that speech was detected
            this.transcriptStore?.addSpeech('[speech detected]', 'speech_api');
          }
        } finally {
          this.finishRequest(request.controller);
          this.isGenerating = false;
        }
      },

      // Forward raw PCM frames to HybridRecognizer (Bridge/Hybrid mode)
      onPCMFrame: (frame: Float32Array) => {
        if (this.speechRecognizer && this.speechRecognizer.mode !== 'browser') {
          this.speechRecognizer.feedPCM(frame);
        }
      },

      // Notify HybridRecognizer of speech segment boundaries (Bridge/Hybrid mode)
      onBridgeSpeechStart: () => {
        if (this.speechRecognizer && this.speechRecognizer.mode !== 'browser') {
          this.speechRecognizer.notifySpeechStart();
        }
      },
      onBridgeSpeechEnd: () => {
        if (this.speechRecognizer && this.speechRecognizer.mode !== 'browser') {
          this.speechRecognizer.notifySpeechEnd();
        }
      },

      onStateChange: (vadState) => {
        if (vadState === 'error') {
          console.error('[Session] VAD error — check microphone permissions');
        }
        if (vadState === 'listening') {
          console.log('[Session] VAD is now listening');
        }
      },
    });

    this.setState('loading_vad');
    this.hudRef = hud || null;
    await this.vad.start();

    // Report audio source to UI
    if (this.callbacks.onAudioSource) {
      this.callbacks.onAudioSource(this.vad.audioSource);
    }

    // Initialize the two-zone combat layout on glasses
    if (this.hudRef) {
      await this.hudRef.initCombatDisplay();
    }

    this.setState('listening');
    this.resetTranscriptActivity();
    this.startSilenceCountdown();

    // Start real-time speech recognition (Web Speech API) if available
    this.startSpeechRecognizer();
  }

  /**
   * Start hybrid speech recognizer for real-time text.
   * - Bridge mode: Uses Hybrid (Web Speech API + PCM buffer)
   * - Browser mode: Uses Web Speech API on phone/computer mic
   * Includes retry logic (max 3 attempts, 2s apart).
   */
  private startSpeechRecognizer(retryCount = 0): void {
    const isBridge = this.vad?.audioSource === 'bridge';

    this.speechRecognizer = new HybridRecognizer({
      onInterimResult: (text) => {
        this.lastLiveTranscript = text;
        this.callbacks.onLiveTranscript?.(text, false);
        
        // Reset silence timer on interim transcript activity
        if (text && text.trim().length > 0) {
          this.resetTranscriptActivity();
        }

        // Show live text on glasses bottom zone + volume bars on top
        if (this.hudRef) {
          this.hudRef.showLiveTranscript(text);
          this.hudRef.showSpeechActive(this.lastVolume);
        }
      },
      onFinalResult: (text) => {
        this.lastLiveTranscript = text;
        this.callbacks.onLiveTranscript?.(text, true);
        const trimmed = text.trim();
        if (!trimmed) return;

        // Reset silence timer on final transcript
        this.resetTranscriptActivity();

        // Record finalized speech recognition to cache and analyzer
        this.transcriptStore?.addSpeech(trimmed, 'live_final');
        this.analyzer?.addUtterance(trimmed, true);

        // Update glasses bottom zone with confirmed text
        if (this.hudRef) {
          this.hudRef.showLiveTranscript(`✓ ${trimmed}`);
        }

        // Check if user used the active hint
        if (this.analyzer?.getActiveHint()) {
          const checkResult = this.analyzer.checkHintUsage(trimmed);
          const activeHint = this.analyzer.getActiveHint()!;

          if (checkResult.used) {
            // User successfully used the recommended expression!
            this.analyzer.resolveActiveHint('used', trimmed);
            this.transcriptStore?.addHintUsed(activeHint.text, trimmed);
            this.callbacks.onHintUsageResult?.({
              hint: activeHint.text,
              status: 'used',
            });
            this.assistMetrics.cue_used_count++;
            this.autoDismissStreak = 0;
            this.emitAssistMetrics();
            if (this.hudRef) {
              this.hudRef.showGoodJob();
            }
            console.log(`[Session] ✓ Hint used: "${activeHint.text}" in "${trimmed}"`);
          }
          // If not used, we don't mark as missed yet — wait for silence threshold
        }

        // Trigger grammar evaluation asynchronously
        (async () => {
          await this.showGrammarFeedbackIfCurrent(trimmed);
        })();
      },
      onSpeechStart: () => {
        // Additional speech detection feedback
      },
      onSpeechEnd: () => {
        // Silence after speech
      },
      onError: (err) => {
        console.warn('[Session] Speech recognizer error:', err);
        // Retry logic for transient errors
        if (retryCount < 3 && err !== 'SECURE_ORIGIN_REQUIRED') {
          console.log(`[Session] Will retry speech recognizer in 2s (attempt ${retryCount + 1}/3)`);
          setTimeout(() => {
            if (this._state === 'listening' || this._state === 'silence_detected') {
              this.startSpeechRecognizer(retryCount + 1);
            }
          }, 2000);
        }
      },
    });

    if (isBridge) {
      // Hybrid mode: Web Speech API for fast text + PCM buffer for evaluateSpeech
      const started = this.speechRecognizer.startHybrid();
      if (started) {
        console.log(`[Session] ✓ Hybrid speech recognition active (mode: ${this.speechRecognizer.mode})`);
      }
    } else {
      // Browser mode: Web Speech API only
      if (!HybridRecognizer.isWebSpeechSupported()) {
        console.log('[Session] Web Speech API not available — real-time transcript disabled');
        return;
      }
      const started = this.speechRecognizer.start();
      if (started) {
        console.log('[Session] ✓ Browser speech recognition active (Web Speech API)');
      }
    }
  }

  private resetTranscriptActivity(): void {
    this.lastTranscriptActivityTime = Date.now();
    this.vad?.simulateSilenceRestart();
  }

  private async showGrammarFeedbackIfCurrent(transcript: string): Promise<void> {
    if (this._state !== 'listening') return;

    const request = this.beginRequest();
    try {
      const correction = await evaluateGrammar(transcript, this._topic, request.controller.signal);
      if (
        correction &&
        this.isCurrentRequest(request.token) &&
        this.hudRef &&
        this._state === 'listening'
      ) {
        this.hudRef.showGrammarFeedback(correction);
      }
    } catch (err) {
      if (!request.controller.signal.aborted) {
        console.warn('[Session] Grammar evaluation failed:', err);
      }
    } finally {
      this.finishRequest(request.controller);
    }
  }

  /**
   * Start silence countdown interval that updates HUD every second.
   */
  private startSilenceCountdown(): void {
    this.stopSilenceCountdown();
    this.showingCountdown = false;
    this.silenceCountdownInterval = setInterval(() => {
      if (this._state !== 'listening' || !this.vad || !this.hudRef) return;
      const silenceMs = Date.now() - this.lastTranscriptActivityTime;
      const thresholdMs = this.weekConfig.silenceThresholdMs;
      const secondsLeft = Math.max(0, Math.ceil((thresholdMs - silenceMs) / 1000));
      const thresholdSeconds = Math.ceil(thresholdMs / 1000);
      // Only show countdown when > 30% into silence
      if (silenceMs > thresholdMs * 0.3) {
        this.hudRef.showSilenceCountdown(secondsLeft, thresholdSeconds);
        this.showingCountdown = true;
      } else if (this.showingCountdown) {
        this.hudRef.showListening();
        this.showingCountdown = false;
      }
    }, 1000);
  }

  private stopSilenceCountdown(): void {
    if (this.silenceCountdownInterval) {
      clearInterval(this.silenceCountdownInterval);
      this.silenceCountdownInterval = null;
    }
  }

  /**
   * End the session and produce a log.
   */
  async stop(): Promise<void> {
    this.lifecycleToken++;
    this.abortActiveRequests();
    this.clearPendingTimeouts();
    this.stopSilenceCountdown();

    // Stop speech recognizer
    if (this.speechRecognizer) {
      this.speechRecognizer.stop();
      this.speechRecognizer = null;
    }

    if (this.vad) {
      await this.vad.stop();
      this.vad = null;
    }

    const endTime = Date.now();
    const avgSilence = this.silenceDurations.length > 0
      ? this.silenceDurations.reduce((a, b) => a + b, 0) / this.silenceDurations.length
      : 0;

    // Resolve any pending active hint as missed
    if (this.analyzer?.getActiveHint()) {
      const activeHint = this.analyzer.getActiveHint()!;
      this.analyzer.resolveActiveHint('missed');
      this.transcriptStore?.addHintMissed(activeHint.text);
    }

    // Get session analysis from TranscriptAnalyzer
    const sessionAnalysis = this.analyzer?.getSessionAnalysis() ?? null;

    // Store hint usage stats in transcript store
    if (sessionAnalysis && this.transcriptStore) {
      this.transcriptStore.setHintUsageStats({
        total: sessionAnalysis.totalHints,
        used: sessionAnalysis.hintsUsed,
        missed: sessionAnalysis.hintsMissed,
        simplified: sessionAnalysis.hintsSimplified,
        successRate: sessionAnalysis.successRate,
        difficultyProgression: sessionAnalysis.difficultyProgression,
        recommendedNextDifficulty: sessionAnalysis.recommendedNextDifficulty,
      });
    }

    // Finalize transcript cache
    const transcript = this.transcriptStore?.finalize();
    this.transcriptStore = null;

    const log: SessionLog = {
      startTime: this.sessionStartTime,
      endTime,
      week: this.weekConfig.week,
      topic: this._topic,
      totalHints: this.hintCount,
      totalSpeechEvents: this.speechCount,
      totalSilenceEvents: this.silenceCount,
      avgSilenceDurationMs: Math.round(avgSilence),
      selfResponseRate: this.speechCount > 0
        ? Math.round((this.selfResponses / this.speechCount) * 100)
        : 0,
      hintHistory: this.hintHistory,
      silenceDurations: this.silenceDurations,
      assistMetrics: { ...this.assistMetrics },
      transcript,
    };

    this.callbacks.onSessionLog(log);

    // Fire session analysis callback
    if (sessionAnalysis) {
      this.callbacks.onSessionAnalysis?.(sessionAnalysis);
    }

    this.analyzer = null;
    this.setState('session_end');
  }

  /**
   * Pause the session temporarily.
   */
  async pause(): Promise<void> {
    if (this._state !== 'listening' && this._state !== 'silence_detected' && this._state !== 'hud_flash') return;
    
    this.lifecycleToken++;
    this.abortActiveRequests();
    this.clearPendingTimeouts();
    this.stopSilenceCountdown();
    
    if (this.speechRecognizer) {
      this.speechRecognizer.stop();
    }
    
    if (this.vad) {
      await this.vad.pause();
    }
    
    this.setState('paused');
    if (this.hudRef) {
      this.hudRef.showPaused();
    }
  }

  /**
   * Resume a paused session.
   */
  async resume(): Promise<void> {
    if (this._state !== 'paused') return;
    this.lifecycleToken++;
    
    if (this.vad) {
      await this.vad.resume();
    }
    
    if (this.speechRecognizer) {
      if (this.vad?.audioSource === 'bridge') {
        this.speechRecognizer.startHybrid();
      } else {
        this.speechRecognizer.start();
      }
    }
    
    this.setState('listening');
    this.startSilenceCountdown();
    if (this.hudRef) {
      this.hudRef.showListening();
    }
  }

  async requestManualCue(): Promise<void> {
    if (this._state === 'paused' || this._state === 'session_end' || this._state === 'loading_vad') return;
    if (this.isGenerating) return;

    this.assistMetrics.manual_request_count++;
    this.emitAssistMetrics();
    await this.generateContextualHint('manual');
  }

  dismissActiveCue(): boolean {
    if (!this.cueVisible) {
      return false;
    }

    const dismissedAutoCue = this.activeCueTrigger === 'auto';
    this.assistMetrics.cue_dismissed_count++;

    if (dismissedAutoCue) {
      this.assistMetrics.false_trigger_count++;
      this.autoDismissStreak++;
      if (this.autoDismissStreak >= 2) {
        this.assistMetrics.auto_assist_paused = true;
      }
    }

    this.analyzer?.clearActiveHint();
    this.clearDisplayedCue();
    this.clearPendingTimeouts();
    this.setState('listening');
    this.resetTranscriptActivity();
    this.hudRef?.showListening();
    this.emitAssistMetrics();
    return true;
  }

  // ── Internal Handlers ──

  private async handleSilenceThreshold(): Promise<void> {
    if (this.isGenerating) return;
    if (this._state !== 'listening') return;

    // Double check silence duration based on last transcript activity
    const silenceDur = Date.now() - this.lastTranscriptActivityTime;
    if (silenceDur < this.weekConfig.silenceThresholdMs - 200) {
      console.log(`[Session] Ignored VAD silence threshold. Actual silence since transcript: ${silenceDur}ms`);
      return;
    }

    this.silenceCount++;
    this.silenceDurations.push(silenceDur);

    // Record silence event to cache
    this.transcriptStore?.addSilence(silenceDur);

    if (this.assistMode === 'manual') {
      if (this.analyzer?.getActiveHint()) {
        const activeHint = this.analyzer.getActiveHint()!;
        this.analyzer.resolveActiveHint('missed');
        this.transcriptStore?.addHintMissed(activeHint.text);
        this.clearDisplayedCue();
        this.callbacks.onHintUsageResult?.({
          hint: activeHint.text,
          status: 'missed',
        });
      }

      this.setState('silence_detected');
      this.callbacks.onSilenceStart();
      this.scheduleTimeout(() => {
        if (this._state === 'silence_detected') {
          this.setState('listening');
        }
      }, 1000);
      return;
    }

    if (this.assistMetrics.auto_assist_paused || this.assistMetrics.auto_trigger_count >= this.maxAutoTriggersPerSession) {
      this.setState('silence_detected');
      this.callbacks.onSilenceStart();
      this.scheduleTimeout(() => {
        if (this._state === 'silence_detected') {
          this.setState('listening');
        }
      }, 1000);
      return;
    }

    // Check if user missed the active hint (silence = they didn't use it)
    if (this.analyzer?.getActiveHint()) {
      const activeHint = this.analyzer.getActiveHint()!;
      this.analyzer.resolveActiveHint('missed');
      this.transcriptStore?.addHintMissed(activeHint.text);

      // Try to simplify the missed hint
      this.isGenerating = true;
      this.setState('chunk_generating');
      this.assistMetrics.auto_trigger_count++;
      this.emitAssistMetrics();

      try {
          const request = this.beginRequest();
          let simplified: string | null = null;
          try {
            simplified = await simplifyHint(activeHint.text, this._topic, request.controller.signal);
          } finally {
            this.finishRequest(request.controller);
          }
          if (!this.isCurrentRequest(request.token)) return;

          if (simplified && simplified !== activeHint.text) {
          // Show simplified hint
          this.transcriptStore?.addHintSimplified(activeHint.text, simplified);
          this.analyzer?.setActiveHint(simplified, Math.max(1, activeHint.difficulty - 1));

          this.hintCount++;
          this.usedHintChunks.push(simplified);
          this.markCueVisible('simplified');
          this.hintHistory.push({ chunk: simplified, source: 'gemini', timestamp: Date.now() });
          this.transcriptStore?.addHint(simplified, 'gemini_eval');

          this.callbacks.onHintUsageResult?.({
            hint: activeHint.text,
            status: 'simplified',
            simplifiedTo: simplified,
          });

          this.setState('hud_flash');
          this.callbacks.onChunkGenerated({ chunk: simplified, source: 'gemini', latencyMs: 0 });

          this.scheduleTimeout(() => {
            if (this._state === 'hud_flash') {
              this.cueVisible = false;
              this.setState('listening');
              this.resetTranscriptActivity();
              this.hudRef?.showListening();
            }
          }, this.weekConfig.hintFlashDurationMs);
        } else {
          // Simplification failed — generate a new contextual hint
          await this.generateContextualHint('auto');
        }
      } catch {
        this.setState('listening');
        this.resetTranscriptActivity();
      } finally {
        this.isGenerating = false;
      }
      return;
    }

    this.setState('silence_detected');
    this.callbacks.onSilenceStart();
    this.assistMetrics.auto_trigger_count++;
    this.emitAssistMetrics();

    // Week 4 blackout check
    if (Math.random() < this.weekConfig.blackoutProbability) {
      this.scheduleTimeout(() => {
        if (this._state === 'silence_detected') {
          this.setState('listening');
        }
      }, 1000);
      return;
    }

    // Generate a contextual hint using TranscriptAnalyzer data
    await this.generateContextualHint('auto');
  }

  /**
   * Generate a hint using conversation context and adaptive difficulty.
   */
  private async generateContextualHint(trigger: CueTrigger): Promise<void> {
    this.isGenerating = true;
    this.setState('chunk_generating');
    const request = this.beginRequest();

    try {
      const adaptiveDifficulty = this.analyzer?.getAdaptiveDifficulty() ?? this.weekConfig.week;
      const conversationContext = this.analyzer?.getConversationContext() ?? undefined;

      const result = await generateChunk({
        topic: this._topic,
        week: this.weekConfig.week,
        category: this._category,
        lastUtterance: this.lastLiveTranscript || undefined,
        usedHints: this.usedHintChunks,
        scenarioContext: this._scenarioContext || undefined,
        conversationContext,
        adaptiveDifficulty,
      }, request.controller.signal);

      if (!this.isCurrentRequest(request.token)) return;

      if (result.chunk) {
        this.hintCount++;
        this.usedHintChunks.push(result.chunk);
        this.markCueVisible(trigger);
        this.hintHistory.push({
          chunk: result.chunk,
          source: result.source,
          timestamp: Date.now(),
        });

        // Register with TranscriptAnalyzer for tracking
        this.analyzer?.setActiveHint(result.chunk, adaptiveDifficulty);

        this.transcriptStore?.addHint(result.chunk, result.source === 'gemini' ? 'gemini_eval' : 'fallback');

        this.setState('hud_flash');
        this.callbacks.onChunkGenerated(result);

        this.scheduleTimeout(() => {
          if (this._state === 'hud_flash') {
            this.cueVisible = false;
            this.setState('listening');
            this.resetTranscriptActivity();
            this.hudRef?.showListening();
          }
        }, this.weekConfig.hintFlashDurationMs);
      } else {
        this.setState('listening');
      }
    } catch {
      this.setState('listening');
      this.resetTranscriptActivity();
    } finally {
      this.finishRequest(request.controller);
      this.isGenerating = false;
    }
  }

  private handleSpeechDetected(): void {
    // Ignore speech if paused or ended
    if (this._state === 'paused' || (this._state as any) === 'session_end') return;

    this.speechCount++;
    this.callbacks.onSpeechDetected();

    // Show listening state on HUD when user starts speaking
    if (this.hudRef) {
      this.hudRef.showListening();
    }
    this.cueVisible = false;

    // If user spoke while in silence/hint state, count as self-response
    if (this._state === 'silence_detected' || this._state === 'listening') {
      this.selfResponses++;
    }

    if (this._state !== 'listening') {
      this.setState('listening');
    }
  }
}
