import {
  ECHO_DOMAIN_V2_SCHEMA_VERSION,
  createConversationInputEvidence,
  isConversationTurn,
  type ConversationTurn,
  type SpeakerRole,
} from '@toolkit/echo-domain-v2';
import { getConversationTurns, type SessionTranscript } from './transcript-store';
import {
  getConversationTranslationState,
  type ConversationTranslationStatus,
} from './translation-queue';

export interface ImportedConversationOptions {
  sessionId: string;
  sessionStartTime: number;
  language?: string;
  defaultSpeaker?: SpeakerRole;
  defaultTurnDurationMs?: number;
  idFactory?: (index: number) => string;
}

export interface ConversationTimelineRow {
  turnId: string;
  speaker: SpeakerRole;
  speakerLabel: string;
  transcript: string;
  translationKo?: string;
  timeLabel: string;
  sourceLabel: string;
  confidenceLabel?: string;
  correctedByUser: boolean;
  translationStatus: ConversationTranslationStatus;
  translationStatusLabel?: string;
  translationWarningLabel?: string;
}

export function buildConversationTimelineRows(
  session: SessionTranscript,
  maxRows = Number.POSITIVE_INFINITY,
): ConversationTimelineRow[] {
  return getConversationTurns(session)
    .filter(shouldDisplayConversationTurn)
    .slice(0, maxRows)
    .map((turn) => toTimelineRow(turn));
}

export function parseImportedConversationTranscript(
  transcript: string,
  options: ImportedConversationOptions,
): ConversationTurn[] {
  const lines = transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const durationMs = Math.max(1, options.defaultTurnDurationMs ?? 1_000);

  return lines
    .map((line, index) => {
      const parsed = parseImportedLine(line, options.defaultSpeaker ?? 'unknown');
      const startedAt = options.sessionStartTime + index * durationMs;
      const turn: ConversationTurn = {
        schemaVersion: ECHO_DOMAIN_V2_SCHEMA_VERSION,
        id: options.idFactory?.(index) ?? `${options.sessionId}:import:${index + 1}`,
        sessionId: options.sessionId,
        speaker: parsed.speaker,
        startedAt,
        endedAt: startedAt + durationMs,
        source: 'import',
        language: options.language ?? 'en-US',
        transcript: parsed.text,
        isFinal: true,
        piiFlags: [],
        inputEvidence: createConversationInputEvidence(
          'import',
          parsed.hasExplicitSpeaker ? 'provided_by_import' : 'single_stream_unresolved',
        ),
      };

      return isConversationTurn(turn) ? turn : null;
    })
    .filter((turn): turn is ConversationTurn => turn !== null);
}

export function speakerLabel(speaker: SpeakerRole): string {
  if (speaker === 'learner') return 'Me';
  if (speaker === 'partner') return 'Partner';
  return 'Unknown';
}

function parseImportedLine(
  line: string,
  fallbackSpeaker: SpeakerRole,
): { speaker: SpeakerRole; text: string; hasExplicitSpeaker: boolean } {
  const match = line.match(/^([A-Za-z0-9 _-]{1,32}):\s*(.+)$/);
  if (!match) {
    return { speaker: fallbackSpeaker, text: line, hasExplicitSpeaker: false };
  }

  const explicitSpeaker = importedSpeakerRole(match[1] ?? '');
  const speaker = explicitSpeaker ?? fallbackSpeaker;
  return {
    speaker,
    text: (match[2] ?? '').trim(),
    hasExplicitSpeaker: explicitSpeaker !== null,
  };
}

function importedSpeakerRole(label: string): SpeakerRole | null {
  const normalized = label.toLowerCase().replace(/[\s_-]+/g, '');
  if (['me', 'i', 'learner', 'student', 'user', 'speaker1'].includes(normalized)) return 'learner';
  if (['partner', 'other', 'interviewer', 'customer', 'client', 'speaker2'].includes(normalized)) return 'partner';
  if (['unknown', 'speaker'].includes(normalized)) return 'unknown';
  return null;
}

function toTimelineRow(turn: ConversationTurn): ConversationTimelineRow {
  const translationState = getConversationTranslationState(turn);
  return {
    turnId: turn.id,
    speaker: turn.speaker,
    speakerLabel: speakerLabel(turn.speaker),
    transcript: turn.transcript,
    translationKo: turn.translationKo,
    timeLabel: formatTime(turn.startedAt),
    sourceLabel: turn.source === 'g2'
      ? 'G2 Mic'
      : turn.source === 'phone'
        ? 'Phone Mic'
        : 'Import',
    confidenceLabel: typeof turn.confidence === 'number'
      ? `${Math.round(turn.confidence * 100)}%`
      : undefined,
    correctedByUser: turn.correctedByUser === true,
    translationStatus: translationState.status,
    translationStatusLabel: translationState.status === 'pending' || translationState.status === 'failed'
      ? translationState.label
      : undefined,
    translationWarningLabel: translationState.warningLabel,
  };
}

function shouldDisplayConversationTurn(turn: ConversationTurn): boolean {
  const transcript = turn.transcript.trim();
  return transcript.length > 0 && transcript.toLowerCase() !== '[speech detected]';
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}
