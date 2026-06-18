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

import { loadCalibration, type CalibrationResult } from './dsp/calibration';
import type { AmbientScheduler } from './ambient/scheduler';
import type { EchoDisplay } from './ambient/echo-display';
import type { HUDController } from './hud/hud-controller';
import { initHudLifecycle } from './hud/hud-lifecycle';
import { bindCalibrationEvents } from './calibration/calibration-controller';
import { bindDebriefEvents } from './debrief/debrief-controller';
import { bindAmbientEvents } from './ambient/ambient-controller';
import {
  bindLivePracticeEvents,
  dismissLivePracticeCue,
  endLivePracticeSession,
  exitLivePracticeEcho,
  isLivePracticeActive,
  requestLivePracticeCue,
  resumeLivePracticeSession,
} from './live-practice/live-practice-controller';

// ── Global State ──

let currentPhase = 2; // Start on Live Practice
let calibration: CalibrationResult | null = null;
let hud: HUDController | null = null;
let ambientScheduler: AmbientScheduler | null = null;
let echoDisplay: EchoDisplay | null = null;

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

  initHudLifecycle({
    getHud: () => hud,
    setHud: (nextHud) => {
      hud = nextHud;
    },
    getEchoDisplay: () => echoDisplay,
    setEchoDisplay: (nextEchoDisplay) => {
      echoDisplay = nextEchoDisplay;
    },
    onRequestCue: requestLivePracticeCue,
    onDismissCue: dismissLivePracticeCue,
    onEndPractice: endLivePracticeSession,
    onExitEcho: exitLivePracticeEcho,
    onResumePractice: resumeLivePracticeSession,
  });

  // Load calibration
  calibration = loadCalibration();

  // Show initial phase
  switchPhase(currentPhase);
}

// ── Phase Switching ──

function switchPhase(phase: number): void {
  // If a live practice session is active, ask for confirmation before leaving
  if (phase !== currentPhase && isLivePracticeActive()) {
    const confirmLeave = window.confirm('A Live Practice session is currently active. Leave and end this practice?');
    if (!confirmLeave) return;

    endLivePracticeSession();
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
      bindCalibrationEvents({
        getCalibration: () => calibration,
        setCalibration: (nextCalibration) => {
          calibration = nextCalibration;
        },
        getHud: () => hud,
      });
      break;
    case 2:
      content.innerHTML = renderCombatView();
      bindLivePracticeEvents({
        getHud: () => hud,
        setHud: (nextHud) => {
          hud = nextHud;
        },
        getCalibration: () => calibration,
      });
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

// Phase 1 lives in calibration/calibration-controller.ts.
// Phase 2 lives in live-practice/live-practice-controller.ts.

// ── Bootstrap ──

document.addEventListener('DOMContentLoaded', renderApp);
