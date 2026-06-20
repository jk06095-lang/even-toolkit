#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  ECHO_DOMAIN_V2_SCHEMA_VERSION,
  ECHO_DOMAIN_V2_SCHEMAS,
  createConversationInputEvidence,
  isAssistEpisode,
  isAutoAssistSignalEvidence,
  isConversationTurn,
  isCue,
  isLearnerProfile,
  isLearningItem,
  validateAutoAssistSignalEvidence,
  validateConversationTurn,
} from '../dist/echo-domain-v2/index.js';

const now = '2026-06-19T00:00:00.000Z';
const dueAt = '2026-06-20T00:00:00.000Z';
const sessionId = 'session-echo-domain-v2';
const turnId = 'turn-partner-1';

const conversationTurn = {
  schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
  id: turnId,
  sessionId,
  speaker: 'partner',
  startedAt: 1000,
  endedAt: 2480,
  source: 'g2',
  language: 'en-US',
  transcript: 'Would you like me to repeat the last part?',
  translationKo: 'Korean translation placeholder for repeat request.',
  confidence: 0.94,
  isFinal: true,
  correctedByUser: false,
  piiFlags: [],
  inputEvidence: createConversationInputEvidence('g2'),
};

const cue = {
  schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
  cueId: 'cue-1',
  speechAct: 'ask_repeat',
  level: 1,
  phrase: 'Could you say that again?',
  meaningKo: 'Meaning placeholder for asking someone to repeat.',
  alternatives: ['Could you repeat that?', 'Sorry, one more time?'],
  expiresAfterMs: 9000,
  targetTurnId: turnId,
};

const assistEpisode = {
  schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
  id: 'assist-1',
  sessionId,
  targetTurnId: turnId,
  trigger: 'manual',
  decision: {
    action: 'show',
    confidence: 0.88,
    trigger: 'manual',
    maxCueLevel: 1,
  },
  cueId: cue.cueId,
  cueLevelUsed: 1,
  speechAct: 'ask_repeat',
  requestedAt: 2600,
  shownAt: 2740,
  acknowledgedAt: 3400,
  resolvedAt: 3900,
  outcome: 'assisted_adapted',
  userAttempt: 'Could you repeat it?',
  acceptedPhrase: 'Could you repeat that?',
  latencyMs: 140,
};

const autoAssistSignalEvidence = {
  schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
  id: 'auto-assist-signal-1',
  sessionId,
  evaluatedAt: 2550,
  trigger: 'long_pause',
  action: 'show',
  signalCount: 2,
  requiredSignalCount: 2,
  signals: ['adaptive_silence', 'incomplete_utterance'],
  latestSpeaker: 'learner',
  silenceDurationMs: 5200,
  autoDismissStreak: 0,
  autoTriggerCount: 0,
  maxAutoTriggersPerSession: 3,
};

const learningItem = {
  schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
  id: 'item-1',
  canonicalExpression: 'Could you repeat that?',
  meaningKo: 'Ask someone to repeat.',
  speechAct: 'ask_repeat',
  scenarioTags: ['meeting', 'listening-repair'],
  breakdownType: 'listening_gap',
  sourceTurnIds: [turnId],
  userAttempt: 'Could you repeat it?',
  naturalRecast: 'Could you repeat that?',
  cueLevelUsed: 1,
  lastOutcome: 'assisted',
  examples: [
    {
      id: 'example-1',
      scenarioTag: 'meeting',
      partnerTurn: 'We should move the launch date to Friday.',
      learnerTurn: 'Could you repeat that?',
      meaningKo: 'Ask for repetition in a meeting.',
      targetExpression: 'Could you repeat that?',
      sourceTurnIds: [turnId],
    },
  ],
  scheduling: {
    reps: 0,
    lapses: 0,
    difficulty: 0.55,
    stability: 1,
    dueAt,
  },
};

const learnerProfile = {
  schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
  id: 'profile-1',
  learnerId: 'learner-local',
  createdAt: now,
  updatedAt: now,
  profileLocale: 'ko-KR',
  targetLanguage: 'en-US',
  privacyMode: 'local_only',
  metrics: {
    conversationRecoveryRate: 0.6,
    independentTransferRate: 0.2,
    assistedExactRate: 0.1,
    activeRecallDueCount: 1,
    totalSessions: 1,
  },
  ability: {
    recall: 0.4,
    listening: 0.35,
    grammar: 0.5,
    wordChoice: 0.45,
    pronunciation: 0.5,
    turnTaking: 0.4,
  },
  learningItems: [learningItem],
  recentAssistEpisodeIds: [assistEpisode.id],
};

assert.equal(ECHO_DOMAIN_V2_SCHEMA_VERSION, '2.0.0');
assert.deepEqual(Object.keys(ECHO_DOMAIN_V2_SCHEMAS).sort(), [
  'assistDecision',
  'assistEpisode',
  'autoAssistSignalEvidence',
  'conversationInputEvidence',
  'conversationTurn',
  'cue',
  'dialogueExample',
  'learnerProfile',
  'learningItem',
]);

assert.ok(isConversationTurn(conversationTurn), 'valid partner ConversationTurn should pass');
assert.deepEqual(conversationTurn.inputEvidence, {
  inputMode: 'g2_bridge_pcm',
  speakerAttribution: 'single_stream_unresolved',
  sampleRateHz: 16000,
  channelCount: 1,
  encoding: 'pcm_s16le_mono',
});
assert.ok(isCue(cue), 'valid stepped Cue should pass');
assert.ok(isAssistEpisode(assistEpisode), 'valid AssistEpisode should pass');
assert.ok(isAutoAssistSignalEvidence(autoAssistSignalEvidence), 'valid AutoAssistSignalEvidence should pass');
assert.ok(isLearningItem(learningItem), 'valid LearningItem should pass');
assert.ok(isLearnerProfile(learnerProfile), 'valid LearnerProfile should pass');

const unsafeTurn = {
  ...conversationTurn,
  id: 'turn-unsafe',
  transcript: '<img src=x onerror=alert(1)>',
};
const unsafeResult = validateConversationTurn(unsafeTurn);
assert.equal(unsafeResult.ok, false, 'HTML-like learner text must be rejected');
assert.ok(
  unsafeResult.issues.some((entry) => entry.path === 'transcript'),
  'unsafe transcript should report a transcript issue',
);

const missingVersion = {
  ...conversationTurn,
  schemaVersion: '1.0.0',
};
assert.equal(validateConversationTurn(missingVersion).ok, false, 'schemaVersion is mandatory for migrations');

const extraTurnField = {
  ...conversationTurn,
  rawTranscriptDebug: 'This field is outside the public ConversationTurn contract.',
};
const extraTurnFieldResult = validateConversationTurn(extraTurnField);
assert.equal(extraTurnFieldResult.ok, false, 'runtime guards must reject unknown ConversationTurn fields');
assert.ok(
  extraTurnFieldResult.issues.some((entry) => entry.path === 'rawTranscriptDebug'),
  'unknown ConversationTurn fields should be reported by name',
);

const mismatchedInputEvidence = {
  ...conversationTurn,
  id: 'turn-bad-input-evidence',
  source: 'phone',
  inputEvidence: createConversationInputEvidence('g2'),
};
const mismatchedInputEvidenceResult = validateConversationTurn(mismatchedInputEvidence);
assert.equal(
  mismatchedInputEvidenceResult.ok,
  false,
  'ConversationTurn input evidence must match source provenance',
);
assert.ok(
  mismatchedInputEvidenceResult.issues.some((entry) => entry.path === 'inputEvidence.inputMode'),
  'mismatched input evidence should report the input mode',
);

const incompleteG2PcmEvidence = {
  ...conversationTurn,
  id: 'turn-incomplete-g2-pcm',
  inputEvidence: {
    inputMode: 'g2_bridge_pcm',
    speakerAttribution: 'single_stream_unresolved',
  },
};
const incompleteG2PcmEvidenceResult = validateConversationTurn(incompleteG2PcmEvidence);
assert.equal(
  incompleteG2PcmEvidenceResult.ok,
  false,
  'G2 bridge input evidence must carry the 16 kHz mono PCM contract',
);
assert.ok(
  incompleteG2PcmEvidenceResult.issues.some((entry) => entry.path === 'inputEvidence.sampleRateHz'),
  'incomplete G2 PCM evidence should report the missing sample rate',
);

const extraLearningItemField = {
  ...learningItem,
  rawSessionExcerpt: 'This field should not be preserved in imported review JSON.',
};
assert.equal(
  isLearningItem(extraLearningItemField),
  false,
  'runtime guards must reject unknown LearningItem fields',
);

const weakAutoAssistSignalEvidence = {
  ...autoAssistSignalEvidence,
  id: 'auto-assist-weak',
  signalCount: 1,
  signals: ['adaptive_silence'],
};
const weakAutoAssistResult = validateAutoAssistSignalEvidence(weakAutoAssistSignalEvidence);
assert.equal(
  weakAutoAssistResult.ok,
  false,
  'Auto Assist cannot show from silence alone',
);
assert.ok(
  weakAutoAssistResult.issues.some((entry) => entry.path === 'signalCount'),
  'weak Auto Assist evidence should report the signal count',
);

assert.equal(
  isAutoAssistSignalEvidence({
    ...autoAssistSignalEvidence,
    action: 'none',
    blockedBy: 'partner_speaking',
    latestSpeaker: 'partner',
  }),
  true,
  'blocked Auto Assist evidence should carry an explicit blocker',
);

const extraNestedProfileField = {
  ...learnerProfile,
  metrics: {
    ...learnerProfile.metrics,
    rawTranscriptCount: 1,
  },
};
assert.equal(
  isLearnerProfile(extraNestedProfileField),
  false,
  'runtime guards must reject unknown nested LearnerProfile fields',
);

console.info('[validate:echo-domain-v2] schemas and runtime guards passed');
