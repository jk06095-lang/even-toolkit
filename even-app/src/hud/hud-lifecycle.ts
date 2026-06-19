import { EchoDisplay } from '../ambient/echo-display';
import {
  HUDController,
  formatWearingStatePhoneLabel,
  parseWearingState,
  type WearingState,
} from './hud-controller';

export interface HudLifecycleContext {
  getHud: () => HUDController | null;
  setHud: (hud: HUDController | null) => void;
  getEchoDisplay: () => EchoDisplay | null;
  setEchoDisplay: (echoDisplay: EchoDisplay | null) => void;
  onRequestCue: () => Promise<void>;
  onDismissCue: () => void;
  onEndPractice: () => Promise<void>;
  onExitEcho: () => Promise<void>;
  onResumePractice: () => Promise<void>;
}

export async function initHudLifecycle(context: HudLifecycleContext): Promise<void> {
  const badge = document.getElementById('g2-badge');

  if (badge) {
    renderG2Badge(badge, 'idle', 'G2 Glasses: Connecting...');
    badge.style.cursor = 'wait';
  }

  let hud = context.getHud();
  if (!hud) {
    hud = new HUDController();
    context.setHud(hud);

    hud.onAction(async (action) => {
      console.log('[App] Action from HUD:', action);
      if (action === 'request-cue') {
        await context.onRequestCue();
      } else if (action === 'dismiss-cue') {
        context.onDismissCue();
      } else if (action === 'end-practice') {
        await context.onEndPractice();
      } else if (action === 'exit-echo') {
        await context.onExitEcho();
      } else if (action === 'resume') {
        await context.onResumePractice();
      }
    });
  }

  hud.onStatusChanged((status) => {
    if (!badge) return;

    const currentHud = context.getHud();
    const isConnected = status.connectType !== undefined
      ? (status.connectType === 'connected' || status.connectType === 1)
      : (currentHud?.connected ?? false);
    badge.classList.toggle('connected', isConnected);

    if (isConnected) {
      const wearingState = parseWearingState(status);
      const battStr = status.batteryLevel !== undefined ? ` [${status.batteryLevel}%]` : '';
      renderG2Badge(badge, 'listening', `G2 Glasses: Connected${wearStatusLabel(wearingState)}${battStr}`);
      badge.onclick = null;
      badge.style.cursor = '';

      if (!context.getEchoDisplay() && currentHud) {
        const echoDisplay = new EchoDisplay();
        echoDisplay.setHUD(currentHud);
        context.setEchoDisplay(echoDisplay);
      }

      currentHud?.enterStandby();
    } else {
      renderG2Badge(badge, 'idle', `G2 Glasses: ${formatConnectType(status.connectType)} (Retry)`);
      badge.style.cursor = 'pointer';
      badge.onclick = () => {
        badge.onclick = null;
        initHudLifecycle(context);
      };
    }
  });

  try {
    await hud.init();
  } catch (err) {
    console.warn('[App] Bridge initialization failed:', err);
  }
}

function renderG2Badge(badge: HTMLElement, dotState: 'idle' | 'listening', text: string): void {
  const dot = document.createElement('span');
  dot.className = `status-dot ${dotState}`;
  dot.id = 'g2-dot';

  const label = document.createElement('span');
  label.id = 'g2-badge-text';
  label.textContent = text;

  badge.replaceChildren(dot, label);
}

function wearStatusLabel(state: WearingState): string {
  return ` (${formatWearingStatePhoneLabel(state)})`;
}

function formatConnectType(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Unavailable';
  return String(value).replace(/\s+/g, ' ').trim().toUpperCase();
}
