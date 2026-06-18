import { EchoDisplay } from '../ambient/echo-display';
import { HUDController, parseWearingState } from './hud-controller';

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
    badge.innerHTML = `<span class="status-dot idle" id="g2-dot"></span><span id="g2-badge-text">G2 Glasses: Connecting...</span>`;
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
      const wearStr = {
        wearing: ' (● Wearing)',
        'not-wearing': ' (○ Not wearing)',
        unavailable: ' (— Wear status unavailable)',
      }[wearingState];
      const battStr = status.batteryLevel !== undefined ? ` [${status.batteryLevel}%]` : '';
      badge.innerHTML = `<span class="status-dot listening"></span> G2 Glasses: Connected${wearStr}${battStr}`;

      if (!context.getEchoDisplay() && currentHud) {
        const echoDisplay = new EchoDisplay();
        echoDisplay.setHUD(currentHud);
        context.setEchoDisplay(echoDisplay);
      }

      currentHud?.enterStandby();
    } else {
      badge.innerHTML = `<span class="status-dot idle"></span> G2 Glasses: ${status.connectType.toUpperCase()} (Retry)`;
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
