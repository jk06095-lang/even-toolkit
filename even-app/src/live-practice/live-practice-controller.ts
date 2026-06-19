import type { CalibrationResult } from '../dsp/calibration';
import { SessionEngine, WEEK_CONFIGS, type AssistMetrics, type AssistMode, type SessionState } from '../combat/session-engine';
import type { ChunkResult } from '../combat/chunk-generator';
import type { ChunkCategory } from '../combat/fallback-chunks';
import { buildConversationTimelineRows, type ConversationTimelineRow } from '../combat/conversation-timeline';
import type { SessionTranscript } from '../combat/transcript-store';
import { getScenarioById, getCategories, toLegacyCategory, type TopicScenario, type TopicCategory } from '../combat/topic-registry';
import { createTopicSelectorElement, fillScenarioGrid, fillTopicDetail } from '../ui/topic-selector-view';
import type { HUDController } from '../hud/hud-controller';
import type { SpeakerRole } from '@toolkit/echo-domain-v2';
import { bindPrivacyControls, updatePrivacySettingsUI } from './privacy-controls';
import {
  loadPrivacySettings,
  type PrivacySettings,
} from '../privacy/settings';

export interface LivePracticeControllerContext {
  getHud: () => HUDController | null;
  setHud: (hud: HUDController | null) => void;
  getCalibration: () => CalibrationResult | null;
}

export type LivePracticeAudioSource = 'bridge' | 'browser';

const PREFERRED_AUDIO_SOURCE_KEY = 'preferredAudioSource';
export const G2_MIC_FALLBACK_PROMPT = [
  'G2 microphone unavailable.',
  '',
  'Use Phone Mic instead?',
  '',
  'Phone Mic opens this device microphone only after you confirm.',
].join('\n');

let context: LivePracticeControllerContext | null = null;
let session: SessionEngine | null = null;
let currentWeek = 1;
let selectedScenario: TopicScenario | null = null;
let expressionUsage: Map<string, boolean> = new Map();
let currentMode: 'general' | 'scenario' | null = null;
let preferredAudioSource: LivePracticeAudioSource = loadPreferredAudioSource();
let endingPracticePromise: Promise<void> | null = null;
let selectedAssistMode: AssistMode = 'manual';
let privacySettings: PrivacySettings = loadPrivacySettings();
let latestAssistMetrics: AssistMetrics = {
  manual_request_count: 0,
  auto_trigger_count: 0,
  cue_dismissed_count: 0,
  false_trigger_count: 0,
  cue_used_count: 0,
  auto_assist_paused: false,
};
let silenceAnimFrame: number | null = null;

export function normalizeAudioSource(input: unknown): LivePracticeAudioSource {
  return input === 'browser' ? 'browser' : 'bridge';
}

export function shouldOfferPhoneMicFallback(error: unknown, source: LivePracticeAudioSource): boolean {
  return source === 'bridge'
    && error instanceof Error
    && error.message.toLowerCase().includes('g2 microphone unavailable');
}

function loadPreferredAudioSource(): LivePracticeAudioSource {
  try {
    return normalizeAudioSource(localStorage.getItem(PREFERRED_AUDIO_SOURCE_KEY));
  } catch {
    return 'bridge';
  }
}

function savePreferredAudioSource(source: LivePracticeAudioSource): void {
  try {
    localStorage.setItem(PREFERRED_AUDIO_SOURCE_KEY, source);
  } catch {
    // Preferred audio source is a convenience setting; the in-memory value is authoritative.
  }
}

function setPreferredAudioSource(source: LivePracticeAudioSource): void {
  preferredAudioSource = source;
  savePreferredAudioSource(source);
}

function audioSourceCopy(source: LivePracticeAudioSource, suffix = ''): string {
  return `${source === 'bridge' ? 'G2 Mic' : 'Phone Mic'}${suffix}`;
}

function updateAudioSourceToggleLabel(): void {
  const span = document.querySelector('#btn-toggle-audio-source span');
  if (span) {
    span.textContent = audioSourceCopy(preferredAudioSource);
  }
}

function updateSelectedAudioSourceLabel(source: LivePracticeAudioSource): void {
  const label = document.getElementById('audio-source-label');
  if (!label) return;
  label.style.display = 'inline-block';
  label.textContent = audioSourceCopy(source, ' (selected)');
  label.style.color = source === 'bridge' ? 'var(--color-positive)' : 'var(--phase4)';
}

export function bindLivePracticeEvents(nextContext: LivePracticeControllerContext): void {
  context = nextContext;
  bindPrivacyControls({
    getSettings: () => privacySettings,
    setSettings: (settings) => {
      privacySettings = settings;
    },
  });

  document.getElementById('btn-mode-general')?.addEventListener('click', () => {
    currentMode = 'general';
    document.getElementById('general-practice-area')!.style.display = 'block';
    document.getElementById('scenario-practice-area')!.style.display = 'none';
    document.getElementById('btn-mode-general')!.style.borderColor = 'var(--phase2)';
    document.getElementById('btn-mode-scenario')!.style.borderColor = 'transparent';
  });

  document.getElementById('btn-mode-scenario')?.addEventListener('click', () => {
    currentMode = 'scenario';
    document.getElementById('general-practice-area')!.style.display = 'none';
    document.getElementById('scenario-practice-area')!.style.display = 'block';
    document.getElementById('btn-mode-scenario')!.style.borderColor = 'var(--phase2)';
    document.getElementById('btn-mode-general')!.style.borderColor = 'transparent';
  });

  document.querySelectorAll('#week-selector .week-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const week = parseInt((btn as HTMLElement).dataset.week ?? '1');
      selectWeek(week);
    });
  });
  selectWeek(currentWeek);

  initTopicSelector();

  document.getElementById('btn-change-topic')?.addEventListener('click', () => {
    selectedScenario = null;
    const selCard = document.getElementById('selected-topic-card');
    if (selCard) selCard.style.display = 'none';
    initTopicSelector();
  });

  document.getElementById('btn-start-general')?.addEventListener('click', () => {
    selectedScenario = null;
    startSession();
  });
  document.getElementById('btn-start-scenario')?.addEventListener('click', () => {
    if (!selectedScenario) return;
    startSession();
  });
  document.getElementById('btn-stop-session')?.addEventListener('click', () => {
    endLivePracticeSession();
  });
  document.getElementById('btn-request-cue')?.addEventListener('click', () => {
    requestLivePracticeCue();
  });

  document.getElementById('btn-pause-session')?.addEventListener('click', async () => {
    if (!session) return;
    if (session.state === 'paused') {
      await session.resume();
      setPauseButtonState(false);
    } else {
      await session.pause();
      setPauseButtonState(true);
    }
  });

  document.querySelectorAll('.assist-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = ((btn as HTMLElement).dataset.assistMode as AssistMode | undefined) ?? 'manual';
      selectedAssistMode = mode;
      session?.setAssistMode(mode);
      updateAssistModeUI();
    });
  });

  const toggleBtnSpan = document.querySelector('#btn-toggle-audio-source span');
  if (toggleBtnSpan) {
    updateAudioSourceToggleLabel();
  }

  document.getElementById('btn-toggle-audio-source')?.addEventListener('click', async () => {
    const isSessionActive = session && session.state !== 'idle';
    const newSource = preferredAudioSource === 'bridge' ? 'browser' : 'bridge';
    setPreferredAudioSource(newSource);

    console.log('[LivePractice] Switched preferred mic source to:', newSource);
    updateAudioSourceToggleLabel();

    if (isSessionActive) {
      const label = document.getElementById('audio-source-label');
      if (label) {
        label.textContent = 'Reconnecting...';
        label.style.color = 'var(--color-text-dim)';
      }

      await endLivePracticeSession();
      setTimeout(async () => {
        await startSession();
      }, 500);
    } else {
      updateSelectedAudioSourceLabel(newSource);
    }
  });
}

export function isLivePracticeActive(): boolean {
  return !!session && session.state !== 'idle';
}

export async function requestLivePracticeCue(): Promise<void> {
  if (!session) return;
  await session.requestManualCue();
  latestAssistMetrics = session.currentAssistMetrics;
  updateAssistModeUI();
}

export function dismissLivePracticeCue(): void {
  if (!session) return;
  const dismissed = session.dismissActiveCue();
  if (!dismissed) return;

  hideChunkDisplay();
  latestAssistMetrics = session.currentAssistMetrics;
  updateAssistModeUI();
}

export async function resumeLivePracticeSession(): Promise<void> {
  if (!session || session.state !== 'paused') return;
  await session.resume();
  setPauseButtonState(false);
}

export async function endLivePracticeSession(options: { returnToStandby?: boolean } = {}): Promise<void> {
  if (endingPracticePromise) {
    await endingPracticePromise;
    return;
  }

  endingPracticePromise = (async () => {
    const { returnToStandby = true } = options;

    try {
      if (session) {
        await session.stop();
      }
    } catch (err) {
      console.warn('[LivePractice] Error while ending practice session:', err);
    } finally {
      session = null;
    }

    toggleSessionUI(false);
    handleSessionState('idle');

    const hud = getHud();
    hud?.setSessionActive(false);
    if (returnToStandby) {
      await hud?.enterStandby();
    }

    for (let i = 0; i < 8; i++) {
      const lBar = document.getElementById(`sw-l${i}`);
      const rBar = document.getElementById(`sw-r${i}`);
      if (lBar) { lBar.style.height = '3px'; lBar.style.background = 'var(--color-text-muted)'; }
      if (rBar) { rBar.style.height = '3px'; rBar.style.background = 'var(--color-text-muted)'; }
    }

    const swPanel = document.getElementById('soundwave-panel');
    if (swPanel) {
      swPanel.style.display = 'none';
      swPanel.classList.remove('active');
      swPanel.classList.add('idle');
    }

    const modeSelector = document.getElementById('mode-selector-card');
    if (modeSelector) modeSelector.style.display = 'block';

    const generalArea = document.getElementById('general-practice-area');
    const scenarioArea = document.getElementById('scenario-practice-area');
    if (generalArea) generalArea.style.display = 'none';
    if (scenarioArea) scenarioArea.style.display = 'none';

    const btnGen = document.getElementById('btn-mode-general');
    const btnScen = document.getElementById('btn-mode-scenario');
    if (btnGen) btnGen.style.borderColor = 'transparent';
    if (btnScen) btnScen.style.borderColor = 'transparent';
    currentMode = null;

    const exprTracker = document.getElementById('expression-tracker');
    if (exprTracker) exprTracker.style.display = 'none';

    const liveContainer = document.getElementById('live-transcript-container');
    if (liveContainer) liveContainer.style.display = 'none';
    const audioLabel = document.getElementById('audio-source-label');
    if (audioLabel) audioLabel.style.display = 'none';
    const transcriptDisplay = document.getElementById('transcript-display');
    if (transcriptDisplay) transcriptDisplay.style.display = 'none';

    selectedAssistMode = 'manual';
    latestAssistMetrics = {
      manual_request_count: 0,
      auto_trigger_count: 0,
      cue_dismissed_count: 0,
      false_trigger_count: 0,
      cue_used_count: 0,
      auto_assist_paused: false,
    };
    updateAssistModeUI();
  })();

  try {
    await endingPracticePromise;
  } finally {
    endingPracticePromise = null;
  }
}

export async function exitLivePracticeEcho(): Promise<void> {
  await endLivePracticeSession({ returnToStandby: false });
  await getHud()?.exitEcho();
  context?.setHud(null);
}

function initTopicSelector(): void {
  const area = document.getElementById('topic-selector-area');
  if (!area) return;

  area.replaceChildren(createTopicSelectorElement());

  if (selectedScenario) {
    document.getElementById('topic-selector')!.style.display = 'none';
    fillTopicDetail(selectedScenario);
  } else {
    const tabs = document.querySelectorAll('.topic-cat-tab');
    const firstCat = getCategories()[0] ?? 'daily';

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const cat = (tab as HTMLElement).dataset.cat as TopicCategory;
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const grid = document.getElementById('topic-scenario-grid');
        if (grid) {
          fillScenarioGrid(grid, cat, selectedScenario?.id);
          bindScenarioCards();
        }
      });
    });

    const firstTab = tabs[0] as HTMLElement | undefined;
    if (firstTab) {
      firstTab.classList.add('active');
      const grid = document.getElementById('topic-scenario-grid');
      if (grid) {
        fillScenarioGrid(grid, firstCat as TopicCategory);
        bindScenarioCards();
      }
    }
  }

  document.getElementById('btn-change-topic')?.addEventListener('click', () => {
    selectedScenario = null;
    initTopicSelector();
  });

  document.getElementById('btn-start-scenario')?.addEventListener('click', () => {
    if (!selectedScenario) return;
    startSession();
  });
}

function bindScenarioCards(): void {
  document.querySelectorAll('.topic-scenario-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = (card as HTMLElement).dataset.scenario;
      if (!id) return;
      const scenario = getScenarioById(id);
      if (!scenario) return;
      selectedScenario = scenario;

      document.getElementById('topic-selector')!.style.display = 'none';
      fillTopicDetail(scenario);
    });
  });
}

function selectWeek(week: number): void {
  currentWeek = week;
  const config = WEEK_CONFIGS[week];

  document.querySelectorAll('#week-selector .week-btn').forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.week === String(week));
  });

  const desc = document.getElementById('week-desc');
  if (desc && config) {
    desc.textContent = `${config.label} | Cue delay: ${config.silenceThresholdMs / 1000}s | Independent practice: ${Math.round(config.blackoutProbability * 100)}%`;
  }

  const threshLabel = document.getElementById('silence-threshold-label');
  if (threshLabel && config) {
    threshLabel.textContent = `${config.silenceThresholdMs / 1000}s threshold`;
  }

  session?.setWeek(week);
}

async function startSession(): Promise<void> {
  privacySettings = loadPrivacySettings();
  if (!privacySettings.useMicrophone) {
    updatePrivacySettingsUI(privacySettings, 'Enable Use microphone before starting Live Practice.', 'error');
    return;
  }

  const scenario = selectedScenario;
  const category = scenario ? toLegacyCategory(scenario.id) as ChunkCategory : 'general';
  const topicLabel = scenario ? scenario.label : 'General English Practice';

  expressionUsage = new Map();
  if (scenario) {
    scenario.keyExpressions.forEach((expr) => expressionUsage.set(expr, false));
    showExpressionTracker(scenario.keyExpressions);
  }

  const swPanel = document.getElementById('soundwave-panel');
  if (swPanel) {
    swPanel.style.display = 'flex';
    swPanel.classList.remove('active');
    swPanel.classList.add('idle');
  }

  const topicArea = document.getElementById('topic-selector-area');
  if (topicArea) topicArea.style.display = 'none';
  const selCard = document.getElementById('selected-topic-card');
  if (selCard) selCard.style.display = 'none';

  session = new SessionEngine(currentWeek, {
    onStateChange: handleSessionState,
    onChunkGenerated: async (result) => {
      await handleChunkGenerated(result);
    },
    onSpeechDetected: handleSpeechDetected,
    onSilenceStart: handleSilenceStart,
    onSessionLog: (log) => {
      const { transcript, ...safeLog } = log;
      console.log('[Session Log]', {
        ...safeLog,
        transcript: transcript ? '[local transcript available for export]' : undefined,
      });
    },
    onTranscript: handleTranscript,
    onLiveTranscript: handleLiveTranscript,
    onAudioSource: handleAudioSource,
    onVolume: updateSoundwaveVolume,
    onHintUsageResult: handleHintUsageResult,
    onSessionAnalysis: (analysis) => {
      console.log('[LivePractice] Session Analysis:', analysis);
      console.log(`[LivePractice] Cues: ${analysis.hintsUsed}/${analysis.totalHints} used (${analysis.successRate}%)`);
      console.log(`[LivePractice] Recommended next difficulty: ${analysis.recommendedNextDifficulty}`);
      if (analysis.topMissedExpressions.length > 0) {
        console.log(`[LivePractice] Top missed: ${analysis.topMissedExpressions.join(', ')}`);
      }
    },
    onAssistMetrics: updateAssistMetricsUI,
    onConversationTimeline: renderLiveConversationTimeline,
  }, preferredAudioSource, getCalibration(), {
    cloudProcessingEnabled: privacySettings.allowCloudProcessing,
    transcriptOptions: {
      saveRawTranscript: privacySettings.saveTranscripts,
      retentionPolicy: privacySettings.transcriptRetention,
    },
  });

  session.setAssistMode(selectedAssistMode);
  session.setTopic(
    topicLabel,
    category,
    scenario?.id ?? '',
    scenario?.geminiCoachContext ?? '',
  );

  toggleSessionUI(true);

  const hud = getHud();
  hud?.setSessionActive(true);
  hud?.setCombatTopic(topicLabel);
  hud?.exitStandby();
  hud?.showListening();

  try {
    await session.start(hud);
  } catch (err: any) {
    console.error('[LivePractice] Failed to start session:', err);
    const failedSource = preferredAudioSource;
    const canOfferPhoneFallback = shouldOfferPhoneMicFallback(err, failedSource);
    await endLivePracticeSession();

    if (canOfferPhoneFallback) {
      const usePhoneMic = window.confirm(G2_MIC_FALLBACK_PROMPT);
      if (usePhoneMic) {
        setPreferredAudioSource('browser');
        updateAudioSourceToggleLabel();
        updateSelectedAudioSourceLabel('browser');
        updatePrivacySettingsUI(privacySettings, 'Phone Mic selected. Starting Live Practice...', 'success');
        await startSession();
      } else {
        updatePrivacySettingsUI(privacySettings, 'Phone Mic was not started. Select Phone Mic to retry.', 'normal');
      }
      return;
    }

    if (err.message === 'SECURE_ORIGIN_REQUIRED') {
      alert('Secure origin required\n\nTo use the microphone on a mobile device, you must:\n1. Use an HTTPS connection\n2. OR enable "Insecure origins treated as secure" in chrome://flags\n\nPlease add http://' + window.location.host + ' to the allowed list.');
    } else {
      alert('Failed to start microphone: ' + err.message);
    }
  }
}

function handleTranscript(transcript: string): void {
  const display = document.getElementById('transcript-display');
  const text = document.getElementById('transcript-text');
  const timing = document.getElementById('speech-timing');
  if (display && text && transcript) {
    text.textContent = `"${transcript}"`;
    display.style.display = 'block';
    if (timing) timing.textContent = nowTimeLabel();
    checkExpressionUsage(transcript);
  }
}

function handleLiveTranscript(text: string, isFinal: boolean): void {
  const liveContainer = document.getElementById('live-transcript-container');
  const liveText = document.getElementById('live-transcript-text');
  if (!liveContainer || !liveText) return;

  if (!text.trim()) return;
  liveContainer.style.display = 'block';
  liveText.textContent = text;

  if (isFinal) {
    const display = document.getElementById('transcript-display');
    const transcriptText = document.getElementById('transcript-text');
    const timing = document.getElementById('speech-timing');
    if (display && transcriptText) {
      transcriptText.textContent = `"${text.trim()}"`;
      display.style.display = 'block';
      if (timing) timing.textContent = nowTimeLabel();
    }
    checkExpressionUsage(text.trim());
    setTimeout(() => {
      liveContainer.style.display = 'none';
      liveText.textContent = '';
    }, 500);
  }
}

function resetLiveConversationTimeline(visible: boolean): void {
  const container = document.getElementById('live-conversation-timeline-container');
  const list = document.getElementById('live-conversation-timeline');
  const empty = document.getElementById('live-conversation-timeline-empty');
  const count = document.getElementById('live-conversation-timeline-count');

  if (container) container.style.display = visible ? 'block' : 'none';
  if (list) list.replaceChildren();
  if (empty) empty.style.display = visible ? 'block' : 'none';
  if (count) count.textContent = '0 turns';
}

function renderLiveConversationTimeline(sessionData: SessionTranscript): void {
  const container = document.getElementById('live-conversation-timeline-container');
  const list = document.getElementById('live-conversation-timeline');
  const empty = document.getElementById('live-conversation-timeline-empty');
  const count = document.getElementById('live-conversation-timeline-count');
  if (!container || !list || !empty) return;

  const rows = buildConversationTimelineRows(sessionData)
    .filter((row) => row.transcript.trim() && !row.transcript.trim().startsWith('['))
    .slice(-6);

  container.style.display = 'block';
  list.replaceChildren(...rows.map(createLiveConversationTimelineItem));
  empty.style.display = rows.length > 0 ? 'none' : 'block';
  if (count) {
    count.textContent = `${rows.length} turn${rows.length === 1 ? '' : 's'}`;
  }
}

function createLiveConversationTimelineItem(row: ConversationTimelineRow): HTMLElement {
  const item = document.createElement('div');
  item.className = `conversation-turn conversation-turn-${row.speaker}`;
  item.style.cssText = 'border: 1px solid var(--color-border); border-radius: 6px; padding: 8px; background: var(--color-surface);';

  const meta = document.createElement('div');
  meta.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 5px;';

  const speaker = document.createElement('select');
  speaker.className = 'conversation-speaker-select';
  speaker.setAttribute('data-live-speaker-turn', row.turnId);
  speaker.setAttribute('aria-label', `Speaker for ${row.timeLabel}`);
  for (const [value, label] of [
    ['learner', 'Me'],
    ['partner', 'Partner'],
    ['unknown', 'Unknown'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = row.speaker === value;
    speaker.append(option);
  }
  speaker.addEventListener('change', () => {
    const nextSpeaker = speaker.value;
    if (!isSpeakerRole(nextSpeaker)) {
      speaker.value = row.speaker;
      return;
    }

    const updated = session?.correctConversationTurnSpeaker(row.turnId, nextSpeaker);
    if (!updated) {
      speaker.value = row.speaker;
    }
  });

  const timing = document.createElement('span');
  timing.className = 'text-detail';
  timing.style.cssText = 'color: var(--color-text-muted); font-family: var(--font-mono);';
  timing.textContent = [
    row.timeLabel,
    row.sourceLabel,
    row.confidenceLabel,
    row.correctedByUser ? 'corrected' : '',
  ].filter(Boolean).join(' | ');

  meta.append(speaker, timing);

  const transcript = document.createElement('div');
  transcript.className = 'text-normal-body';
  transcript.style.cssText = 'color: var(--color-text); line-height: 1.35;';
  transcript.textContent = row.transcript;

  item.append(meta, transcript);

  const translation = row.translationKo ?? row.translationStatusLabel;
  if (translation) {
    const translationEl = document.createElement('div');
    translationEl.className = `text-detail conversation-turn-translation${row.translationStatus === 'failed' ? ' conversation-turn-translation-status-failed' : ''}`;
    translationEl.style.cssText = 'margin-top: 5px;';
    translationEl.textContent = translation;
    item.append(translationEl);
  }

  if (row.translationWarningLabel) {
    const warningEl = document.createElement('div');
    warningEl.className = 'text-detail conversation-turn-translation-warning';
    warningEl.style.cssText = 'margin-top: 5px;';
    warningEl.textContent = row.translationWarningLabel;
    item.append(warningEl);
  }

  return item;
}

function isSpeakerRole(value: string): value is SpeakerRole {
  return value === 'learner' || value === 'partner' || value === 'unknown';
}

function handleAudioSource(source: string): void {
  const label = document.getElementById('audio-source-label');
  if (label) {
    label.style.display = 'inline-block';
    if (source === 'bridge') {
      label.textContent = 'G2 Mic';
      label.style.color = 'var(--color-positive)';
    } else {
      label.textContent = 'Phone Mic';
      label.style.color = 'var(--phase4)';
    }
  }
  getHud()?.setMicReady(true);
}

function updateSoundwaveVolume(volume: number): void {
  const swPanel = document.getElementById('soundwave-panel');
  if (swPanel) {
    if (volume > 0.05) {
      swPanel.classList.add('active');
      swPanel.classList.remove('idle');
    } else {
      swPanel.classList.remove('active');
      swPanel.classList.add('idle');
    }
  }
  for (let i = 0; i < 8; i++) {
    const lBar = document.getElementById(`sw-l${i}`);
    const rBar = document.getElementById(`sw-r${i}`);
    if (lBar && rBar) {
      const centerWeight = 1 - (Math.abs(i - 3.5) / 8) * 0.6;
      const barVolume = Math.max(0, volume * centerWeight);
      const jitter = 1 + (Math.random() - 0.5) * 0.25;
      const height = Math.max(3, Math.min(42, barVolume * 55 * jitter));
      lBar.style.height = `${height}px`;
      rBar.style.height = `${height}px`;
      const color = volume > 0.6 ? 'var(--phase2)'
        : volume > 0.25 ? 'var(--color-positive)'
        : 'var(--color-text-muted)';
      lBar.style.background = color;
      rBar.style.background = color;
    }
  }

  const swStatus = document.getElementById('soundwave-status');
  if (swStatus) {
    swStatus.textContent = volume > 0.1 ? 'Audio detected' : 'Waiting for audio...';
  }
}

function handleHintUsageResult(result: {
  status: 'used' | 'simplified' | 'missed';
  hint: string;
  outcome?: string;
  simplifiedTo?: string;
}): void {
  const liveContainer = document.getElementById('live-transcript-container');
  const liveText = document.getElementById('live-transcript-text');

  if (result.status === 'used') {
    if (liveContainer && liveText) {
      liveContainer.style.display = 'block';
      liveContainer.style.borderLeftColor = 'var(--color-positive)';
      liveText.textContent = `Nice recovery: "${result.hint}"`;
      setTimeout(() => {
        liveContainer.style.borderLeftColor = 'var(--color-accent)';
      }, 2000);
    }
    console.log(`[LivePractice] Hint used: "${result.hint}"`);
  } else if (result.status === 'simplified') {
    if (liveContainer && liveText) {
      liveContainer.style.display = 'block';
      liveContainer.style.borderLeftColor = 'var(--phase4)';
      liveText.textContent = `Try simpler: "${result.simplifiedTo}"`;
      setTimeout(() => {
        liveContainer.style.borderLeftColor = 'var(--color-accent)';
      }, 2000);
    }
    console.log(`[LivePractice] Hint simplified: "${result.hint}" -> "${result.simplifiedTo}"`);
  } else if (result.status === 'missed') {
    console.log(`[LivePractice] Hint missed: "${result.hint}"`);
  }
}

function toggleSessionUI(active: boolean): void {
  const btnStartGen = document.getElementById('btn-start-general') as HTMLButtonElement;
  const btnStartScen = document.getElementById('btn-start-scenario') as HTMLButtonElement;
  const modeSelector = document.getElementById('mode-selector-card');
  const btnCue = document.getElementById('btn-request-cue') as HTMLButtonElement;
  const btnStop = document.getElementById('btn-stop-session') as HTMLButtonElement;
  const btnPause = document.getElementById('btn-pause-session') as HTMLButtonElement;
  const statsCard = document.getElementById('live-stats-card');
  const historyCard = document.getElementById('hint-history-card');
  const sessionCard = document.getElementById('session-card');
  const assistPanel = document.getElementById('assist-mode-panel');
  const privacyCard = document.getElementById('privacy-settings-card');

  if (btnStartGen) btnStartGen.style.display = active ? 'none' : 'block';
  if (btnStartScen) btnStartScen.style.display = active ? 'none' : 'block';
  if (modeSelector) modeSelector.style.display = active ? 'none' : 'block';
  if (privacyCard) privacyCard.style.display = active ? 'none' : 'block';

  if (active) {
    const genArea = document.getElementById('general-practice-area');
    const scenArea = document.getElementById('scenario-practice-area');
    if (genArea) genArea.style.display = 'none';
    if (scenArea) scenArea.style.display = 'none';
  }

  if (sessionCard) sessionCard.style.display = active ? 'block' : 'none';
  if (assistPanel) assistPanel.style.display = active ? 'block' : 'none';
  if (btnCue) btnCue.style.display = active ? 'flex' : 'none';
  if (btnStop) btnStop.style.display = active ? 'flex' : 'none';
  if (btnPause) {
    btnPause.style.display = active ? 'flex' : 'none';
    setPauseButtonState(false);
  }
  if (statsCard) statsCard.style.display = active ? 'block' : 'none';
  if (historyCard) historyCard.style.display = active ? 'block' : 'none';
  resetLiveConversationTimeline(active);
  updateAssistModeUI();
}

function setPauseButtonState(paused: boolean): void {
  const btnPause = document.getElementById('btn-pause-session') as HTMLButtonElement | null;
  if (!btnPause) return;
  btnPause.textContent = paused ? 'Resume' : 'Pause';
  btnPause.classList.toggle('btn-highlight', paused);
  btnPause.classList.toggle('btn-neutral', !paused);
}

function hideChunkDisplay(): void {
  const chunkDisplay = document.getElementById('chunk-display');
  if (chunkDisplay) {
    chunkDisplay.style.display = 'none';
    chunkDisplay.replaceChildren();
  }
}

function updateAssistMetricsUI(metrics: AssistMetrics): void {
  latestAssistMetrics = metrics;
  updateAssistModeUI();
}

function updateAssistModeUI(): void {
  document.querySelectorAll('.assist-mode-btn').forEach((btn) => {
    const button = btn as HTMLButtonElement;
    const active = button.dataset.assistMode === selectedAssistMode;
    button.classList.toggle('active', active);
    button.style.background = active ? 'var(--phase2)' : 'var(--color-surface)';
    button.style.color = active ? 'white' : 'var(--color-text-dim)';
  });

  const label = document.getElementById('assist-mode-label');
  if (label) {
    label.textContent =
      selectedAssistMode === 'auto'
        ? latestAssistMetrics.auto_assist_paused
          ? 'Assist: Auto paused'
          : 'Assist: Auto'
        : 'Assist: Manual';
    label.style.color =
      selectedAssistMode === 'auto' && !latestAssistMetrics.auto_assist_paused
        ? 'var(--phase2)'
        : 'var(--color-text-dim)';
  }

  const metricsLabel = document.getElementById('assist-metrics-label');
  if (metricsLabel) {
    metricsLabel.textContent =
      `Manual ${latestAssistMetrics.manual_request_count} | ` +
      `Auto ${latestAssistMetrics.auto_trigger_count} | ` +
      `Dismissed ${latestAssistMetrics.cue_dismissed_count} | ` +
      `Used ${latestAssistMetrics.cue_used_count}`;
  }
}

function handleSessionState(state: SessionState): void {
  const status = document.getElementById('session-status');
  const vadDot = document.getElementById('vad-dot');
  const vadLabel = document.getElementById('vad-label');
  const chunkDisplay = document.getElementById('chunk-display');

  const isListening = state === 'listening';
  const swPanel = document.getElementById('soundwave-panel');
  if (swPanel) {
    if (isListening) {
      // Active state is driven by the volume callback.
    } else if (state === 'loading_vad') {
      swPanel.classList.remove('active');
      swPanel.classList.add('idle');
    } else if (state === 'idle' || state === 'session_end') {
      swPanel.classList.remove('active');
      swPanel.classList.add('idle');
    }
  }

  if (status) {
    const labels: Record<SessionState, string> = {
      idle: 'Standby',
      calibrated: 'Ready',
      loading_vad: 'Preparing mic...',
      listening: 'Listening',
      silence_detected: 'Need a cue?',
      chunk_generating: 'Preparing cue...',
      hud_flash: 'Cue sent',
      paused: 'Paused',
      session_end: 'Ended',
    };
    status.textContent = labels[state] ?? state;
    status.className = state === 'listening' ? 'badge badge-positive' :
      state === 'loading_vad' ? 'badge badge-accent' :
      state === 'silence_detected' ? 'badge badge-accent' :
      state === 'hud_flash' ? 'badge badge-accent' :
      state === 'paused' ? 'badge badge-neutral' : 'badge badge-neutral';
  }

  if (vadDot) {
    vadDot.className = `status-dot ${state === 'listening' ? 'listening' : state === 'idle' || state === 'session_end' ? 'idle' : 'listening'}`;
  }

  if (vadLabel) {
    vadLabel.textContent = state === 'listening'
      ? 'Mic: Listening...'
      : state === 'loading_vad' ? 'Mic: Preparing...'
        : state === 'silence_detected' ? 'Need a cue?'
          : state === 'chunk_generating' ? 'Preparing cue...'
            : state === 'hud_flash' ? 'Cue displayed'
              : 'Mic inactive';
  }

  if (chunkDisplay && (state === 'listening' || state === 'idle')) {
    chunkDisplay.style.display = 'none';
  }

  if (session) {
    const s = session.stats;
    setElText('stat-hints', String(s.hints));
    setElText('stat-speeches', String(s.speeches));
    setElText('stat-silences', String(s.silences));
    setElText('stat-self-rate', `${s.selfResponseRate}%`);
  }

  updateSilenceMeter(state);
}

async function handleChunkGenerated(result: ChunkResult): Promise<void> {
  const chunkDisplay = document.getElementById('chunk-display');
  if (chunkDisplay && result.chunk) {
    chunkDisplay.style.display = 'block';
    const chunk = document.createElement('div');
    chunk.className = 'chunk-flash';
    chunk.textContent = result.chunk;

    const detail = document.createElement('div');
    detail.className = 'text-detail';
    detail.style.textAlign = 'center';
    detail.style.color = 'var(--color-text-muted)';
    detail.style.marginTop = 'var(--spacing-same)';
    detail.textContent = `Cue ready in ${result.latencyMs}ms`;

    chunkDisplay.replaceChildren(chunk, detail);
  }

  if (currentWeek === 3) {
    await getHud()?.showSpeedUp(result.chunk);
  } else {
    await getHud()?.flashChunk(result.chunk);
  }

  const list = document.getElementById('hint-list');
  if (list) {
    const li = document.createElement('li');
    li.textContent = result.chunk;
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
  }
}

function handleSpeechDetected(): void {
  getHud()?.showListening();
  hideChunkDisplay();

  const vadLabel = document.getElementById('vad-label');
  if (vadLabel) {
    vadLabel.textContent = 'Voice detected';
    vadLabel.style.color = 'var(--color-positive)';
    setTimeout(() => {
      if (vadLabel && session?.state === 'listening') {
        vadLabel.textContent = 'Mic: Listening...';
        vadLabel.style.color = '';
      }
    }, 1500);
  }
}

function handleSilenceStart(): void {
  // Reserved for a future subtle phone-side silence warning.
}

function updateSilenceMeter(state: SessionState): void {
  const fill = document.getElementById('silence-fill');
  if (!fill) return;

  if (silenceAnimFrame) cancelAnimationFrame(silenceAnimFrame);

  if (state === 'listening' && session) {
    const config = WEEK_CONFIGS[currentWeek];
    const threshold = config?.silenceThresholdMs ?? 3000;

    const animate = () => {
      if (!session || session.state !== 'listening') {
        fill.style.width = '0%';
        return;
      }
      const silenceMs = (session as any).vad?.silenceDurationMs ?? 0;
      const pct = Math.min(100, (silenceMs / threshold) * 100);
      fill.style.width = `${pct}%`;

      if (pct > 75) {
        fill.style.background = 'var(--color-negative, #ef4444)';
      } else if (pct > 50) {
        fill.style.background = 'var(--phase3, #f59e0b)';
      } else {
        fill.style.background = 'var(--color-positive, #22c55e)';
      }

      silenceAnimFrame = requestAnimationFrame(animate);
    };
    animate();
  } else {
    fill.style.width = state === 'silence_detected' ? '100%' : '0%';
    if (state === 'silence_detected') {
      fill.style.background = 'var(--color-negative, #ef4444)';
    }
  }
}

function showExpressionTracker(expressions: string[]): void {
  const tracker = document.getElementById('expression-tracker');
  const list = document.getElementById('expr-list');
  const score = document.getElementById('expr-score');
  if (!tracker || !list) return;

  tracker.style.display = 'block';
  if (score) score.textContent = `0/${expressions.length} used`;

  list.replaceChildren(...expressions.map((expr) => createExpressionTrackerItem(expr)));
}

function createExpressionTrackerItem(expr: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'expr-item';
  item.dataset.expr = expr;
  item.style.padding = '3px 0';
  item.style.display = 'flex';
  item.style.alignItems = 'center';
  item.style.gap = '6px';

  const check = document.createElement('span');
  check.className = 'expr-check';
  check.style.color = 'var(--color-text-muted)';
  check.style.fontSize = '11px';
  check.textContent = '-';

  const label = document.createElement('span');
  label.style.color = 'var(--color-text-dim)';
  label.textContent = expr;

  item.append(check, label);
  return item;
}

function checkExpressionUsage(userText: string): void {
  if (!selectedScenario || expressionUsage.size === 0) return;

  const lower = userText.toLowerCase();
  let changed = false;

  for (const [expr, used] of expressionUsage) {
    if (used) continue;
    const pattern = expr
      .replace(/\([^)]*\)/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

    const words = pattern.split(' ').filter((w) => w.length > 1);
    const matchCount = words.filter((w) => lower.includes(w)).length;
    const matchRatio = words.length > 0 ? matchCount / words.length : 0;

    if (matchRatio >= 0.6) {
      expressionUsage.set(expr, true);
      changed = true;
    }
  }

  if (changed) updateExpressionUI();
}

function updateExpressionUI(): void {
  const items = document.querySelectorAll('.expr-item');
  let usedCount = 0;

  items.forEach((item) => {
    const expr = (item as HTMLElement).dataset.expr;
    if (!expr) return;
    const used = expressionUsage.get(expr) ?? false;
    const check = item.querySelector('.expr-check');
    if (used) {
      usedCount++;
      if (check) {
        (check as HTMLElement).textContent = '●';
        (check as HTMLElement).style.color = 'var(--color-positive)';
      }
      (item as HTMLElement).style.opacity = '0.6';
    }
  });

  const score = document.getElementById('expr-score');
  if (score) score.textContent = `${usedCount}/${expressionUsage.size} used`;
}

function nowTimeLabel(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
}

function setElText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function getHud(): HUDController | null {
  return context?.getHud() ?? null;
}

function getCalibration(): CalibrationResult | null {
  return context?.getCalibration() ?? null;
}
