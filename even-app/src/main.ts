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
import { TranscriptStore } from './combat/transcript-store';
import { downloadExportJSON } from './combat/transcript-export';
import { SCENARIOS, CATEGORY_META, getScenariosByCategory, getScenarioById, getCategories, toLegacyCategory, type TopicScenario, type TopicCategory } from './combat/topic-registry';
import { renderTopicSelector, renderScenarioGrid, fillTopicDetail } from './ui/topic-selector-view';

// ── Global State ──

let currentPhase = 2; // Start on Combat
let calibration: CalibrationResult | null = null;
let session: SessionEngine | null = null;
let hud: HUDController | null = null;
let ambientScheduler: AmbientScheduler | null = null;
let echoDisplay: EchoDisplay | null = null;
let currentWeek = 1;
let selectedScenario: TopicScenario | null = null;
let expressionUsage: Map<string, boolean> = new Map();
let currentActiveHint: string | null = null;
let currentMode: 'general' | 'scenario' | null = null;

// ── App Shell ──

function renderApp(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <!-- Header -->
    <header class="app-header" style="padding: 16px 0; display: flex; align-items: center; justify-content: center; gap: 16px;">
      <h1 style="margin: 0; font-size: 22px;">Project ECHO</h1>
      <!-- G2 Connection Badge -->
      <div class="connection-badge" id="g2-badge" style="margin: 0;">
        <span class="status-dot idle" id="g2-dot"></span>
        <span id="g2-badge-text">G2 Glasses: Connecting...</span>
      </div>
    </header>

    <div id="g2-diagnostics" style="text-align: center; font-size: 11px; color: var(--color-text-muted); margin-bottom: 20px; display: none;">
      Device: <span id="diag-status">none</span> | 
      Startup: <span id="diag-startup">-</span> |
      Wearing: <span id="diag-wearing">-</span>
    </div>

    <!-- Learning Flow Navigation -->
    <nav class="phase-nav" id="phase-nav">
      <button class="phase-tab" data-phase="1">Voice Setup</button>
      <button class="phase-tab" data-phase="2">Combat Training</button>
      <button class="phase-tab" data-phase="3">Debrief & Export</button>
      <button class="phase-tab" data-phase="4">Ambient Immersion</button>
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
  // If a training session is active, ask for confirmation before leaving
  if (phase !== currentPhase && session && session.state !== 'idle') {
    const confirmLeave = window.confirm('A training session is currently active. Are you sure you want to leave and stop the session?');
    if (!confirmLeave) return;
    
    // User confirmed leaving, so stop the session first
    stopSession();
  }

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
  const diag = document.getElementById('g2-diagnostics');
  const diagStatus = document.getElementById('diag-status');
  const diagStartup = document.getElementById('diag-startup');
  const diagWearing = document.getElementById('diag-wearing');
  
  if (badge) {
    badge.innerHTML = `<span class="status-dot idle" id="g2-dot"></span><span id="g2-badge-text">G2 Glasses: Connecting...</span>`;
    badge.style.cursor = 'wait';
  }

  if (!hud) {
    hud = new HUDController();
    
    // Handle actions from the glasses touchpad
    hud.onAction((action) => {
      console.log('[App] Action from HUD:', action);
      if (action === 'stop') {
        stopSession();
      } else if (action === 'resume') {
        // Resume session if it was paused
        if (session && session.state === 'paused') {
          session.resume();
          // Update UI button state if needed
          const btnPause = document.getElementById('btn-pause-session') as HTMLButtonElement;
          if (btnPause) {
            btnPause.textContent = 'Pause';
            btnPause.classList.remove('btn-highlight');
            btnPause.classList.add('btn-neutral');
          }
        }
      }
    });
  }

  // Listen for real-time status changes
  hud.onStatusChanged((status) => {
    if (!badge) return;
    
    if (diag) diag.style.display = 'block';
    if (diagStatus) diagStatus.textContent = status.connectType;
    if (diagWearing) {
      const rawWearing = status.isWearing ?? status.wearing ?? status.is_wearing ?? status.wearingStatus ?? status.wearState ?? status.isWear ?? status.wearStatus ?? status.wearingState ?? status.wear;
      const isWearing = rawWearing === true || rawWearing === 1 || rawWearing === '1' || String(rawWearing).toLowerCase() === 'true' || String(rawWearing).toLowerCase() === 'yes';
      
      if (rawWearing === undefined) diagWearing.textContent = 'UNKNOWN';
      else diagWearing.textContent = isWearing ? 'YES' : 'NO';

      // Log raw value for debugging if it's NO but user is wearing
      if (!isWearing) {
        console.log('[DEBUG] Wear status is false. Raw value:', rawWearing, 'Type:', typeof rawWearing);
      }
    }

    const isConnected = status.connectType !== undefined 
      ? (status.connectType === 'connected' || status.connectType === 1) 
      : (hud?.connected ?? false);
    badge.classList.toggle('connected', isConnected);
    
    if (isConnected) {
      const rawWearing = status.isWearing ?? status.wearing ?? status.is_wearing ?? status.wearingStatus ?? status.wearState ?? status.isWear ?? status.wearStatus ?? status.wearingState ?? status.wear;
      const isWearing = rawWearing === true || rawWearing === 1 || rawWearing === '1' || String(rawWearing).toLowerCase() === 'true' || String(rawWearing).toLowerCase() === 'yes';
      const wearStr = isWearing ? ' (Wearing)' : ' (Not Wearing)';
      const battStr = status.batteryLevel !== undefined ? ` [${status.batteryLevel}%]` : '';
      badge.innerHTML = `<span class="status-dot listening"></span> G2 Glasses: Connected${wearStr}${battStr}`;
      
      // Set up echo display if needed
      if (!echoDisplay && hud) {
        echoDisplay = new EchoDisplay();
        echoDisplay.setHUD(hud);
      }

      // Enter standby screen on glasses (1-time render)
      hud?.enterStandby();
    } else {
      badge.innerHTML = `<span class="status-dot idle"></span> G2 Glasses: ${status.connectType.toUpperCase()} (Retry)`;
      badge.onclick = () => {
        badge.onclick = null;
        initHUD();
      };
    }
  });

  try {
    const success = await hud.init();
    // We get the startup result via the internal logs usually, 
    // but here we can try to reflect it if we exposed it.
    // For now, let's just show bridge found.
    if (diagStartup) diagStartup.textContent = 'OK';
  } catch (err) {
    if (diagStartup) diagStartup.textContent = 'FAIL';
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

    // Show calibration soundwave
    const calSW = document.getElementById('cal-soundwave');
    if (calSW) {
      calSW.style.display = 'flex';
      calSW.classList.add('idle');
      calSW.classList.remove('active');
    }

    // HUD feedback
    hud?.showCalibration('Voice Sampling', 'Say: "Test, one two three"');

    // Soundwave volume driver for calibration
    const driveCalibrSW = (volume: number) => {
      const panel = document.getElementById('cal-soundwave');
      if (panel) {
        if (volume > 0.05) {
          panel.classList.add('active');
          panel.classList.remove('idle');
        } else {
          panel.classList.remove('active');
          panel.classList.add('idle');
        }
      }
      for (let i = 0; i < 8; i++) {
        const lBar = document.getElementById(`cal-sw-l${i}`);
        const rBar = document.getElementById(`cal-sw-r${i}`);
        if (lBar && rBar) {
          const centerWeight = 1 - (Math.abs(i - 3.5) / 8) * 0.6;
          const barVolume = Math.max(0, volume * centerWeight);
          const jitter = 1 + (Math.random() - 0.5) * 0.25;
          const height = Math.max(3, Math.min(42, barVolume * 55 * jitter));
          lBar.style.height = `${height}px`;
          rBar.style.height = `${height}px`;
          const color = volume > 0.6 ? 'var(--phase1)' 
            : volume > 0.25 ? 'var(--color-positive)'
            : 'var(--color-text-muted)';
          lBar.style.background = color;
          rBar.style.background = color;
        }
      }
      const swStatus = document.getElementById('cal-soundwave-status');
      if (swStatus) {
        swStatus.textContent = volume > 0.1 ? '● Voice detected' : 'Waiting for voice input...';
      }
    };

    try {
      calibration = await runCalibration((pct) => {
        progressBar.style.width = `${Math.round(pct * 100)}%`;
      }, hud ?? undefined, driveCalibrSW);

      showCalibrationResult(calibration);
      status.textContent = 'Done';

      // Hide soundwave after calibration
      if (calSW) {
        calSW.style.display = 'none';
      }

      hud?.showCalibration(
        'Calibration Complete',
        `F0: ${calibration.pitch.f0}Hz | ${calibration.filter.persona}`,
      );
    } catch (err) {
      status.textContent = 'Error';
      status.className = 'badge badge-negative';
      console.error('Calibration failed:', err);
      // Hide soundwave on error too
      if (calSW) calSW.style.display = 'none';
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
  // Mode selection
  document.getElementById('btn-mode-general')?.addEventListener('click', () => {
    currentMode = 'general';
    document.getElementById('general-practice-area')!.style.display = 'block';
    document.getElementById('scenario-practice-area')!.style.display = 'none';
    document.getElementById('btn-mode-general')!.style.borderColor = 'var(--phase2)';
    document.getElementById('btn-mode-scenario')!.style.borderColor = 'transparent';
  });

  document.getElementById('btn-mode-scenario')?.addEventListener('click', () => {
    currentMode = 'scenario';
    document.getElementById('general-practice-area')!.style.display = 'none';
    document.getElementById('scenario-practice-area')!.style.display = 'block';
    document.getElementById('btn-mode-scenario')!.style.borderColor = 'var(--phase2)';
    document.getElementById('btn-mode-general')!.style.borderColor = 'transparent';
  });

  // Week selector
  const weekBtns = document.querySelectorAll('#week-selector .week-btn');
  weekBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const week = parseInt((btn as HTMLElement).dataset.week ?? '1');
      selectWeek(week);
    });
  });
  selectWeek(currentWeek);

  // Topic selector
  initTopicSelector();

  // Change topic button
  document.getElementById('btn-change-topic')?.addEventListener('click', () => {
    selectedScenario = null;
    const selCard = document.getElementById('selected-topic-card');
    if (selCard) selCard.style.display = 'none';
    initTopicSelector();
  });

  // Start/Stop/Pause session
  document.getElementById('btn-start-general')?.addEventListener('click', () => {
    selectedScenario = null; // Ensure general mode
    startSession();
  });
  document.getElementById('btn-start-scenario')?.addEventListener('click', () => {
    if (!selectedScenario) return;
    startSession();
  });
  document.getElementById('btn-stop-session')?.addEventListener('click', stopSession);
  
  document.getElementById('btn-pause-session')?.addEventListener('click', async () => {
    if (!session) return;
    const btnPause = document.getElementById('btn-pause-session') as HTMLButtonElement;
    if (session.state === 'paused') {
      await session.resume();
      btnPause.textContent = 'Pause';
      btnPause.classList.remove('btn-highlight');
      btnPause.classList.add('btn-neutral');
    } else {
      await session.pause();
      btnPause.textContent = 'Resume';
      btnPause.classList.remove('btn-neutral');
      btnPause.classList.add('btn-highlight');
    }
  });
}

function initTopicSelector(): void {
  const area = document.getElementById('topic-selector-area');
  if (!area) return;

  if (selectedScenario) {
    area.innerHTML = '';
    showSelectedTopicCard(selectedScenario);
    return;
  }

  area.innerHTML = renderTopicSelector();

  // Bind category tabs
  const tabs = document.querySelectorAll('.topic-cat-tab');
  const firstCat = getCategories()[0] ?? 'daily';

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const cat = (tab as HTMLElement).dataset.cat as TopicCategory;
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const grid = document.getElementById('topic-scenario-grid');
      if (grid) {
        grid.innerHTML = renderScenarioGrid(cat, selectedScenario?.id);
        bindScenarioCards();
      }
    });
  });

  // Show first category
  const firstTab = tabs[0] as HTMLElement | undefined;
  if (firstTab) {
    firstTab.classList.add('active');
    const grid = document.getElementById('topic-scenario-grid');
    if (grid) {
      grid.innerHTML = renderScenarioGrid(firstCat as TopicCategory);
      bindScenarioCards();
    }
  }
}

function bindScenarioCards(): void {
  document.querySelectorAll('.topic-scenario-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = (card as HTMLElement).dataset.scenario;
      if (!id) return;
      const scenario = getScenarioById(id);
      if (!scenario) return;
      selectedScenario = scenario;
      fillTopicDetail(scenario);

      // Highlight selected card
      document.querySelectorAll('.topic-scenario-card').forEach((c) => {
        (c as HTMLElement).style.borderColor = 'var(--color-border)';
        (c as HTMLElement).style.borderWidth = '1px';
      });
      (card as HTMLElement).style.borderColor = 'var(--phase2)';
      (card as HTMLElement).style.borderWidth = '2px';
    });
  });
}

function showSelectedTopicCard(scenario: TopicScenario): void {
  const card = document.getElementById('selected-topic-card');
  if (!card) return;
  card.style.display = 'block';
  setElText('selected-topic-emoji', scenario.emoji);
  setElText('selected-topic-label', scenario.label);
  setElText('selected-topic-situation', scenario.situation);
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
  // Use selected scenario or fall back to general
  const scenario = selectedScenario;
  const category = scenario ? toLegacyCategory(scenario.id) as ChunkCategory : 'general';
  const topicLabel = scenario ? scenario.label : 'General English Practice';

  // Initialize expression tracking if scenario has key expressions
  expressionUsage = new Map();
  if (scenario) {
    scenario.keyExpressions.forEach((expr) => expressionUsage.set(expr, false));
    showExpressionTracker(scenario.keyExpressions);
  }

  // Show soundwave panel
  const swPanel = document.getElementById('soundwave-panel');
  if (swPanel) {
    swPanel.style.display = 'flex';
    swPanel.classList.remove('active');
    swPanel.classList.add('idle');
  }

  // Hide topic selector area during session
  const topicArea = document.getElementById('topic-selector-area');
  if (topicArea) topicArea.style.display = 'none';
  const selCard = document.getElementById('selected-topic-card');
  if (selCard) selCard.style.display = 'none';

  session = new SessionEngine(currentWeek, {
    onStateChange: handleSessionState,
    onChunkGenerated: (result) => {
      currentActiveHint = result.chunk;
      handleChunkGenerated(result);
    },
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
        // Check expression usage
        checkExpressionUsage(transcript);

        // Check if the transcript contains the active hint
        if (currentActiveHint) {
          const cleanText = transcript.toLowerCase().replace(/[^\\w\\s]/g, '');
          const cleanHint = currentActiveHint.toLowerCase().replace(/[^\\w\\s]/g, '');
          if (cleanText.includes(cleanHint)) {
            hud?.showGoodJob();
            currentActiveHint = null; // clear it
          }
        }
      }
    },
    onLiveTranscript: (text, isFinal) => {
      const liveContainer = document.getElementById('live-transcript-container');
      const liveText = document.getElementById('live-transcript-text');
      if (!liveContainer || !liveText) return;

      if (text.trim()) {
        liveContainer.style.display = 'block';
        liveText.textContent = text;

        // Check hint usage on live text too for snappy feedback
        if (currentActiveHint) {
          const cleanText = text.toLowerCase().replace(/[^\\w\\s]/g, '');
          const cleanHint = currentActiveHint.toLowerCase().replace(/[^\\w\\s]/g, '');
          if (cleanText.includes(cleanHint)) {
            hud?.showGoodJob();
            currentActiveHint = null; // clear it
          }
        }

        if (isFinal) {
          // Update the recognized display with final text
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
          // Check expression usage on final transcript
          checkExpressionUsage(text.trim());
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
      // Track mic readiness on HUD for standby screen
      hud?.setMicReady(true);
    },
    onVolume: (volume: number) => {
      // Drive symmetric soundwave bars (8 left + 8 right)
      const swPanel = document.getElementById('soundwave-panel');
      if (swPanel) {
        if (volume > 0.05) {
          swPanel.classList.add('active');
          swPanel.classList.remove('idle');
        } else {
          swPanel.classList.remove('active');
          swPanel.classList.add('idle');
        }
      }
      for (let i = 0; i < 8; i++) {
        const lBar = document.getElementById(`sw-l${i}`);
        const rBar = document.getElementById(`sw-r${i}`);
        if (lBar && rBar) {
          // Center bars taller, edge bars shorter
          const centerWeight = 1 - (Math.abs(i - 3.5) / 8) * 0.6;
          const barVolume = Math.max(0, volume * centerWeight);
          const jitter = 1 + (Math.random() - 0.5) * 0.25;
          const height = Math.max(3, Math.min(42, barVolume * 55 * jitter));
          lBar.style.height = `${height}px`;
          rBar.style.height = `${height}px`;
          // Color based on volume intensity
          const color = volume > 0.6 ? 'var(--phase2)'
            : volume > 0.25 ? 'var(--color-positive)'
            : 'var(--color-text-muted)';
          lBar.style.background = color;
          rBar.style.background = color;
        }
      }
      // Update soundwave status text
      const swStatus = document.getElementById('soundwave-status');
      if (swStatus) {
        swStatus.textContent = volume > 0.1 ? '● Audio detected' : 'Waiting for audio...';
      }
    },
  });

  session.setTopic(
    topicLabel,
    category,
    scenario?.id ?? '',
    scenario?.geminiCoachContext ?? '',
  );

  // UI updates
  toggleSessionUI(true);

  // HUD — exit standby, enter combat mode
  hud?.setSessionActive(true);
  hud?.exitStandby();
  hud?.showListening();

  try {
    await session.start(hud);
  } catch (err: any) {
    console.error('[App] Failed to start session:', err);
    if (err.message === 'SECURE_ORIGIN_REQUIRED') {
      alert('🔒 SECURE ORIGIN REQUIRED\n\nTo use the microphone on a mobile device, you must:\n1. Use an HTTPS connection\n2. OR enable "Insecure origins treated as secure" in chrome://flags\n\nPlease add http://' + window.location.host + ' to the allowed list.');
    } else {
      alert('Failed to start microphone: ' + err.message);
    }
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

  // Return glasses to standby screen instead of blank
  hud?.setSessionActive(false);
  hud?.enterStandby();

  // Reset soundwave bars
  for (let i = 0; i < 8; i++) {
    const lBar = document.getElementById(`sw-l${i}`);
    const rBar = document.getElementById(`sw-r${i}`);
    if (lBar) { lBar.style.height = '3px'; lBar.style.background = 'var(--color-text-muted)'; }
    if (rBar) { rBar.style.height = '3px'; rBar.style.background = 'var(--color-text-muted)'; }
  }

  // Hide soundwave panel
  const swPanel = document.getElementById('soundwave-panel');
  if (swPanel) {
    swPanel.style.display = 'none';
    swPanel.classList.remove('active');
    swPanel.classList.add('idle');
  }

  // Show mode selector area again and reset selection
  const modeSelector = document.getElementById('mode-selector-card');
  if (modeSelector) modeSelector.style.display = 'block';
  
  const generalArea = document.getElementById('general-practice-area');
  const scenarioArea = document.getElementById('scenario-practice-area');
  if (generalArea) generalArea.style.display = 'none';
  if (scenarioArea) scenarioArea.style.display = 'none';
  
  const btnGen = document.getElementById('btn-mode-general');
  const btnScen = document.getElementById('btn-mode-scenario');
  if (btnGen) btnGen.style.borderColor = 'transparent';
  if (btnScen) btnScen.style.borderColor = 'transparent';
  currentMode = null;

  // Hide expression tracker
  const exprTracker = document.getElementById('expression-tracker');
  if (exprTracker) exprTracker.style.display = 'none';

  // Hide live transcript and audio source
  const liveContainer = document.getElementById('live-transcript-container');
  if (liveContainer) liveContainer.style.display = 'none';
  const audioLabel = document.getElementById('audio-source-label');
  if (audioLabel) audioLabel.style.display = 'none';
  const transcriptDisplay = document.getElementById('transcript-display');
  if (transcriptDisplay) transcriptDisplay.style.display = 'none';
}
function toggleSessionUI(active: boolean): void {
  const btnStartGen = document.getElementById('btn-start-general') as HTMLButtonElement;
  const btnStartScen = document.getElementById('btn-start-scenario') as HTMLButtonElement;
  const modeSelector = document.getElementById('mode-selector-card');
  const btnStop = document.getElementById('btn-stop-session') as HTMLButtonElement;
  const btnPause = document.getElementById('btn-pause-session') as HTMLButtonElement;
  const statsCard = document.getElementById('live-stats-card');
  const historyCard = document.getElementById('hint-history-card');
  const sessionCard = document.getElementById('session-card');

  if (btnStartGen) btnStartGen.style.display = active ? 'none' : 'block';
  if (btnStartScen) btnStartScen.style.display = active ? 'none' : 'block';
  if (modeSelector) modeSelector.style.display = active ? 'none' : 'block';
  
  // Hide the specific practice areas when active to declutter
  if (active) {
    const genArea = document.getElementById('general-practice-area');
    const scenArea = document.getElementById('scenario-practice-area');
    if (genArea) genArea.style.display = 'none';
    if (scenArea) scenArea.style.display = 'none';
  }

  if (sessionCard) sessionCard.style.display = active ? 'block' : 'none';
  if (btnStop) btnStop.style.display = active ? 'flex' : 'none';
  if (btnPause) {
    btnPause.style.display = active ? 'flex' : 'none';
    btnPause.textContent = 'Pause';
    btnPause.classList.remove('btn-highlight');
    btnPause.classList.add('btn-neutral');
  }
  if (statsCard) statsCard.style.display = active ? 'block' : 'none';
  if (historyCard) historyCard.style.display = active ? 'block' : 'none';
}

function handleSessionState(state: SessionState): void {
  const status = document.getElementById('session-status');
  const vadDot = document.getElementById('vad-dot');
  const vadLabel = document.getElementById('vad-label');
  const chunkDisplay = document.getElementById('chunk-display');

  // Soundwave idle animation for state changes
  const isListening = state === 'listening';
  const swPanel = document.getElementById('soundwave-panel');
  if (swPanel) {
    if (isListening) {
      // Active state — JS drives bars
    } else if (state === 'loading_vad') {
      swPanel.classList.remove('active');
      swPanel.classList.add('idle');
    } else if (state === 'idle' || state === 'session_end') {
      swPanel.classList.remove('active');
      swPanel.classList.add('idle');
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
      paused: 'Paused',
      session_end: 'Ended',
    };
    status.textContent = labels[state] ?? state;
    status.className = state === 'listening' ? 'badge badge-positive' :
                       state === 'loading_vad' ? 'badge badge-accent' :
                       state === 'silence_detected' ? 'badge badge-negative' :
                       state === 'hud_flash' ? 'badge badge-accent' : 
                       state === 'paused' ? 'badge badge-neutral' : 'badge badge-neutral';
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

  // Render cached session export list
  renderSessionExportList();
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

/**
 * Render the list of cached combat sessions available for export.
 */
function renderSessionExportList(): void {
  const listEl = document.getElementById('session-export-list');
  const emptyEl = document.getElementById('session-export-empty');
  if (!listEl) return;

  const summaries = TranscriptStore.getSummaries();

  if (summaries.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  listEl.innerHTML = summaries
    .slice()
    .reverse() // most recent first
    .map((s) => {
      const date = new Date(s.startTime);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      const durationSec = s.endTime ? Math.round((s.endTime - s.startTime) / 1000) : 0;
      const durationStr = durationSec > 60 ? `${Math.floor(durationSec / 60)}m${durationSec % 60}s` : `${durationSec}s`;
      return `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px; margin-bottom: 6px; background: var(--color-surface-light); border-radius: var(--radius); border-left: 3px solid var(--phase2);">
          <div style="flex: 1; min-width: 0;">
            <div class="text-normal-body" style="color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">W${s.week} · ${s.topic}</div>
            <div class="text-detail" style="color: var(--color-text-muted);">${dateStr} · ${durationStr} · 💬${s.speechCount} 💡${s.hintCount}</div>
          </div>
          <button class="btn" style="padding: 4px 12px; font-size: 12px; min-width: auto;" data-export-session="${s.sessionId}">Export</button>
        </div>
      `;
    })
    .join('');

  // Bind export buttons
  listEl.querySelectorAll('[data-export-session]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sessionId = (btn as HTMLElement).dataset.exportSession;
      if (!sessionId) return;

      const statusEl = document.getElementById('session-export-status');
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.textContent = 'Generating 3-stage JSON...';
        statusEl.style.background = 'var(--color-accent-alpha)';
        statusEl.style.color = 'var(--color-accent)';
      }

      try {
        const sessionData = TranscriptStore.getById(sessionId);
        if (!sessionData) throw new Error('Session not found in cache');

        await downloadExportJSON(sessionData);

        if (statusEl) {
          statusEl.textContent = '✓ Export downloaded successfully';
          statusEl.style.background = 'var(--color-positive-alpha)';
          statusEl.style.color = 'var(--color-positive)';
        }
      } catch (err) {
        console.error('[Export] Failed:', err);
        if (statusEl) {
          statusEl.textContent = `✗ Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
          statusEl.style.background = 'var(--color-negative-alpha, rgba(239,68,68,0.1))';
          statusEl.style.color = 'var(--color-negative)';
        }
      }
    });
  });
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

// ── Expression Tracking ──

function showExpressionTracker(expressions: string[]): void {
  const tracker = document.getElementById('expression-tracker');
  const list = document.getElementById('expr-list');
  const score = document.getElementById('expr-score');
  if (!tracker || !list) return;

  tracker.style.display = 'block';
  if (score) score.textContent = `0/${expressions.length} used`;

  list.innerHTML = expressions
    .map((expr) => `<div class="expr-item" data-expr="${expr}" style="padding: 3px 0; display: flex; align-items: center; gap: 6px;">
      <span class="expr-check" style="color: var(--color-text-muted); font-size: 11px;">○</span>
      <span style="color: var(--color-text-dim);">${expr}</span>
    </div>`)
    .join('');
}

function checkExpressionUsage(userText: string): void {
  if (!selectedScenario || expressionUsage.size === 0) return;

  const lower = userText.toLowerCase();
  let changed = false;

  for (const [expr, used] of expressionUsage) {
    if (used) continue;
    // Extract the core pattern (remove placeholder parentheses content)
    const pattern = expr
      .replace(/\([^)]*\)/g, '')  // remove (placeholder)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

    // Check if user used the core pattern (allow partial match for 3+ word patterns)
    const words = pattern.split(' ').filter((w) => w.length > 1);
    const matchCount = words.filter((w) => lower.includes(w)).length;
    const matchRatio = words.length > 0 ? matchCount / words.length : 0;

    if (matchRatio >= 0.6) {
      expressionUsage.set(expr, true);
      changed = true;
    }
  }

  if (changed) updateExpressionUI();
}

function updateExpressionUI(): void {
  const items = document.querySelectorAll('.expr-item');
  let usedCount = 0;

  items.forEach((item) => {
    const expr = (item as HTMLElement).dataset.expr;
    if (!expr) return;
    const used = expressionUsage.get(expr) ?? false;
    const check = item.querySelector('.expr-check');
    if (used) {
      usedCount++;
      if (check) {
        (check as HTMLElement).textContent = '●';
        (check as HTMLElement).style.color = 'var(--color-positive)';
      }
      (item as HTMLElement).style.opacity = '0.6';
    }
  });

  const score = document.getElementById('expr-score');
  if (score) score.textContent = `${usedCount}/${expressionUsage.size} used`;
}

// ── Bootstrap ──

document.addEventListener('DOMContentLoaded', renderApp);
