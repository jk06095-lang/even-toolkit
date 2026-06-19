export type TranscriptRetentionPolicy = 'immediate' | '1d' | '7d' | 'until_deleted';

export interface PrivacySettings {
  useMicrophone: boolean;
  allowCloudProcessing: boolean;
  saveTranscripts: boolean;
  transcriptRetention: TranscriptRetentionPolicy;
  updatedAt: number;
}

export const PRIVACY_SETTINGS_KEY = 'echo_privacy_settings_v1';

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  useMicrophone: false,
  allowCloudProcessing: false,
  saveTranscripts: false,
  transcriptRetention: 'immediate',
  updatedAt: 0,
};

export const RETENTION_LABELS: Record<TranscriptRetentionPolicy, string> = {
  immediate: 'Delete after session',
  '1d': 'Keep for 1 day',
  '7d': 'Keep for 7 days',
  until_deleted: 'Keep until I delete',
};

export function normalizePrivacySettings(input: unknown, now = Date.now()): PrivacySettings {
  if (!input || typeof input !== 'object') {
    return { ...DEFAULT_PRIVACY_SETTINGS };
  }

  const record = input as Record<string, unknown>;
  const retention = normalizeRetention(record.transcriptRetention);
  const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
    ? record.updatedAt
    : now;

  return {
    useMicrophone: record.useMicrophone === true,
    allowCloudProcessing: record.allowCloudProcessing === true,
    saveTranscripts: record.saveTranscripts === true,
    transcriptRetention: retention,
    updatedAt,
  };
}

export function loadPrivacySettings(): PrivacySettings {
  try {
    const raw = localStorage.getItem(PRIVACY_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_PRIVACY_SETTINGS };
    return normalizePrivacySettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PRIVACY_SETTINGS };
  }
}

export function savePrivacySettings(settings: PrivacySettings): PrivacySettings {
  const normalized = normalizePrivacySettings({
    ...settings,
    updatedAt: Date.now(),
  });
  try {
    localStorage.setItem(PRIVACY_SETTINGS_KEY, JSON.stringify(normalized));
  } catch {
    // Settings are best-effort in localStorage; callers still receive normalized state.
  }
  return normalized;
}

export function retentionCutoffMs(policy: TranscriptRetentionPolicy, now = Date.now()): number | null {
  if (policy === 'until_deleted' || policy === 'immediate') return null;
  const days = policy === '1d' ? 1 : 7;
  return now - days * 24 * 60 * 60 * 1000;
}

export function isPersistentTranscriptRetention(policy: TranscriptRetentionPolicy): boolean {
  return policy !== 'immediate';
}

function normalizeRetention(input: unknown): TranscriptRetentionPolicy {
  if (input === 'immediate' || input === '1d' || input === '7d' || input === 'until_deleted') {
    return input;
  }
  return DEFAULT_PRIVACY_SETTINGS.transcriptRetention;
}
