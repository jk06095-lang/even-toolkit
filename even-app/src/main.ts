/**
 * Project ECHO — Main Entry Point
 *
 * Wires all Phase modules together:
 * - Phase 1: Calibration (DSP)
 * - Phase 2: Live Practice (VAD + ECHO API proxy + HUD)
 * - Phase 3: Review (JSON import)
 * - Phase 4: Ambient (Scheduler + Echo)
 */

import './style.css';

import { renderAppShell } from './ui/app-shell';
import { renderCalibrationView } from './ui/calibration-view';
import { renderCombatView } from './ui/combat-view';
import { renderDebriefView } from './ui/debrief-view';
import { renderAmbientView } from './ui/ambient-view';

import { runCalibration, loadCalibration, defaultCalibration, type CalibrationResult } from './dsp/calibration';
import { SessionEngine, WEEK_CONFIGS, type AssistMetrics, type AssistMode, type SessionState } from './combat/session-engine';
import type { ChunkResult } from './combat/chunk-generator';
import type { ChunkCategory } from './combat/fallback-chunks';
import { AmbientScheduler } from './ambient/scheduler';
import { EchoDisplay } from './ambient/echo-display';
import { HUDController, parseWearingState } from './hud/hud-controller';
import { SCENARIOS, CATEGORY_META, getScenariosByCategory, getScenarioById, getCategories, toLegacyCategory, type TopicScenario, type TopicCategory } from './combat/topic-registry';
import { renderTopicSelector, renderScenarioGrid, fillTopicDetail } from './ui/topic-selector-view';
import { bindDebriefEvents } from './debrief/debrief-controller';
import { bindAmbientEvents } from './ambient/ambient-controller';
import { bindPrivacyControls, updatePrivacySettingsUI } from './live-practice/privacy-controls';
import {
  loadPrivacySettings,
  type PrivacySettings,
} from './privacy/settings';

// ── Global State ──

let currentPhase = 2; // Start on Live Practice
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
let preferredAudioSource: 'bridge' | 'browser' = (localStorage.getItem('preferredAudioSource') as 'bridge' | 'browser') || 'bridge';
let endingPracticePromise: Promise<void> | null = null;
let selectedAssistMode: AssistMode = 'manual';
let privacySettings: PrivacySettings = loadPrivacySettings();
let latestAssistMetrics: AssistMetrics = {
  manual_request_count: 0,
  auto_trigger_count: 0,
  cue_dismissed_count: 0,
  false_trigger_count: 0,
  cue_used_count: 0,
  auto_assist_paused: false,
};

// ── App Shell ──

function renderApp(): void {
  const app = document.getElementById('app')!;
  app.innerHTML = renderAppShell();

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
  // If a live practice session is active, ask for confirmation before leaving
  if (phase !== currentPhase && session && session.state !== 'idle') {
    const confirmLeave = window.confirm('A Live Practice session is currently active. Leave and end this practice?');
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
      bindDebriefEvents({
        getHud: () => hud,
      });
      break;
    case 4:
      content.innerHTML = renderAmbientView();
      bindAmbientEvents({
        getHud: () => hud,
        getEchoDisplay: () => echoDisplay,
        getScheduler: () => ambientScheduler,
        setScheduler: (scheduler) => {
          ambientScheduler = scheduler;
        },
      });
      break;
  }
}

// ── HUD Init ──

async function initHUD(): Promise<void> {
  const badge = document.getElementById('g2-badge');
  
  if (badge) {
    badge.innerHTML = `<span class="status-dot idle" id="g2-dot"></span><span id="g2-badge-text">G2 Glasses: Connecting...</span>`;
    badge.style.cursor = 'wait';
  }

  if (!hud) {
    hud = new HUDController();
    
    // Handle actions from the glasses touchpad
    hud.onAction(async (action) => {
      console.log('[App] Action from HUD:', action);
      if (action === 'request-cue') {
        await requestManualCue();
      } else if (action === 'dismiss-cue') {
        dismissCue();
      } else if (action === 'end-practice') {
        await endPracticeSession();
      } else if (action === 'exit-echo') {
        await exitEcho();
      } else if (action === 'resume') {
        // Resume session if it was paused
        if (session && session.state === 'paused') {
          await session.resume();
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
    
    const isConnected = status.connectType !== undefined 
      ? (status.connectType === 'connected' || status.connectType === 1) 
      : (hud?.connected ?? false);
    badge.classList.toggle('connected', isConnected);
    
    if (isConnected) {
      const wearingState = parseWearingState(status);
      const wearStr = {
        wearing: ' (● Wearing)',
        'not-wearing': ' (○ Not wearing)',
        unavailable: ' (— Wear status unavailable)',
      }[wearingState];
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
    await hud.init();
  } catch (err) {
    console.warn('[App] Bridge initialization failed:', err);
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
  setEl('cal-vad-threshold', cal.speechThreshold.toFixed(4));
  setEl('cal-noise-floor', cal.noiseFloorRms.toFixed(4));

  const ring = document.getElementById('cal-ring');
  if (ring) {
    ring.style.borderColor = 'var(--phase1)';
  }
}

// ═══════════════════════════════════════════
// Phase 2: Live Practice
// ═══════════════════════════════════════════

function bindCombatEvents(): void {
  bindPrivacyControls({
    getSettings: () => privacySettings,
    setSettings: (settings) => {
      privacySettings = settings;
    },
  });

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
  document.getElementById('btn-stop-session')?.addEventListener('click', () => {
    endPracticeSession();
  });
  document.getElementById('btn-request-cue')?.addEventListener('click', () => {
    requestManualCue();
  });
  
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

  document.querySelectorAll('.assist-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = ((btn as HTMLElement).dataset.assistMode as AssistMode | undefined) ?? 'manual';
      selectedAssistMode = mode;
      session?.setAssistMode(mode);
      updateAssistModeUI();
    });
  });

  // Initialize toggle button text on render
  const toggleBtnSpan = document.querySelector('#btn-toggle-audio-source span');
  if (toggleBtnSpan) {
    toggleBtnSpan.textContent = preferredAudioSource === 'bridge' ? '🔄 G2 Mic' : '🔄 Phone Mic';
  }

  // Bind the toggle button click
  document.getElementById('btn-toggle-audio-source')?.addEventListener('click', async () => {
    const isSessionActive = session && session.state !== 'idle';
    
    // Toggle preferred source
    const newSource = preferredAudioSource === 'bridge' ? 'browser' : 'bridge';
    preferredAudioSource = newSource;
    localStorage.setItem('preferredAudioSource', newSource);
    
    console.log('[Main] Switched preferred mic source to:', newSource);
    
    // Update button label
    const span = document.querySelector('#btn-toggle-audio-source span');
    if (span) {
      span.textContent = newSource === 'bridge' ? '🔄 G2 Mic' : '🔄 Phone Mic';
    }

    if (isSessionActive) {
      // Visually indicate reconnecting
      const label = document.getElementById('audio-source-label');
      if (label) {
        label.textContent = '🔄 Reconnecting...';
        label.style.color = 'var(--color-text-dim)';
      }
      
      // Restart session
      await endPracticeSession();
      setTimeout(async () => {
        await startSession();
      }, 500);
    } else {
      // If standby, update label directly
      const label = document.getElementById('audio-source-label');
      if (label) {
        label.style.display = 'inline-block';
        if (newSource === 'bridge') {
          label.textContent = '🔊 G2 Mic (Pref)';
          label.style.color = 'var(--color-positive)';
        } else {
          label.textContent = '🎤 Phone Mic (Pref)';
          label.style.color = 'var(--phase4)';
        }
      }
    }
  });
}

function initTopicSelector(): void {
  const area = document.getElementById('topic-selector-area');
  if (!area) return;

  area.innerHTML = renderTopicSelector();

  if (selectedScenario) {
    document.getElementById('topic-selector')!.style.display = 'none';
    fillTopicDetail(selectedScenario);
  } else {
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

  // Bind the newly rendered buttons
  document.getElementById('btn-change-topic')?.addEventListener('click', () => {
    selectedScenario = null;
    initTopicSelector();
  });

  document.getElementById('btn-start-scenario')?.addEventListener('click', () => {
    if (!selectedScenario) return;
    startSession();
  });
}

function bindScenarioCards(): void {
  document.querySelectorAll('.topic-scenario-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = (card as HTMLElement).dataset.scenario;
      if (!id) return;
      const scenario = getScenarioById(id);
      if (!scenario) return;
      selectedScenario = scenario;
      
      // Hide the selector grid and show detail card
      document.getElementById('topic-selector')!.style.display = 'none';
      fillTopicDetail(scenario);
    });
  });
}

function selectWeek(week: number): void {
  currentWeek = week;
  const config = WEEK_CONFIGS[week];

  document.querySelectorAll('#week-selector .week-btn').forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.week === String(week));
  });

  const desc = document.getElementById('week-desc');
  if (desc && config) {
    desc.textContent = `${config.label} | Cue delay: ${config.silenceThresholdMs / 1000}s | Independent practice: ${Math.round(config.blackoutProbability * 100)}%`;
  }

  const threshLabel = document.getElementById('silence-threshold-label');
  if (threshLabel && config) {
    threshLabel.textContent = `${config.silenceThresholdMs / 1000}s threshold`;
  }

  session?.setWeek(week);
}

async function startSession(): Promise<void> {
  privacySettings = loadPrivacySettings();
  if (!privacySettings.useMicrophone) {
    updatePrivacySettingsUI(privacySettings, 'Enable Use microphone before starting Live Practice.', 'error');
    return;
  }

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
    onChunkGenerated: async (result) => {
      currentActiveHint = result.chunk;
      await handleChunkGenerated(result);
    },
    onSpeechDetected: handleSpeechDetected,
    onSilenceStart: handleSilenceStart,
    onSessionLog: (log) => {
      const { transcript, ...safeLog } = log;
      console.log('[Session Log]', {
        ...safeLog,
        transcript: transcript ? '[local transcript available for export]' : undefined,
      });
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
    onHintUsageResult: (result) => {
      const liveContainer = document.getElementById('live-transcript-container');
      const liveText = document.getElementById('live-transcript-text');

      if (result.status === 'used') {
        // Flash green feedback
        if (liveContainer && liveText) {
          liveContainer.style.display = 'block';
          liveContainer.style.borderLeftColor = 'var(--color-positive)';
          liveText.textContent = `✅ Great! You used: "${result.hint}"`;
          setTimeout(() => {
            liveContainer.style.borderLeftColor = 'var(--color-accent)';
          }, 2000);
        }
        console.log(`[Main] Hint used: "${result.hint}"`);
      } else if (result.status === 'simplified') {
        // Flash orange feedback
        if (liveContainer && liveText) {
          liveContainer.style.display = 'block';
          liveContainer.style.borderLeftColor = 'var(--phase4)';
          liveText.textContent = `🔄 Easier: "${result.simplifiedTo}"`;
          setTimeout(() => {
            liveContainer.style.borderLeftColor = 'var(--color-accent)';
          }, 2000);
        }
        console.log(`[Main] Hint simplified: "${result.hint}" → "${result.simplifiedTo}"`);
      } else if (result.status === 'missed') {
        console.log(`[Main] Hint missed: "${result.hint}"`);
      }
    },
    onSessionAnalysis: (analysis) => {
      console.log('[Main] Session Analysis:', analysis);
      console.log(`[Main] Hints: ${analysis.hintsUsed}/${analysis.totalHints} used (${analysis.successRate}%)`);
      console.log(`[Main] Recommended next difficulty: ${analysis.recommendedNextDifficulty}`);
      if (analysis.topMissedExpressions.length > 0) {
        console.log(`[Main] Top missed: ${analysis.topMissedExpressions.join(', ')}`);
      }
    },
    onAssistMetrics: updateAssistMetricsUI,
  }, preferredAudioSource, calibration, {
    cloudProcessingEnabled: privacySettings.allowCloudProcessing,
    transcriptOptions: {
      saveRawTranscript: privacySettings.saveTranscripts,
      retentionPolicy: privacySettings.transcriptRetention,
    },
  });

  session.setAssistMode(selectedAssistMode);

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
  if (hud) {
    hud.setCombatTopic(topicLabel);
  }
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
    endPracticeSession();
  }
}

async function stopSession(): Promise<void> {
  await endPracticeSession();
}

async function endPracticeSession(options: { returnToStandby?: boolean } = {}): Promise<void> {
  if (endingPracticePromise) {
    await endingPracticePromise;
    return;
  }

  endingPracticePromise = (async () => {
    const { returnToStandby = true } = options;

    try {
      if (session) {
        await session.stop();
      }
    } catch (err) {
      console.warn('[App] Error while ending practice session:', err);
    } finally {
      session = null;
    }

    toggleSessionUI(false);
    handleSessionState('idle'); // Force UI to standby

    // Return glasses to standby screen instead of blank
    hud?.setSessionActive(false);
    if (returnToStandby) {
      await hud?.enterStandby();
    }

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

    selectedAssistMode = 'manual';
    latestAssistMetrics = {
      manual_request_count: 0,
      auto_trigger_count: 0,
      cue_dismissed_count: 0,
      false_trigger_count: 0,
      cue_used_count: 0,
      auto_assist_paused: false,
    };
    updateAssistModeUI();
  })();

  try {
    await endingPracticePromise;
  } finally {
    endingPracticePromise = null;
  }
}

async function exitEcho(): Promise<void> {
  await endPracticeSession({ returnToStandby: false });
  await hud?.exitEcho();
  hud = null;
}

function toggleSessionUI(active: boolean): void {
  const btnStartGen = document.getElementById('btn-start-general') as HTMLButtonElement;
  const btnStartScen = document.getElementById('btn-start-scenario') as HTMLButtonElement;
  const modeSelector = document.getElementById('mode-selector-card');
  const btnCue = document.getElementById('btn-request-cue') as HTMLButtonElement;
  const btnStop = document.getElementById('btn-stop-session') as HTMLButtonElement;
  const btnPause = document.getElementById('btn-pause-session') as HTMLButtonElement;
  const statsCard = document.getElementById('live-stats-card');
  const historyCard = document.getElementById('hint-history-card');
  const sessionCard = document.getElementById('session-card');
  const assistPanel = document.getElementById('assist-mode-panel');
  const privacyCard = document.getElementById('privacy-settings-card');

  if (btnStartGen) btnStartGen.style.display = active ? 'none' : 'block';
  if (btnStartScen) btnStartScen.style.display = active ? 'none' : 'block';
  if (modeSelector) modeSelector.style.display = active ? 'none' : 'block';
  if (privacyCard) privacyCard.style.display = active ? 'none' : 'block';
  
  // Hide the specific practice areas when active to declutter
  if (active) {
    const genArea = document.getElementById('general-practice-area');
    const scenArea = document.getElementById('scenario-practice-area');
    if (genArea) genArea.style.display = 'none';
    if (scenArea) scenArea.style.display = 'none';
  }

  if (sessionCard) sessionCard.style.display = active ? 'block' : 'none';
  if (assistPanel) assistPanel.style.display = active ? 'block' : 'none';
  if (btnCue) btnCue.style.display = active ? 'flex' : 'none';
  if (btnStop) btnStop.style.display = active ? 'flex' : 'none';
  if (btnPause) {
    btnPause.style.display = active ? 'flex' : 'none';
    btnPause.textContent = 'Pause';
    btnPause.classList.remove('btn-highlight');
    btnPause.classList.add('btn-neutral');
  }
  if (statsCard) statsCard.style.display = active ? 'block' : 'none';
  if (historyCard) historyCard.style.display = active ? 'block' : 'none';
  updateAssistModeUI();
}

async function requestManualCue(): Promise<void> {
  if (!session) return;
  await session.requestManualCue();
  latestAssistMetrics = session.currentAssistMetrics;
  updateAssistModeUI();
}

function dismissCue(): void {
  if (!session) return;
  const dismissed = session.dismissActiveCue();
  if (!dismissed) return;

  currentActiveHint = null;
  hideChunkDisplay();
  latestAssistMetrics = session.currentAssistMetrics;
  updateAssistModeUI();
}

function hideChunkDisplay(): void {
  const chunkDisplay = document.getElementById('chunk-display');
  if (chunkDisplay) {
    chunkDisplay.style.display = 'none';
    chunkDisplay.innerHTML = '';
  }
}

function updateAssistMetricsUI(metrics: AssistMetrics): void {
  latestAssistMetrics = metrics;
  updateAssistModeUI();
}

function updateAssistModeUI(): void {
  document.querySelectorAll('.assist-mode-btn').forEach((btn) => {
    const button = btn as HTMLButtonElement;
    const active = button.dataset.assistMode === selectedAssistMode;
    button.classList.toggle('active', active);
    button.style.background = active ? 'var(--phase2)' : 'var(--color-surface)';
    button.style.color = active ? 'white' : 'var(--color-text-dim)';
  });

  const label = document.getElementById('assist-mode-label');
  if (label) {
    label.textContent =
      selectedAssistMode === 'auto'
        ? latestAssistMetrics.auto_assist_paused
          ? 'Assist: Auto paused'
          : 'Assist: Auto'
        : 'Assist: Manual';
    label.style.color =
      selectedAssistMode === 'auto' && !latestAssistMetrics.auto_assist_paused
        ? 'var(--phase2)'
        : 'var(--color-text-dim)';
  }

  const metricsLabel = document.getElementById('assist-metrics-label');
  if (metricsLabel) {
    metricsLabel.textContent =
      `Manual ${latestAssistMetrics.manual_request_count} · ` +
      `Auto ${latestAssistMetrics.auto_trigger_count} · ` +
      `Dismissed ${latestAssistMetrics.cue_dismissed_count} · ` +
      `Used ${latestAssistMetrics.cue_used_count}`;
  }
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
      calibrated: 'Ready',
      loading_vad: 'Preparing mic...',
      listening: 'Listening',
      silence_detected: 'Need a cue?',
      chunk_generating: 'Preparing cue...',
      hud_flash: 'Cue sent',
      paused: 'Paused',
      session_end: 'Ended',
    };
    status.textContent = labels[state] ?? state;
    status.className = state === 'listening' ? 'badge badge-positive' :
                       state === 'loading_vad' ? 'badge badge-accent' :
                       state === 'silence_detected' ? 'badge badge-accent' :
                       state === 'hud_flash' ? 'badge badge-accent' : 
                       state === 'paused' ? 'badge badge-neutral' : 'badge badge-neutral';
  }

  if (vadDot) {
    vadDot.className = `status-dot ${state === 'listening' ? 'listening' : state === 'idle' || state === 'session_end' ? 'idle' : 'listening'}`;
  }

  if (vadLabel) {
    vadLabel.textContent = state === 'listening'
                            ? 'Mic: Listening...'
                            : state === 'loading_vad' ? 'Mic: Preparing...'
                            : state === 'silence_detected' ? 'Need a cue?'
                            : state === 'chunk_generating' ? 'Preparing cue...'
                            : state === 'hud_flash' ? 'Cue displayed'
                            : 'Mic inactive';
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

async function handleChunkGenerated(result: ChunkResult): Promise<void> {
  const chunkDisplay = document.getElementById('chunk-display');
  if (chunkDisplay && result.chunk) {
    chunkDisplay.style.display = 'block';
    chunkDisplay.innerHTML = `<div class="chunk-flash">${result.chunk}</div>
      <div class="text-detail" style="text-align: center; color: var(--color-text-muted); margin-top: var(--spacing-same);">
        Cue ready in ${result.latencyMs}ms
      </div>`;
  }

  // HUD
  if (currentWeek === 3) {
    await hud?.showSpeedUp(result.chunk);
  } else {
    await hud?.flashChunk(result.chunk);
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
  hideChunkDisplay();

  // Flash the speaking indicator on the web UI
  const vadLabel = document.getElementById('vad-label');
  if (vadLabel) {
    vadLabel.textContent = 'Voice detected';
    vadLabel.style.color = 'var(--color-positive)';
    setTimeout(() => {
      if (vadLabel && session?.state === 'listening') {
        vadLabel.textContent = 'Mic: Listening...';
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
// Phase 3: Review
// ═══════════════════════════════════════════

// Phase 4: Ambient
// ═══════════════════════════════════════════

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
