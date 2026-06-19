import { AmbientScheduler, type PendingItem } from './scheduler';
import type { EchoDisplay } from './echo-display';
import type { HUDController } from '../hud/hud-controller';
import { TranscriptStore } from '../combat/transcript-store';
import { loadPrivacySettings } from '../privacy/settings';
import {
  buildActiveRecallQueue,
  evaluateActiveRecallAttempt,
  recordActiveRecallAttempt,
  type ActiveRecallGrade,
  type ActiveRecallAttemptEvaluation,
  type ActiveRecallQueueItem,
} from '../learning/active-recall';
import {
  ActiveRecallSpeechCapture,
  type ActiveRecallSpeechStatus,
} from '../learning/active-recall-speech';
import { loadImportedLearningItemsForRecall } from '../debrief/json-parser';

export interface AmbientControllerContext {
  getHud: () => HUDController | null;
  getEchoDisplay: () => EchoDisplay | null;
  getScheduler: () => AmbientScheduler | null;
  setScheduler: (scheduler: AmbientScheduler | null) => void;
}

export function bindAmbientEvents(context: AmbientControllerContext): void {
  document.getElementById('btn-start-ambient')?.addEventListener('click', () => startAmbient(context));
  document.getElementById('btn-stop-ambient')?.addEventListener('click', () => stopAmbient(context));
  document.getElementById('btn-refresh-recall')?.addEventListener('click', () => {
    renderActiveRecallPanel();
    renderImportedReviewItems();
  });
  document.getElementById('btn-recall-reveal')?.addEventListener('click', () => revealActiveRecallAnswer());
  document.getElementById('btn-recall-speech-start')?.addEventListener('click', () => startActiveRecallSpeech());
  document.getElementById('btn-recall-speech-stop')?.addEventListener('click', () => stopActiveRecallSpeech());
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
  renderImportedReviewItems();
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
let recallSpeechCapture: ActiveRecallSpeechCapture | null = null;
let currentVoiceAttemptConfidence: number | undefined;

function renderActiveRecallPanel(statusMessage = ''): void {
  const promptEl = document.getElementById('active-recall-prompt');
  const answerEl = document.getElementById('active-recall-answer');
  const answerTextEl = document.getElementById('active-recall-answer-text');
  const evaluationEl = document.getElementById('active-recall-evaluation');
  const metaEl = document.getElementById('active-recall-meta');
  const emptyEl = document.getElementById('active-recall-empty');
  const attemptEl = document.getElementById('active-recall-attempt') as HTMLTextAreaElement | null;
  const revealButton = document.getElementById('btn-recall-reveal') as HTMLButtonElement | null;
  const gradeRow = document.getElementById('active-recall-grade-row');
  const dueCount = document.getElementById('active-recall-count');
  const statusEl = document.getElementById('active-recall-status');
  const speechStatusEl = document.getElementById('active-recall-speech-status');

  if (!promptEl || !answerEl || !answerTextEl || !metaEl || !attemptEl) return;

  const queue = buildActiveRecallQueue(TranscriptStore.loadAll());
  currentRecallItem = queue[0] ?? null;
  if (dueCount) dueCount.textContent = String(queue.length);
  if (statusEl) statusEl.textContent = statusMessage;
  if (speechStatusEl) speechStatusEl.textContent = '';
  currentVoiceAttemptConfidence = undefined;
  answerEl.style.display = 'none';
  if (evaluationEl) evaluationEl.textContent = '';
  if (gradeRow) gradeRow.style.display = 'none';
  attemptEl.value = '';

  if (!currentRecallItem) {
    promptEl.textContent = '';
    answerTextEl.textContent = '';
    metaEl.textContent = '';
    attemptEl.disabled = true;
    if (revealButton) revealButton.disabled = true;
    setSpeechButtons(false);
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
  setSpeechButtons(false, true);
  if (emptyEl) emptyEl.style.display = 'none';
}

function renderImportedReviewItems(): void {
  const listEl = document.getElementById('imported-review-list');
  const emptyEl = document.getElementById('imported-review-empty');
  const countEl = document.getElementById('imported-review-count');
  if (!listEl) return;

  const items = loadImportedLearningItemsForRecall();
  if (countEl) countEl.textContent = String(items.length);

  if (items.length === 0) {
    listEl.replaceChildren();
    listEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  listEl.style.display = 'block';
  listEl.replaceChildren(...items.slice(0, 10).map((item) => {
    const listItem = document.createElement('li');
    listItem.className = 'schedule-item';

    const due = document.createElement('span');
    due.className = 'time';
    due.textContent = formatDueTime(new Date(item.scheduling.dueAt));

    const summary = document.createElement('span');
    summary.className = 'chunk';
    summary.textContent = [
      item.meaningKo,
      item.speechAct,
      item.scenarioTags[0] ?? 'review',
    ].join(' | ');

    listItem.append(due, summary);
    return listItem;
  }));
}

function startActiveRecallSpeech(): void {
  if (!currentRecallItem) return;
  const settings = loadPrivacySettings();
  if (!settings.useMicrophone) {
    setSpeechStatus('Enable microphone in Live Practice privacy settings before voice recall.');
    return;
  }
  if (!settings.allowCloudProcessing) {
    setSpeechStatus('Enable cloud processing before Web Speech voice recall.');
    return;
  }

  stopActiveRecallSpeech();
  const attemptEl = document.getElementById('active-recall-attempt') as HTMLTextAreaElement | null;
  recallSpeechCapture = new ActiveRecallSpeechCapture({
    onInterim: (text) => {
      setSpeechStatus(`Listening: ${text}`);
    },
    onFinal: (text, confidence) => {
      if (attemptEl) {
        attemptEl.value = mergeAttemptText(attemptEl.value, text);
      }
      currentVoiceAttemptConfidence = combineConfidence(currentVoiceAttemptConfidence, confidence);
      setSpeechStatus(
        currentVoiceAttemptConfidence === undefined
          ? 'Voice attempt captured.'
          : `Voice attempt captured. Confidence ${Math.round(currentVoiceAttemptConfidence * 100)}%.`,
      );
    },
    onStatus: (status) => {
      setSpeechButtons(status === 'listening', Boolean(currentRecallItem));
      if (status !== 'idle' && status !== 'listening') {
        setSpeechStatus(statusMessageForSpeechStatus(status));
      }
    },
    onError: (message) => {
      setSpeechStatus(`Voice capture failed: ${message}`);
    },
  });

  const result = recallSpeechCapture.start();
  if (!result.ok) {
    setSpeechStatus(statusMessageForSpeechStartReason(result.reason));
    recallSpeechCapture = null;
    setSpeechButtons(false, Boolean(currentRecallItem));
  }
}

function stopActiveRecallSpeech(): void {
  recallSpeechCapture?.stop();
  recallSpeechCapture = null;
  setSpeechButtons(false, Boolean(currentRecallItem));
}

function revealActiveRecallAnswer(): void {
  if (!currentRecallItem) return;
  const answerEl = document.getElementById('active-recall-answer');
  const evaluationEl = document.getElementById('active-recall-evaluation');
  const gradeRow = document.getElementById('active-recall-grade-row');
  const statusEl = document.getElementById('active-recall-status');
  const attemptEl = document.getElementById('active-recall-attempt') as HTMLTextAreaElement | null;
  if (answerEl) answerEl.style.display = 'block';
  if (gradeRow) gradeRow.style.display = 'grid';
  const evaluation = evaluateActiveRecallAttempt(currentRecallItem.learningItem, attemptEl?.value ?? '', {
    pronunciationConfidence: currentVoiceAttemptConfidence,
  });
  if (evaluationEl) evaluationEl.textContent = formatEvaluation(evaluation);
  if (statusEl) statusEl.textContent = `Suggested grade: ${evaluation.recommendedGrade}. Choose the grade you want to save.`;
}

function gradeActiveRecallItem(grade: ActiveRecallGrade): void {
  if (!currentRecallItem) return;
  stopActiveRecallSpeech();
  const attemptEl = document.getElementById('active-recall-attempt') as HTMLTextAreaElement | null;
  const attempt = recordActiveRecallAttempt(
    currentRecallItem.learningItem,
    grade,
    attemptEl?.value ?? '',
    {
      mode: currentRecallItem.prompt.mode,
      pronunciationConfidence: currentVoiceAttemptConfidence,
    },
  );
  const next = new Date(attempt.dueAtAfter);
  const suggestion = attempt.evaluation?.recommendedGrade;
  const suffix = suggestion && suggestion !== grade ? ` Suggested was ${suggestion}.` : '';
  renderActiveRecallPanel(`Saved ${grade}. Next review: ${formatDueTime(next)}.${suffix}`);
}

function formatDueTime(date: Date): string {
  if (Number.isNaN(date.getTime())) return 'scheduled';
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function isActiveRecallGrade(value: string | undefined): value is ActiveRecallGrade {
  return value === 'again' || value === 'hard' || value === 'good' || value === 'easy';
}

function setSpeechStatus(message: string): void {
  const statusEl = document.getElementById('active-recall-speech-status');
  if (statusEl) statusEl.textContent = message;
}

function setSpeechButtons(listening: boolean, enabled = true): void {
  const start = document.getElementById('btn-recall-speech-start') as HTMLButtonElement | null;
  const stop = document.getElementById('btn-recall-speech-stop') as HTMLButtonElement | null;
  if (start) {
    start.disabled = !enabled || listening;
  }
  if (stop) {
    stop.disabled = !enabled || !listening;
  }
}

function mergeAttemptText(existing: string, next: string): string {
  const trimmedExisting = existing.trim();
  const trimmedNext = next.trim();
  if (!trimmedNext) return trimmedExisting;
  if (!trimmedExisting) return trimmedNext;
  if (trimmedExisting.toLowerCase().includes(trimmedNext.toLowerCase())) return trimmedExisting;
  return `${trimmedExisting} ${trimmedNext}`;
}

function combineConfidence(existing: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return existing;
  if (existing === undefined) return next;
  return Math.round(((existing + next) / 2) * 1000) / 1000;
}

function statusMessageForSpeechStatus(status: ActiveRecallSpeechStatus): string {
  if (status === 'unsupported') return 'Voice recall is not supported in this browser.';
  if (status === 'secure_origin_required') return 'Voice recall needs HTTPS or localhost.';
  if (status === 'error') return 'Voice recall stopped after an error.';
  return '';
}

function statusMessageForSpeechStartReason(reason: string | undefined): string {
  if (reason === 'secure_origin_required') return 'Voice recall needs HTTPS or localhost.';
  if (reason === 'not_supported') return 'Voice recall is not supported in this browser.';
  if (reason === 'start_failed') return 'Voice recall could not start.';
  return 'Voice recall is already active.';
}

function formatEvaluation(evaluation: ActiveRecallAttemptEvaluation): string {
  const percent = Math.round(evaluation.semanticScore * 100);
  const pronunciation = evaluation.pronunciationScore !== undefined
    ? ` Voice confidence ${Math.round(evaluation.pronunciationScore * 100)}%.`
    : '';
  const missing = evaluation.missingKeywords.length > 0
    ? ` Missing: ${evaluation.missingKeywords.join(', ')}.`
    : '';
  return `${evaluation.note} Score ${percent}%.${pronunciation} Recommended: ${evaluation.recommendedGrade}.${missing}`;
}
