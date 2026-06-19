import { AmbientScheduler, type PendingItem } from './scheduler';
import type { EchoDisplay } from './echo-display';
import type { HUDController } from '../hud/hud-controller';

export interface AmbientControllerContext {
  getHud: () => HUDController | null;
  getEchoDisplay: () => EchoDisplay | null;
  getScheduler: () => AmbientScheduler | null;
  setScheduler: (scheduler: AmbientScheduler | null) => void;
}

export function bindAmbientEvents(context: AmbientControllerContext): void {
  document.getElementById('btn-start-ambient')?.addEventListener('click', () => startAmbient(context));
  document.getElementById('btn-stop-ambient')?.addEventListener('click', () => stopAmbient(context));

  if (context.getScheduler()) {
    context.getScheduler()?.refresh();
  }
}

function startAmbient(context: AmbientControllerContext): void {
  const scheduler = new AmbientScheduler({
    onEchoPush: (chunk) => {
      context.getEchoDisplay()?.flash(chunk, 2000);
      console.log(`[Ambient Echo] ${chunk}`);
    },
    onScheduleUpdate: (pending) => {
      updatePendingList(pending);
    },
  });

  const echoDisplay = context.getEchoDisplay();
  const hud = context.getHud();
  if (echoDisplay && hud) {
    echoDisplay.setHUD(hud);
  }

  scheduler.start();
  context.setScheduler(scheduler);

  const btnStart = document.getElementById('btn-start-ambient');
  const btnStop = document.getElementById('btn-stop-ambient');
  const status = document.getElementById('ambient-status');
  if (btnStart) btnStart.style.display = 'none';
  if (btnStop) btnStop.style.display = 'block';
  if (status) {
    status.textContent = 'Echo reminders active';
    status.className = 'badge badge-positive';
  }
}

function stopAmbient(context: AmbientControllerContext): void {
  context.getScheduler()?.stop();
  context.setScheduler(null);

  const btnStart = document.getElementById('btn-start-ambient');
  const btnStop = document.getElementById('btn-stop-ambient');
  const status = document.getElementById('ambient-status');
  if (btnStart) btnStart.style.display = 'block';
  if (btnStop) btnStop.style.display = 'none';
  if (status) {
    status.textContent = 'Paused';
    status.className = 'badge badge-neutral';
  }
}

function updatePendingList(items: PendingItem[]): void {
  const container = document.getElementById('pending-list') as HTMLUListElement | null;
  const empty = document.getElementById('pending-empty');
  const count = document.getElementById('pending-count');
  if (!container) return;

  if (count) count.textContent = String(items.length);

  if (items.length === 0) {
    container.replaceChildren();
    container.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return;
  }

  container.style.display = 'block';
  if (empty) empty.style.display = 'none';

  container.replaceChildren(...items
    .slice(0, 10)
    .map((item) => {
      const mins = Math.ceil(item.timeUntilMs / 60000);
      const timeStr = mins > 60 ? `${Math.round(mins / 60)}h` : `${mins}m`;
      const listItem = document.createElement('li');
      listItem.className = 'schedule-item';

      const time = document.createElement('span');
      time.className = 'time';
      time.textContent = timeStr;

      const chunk = document.createElement('span');
      chunk.className = 'chunk';
      chunk.textContent = item.chunk;

      listItem.append(time, chunk);
      return listItem;
    }));
}
