import { AmbientScheduler, type PendingItem } from './scheduler';
import type { EchoDisplay } from './echo-display';
import type { HUDController } from '../hud/hud-controller';
import { TranscriptStore } from '../combat/transcript-store';
import {
  buildActiveRecallQueue,
  recordActiveRecallAttempt,
  type ActiveRecallGrade,
  type ActiveRecallQueueItem,
} from '../learning/active-recall';

export interface AmbientControllerContext {
  getHud: () => HUDController | null;
  getEchoDisplay: () => EchoDisplay | null;
  getScheduler: () => AmbientScheduler | null;
  setScheduler: (scheduler: AmbientScheduler | null) => void;
}

export function bindAmbientEvents(context: AmbientControllerContext): void {
  document.getElementById('btn-start-ambient')?.addEventListener('click', () => startAmbient(context));
  document.getElementById('btn-stop-ambient')?.addEventListener('click', () => stopAmbient(context));
  document.getElementById('btn-refresh-recall')?.addEventListener('click', () => renderActiveRecallPanel());
  document.getElementById('btn-recall-reveal')?.addEventListener('click', () => revealActiveRecallAnswer());
  document.querySelectorAll('[data-recall-grade]').forEach((button) => {
    button.addEventListener('click', () => {
      const grade = (button as HTMLElement).dataset.recallGrade;
      if (isActiveRecallGrade(grade)) {
        gradeActiveRecallItem(grade);
      }
    });
  });

  if (context.getScheduler()) {
    context.getScheduler()?.refresh();
  }

  renderActiveRecallPanel();
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

let currentRecallItem: ActiveRecallQueueItem | null = null;

function renderActiveRecallPanel(statusMessage = ''): void {
  const promptEl = document.getElementById('active-recall-prompt');
  const answerEl = document.getElementById('active-recall-answer');
  const answerTextEl = document.getElementById('active-recall-answer-text');
  const metaEl = document.getElementById('active-recall-meta');
  const emptyEl = document.getElementById('active-recall-empty');
  const attemptEl = document.getElementById('active-recall-attempt') as HTMLTextAreaElement | null;
  const revealButton = document.getElementById('btn-recall-reveal') as HTMLButtonElement | null;
  const gradeRow = document.getElementById('active-recall-grade-row');
  const dueCount = document.getElementById('active-recall-count');
  const statusEl = document.getElementById('active-recall-status');

  if (!promptEl || !answerEl || !answerTextEl || !metaEl || !attemptEl) return;

  const queue = buildActiveRecallQueue(TranscriptStore.loadAll());
  currentRecallItem = queue[0] ?? null;
  if (dueCount) dueCount.textContent = String(queue.length);
  if (statusEl) statusEl.textContent = statusMessage;
  answerEl.style.display = 'none';
  if (gradeRow) gradeRow.style.display = 'none';
  attemptEl.value = '';

  if (!currentRecallItem) {
    promptEl.textContent = '';
    answerTextEl.textContent = '';
    metaEl.textContent = '';
    attemptEl.disabled = true;
    if (revealButton) revealButton.disabled = true;
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }

  const item = currentRecallItem.learningItem;
  promptEl.textContent = currentRecallItem.prompt.prompt;
  answerTextEl.textContent = item.canonicalExpression;
  metaEl.textContent = [
    currentRecallItem.prompt.mode === 'transfer' ? 'Transfer check' : 'Active recall',
    item.speechAct,
    `reps ${currentRecallItem.state.reps}`,
    `lapses ${currentRecallItem.state.lapses}`,
  ].join(' | ');
  attemptEl.disabled = false;
  if (revealButton) revealButton.disabled = false;
  if (emptyEl) emptyEl.style.display = 'none';
}

function revealActiveRecallAnswer(): void {
  if (!currentRecallItem) return;
  const answerEl = document.getElementById('active-recall-answer');
  const gradeRow = document.getElementById('active-recall-grade-row');
  const statusEl = document.getElementById('active-recall-status');
  if (answerEl) answerEl.style.display = 'block';
  if (gradeRow) gradeRow.style.display = 'grid';
  if (statusEl) statusEl.textContent = 'Grade the attempt after producing it first.';
}

function gradeActiveRecallItem(grade: ActiveRecallGrade): void {
  if (!currentRecallItem) return;
  const attemptEl = document.getElementById('active-recall-attempt') as HTMLTextAreaElement | null;
  const attempt = recordActiveRecallAttempt(
    currentRecallItem.learningItem,
    grade,
    attemptEl?.value ?? '',
    {
      mode: currentRecallItem.prompt.mode,
    },
  );
  const next = new Date(attempt.dueAtAfter);
  renderActiveRecallPanel(`Saved ${grade}. Next review: ${formatDueTime(next)}.`);
}

function formatDueTime(date: Date): string {
  if (Number.isNaN(date.getTime())) return 'scheduled';
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function isActiveRecallGrade(value: string | undefined): value is ActiveRecallGrade {
  return value === 'again' || value === 'hard' || value === 'good' || value === 'easy';
}
