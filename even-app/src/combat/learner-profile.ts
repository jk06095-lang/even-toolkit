import {
  ECHO_DOMAIN_V2_SCHEMA_VERSION,
  isLearningItem,
  type AssistEpisode,
  type AssistOutcome,
  type BreakdownType,
  type ConversationTurn,
  type Cue,
  type LearnerProfile,
  type LearningItem,
  type LearningOutcome,
  type SpeechAct,
} from '@toolkit/echo-domain-v2';
import {
  getAssistEpisodes,
  getConversationTurns,
  getCues,
  type SessionTranscript,
} from './transcript-store';

export interface LearnerProfileBuildOptions {
  learnerId?: string;
  profileLocale?: string;
  targetLanguage?: string;
  now?: () => Date;
}

export interface CustomGptHandoffFiles {
  profileFileName: 'echo_learner_profile.json';
  profileJson: LearnerProfile;
  instructionsFileName: 'echo_tutor_instructions.md';
  instructionsMarkdown: string;
}

const MAX_LEARNING_ITEMS_PER_SESSION = 3;

export function buildLearningItems(
  session: SessionTranscript,
  options: LearnerProfileBuildOptions = {},
): LearningItem[] {
  const cuesById = new Map(getCues(session).map((cue) => [cue.cueId, cue]));
  const turnsById = new Map(getConversationTurns(session).map((turn) => [turn.id, turn]));
  const sessionEnd = session.endTime || session.startTime || options.now?.().getTime() || Date.now();

  return getAssistEpisodes(session)
    .map((episode) => ({
      episode,
      cue: episode.cueId ? cuesById.get(episode.cueId) : undefined,
      score: scoreEpisodeForLearning(episode),
    }))
    .filter((entry): entry is { episode: AssistEpisode; cue: Cue; score: number } => Boolean(entry.cue))
    .sort((a, b) => b.score - a.score || b.episode.requestedAt - a.episode.requestedAt)
    .slice(0, MAX_LEARNING_ITEMS_PER_SESSION)
    .map(({ episode, cue }, index) => createLearningItem(session, episode, cue, turnsById, sessionEnd, index))
    .filter(isLearningItem);
}

export function buildLearnerProfile(
  session: SessionTranscript,
  options: LearnerProfileBuildOptions = {},
): LearnerProfile {
  const learningItems = buildLearningItems(session, options);
  const assistEpisodes = getAssistEpisodes(session);
  const cueEpisodes = assistEpisodes.filter((episode) => episode.cueLevelUsed > 0);
  const recovered = cueEpisodes.filter((episode) => isRecoveredOutcome(episode.outcome));
  const exact = cueEpisodes.filter((episode) => episode.outcome === 'assisted_exact');
  const askRepeatEpisodes = cueEpisodes.filter((episode) => episode.speechAct === 'ask_repeat');
  const askRepeatRecovered = askRepeatEpisodes.filter((episode) => isRecoveredOutcome(episode.outcome));
  const repairEpisodes = cueEpisodes.filter(
    (episode) => episode.speechAct === 'repair' || episode.speechAct === 'clarify',
  );
  const repairRecovered = repairEpisodes.filter((episode) => isRecoveredOutcome(episode.outcome));
  const now = options.now?.() ?? new Date();
  const createdAt = toIsoDate(session.startTime || now.getTime());
  const updatedAt = toIsoDate(session.endTime || now.getTime());
  const conversationRecoveryRate = ratio(recovered.length, cueEpisodes.length);
  const profile: LearnerProfile = {
    schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
    id: cleanId(`${session.sessionId}:learner-profile`),
    learnerId: cleanId(options.learnerId ?? 'local-echo-learner'),
    createdAt,
    updatedAt,
    profileLocale: options.profileLocale ?? 'ko-KR',
    targetLanguage: options.targetLanguage ?? 'en-US',
    privacyMode: 'local_only',
    metrics: {
      conversationRecoveryRate,
      independentTransferRate: 0,
      assistedExactRate: ratio(exact.length, cueEpisodes.length),
      activeRecallDueCount: learningItems.length,
      totalSessions: 1,
    },
    ability: {
      recall: conversationRecoveryRate,
      listening: ratio(askRepeatRecovered.length, askRepeatEpisodes.length),
      grammar: ratio(recovered.length, cueEpisodes.length),
      wordChoice: ratio(
        cueEpisodes.filter((episode) => episode.outcome === 'assisted_adapted').length,
        cueEpisodes.length,
      ),
      pronunciation: 0,
      turnTaking: ratio(repairRecovered.length, repairEpisodes.length),
    },
    learningItems,
    recentAssistEpisodeIds: assistEpisodes
      .slice(-32)
      .map((episode) => cleanId(episode.id))
      .filter(Boolean),
  };

  return profile;
}

export function buildTutorInstructions(profile: LearnerProfile): string {
  const dueItems = profile.learningItems
    .slice(0, MAX_LEARNING_ITEMS_PER_SESSION)
    .map((item, index) => `${index + 1}. ${item.meaningKo} -> ${item.canonicalExpression}`)
    .join('\n');

  return [
    '# Project ECHO Tutor Instructions',
    '',
    '- Keep the live conversation moving before correcting form.',
    '- Give at most one correction per turn.',
    '- When the learner is stuck, help in this order: keyword, sentence starter, full sentence.',
    '- Use Korean explanations briefly and keep practice in the target language.',
    '- Do not count repeating the answer immediately after seeing it as mastery.',
    '- Raise mastery only after the learner uses the expression independently in a new context.',
    '- Save at most three learning items after a session.',
    '',
    '## Current Active Recall Targets',
    dueItems || 'No active recall targets yet.',
  ].join('\n');
}

export function buildCustomGptHandoffFiles(
  session: SessionTranscript,
  options: LearnerProfileBuildOptions = {},
): CustomGptHandoffFiles {
  const profileJson = buildLearnerProfile(session, options);
  return {
    profileFileName: 'echo_learner_profile.json',
    profileJson,
    instructionsFileName: 'echo_tutor_instructions.md',
    instructionsMarkdown: buildTutorInstructions(profileJson),
  };
}

function createLearningItem(
  session: SessionTranscript,
  episode: AssistEpisode,
  cue: Cue,
  turnsById: Map<string, ConversationTurn>,
  sessionEnd: number,
  index: number,
): LearningItem {
  const sourceTurnIds = [cue.targetTurnId].filter(Boolean);
  const userAttempt = sanitizeOptional(episode.userAttempt, 1000);
  const canonicalExpression = sanitizePlainText(cue.phrase, 240);
  const meaningKo = sanitizePlainText(cue.meaningKo || 'Meaning unavailable', 400);
  const targetTurn = turnsById.get(cue.targetTurnId);
  const lastOutcome = mapLearningOutcome(episode.outcome);
  const dueAt = scheduleDueAt(sessionEnd, episode.outcome);
  const exampleLearnerTurn = userAttempt ||
    sanitizeOptional(targetTurn?.transcript, 1000) ||
    'No learner attempt captured.';

  return {
    schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
    id: cleanId(`${session.sessionId}:learning:${cue.cueId || index + 1}`),
    canonicalExpression,
    meaningKo,
    speechAct: episode.speechAct ?? cue.speechAct,
    scenarioTags: [sanitizePlainText(session.category || session.topic || 'general', 160)],
    breakdownType: inferBreakdownType(episode.speechAct ?? cue.speechAct, episode.outcome),
    sourceTurnIds,
    userAttempt,
    naturalRecast: canonicalExpression,
    cueLevelUsed: episode.cueLevelUsed,
    lastOutcome,
    examples: [
      {
        id: cleanId(`${session.sessionId}:example:${cue.cueId || index + 1}`),
        scenarioTag: sanitizePlainText(session.topic || session.category || 'general', 120),
        learnerTurn: exampleLearnerTurn,
        meaningKo,
        targetExpression: canonicalExpression,
        sourceTurnIds,
      },
    ],
    scheduling: {
      reps: 0,
      lapses: lastOutcome === 'failed' ? 1 : 0,
      difficulty: scheduleDifficulty(episode.outcome),
      stability: scheduleStability(episode.outcome),
      dueAt,
    },
  };
}

function scoreEpisodeForLearning(episode: AssistEpisode): number {
  if (episode.outcome === 'failed') return 4;
  if (episode.outcome === 'partial') return 3;
  if (episode.outcome === 'assisted_exact') return 2;
  if (episode.outcome === 'assisted_adapted') return 1;
  return 0;
}

function inferBreakdownType(speechAct: SpeechAct | undefined, outcome: AssistOutcome): BreakdownType {
  if (speechAct === 'ask_repeat') return 'listening_gap';
  if (speechAct === 'repair' || speechAct === 'clarify') return 'turn_taking';
  if (outcome === 'failed' || outcome === 'partial') return 'recall_gap';
  return 'word_choice';
}

function mapLearningOutcome(outcome: AssistOutcome): LearningOutcome {
  if (outcome === 'independent') return 'independent';
  if (outcome === 'failed' || outcome === 'partial') return 'failed';
  return 'assisted';
}

function scheduleDueAt(sessionEnd: number, outcome: AssistOutcome): string {
  const base = Number.isFinite(sessionEnd) && sessionEnd > 0 ? sessionEnd : Date.now();
  const hours =
    outcome === 'failed' ? 4 :
    outcome === 'partial' ? 12 :
    outcome === 'independent' ? 72 :
    24;
  return toIsoDate(base + hours * 60 * 60 * 1000);
}

function scheduleDifficulty(outcome: AssistOutcome): number {
  if (outcome === 'failed') return 0.85;
  if (outcome === 'partial') return 0.7;
  if (outcome === 'assisted_exact') return 0.55;
  if (outcome === 'assisted_adapted') return 0.45;
  return 0.35;
}

function scheduleStability(outcome: AssistOutcome): number {
  if (outcome === 'failed') return 0.2;
  if (outcome === 'partial') return 0.35;
  if (outcome === 'assisted_exact') return 0.5;
  if (outcome === 'assisted_adapted') return 0.65;
  return 1;
}

function isRecoveredOutcome(outcome: AssistOutcome): boolean {
  return outcome === 'assisted_adapted' ||
    outcome === 'assisted_exact' ||
    outcome === 'independent';
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function cleanId(value: string): string {
  return sanitizePlainText(value, 128) || 'echo-record';
}

function sanitizeOptional(value: string | undefined, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = sanitizePlainText(value, maxLength);
  return cleaned || undefined;
}

function sanitizePlainText(value: string, maxLength: number): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-phone]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function toIsoDate(timestamp: number): string {
  return new Date(timestamp).toISOString();
}
