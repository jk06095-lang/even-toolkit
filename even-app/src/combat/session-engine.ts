/**
 * Session Engine — Phase 2 main orchestrator.
 *
 * State machine that coordinates VAD → Silence Detection → Chunk Generation → HUD Flash.
 * Manages Week-based progression and collects session analytics.
 */

import { VADManager } from './vad-manager';
import { generateChunk, evaluateSpeech, type ChunkResult } from './chunk-generator';
import type { ChunkCategory } from './fallback-chunks';
import type { HUDController } from '../hud/hud-controller';
import { SpeechRecognizer } from './speech-recognizer';
import { TranscriptStore, type SessionTranscript } from './transcript-store';

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
  /** Real-time interim text from SpeechRecognizer (Web Speech API) */
  onLiveTranscript?: (text: string, isFinal: boolean) => void;
  /** Notifies which audio source is active */
  onAudioSource?: (source: string) => void;
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
  private speechRecognizer: SpeechRecognizer | null = null;
  private lastLiveTranscript = '';
  private transcriptStore: TranscriptStore | null = null;

  constructor(week: number, callbacks: SessionCallbacks) {
    this.weekConfig = WEEK_CONFIGS[week] ?? WEEK_CONFIGS[1]!;
    this.callbacks = callbacks;
  }

  /** Whether VAD is running in simulation (keyboard) mode */
  get state(): SessionState { return this._state; }
  get topic(): string { return this._topic; }
  get week(): number { return this.weekConfig.week; }
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

    this.sessionStartTime = Date.now();
    this.hintCount = 0;
    this.speechCount = 0;
    this.silenceCount = 0;
    this.silenceDurations = [];
    this.hintHistory = [];
    this.usedHintChunks = [];
    this.selfResponses = 0;
    this.lastLiveTranscript = '';

    // Initialize transcript cache
    this.transcriptStore = new TranscriptStore(
      this.weekConfig.week,
      this._topic,
      this._scenarioId || this._category,
    );

    this.vad = new VADManager({
      silenceThresholdMs: this.weekConfig.silenceThresholdMs,
      hud,

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
        try {
          const result = await evaluateSpeech(audio, {
            topic: this._topic,
            week: this.weekConfig.week,
            category: this._category,
            lastUtterance: this.lastLiveTranscript || undefined,
            usedHints: this.usedHintChunks,
            scenarioContext: this._scenarioContext || undefined,
          });

          if (result) {
            // Forward the transcript to the UI
            if (this.callbacks.onTranscript) {
              this.callbacks.onTranscript(result.transcript);
            }

            // Record to cache
            this.transcriptStore?.addSpeech(result.transcript, 'gemini_eval');

            // If Gemini returned a hint chunk (meaning speech was bad) and we are still listening
            if (result.chunk) {
              this.hintCount++;
              this.usedHintChunks.push(result.chunk);
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
              setTimeout(() => {
                if (this._state === 'hud_flash') {
                  this.setState('listening');
                  this.vad?.simulateSilenceRestart();
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
          this.isGenerating = false;
        }
      },

      // Forward raw PCM frames to SpeechRecognizer (Bridge mode only)
      onPCMFrame: (frame: Float32Array) => {
        if (this.speechRecognizer?.mode === 'bridge') {
          this.speechRecognizer.feedPCM(frame);
        }
      },

      // Notify SpeechRecognizer of speech segment boundaries (Bridge mode)
      onBridgeSpeechStart: () => {
        if (this.speechRecognizer?.mode === 'bridge') {
          this.speechRecognizer.notifySpeechStart();
        }
      },
      onBridgeSpeechEnd: () => {
        if (this.speechRecognizer?.mode === 'bridge') {
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
    this.startSilenceCountdown();

    // Start real-time speech recognition (Web Speech API) if available
    this.startSpeechRecognizer();
  }

  /**
   * Start speech recognizer for real-time text.
   * - Bridge mode: Uses PCM from G2 glasses → Gemini transcription
   * - Browser mode: Uses Web Speech API on phone/computer mic
   * Includes retry logic (max 3 attempts, 2s apart).
   */
  private startSpeechRecognizer(retryCount = 0): void {
    const isBridge = this.vad?.audioSource === 'bridge';

    this.speechRecognizer = new SpeechRecognizer({
      onInterimResult: (text) => {
        this.lastLiveTranscript = text;
        this.callbacks.onLiveTranscript?.(text, false);
        // Show live text on glasses bottom zone + volume bars on top
        if (this.hudRef) {
          this.hudRef.showLiveTranscript(text);
          this.hudRef.showSpeechActive(this.lastVolume);
        }
      },
      onFinalResult: (text) => {
        this.lastLiveTranscript = text;
        this.callbacks.onLiveTranscript?.(text, true);
        // Record finalized speech recognition to cache
        if (text.trim()) {
          this.transcriptStore?.addSpeech(text.trim(), 'live_final');
        }
        // Update glasses bottom zone with confirmed text
        if (this.hudRef && text.trim()) {
          this.hudRef.showLiveTranscript(`✓ ${text.trim()}`);
        }
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
      // Bridge mode: PCM from glasses → Gemini transcription
      const started = this.speechRecognizer.startBridge();
      if (started) {
        console.log('[Session] ✓ Bridge speech recognition active (PCM → Gemini)');
      }
    } else {
      // Browser mode: Web Speech API
      if (!SpeechRecognizer.isSupported()) {
        console.log('[Session] Web Speech API not available — real-time transcript disabled');
        return;
      }
      const started = this.speechRecognizer.start();
      if (started) {
        console.log('[Session] ✓ Browser speech recognition active (Web Speech API)');
      }
    }
  }

  /**
   * Start silence countdown interval that updates HUD every second.
   */
  private startSilenceCountdown(): void {
    this.stopSilenceCountdown();
    this.silenceCountdownInterval = setInterval(() => {
      if (this._state !== 'listening' || !this.vad || !this.hudRef) return;
      const silenceMs = this.vad.silenceDurationMs;
      const thresholdMs = this.weekConfig.silenceThresholdMs;
      const secondsLeft = Math.max(0, Math.ceil((thresholdMs - silenceMs) / 1000));
      const thresholdSeconds = Math.ceil(thresholdMs / 1000);
      // Only show countdown when > 30% into silence
      if (silenceMs > thresholdMs * 0.3) {
        this.hudRef.showSilenceCountdown(secondsLeft, thresholdSeconds);
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
      transcript,
    };

    this.callbacks.onSessionLog(log);
    this.setState('session_end');
  }

  /**
   * Pause the session temporarily.
   */
  async pause(): Promise<void> {
    if (this._state !== 'listening' && this._state !== 'silence_detected' && this._state !== 'hud_flash') return;
    
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
    
    if (this.vad) {
      await this.vad.resume();
    }
    
    if (this.speechRecognizer) {
      if (this.vad?.audioSource === 'bridge') {
        this.speechRecognizer.startBridge();
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

  // ── Internal Handlers ──

  private async handleSilenceThreshold(): Promise<void> {
    if (this.isGenerating) return;
    if (this._state !== 'listening') return;

    this.silenceCount++;
    const silenceDur = this.vad?.silenceDurationMs ?? 0;
    this.silenceDurations.push(silenceDur);

    // Record silence event to cache
    this.transcriptStore?.addSilence(silenceDur);

    this.setState('silence_detected');
    this.callbacks.onSilenceStart();

    // Week 4 blackout check
    if (Math.random() < this.weekConfig.blackoutProbability) {
      // Blackout — no hint shown
      setTimeout(() => {
        if (this._state === 'silence_detected') {
          this.setState('listening');
        }
      }, 1000);
      return;
    }

    // Generate chunk
    this.isGenerating = true;
    this.setState('chunk_generating');

    try {
      const result = await generateChunk({
        topic: this._topic,
        week: this.weekConfig.week,
        category: this._category,
        lastUtterance: this.lastLiveTranscript || undefined,
        usedHints: this.usedHintChunks,
        scenarioContext: this._scenarioContext || undefined,
      });

      // Check if session was stopped during API call
      if ((this._state as any) === 'session_end') return;

      if (result.chunk) {
        this.hintCount++;
        this.usedHintChunks.push(result.chunk);
        this.hintHistory.push({
          chunk: result.chunk,
          source: result.source,
          timestamp: Date.now(),
        });

        // Record hint to cache
        this.transcriptStore?.addHint(result.chunk, result.source === 'gemini' ? 'gemini_eval' : 'fallback');

        this.setState('hud_flash');
        this.callbacks.onChunkGenerated(result);

        // Auto-clear after flash duration, then restart silence cycle
        setTimeout(() => {
          if (this._state === 'hud_flash') {
            this.setState('listening');
            // Restart silence timer so the cycle continues
            this.vad?.simulateSilenceRestart();
            // Restore gauge on glasses
            this.hudRef?.showListening();
          }
        }, this.weekConfig.hintFlashDurationMs);
      } else {
        // Empty chunk (Week 4 blackout from API)
        this.setState('listening');
      }
    } catch {
      this.setState('listening');
    } finally {
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

    // If user spoke while in silence/hint state, count as self-response
    if (this._state === 'silence_detected' || this._state === 'listening') {
      this.selfResponses++;
    }

    if (this._state !== 'listening') {
      this.setState('listening');
    }
  }
}
