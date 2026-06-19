import type { ConversationTurn, SpeakerRole } from '@toolkit/echo-domain-v2';
import { getConversationTurns, type SessionTranscript } from './transcript-store';
import {
  getConversationTranslationState,
  type ConversationTranslationStatus,
} from './translation-queue';

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
}

export function buildConversationTimelineRows(
  session: SessionTranscript,
  maxRows = Number.POSITIVE_INFINITY,
): ConversationTimelineRow[] {
  return getConversationTurns(session)
    .slice(0, maxRows)
    .map((turn) => toTimelineRow(turn));
}

export function speakerLabel(speaker: SpeakerRole): string {
  if (speaker === 'learner') return 'Me';
  if (speaker === 'partner') return 'Partner';
  return 'Unknown';
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
  };
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}
