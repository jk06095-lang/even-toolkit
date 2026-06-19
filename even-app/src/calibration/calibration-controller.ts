import { defaultCalibration, runCalibration, type CalibrationResult } from '../dsp/calibration';
import type { HUDController } from '../hud/hud-controller';

export interface CalibrationControllerContext {
  getCalibration: () => CalibrationResult | null;
  setCalibration: (calibration: CalibrationResult) => void;
  getHud: () => HUDController | null;
}

export function bindCalibrationEvents(context: CalibrationControllerContext): void {
  const btnCalibrate = document.getElementById('btn-calibrate') as HTMLButtonElement;
  const btnSkip = document.getElementById('btn-skip-cal') as HTMLButtonElement;
  const calibration = context.getCalibration();

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

    const calSW = document.getElementById('cal-soundwave');
    if (calSW) {
      calSW.style.display = 'flex';
      calSW.classList.add('idle');
      calSW.classList.remove('active');
    }

    const hud = context.getHud();
    hud?.showCalibration('Voice Sampling', 'Say: "Test, one two three"');

    try {
      const nextCalibration = await runCalibration((pct) => {
        progressBar.style.width = `${Math.round(pct * 100)}%`;
      }, hud ?? undefined, driveCalibrationSoundwave);

      context.setCalibration(nextCalibration);
      showCalibrationResult(nextCalibration);
      status.textContent = 'Done';

      if (calSW) {
        calSW.style.display = 'none';
      }

      hud?.showCalibration(
        'Calibration Complete',
        `F0: ${nextCalibration.pitch.f0}Hz | ${nextCalibration.filter.persona}`,
      );
    } catch (err) {
      status.textContent = 'Error';
      status.className = 'badge badge-negative';
      console.error('Calibration failed:', err);
      if (calSW) calSW.style.display = 'none';
    }

    btnCalibrate.disabled = false;
    btnCalibrate.textContent = 'Re-Calibrate';
  });

  btnSkip?.addEventListener('click', () => {
    const nextCalibration = defaultCalibration();
    context.setCalibration(nextCalibration);
    showCalibrationResult(nextCalibration);
  });
}

function driveCalibrationSoundwave(volume: number): void {
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
    swStatus.textContent = volume > 0.1 ? 'Voice detected' : 'Waiting for voice input...';
  }
}

function showCalibrationResult(cal: CalibrationResult): void {
  const result = document.getElementById('cal-result');
  if (!result) return;
  result.style.display = 'block';

  setElText('cal-freq', String(cal.pitch.f0));
  setElText('cal-f0', `${cal.pitch.f0}Hz`);
  setElText('cal-range', cal.pitch.range.toUpperCase());
  setElText('cal-persona', cal.filter.persona);
  setElText('cal-filter', `${cal.filter.filterType} @ ${cal.filter.cutoffHz}Hz`);
  setElText('cal-vad-threshold', cal.speechThreshold.toFixed(4));
  setElText('cal-noise-floor', cal.noiseFloorRms.toFixed(4));

  const ring = document.getElementById('cal-ring');
  if (ring) {
    ring.style.borderColor = 'var(--phase1)';
  }
}

function setElText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
