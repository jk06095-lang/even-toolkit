/**
 * Project ECHO — Main Entry Point
 *
 * Wires all Phase modules together:
 * - Phase 1: Calibration (DSP)
 * - Phase 2: Combat (VAD + Gemini + HUD)
 * - Phase 3: Debrief (JSON import)
 * - Phase 4: Ambient (Scheduler + Echo)
 */

import './style.css';

import { renderCalibrationView } from './ui/calibration-view';
import { renderCombatView } from './ui/combat-view';
import { renderDebriefView } from './ui/debrief-view';
import { renderAmbientView } from './ui/ambient-view';

import { runCalibration, loadCalibration, defaultCalibration, type CalibrationResult } from './dsp/calibration';
import { SessionEngine, WEEK_CONFIGS, type SessionState } from './combat/session-engine';
import type { ChunkResult } from './combat/chunk-generator';
import type { ChunkCategory } from './combat/fallback-chunks';
import { importDebrief, type StoredDebrief } from './debrief/json-parser';
import { AmbientScheduler, type PendingItem } from './ambient/scheduler';
import { EchoDisplay } from './ambient/echo-display';
import { HUDController } from './hud/hud-controller';

// ── Global State ──

let currentPhase = 2; // Start on Combat
let calibration: CalibrationResult | null = null;
let session: SessionEngine | null = null;
let hud: HUDController | null = null;
let ambientScheduler: AmbientScheduler | null = null;
let echoDisplay: EchoDisplay | null = null;
let currentWeek = 1;

// ── App Shell ──

function renderApp(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <!-- Header -->
    <header class="app-header">
      <div class="logo">CHEATKEY</div>
      <h1>Project ECHO</h1>
      <div class="subtitle">The Agent Pipeline — 4-Week English Combat Training</div>
    </header>

    <!-- G2 Connection -->
    <div style="text-align: center; margin-bottom: 20px;">
      <span class="connection-badge" id="g2-badge">
        <span class="status-dot idle" id="g2-dot"></span>
        G2 Glasses: Disconnected
      </span>
    </div>

    <!-- Phase Navigation -->
    <nav class="phase-nav" id="phase-nav">
      <button class="phase-tab" data-phase="1">Calibrate</button>
      <button class="phase-tab" data-phase="2">Combat</button>
      <button class="phase-tab" data-phase="3">Debrief</button>
      <button class="phase-tab" data-phase="4">Ambient</button>
    </nav>

    <!-- Phase Content -->
    <main id="phase-content"></main>
  `;

  // Bind phase nav
  const tabs = app.querySelectorAll('.phase-tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const phase = parseInt((tab as HTMLElement).dataset.phase ?? '1');
      switchPhase(phase);
    });
  });

  // Initialize HUD
  initHUD();

  // Load calibration
  calibration = loadCalibration();

  // Show initial phase
  switchPhase(currentPhase);
}

// ── Phase Switching ──

function switchPhase(phase: number): void {
  currentPhase = phase;

  // Update tabs
  document.querySelectorAll('.phase-tab').forEach((tab) => {
    tab.classList.toggle('active', (tab as HTMLElement).dataset.phase === String(phase));
  });

  // Render phase content
  const content = document.getElementById('phase-content')!;
  switch (phase) {
    case 1:
      content.innerHTML = renderCalibrationView();
      bindCalibrationEvents();
      break;
    case 2:
      content.innerHTML = renderCombatView();
      bindCombatEvents();
      break;
    case 3:
      content.innerHTML = renderDebriefView();
      bindDebriefEvents();
      break;
    case 4:
      content.innerHTML = renderAmbientView();
      bindAmbientEvents();
      break;
  }
}

// ── HUD Init ──

async function initHUD(): Promise<void> {
  const badge = document.getElementById('g2-badge');
  const dot = document.getElementById('g2-dot');
  
  if (badge) {
    badge.innerHTML = `<span class="status-dot idle"></span> G2 Glasses: Connecting...`;
    badge.style.cursor = 'wait';
  }

  if (!hud) hud = new HUDController();
  const connected = await hud.init();

  if (badge) {
    badge.style.cursor = 'pointer';
    if (connected) {
      badge.classList.add('connected');
      badge.innerHTML = `<span class="status-dot listening"></span> G2 Glasses: Connected`;
    } else {
      badge.classList.remove('connected');
      badge.innerHTML = `<span class="status-dot idle"></span> G2 Glasses: Disconnected (Retry)`;
      
      // Allow manual retry
      badge.onclick = () => {
        badge.onclick = null;
        initHUD();
      };
    }
  }

  // Set up echo display
  if (connected && !echoDisplay) {
    echoDisplay = new EchoDisplay();
    if (hud) echoDisplay.setHUD(hud);
  }
}

// ═══════════════════════════════════════════
// Phase 1: Calibration
// ═══════════════════════════════════════════

function bindCalibrationEvents(): void {
  const btnCalibrate = document.getElementById('btn-calibrate') as HTMLButtonElement;
  const btnSkip = document.getElementById('btn-skip-cal') as HTMLButtonElement;

  // Show existing calibration if available
  if (calibration) {
    showCalibrationResult(calibration);
  }

  btnCalibrate?.addEventListener('click', async () => {
    btnCalibrate.disabled = true;
    btnCalibrate.textContent = 'Listening...';

    const progress = document.getElementById('cal-progress')!;
    const progressBar = document.getElementById('cal-progress-bar')!;
    progress.style.display = 'block';

    const status = document.getElementById('cal-status')!;
    status.textContent = 'Sampling';
    status.className = 'badge badge-positive';

    // HUD feedback
    hud?.showCalibration('Voice Sampling', 'Say: "Test, one two three"');

    try {
      calibration = await runCalibration((pct) => {
        progressBar.style.width = `${Math.round(pct * 100)}%`;
      }, hud ?? undefined);

      showCalibrationResult(calibration);
      status.textContent = 'Done';

      hud?.showCalibration(
        'Calibration Complete',
        `F0: ${calibration.pitch.f0}Hz | ${calibration.filter.persona}`,
      );
    } catch (err) {
      status.textContent = 'Error';
      status.className = 'badge badge-negative';
      console.error('Calibration failed:', err);
    }

    btnCalibrate.disabled = false;
    btnCalibrate.textContent = 'Re-Calibrate';
  });

  btnSkip?.addEventListener('click', () => {
    calibration = defaultCalibration();
    showCalibrationResult(calibration);
  });
}

function showCalibrationResult(cal: CalibrationResult): void {
  const result = document.getElementById('cal-result');
  if (!result) return;
  result.style.display = 'block';

  const setEl = (id: string, val: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setEl('cal-freq', String(cal.pitch.f0));
  setEl('cal-f0', `${cal.pitch.f0}Hz`);
  setEl('cal-range', cal.pitch.range.toUpperCase());
  setEl('cal-persona', cal.filter.persona);
  setEl('cal-filter', `${cal.filter.filterType} @ ${cal.filter.cutoffHz}Hz`);

  const ring = document.getElementById('cal-ring');
  if (ring) {
    ring.style.borderColor = 'var(--phase1)';
  }
}

// ═══════════════════════════════════════════
// Phase 2: Combat
// ═══════════════════════════════════════════

function bindCombatEvents(): void {
  // Week selector
  const weekBtns = document.querySelectorAll('#week-selector .week-btn');
  weekBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const week = parseInt((btn as HTMLElement).dataset.week ?? '1');
      selectWeek(week);
    });
  });
  selectWeek(currentWeek);

  // Start/Stop session
  document.getElementById('btn-start-session')?.addEventListener('click', startSession);
  document.getElementById('btn-stop-session')?.addEventListener('click', stopSession);
}

function selectWeek(week: number): void {
  currentWeek = week;
  const config = WEEK_CONFIGS[week];

  document.querySelectorAll('#week-selector .week-btn').forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.week === String(week));
  });

  const desc = document.getElementById('week-desc');
  if (desc && config) {
    desc.textContent = `${config.label} | Silence: ${config.silenceThresholdMs / 1000}s | Blackout: ${Math.round(config.blackoutProbability * 100)}%`;
  }

  const threshLabel = document.getElementById('silence-threshold-label');
  if (threshLabel && config) {
    threshLabel.textContent = `${config.silenceThresholdMs / 1000}s threshold`;
  }

  session?.setWeek(week);
}

async function startSession(): Promise<void> {
  const topicSelect = document.getElementById('topic-select') as HTMLSelectElement;
  const category = (topicSelect?.value ?? 'general') as ChunkCategory;
  const topicLabels: Record<string, string> = {
    general: 'General English Practice',
    nampodong: 'Nampodong Local Guide 🇰🇷',
    business: 'Silicon Valley Pitch Meeting',
    travel: 'Travel & Directions',
    food: 'Food & Restaurant Recommendation',
  };

  session = new SessionEngine(currentWeek, {
    onStateChange: handleSessionState,
    onChunkGenerated: handleChunkGenerated,
    onSpeechDetected: handleSpeechDetected,
    onSilenceStart: handleSilenceStart,
    onSessionLog: (log) => {
      console.log('[Session Log]', log);
    },
    onTranscript: (transcript) => {
      const display = document.getElementById('transcript-display');
      const text = document.getElementById('transcript-text');
      const timing = document.getElementById('speech-timing');
      if (display && text && transcript) {
        text.textContent = `"${transcript}"`;
        display.style.display = 'block';
        // Show when this was heard
        if (timing) {
          const now = new Date();
          timing.textContent = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
        }
        // Auto-hide after 8 seconds
        setTimeout(() => {
          if (display) display.style.display = 'none';
        }, 8000);
      }
    },
    onLiveTranscript: (text, isFinal) => {
      const liveContainer = document.getElementById('live-transcript-container');
      const liveText = document.getElementById('live-transcript-text');
      if (!liveContainer || !liveText) return;

      if (text.trim()) {
        liveContainer.style.display = 'block';
        liveText.textContent = text;

        if (isFinal) {
          // Move final text to the "Recognized" display
          const display = document.getElementById('transcript-display');
          const transcriptText = document.getElementById('transcript-text');
          const timing = document.getElementById('speech-timing');
          if (display && transcriptText) {
            transcriptText.textContent = `"${text.trim()}"`;
            display.style.display = 'block';
            if (timing) {
              const now = new Date();
              timing.textContent = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
            }
          }
          // Clear the live transcript after a beat
          setTimeout(() => {
            if (liveContainer) liveContainer.style.display = 'none';
            if (liveText) liveText.textContent = '';
          }, 500);
        }
      }
    },
    onAudioSource: (source) => {
      const label = document.getElementById('audio-source-label');
      if (label) {
        label.style.display = 'inline-block';
        if (source === 'bridge') {
          label.textContent = '🔊 G2 Mic';
          label.style.color = 'var(--color-positive)';
        } else {
          label.textContent = '🎤 Phone Mic';
          label.style.color = 'var(--phase4)';
        }
      }
    },
    onVolume: (volume: number) => {
      // Drive waveform bars with real volume data
      for (let i = 0; i < 5; i++) {
        const bar = document.getElementById(`wb-${i}`);
        if (bar) {
          // Stagger the bars for natural look
          const barVolume = Math.max(0, volume - i * 0.03);
          const height = Math.max(4, Math.min(20, barVolume * 40));
          bar.style.height = `${height}px`;
          bar.classList.remove('animating'); // Use real data, not CSS animation
        }
      }
    },
  });

  session.setTopic(topicLabels[category] ?? 'Practice', category);

  // UI updates
  toggleSessionUI(true);

  // HUD
  hud?.showListening();

  try {
    await session.start(hud);


  } catch (err) {
    console.error('[App] Failed to start session:', err);
    stopSession();
  }
}

async function stopSession(): Promise<void> {
  if (session) {
    await session.stop();
    session = null;
  }
  toggleSessionUI(false);
  handleSessionState('idle'); // Force UI to standby
  hud?.clearDisplay();

  // Reset waveform bars
  for (let i = 0; i < 5; i++) {
    const bar = document.getElementById(`wb-${i}`);
    if (bar) {
      bar.style.height = '4px';
      bar.classList.remove('animating');
    }
  }

  // Hide live transcript and audio source
  const liveContainer = document.getElementById('live-transcript-container');
  if (liveContainer) liveContainer.style.display = 'none';
  const audioLabel = document.getElementById('audio-source-label');
  if (audioLabel) audioLabel.style.display = 'none';
  const transcriptDisplay = document.getElementById('transcript-display');
  if (transcriptDisplay) transcriptDisplay.style.display = 'none';
}

function toggleSessionUI(active: boolean): void {
  const btnStart = document.getElementById('btn-start-session') as HTMLButtonElement;
  const btnStop = document.getElementById('btn-stop-session') as HTMLButtonElement;
  const statsCard = document.getElementById('live-stats-card');
  const historyCard = document.getElementById('hint-history-card');

  if (btnStart) btnStart.style.display = active ? 'none' : 'flex';
  if (btnStop) btnStop.style.display = active ? 'flex' : 'none';
  if (statsCard) statsCard.style.display = active ? 'block' : 'none';
  if (historyCard) historyCard.style.display = active ? 'block' : 'none';
}

function handleSessionState(state: SessionState): void {
  const status = document.getElementById('session-status');
  const vadDot = document.getElementById('vad-dot');
  const vadLabel = document.getElementById('vad-label');
  const chunkDisplay = document.getElementById('chunk-display');

  const isListening = state === 'listening';
  for (let i = 0; i < 5; i++) {
    const bar = document.getElementById(`wb-${i}`);
    if (bar) {
      if (isListening) {
        bar.classList.add('animating');
        bar.style.animationDelay = `${i * 0.1}s`;
      } else {
        bar.classList.remove('animating');
        bar.style.animationDelay = '0s';
      }
    }
  }

  if (status) {
    const labels: Record<SessionState, string> = {
      idle: 'Standby',
      calibrated: 'Calibrated',
      loading_vad: 'Initializing Mic...',
      listening: 'Listening',
      silence_detected: 'Silence!',
      chunk_generating: 'Generating...',
      hud_flash: 'Hint Sent',
      session_end: 'Ended',
    };
    status.textContent = labels[state] ?? state;
    status.className = state === 'listening' ? 'badge badge-positive' :
                       state === 'loading_vad' ? 'badge badge-accent' :
                       state === 'silence_detected' ? 'badge badge-negative' :
                       state === 'hud_flash' ? 'badge badge-accent' : 'badge badge-neutral';
  }

  if (vadDot) {
    vadDot.className = `status-dot ${state === 'listening' ? 'listening' : state === 'idle' || state === 'session_end' ? 'idle' : 'listening'}`;
  }

  if (vadLabel) {
    vadLabel.textContent = state === 'listening'
                            ? 'VAD: Active — Listening...'
                            : state === 'loading_vad' ? 'VAD: Requesting Mic / Loading ONNX models...'
                            : state === 'silence_detected' ? 'VAD: Silence Detected!'
                            : state === 'chunk_generating' ? 'VAD: Generating hint...'
                            : state === 'hud_flash' ? 'VAD: Hint displayed!'
                            : 'VAD: Inactive';
  }

  if (chunkDisplay && (state === 'listening' || state === 'idle')) {
    chunkDisplay.style.display = 'none';
  }

  // Update stats
  if (session) {
    const s = session.stats;
    setElText('stat-hints', String(s.hints));
    setElText('stat-speeches', String(s.speeches));
    setElText('stat-silences', String(s.silences));
    setElText('stat-self-rate', `${s.selfResponseRate}%`);
  }

  // Silence meter animation
  updateSilenceMeter(state);
}

function handleChunkGenerated(result: ChunkResult): void {
  const chunkDisplay = document.getElementById('chunk-display');
  if (chunkDisplay && result.chunk) {
    chunkDisplay.style.display = 'block';
    chunkDisplay.innerHTML = `<div class="chunk-flash">${result.chunk}</div>
      <div class="text-detail" style="text-align: center; color: var(--color-text-muted); margin-top: var(--spacing-same);">
        Source: ${result.source} | ${result.latencyMs}ms
      </div>`;
  }

  // HUD
  if (currentWeek === 3) {
    hud?.showSpeedUp(result.chunk);
  } else {
    hud?.flashChunk(result.chunk);
  }

  // Add to history
  const list = document.getElementById('hint-list');
  if (list) {
    const li = document.createElement('li');
    li.textContent = result.chunk;
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
  }
}

function handleSpeechDetected(): void {
  hud?.showListening();

  // Flash the speaking indicator on the web UI
  const vadLabel = document.getElementById('vad-label');
  if (vadLabel) {
    vadLabel.textContent = 'VAD: Speech Detected!';
    vadLabel.style.color = 'var(--color-positive)';
    setTimeout(() => {
      if (vadLabel && session?.state === 'listening') {
        vadLabel.textContent = 'VAD: Active — Listening...';
        vadLabel.style.color = '';
      }
    }, 1500);
  }
}

function handleSilenceStart(): void {
  // Could show warning on HUD
}

let silenceAnimFrame: number | null = null;

function updateSilenceMeter(state: SessionState): void {
  const fill = document.getElementById('silence-fill');
  if (!fill) return;

  if (silenceAnimFrame) cancelAnimationFrame(silenceAnimFrame);

  if (state === 'listening' && session) {
    const config = WEEK_CONFIGS[currentWeek];
    const threshold = config?.silenceThresholdMs ?? 3000;

    const animate = () => {
      if (!session || session.state !== 'listening') {
        fill.style.width = '0%';
        return;
      }
      // Track actual silence duration from VAD's last speech time
      const silenceMs = (session as any).vad?.silenceDurationMs ?? 0;
      const pct = Math.min(100, (silenceMs / threshold) * 100);
      fill.style.width = `${pct}%`;

      // Color transition: green → yellow → red
      if (pct > 75) {
        fill.style.background = 'var(--color-negative, #ef4444)';
      } else if (pct > 50) {
        fill.style.background = 'var(--phase3, #f59e0b)';
      } else {
        fill.style.background = 'var(--color-positive, #22c55e)';
      }

      silenceAnimFrame = requestAnimationFrame(animate);
    };
    animate();
  } else {
    fill.style.width = state === 'silence_detected' ? '100%' : '0%';
    if (state === 'silence_detected') {
      fill.style.background = 'var(--color-negative, #ef4444)';
    }
  }
}

// ═══════════════════════════════════════════
// Phase 3: Debrief
// ═══════════════════════════════════════════

function bindDebriefEvents(): void {
  document.getElementById('btn-import-debrief')?.addEventListener('click', async () => {
    const input = document.getElementById('debrief-input') as HTMLTextAreaElement;
    const errorEl = document.getElementById('debrief-error')!;
    errorEl.style.display = 'none';

    try {
      const stored = await importDebrief(input.value);
      showDebriefResult(stored);

      // HUD feedback
      hud?.showDebrief(`Imported ${stored.report.bottleneck_chunks.length} chunks`);
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Invalid JSON';
      errorEl.style.display = 'block';
    }
  });
}

function showDebriefResult(stored: StoredDebrief): void {
  const result = document.getElementById('debrief-result');
  if (!result) return;
  result.style.display = 'block';

  setElText('debrief-date', stored.report.session_date);
  setElText('debrief-stress', stored.report.fsi_stress_level);
  setElText('debrief-chunks', String(stored.report.bottleneck_chunks.length));
  setElText('debrief-pushes', String(stored.scheduledPushes.length));

  const list = document.getElementById('debrief-chunk-list');
  if (list) {
    list.innerHTML = stored.report.bottleneck_chunks
      .map((c) => `<li>${c.target} <span style="color: var(--color-text-muted)">| intervals: ${c.interval.join(', ')}min</span></li>`)
      .join('');
  }
}

// ═══════════════════════════════════════════
// Phase 4: Ambient
// ═══════════════════════════════════════════

function bindAmbientEvents(): void {
  document.getElementById('btn-start-ambient')?.addEventListener('click', startAmbient);
  document.getElementById('btn-stop-ambient')?.addEventListener('click', stopAmbient);

  // Load pending items immediately
  if (ambientScheduler) {
    ambientScheduler.refresh();
  }
}

function startAmbient(): void {
  ambientScheduler = new AmbientScheduler({
    onEchoPush: (chunk) => {
      // Flash on HUD
      echoDisplay?.flash(chunk, 2000);

      // Visual feedback on web UI
      console.log(`[Ambient Echo] ${chunk}`);
    },
    onScheduleUpdate: (pending) => {
      updatePendingList(pending);
    },
  });

  if (echoDisplay && hud) {
    echoDisplay.setHUD(hud);
  }

  ambientScheduler.start();

  // UI
  const btnStart = document.getElementById('btn-start-ambient');
  const btnStop = document.getElementById('btn-stop-ambient');
  const status = document.getElementById('ambient-status');

  if (btnStart) btnStart.style.display = 'none';
  if (btnStop) btnStop.style.display = 'flex';
  if (status) {
    status.textContent = 'Active';
    status.className = 'badge badge-positive';
  }
}

function stopAmbient(): void {
  ambientScheduler?.stop();
  ambientScheduler = null;

  const btnStart = document.getElementById('btn-start-ambient');
  const btnStop = document.getElementById('btn-stop-ambient');
  const status = document.getElementById('ambient-status');

  if (btnStart) btnStart.style.display = 'flex';
  if (btnStop) btnStop.style.display = 'none';
  if (status) {
    status.textContent = 'Inactive';
    status.className = 'badge badge-neutral';
  }
}

function updatePendingList(items: PendingItem[]): void {
  const container = document.getElementById('pending-list') as HTMLUListElement;
  const empty = document.getElementById('pending-empty');
  const count = document.getElementById('pending-count');

  if (!container) return;

  if (count) count.textContent = String(items.length);

  if (items.length === 0) {
    container.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return;
  }

  container.style.display = 'block';
  if (empty) empty.style.display = 'none';

  container.innerHTML = items
    .slice(0, 10) // show max 10
    .map((item) => {
      const mins = Math.ceil(item.timeUntilMs / 60000);
      const timeStr = mins > 60 ? `${Math.round(mins / 60)}h` : `${mins}m`;
      return `<li class="schedule-item">
        <span class="time">⏰ ${timeStr}</span>
        <span class="chunk">${item.chunk}</span>
      </li>`;
    })
    .join('');
}

// ── Helpers ──

function setElText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ── Bootstrap ──

document.addEventListener('DOMContentLoaded', renderApp);
