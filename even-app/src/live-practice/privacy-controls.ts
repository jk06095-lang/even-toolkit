import { TranscriptStore } from '../combat/transcript-store';
import {
  loadPrivacySettings,
  savePrivacySettings,
  RETENTION_LABELS,
  type PrivacySettings,
  type TranscriptRetentionPolicy,
} from '../privacy/settings';

export type StatusTone = 'normal' | 'error' | 'success';

export interface PrivacyControlContext {
  getSettings: () => PrivacySettings;
  setSettings: (settings: PrivacySettings) => void;
}

export function bindPrivacyControls(context: PrivacyControlContext): void {
  context.setSettings(loadPrivacySettings());

  const mic = document.getElementById('privacy-use-microphone') as HTMLInputElement | null;
  const cloud = document.getElementById('privacy-cloud-processing') as HTMLInputElement | null;
  const save = document.getElementById('privacy-save-transcripts') as HTMLInputElement | null;
  const retention = document.getElementById('privacy-retention') as HTMLSelectElement | null;

  if (!mic || !cloud || !save || !retention) return;

  const settings = context.getSettings();
  mic.checked = settings.useMicrophone;
  cloud.checked = settings.allowCloudProcessing;
  save.checked = settings.saveTranscripts;
  retention.value = settings.transcriptRetention;
  retention.disabled = !save.checked;

  const persist = () => {
    const nextSettings = savePrivacySettings({
      ...context.getSettings(),
      useMicrophone: mic.checked,
      allowCloudProcessing: cloud.checked,
      saveTranscripts: save.checked,
      transcriptRetention: retention.value as TranscriptRetentionPolicy,
    });

    context.setSettings(nextSettings);
    retention.disabled = !nextSettings.saveTranscripts;
    if (!nextSettings.saveTranscripts) {
      TranscriptStore.clearSessionBuffer();
    }
    TranscriptStore.applyRetention(nextSettings.transcriptRetention);
    updatePrivacySettingsUI(nextSettings);
  };

  mic.addEventListener('change', persist);
  cloud.addEventListener('change', persist);
  save.addEventListener('change', persist);
  retention.addEventListener('change', persist);

  updatePrivacySettingsUI(settings);
}

export function updatePrivacySettingsUI(
  settings: PrivacySettings,
  message?: string,
  tone: StatusTone = 'normal',
): void {
  const badge = document.getElementById('privacy-settings-badge');
  const status = document.getElementById('privacy-settings-status');
  if (badge) {
    badge.textContent = settings.useMicrophone ? 'Ready' : 'Mic off';
    badge.className = settings.useMicrophone ? 'badge badge-positive' : 'badge badge-neutral';
  }
  if (status) {
    const retentionLabel = RETENTION_LABELS[settings.transcriptRetention];
    status.textContent = message ?? [
      settings.useMicrophone ? 'Microphone enabled' : 'Microphone disabled',
      settings.allowCloudProcessing ? 'cloud on' : 'cloud off',
      settings.saveTranscripts ? `saving on (${retentionLabel})` : 'saving off',
    ].join(' | ');
    status.style.color = tone === 'error'
      ? 'var(--color-negative)'
      : tone === 'success'
        ? 'var(--color-positive)'
        : 'var(--color-text-muted)';
  }
}
