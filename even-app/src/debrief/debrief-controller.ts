import { TranscriptStore } from '../combat/transcript-store';
import { downloadExportJSON } from '../combat/transcript-export';
import { loadPrivacySettings } from '../privacy/settings';
import { importDebrief, type StoredDebrief } from './json-parser';
import type { HUDController } from '../hud/hud-controller';

export interface DebriefControllerContext {
  getHud: () => HUDController | null;
}

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
    list.innerHTML = stored.report.bottleneck_chunks
      .map((c) => `<li>${c.target} <span style="color: var(--color-text-muted)">| intervals: ${c.interval.join(', ')}min</span></li>`)
      .join('');
  }
}

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
    .reverse()
    .map((s) => {
      const date = new Date(s.startTime);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      const durationSec = s.endTime ? Math.round((s.endTime - s.startTime) / 1000) : 0;
      const durationStr = durationSec > 60 ? `${Math.floor(durationSec / 60)}m${durationSec % 60}s` : `${durationSec}s`;
      return `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px; margin-bottom: 6px; background: var(--color-surface-light); border-radius: var(--radius); border-left: 3px solid var(--phase2);">
          <div style="flex: 1; min-width: 0;">
            <div class="text-normal-body" style="color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">W${s.week} · ${s.topic}</div>
            <div class="text-detail" style="color: var(--color-text-muted);">${dateStr} · ${durationStr} · turns ${s.speechCount} · cues ${s.hintCount}</div>
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="btn" style="padding: 4px 12px; font-size: 12px; min-width: auto;" data-export-session="${s.sessionId}">Export</button>
            <button class="btn btn-neutral" style="padding: 4px 12px; font-size: 12px; min-width: auto;" data-delete-session="${s.sessionId}">Delete</button>
          </div>
        </div>
      `;
    })
    .join('');

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
