import { TranscriptStore } from '../combat/transcript-store';
import { downloadExportJSON } from '../combat/transcript-export';
import { buildConversationTimelineRows } from '../combat/conversation-timeline';
import { loadPrivacySettings } from '../privacy/settings';
import { importDebrief, type StoredDebrief } from './json-parser';
import type { HUDController } from '../hud/hud-controller';
import type { SpeakerRole } from '@toolkit/echo-domain-v2';

export interface DebriefControllerContext {
  getHud: () => HUDController | null;
}

type SessionSummary = ReturnType<typeof TranscriptStore.getSummaries>[number];

export function bindDebriefEvents(context: DebriefControllerContext): void {
  document.getElementById('btn-import-debrief')?.addEventListener('click', async () => {
    const input = document.getElementById('debrief-input') as HTMLTextAreaElement;
    const errorEl = document.getElementById('debrief-error')!;
    errorEl.style.display = 'none';

    try {
      const stored = await importDebrief(input.value);
      showDebriefResult(stored);
      context.getHud()?.showDebrief(`Imported ${stored.report.bottleneck_chunks.length} review phrases`);
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Invalid JSON';
      errorEl.style.display = 'block';
    }
  });

  renderSessionExportList();

  document.getElementById('btn-export-my-data')?.addEventListener('click', () => {
    downloadMyDataExport();
    setSessionExportStatus('My data export downloaded.', 'success');
  });

  document.getElementById('btn-delete-current-session')?.addEventListener('click', () => {
    const deletedSessionId = TranscriptStore.deleteLatestSession();
    renderSessionExportList();
    setSessionExportStatus(
      deletedSessionId ? `Deleted current session ${deletedSessionId}.` : 'No saved session to delete.',
      deletedSessionId ? 'success' : 'normal',
    );
  });

  document.getElementById('btn-delete-all-transcripts')?.addEventListener('click', () => {
    const confirmed = window.confirm('Delete all saved raw transcripts from this device?');
    if (!confirmed) return;
    const count = TranscriptStore.deleteAllTranscripts();
    renderSessionExportList();
    setSessionExportStatus(`Deleted ${count} saved transcript${count === 1 ? '' : 's'}.`, 'success');
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
    list.replaceChildren(...stored.report.bottleneck_chunks.map((chunk) => {
      const item = document.createElement('li');
      const meta = document.createElement('span');
      meta.style.color = 'var(--color-text-muted)';
      meta.textContent = `| intervals: ${chunk.interval.join(', ')}min`;
      item.append(document.createTextNode(`${chunk.target} `), meta);
      return item;
    }));
  }
}

function renderSessionExportList(): void {
  const listEl = document.getElementById('session-export-list');
  const emptyEl = document.getElementById('session-export-empty');
  if (!listEl) return;

  const summaries = TranscriptStore.getSummaries();

  if (summaries.length === 0) {
    listEl.replaceChildren();
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  listEl.replaceChildren(...summaries
    .slice()
    .reverse()
    .map((summary) => createSessionSummaryItem(summary)));

  listEl.querySelectorAll('[data-export-session]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sessionId = (btn as HTMLElement).dataset.exportSession;
      if (!sessionId) return;

      setSessionExportStatus('Preparing review JSON...');

      try {
        const sessionData = TranscriptStore.getById(sessionId);
        if (!sessionData) throw new Error('Saved session not found');

        await downloadExportJSON(sessionData, {
          allowCloudProcessing: loadPrivacySettings().allowCloudProcessing,
        });

        setSessionExportStatus('Export downloaded successfully.', 'success');
      } catch (err) {
        console.error('[Export] Failed:', err);
        setSessionExportStatus(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
      }
    });
  });

  listEl.querySelectorAll('[data-delete-session]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sessionId = (btn as HTMLElement).dataset.deleteSession;
      if (!sessionId) return;
      TranscriptStore.deleteSession(sessionId);
      renderSessionExportList();
      setSessionExportStatus(`Deleted session ${sessionId}.`, 'success');
    });
  });

  listEl.querySelectorAll('[data-speaker-turn]').forEach((select) => {
    select.addEventListener('change', () => {
      const element = select as HTMLSelectElement;
      const sessionId = element.dataset.speakerSession;
      const turnId = element.dataset.speakerTurn;
      const speaker = element.value as SpeakerRole;
      if (!sessionId || !turnId || !isSpeakerRole(speaker)) return;

      const updated = TranscriptStore.updateConversationTurn(sessionId, turnId, {
        speaker,
        correctedByUser: true,
      });

      if (updated) {
        renderSessionExportList();
        setSessionExportStatus(`Updated speaker for turn ${turnId}.`, 'success');
      } else {
        setSessionExportStatus('Speaker update failed.', 'error');
      }
    });
  });
}

function createSessionSummaryItem(summary: SessionSummary): HTMLElement {
  const date = new Date(summary.startTime);
  const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  const durationSec = summary.endTime ? Math.round((summary.endTime - summary.startTime) / 1000) : 0;
  const durationStr = durationSec > 60 ? `${Math.floor(durationSec / 60)}m${durationSec % 60}s` : `${durationSec}s`;

  const item = document.createElement('div');
  item.style.display = 'flex';
  item.style.alignItems = 'center';
  item.style.justifyContent = 'space-between';
  item.style.padding = '10px';
  item.style.marginBottom = '6px';
  item.style.background = 'var(--color-surface-light)';
  item.style.borderRadius = 'var(--radius)';
  item.style.borderLeft = '3px solid var(--phase2)';

  const content = document.createElement('div');
  content.style.flex = '1';
  content.style.minWidth = '0';

  const title = document.createElement('div');
  title.className = 'text-normal-body';
  title.style.color = 'var(--color-text)';
  title.style.whiteSpace = 'nowrap';
  title.style.overflow = 'hidden';
  title.style.textOverflow = 'ellipsis';
  title.textContent = `W${summary.week} - ${summary.topic}`;

  const detail = document.createElement('div');
  detail.className = 'text-detail';
  detail.style.color = 'var(--color-text-muted)';
  detail.textContent = `${dateStr} - ${durationStr} - turns ${summary.speechCount} - cues ${summary.hintCount}`;

  content.append(title, detail);

  const session = TranscriptStore.getById(summary.sessionId);
  if (session) {
    const timeline = createConversationTimeline(summary.sessionId, session);
    if (timeline) {
      content.append(timeline);
    }
  }

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '6px';

  const exportButton = document.createElement('button');
  exportButton.className = 'btn';
  exportButton.style.padding = '4px 12px';
  exportButton.style.fontSize = '12px';
  exportButton.style.minWidth = 'auto';
  exportButton.dataset.exportSession = summary.sessionId;
  exportButton.textContent = 'Export';

  const deleteButton = document.createElement('button');
  deleteButton.className = 'btn btn-neutral';
  deleteButton.style.padding = '4px 12px';
  deleteButton.style.fontSize = '12px';
  deleteButton.style.minWidth = 'auto';
  deleteButton.dataset.deleteSession = summary.sessionId;
  deleteButton.textContent = 'Delete';

  actions.append(exportButton, deleteButton);
  item.append(content, actions);
  return item;
}

function createConversationTimeline(sessionId: string, session: NonNullable<ReturnType<typeof TranscriptStore.getById>>): HTMLElement | null {
  const rows = buildConversationTimelineRows(session, 6);
  if (rows.length === 0) return null;

  const timeline = document.createElement('div');
  timeline.className = 'conversation-timeline';

  rows.forEach((row) => {
    const item = document.createElement('div');
    item.className = `conversation-turn conversation-turn-${row.speaker}`;

    const header = document.createElement('div');
    header.className = 'conversation-turn-header';

    const select = document.createElement('select');
    select.className = 'conversation-speaker-select';
    select.dataset.speakerSession = sessionId;
    select.dataset.speakerTurn = row.turnId;
    for (const [value, label] of [
      ['learner', 'Me'],
      ['partner', 'Partner'],
      ['unknown', 'Unknown'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = row.speaker === value;
      select.append(option);
    }

    const meta = document.createElement('span');
    meta.className = 'conversation-turn-meta';
    meta.textContent = [
      row.timeLabel,
      row.sourceLabel,
      row.confidenceLabel,
      row.correctedByUser ? 'corrected' : '',
    ].filter(Boolean).join(' | ');

    header.append(select, meta);

    const transcript = document.createElement('div');
    transcript.className = 'conversation-turn-text';
    transcript.textContent = row.transcript;

    item.append(header, transcript);

    if (row.translationKo) {
      const translation = document.createElement('div');
      translation.className = 'conversation-turn-translation';
      translation.textContent = row.translationKo;
      item.append(translation);
    }

    timeline.append(item);
  });

  return timeline;
}

function setSessionExportStatus(
  message: string,
  tone: 'normal' | 'success' | 'error' = 'normal',
): void {
  const statusEl = document.getElementById('session-export-status');
  if (!statusEl) return;
  statusEl.style.display = 'block';
  statusEl.textContent = message;
  statusEl.style.background = tone === 'error'
    ? 'var(--color-negative-alpha, rgba(239,68,68,0.1))'
    : tone === 'success'
      ? 'var(--color-positive-alpha)'
      : 'var(--color-accent-alpha)';
  statusEl.style.color = tone === 'error'
    ? 'var(--color-negative)'
    : tone === 'success'
      ? 'var(--color-positive)'
      : 'var(--color-accent)';
}

function downloadMyDataExport(): void {
  const exportData = TranscriptStore.exportUserData();
  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `echo_my_data_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function setElText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function isSpeakerRole(value: string): value is SpeakerRole {
  return value === 'learner' || value === 'partner' || value === 'unknown';
}
