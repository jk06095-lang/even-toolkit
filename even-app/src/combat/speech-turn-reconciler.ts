import type { ConversationTurn, ConversationTurnSource } from '@toolkit/echo-domain-v2';
import { TranscriptStore, type TranscriptEntry } from './transcript-store';

export interface SpeechTurnReconcilerOptions {
  now: () => number;
  getTurnSource: () => ConversationTurnSource;
}

export interface SpeechTurnRecordResult {
  turn: ConversationTurn | null;
  transcript: string;
  legacyEntryRecorded: boolean;
}

/**
 * Owns the speech-recognition write path for live ConversationTurn records.
 * Partial recognizer text updates one active turn, while final text closes that
 * same turn and appends the legacy user_speech entry exactly once.
 */
export class SpeechTurnReconciler {
  private activeTurnId: string | null = null;

  constructor(
    private readonly transcriptStore: TranscriptStore,
    private readonly options: SpeechTurnReconcilerOptions,
  ) {}

  resetActiveTurn(): void {
    this.activeTurnId = null;
  }

  recordPartial(text: string, confidence?: number): ConversationTurn | null {
    const transcript = text.trim();
    if (!transcript) return null;

    const now = this.options.now();
    const source = this.options.getTurnSource();
    let turn: ConversationTurn | null = null;

    if (this.activeTurnId) {
      turn = this.transcriptStore.updateConversationTurn(this.activeTurnId, {
        transcript,
        confidence,
        isFinal: false,
        endedAt: now,
        source,
      });
    }

    if (!turn) {
      turn = this.transcriptStore.addConversationTurn({
        transcript,
        source,
        confidence,
        isFinal: false,
        startedAt: now,
        endedAt: now,
      });
    }

    this.activeTurnId = turn?.id ?? null;
    return turn;
  }

  recordFinal(
    text: string,
    source: TranscriptEntry['source'],
    confidence?: number,
  ): SpeechTurnRecordResult | null {
    const transcript = text.trim();
    if (!transcript) return null;

    const finalizedAt = this.options.now();
    const turnSource = this.options.getTurnSource();
    let turn: ConversationTurn | null = null;

    if (this.activeTurnId) {
      turn = this.transcriptStore.updateConversationTurn(this.activeTurnId, {
        transcript,
        confidence,
        isFinal: true,
        endedAt: finalizedAt,
        source: turnSource,
      });
    }

    if (!turn) {
      turn = this.transcriptStore.addConversationTurn({
        transcript,
        source: turnSource,
        confidence,
        isFinal: true,
        startedAt: finalizedAt,
        endedAt: finalizedAt,
      });
    }

    this.activeTurnId = null;
    return {
      turn,
      transcript,
      legacyEntryRecorded: this.transcriptStore.addSpeechEntry(transcript, source, true, confidence),
    };
  }

  recordSpeechEvent(
    text: string,
    source: TranscriptEntry['source'] = 'speech_api',
    isFinal = true,
    confidence?: number,
  ): SpeechTurnRecordResult | null {
    const transcript = text.trim();
    if (!transcript) return null;

    const turn = this.transcriptStore.addSpeech(
      transcript,
      source,
      isFinal,
      confidence,
      this.options.getTurnSource(),
    );

    if (turn && !turn.isFinal) {
      this.activeTurnId = turn.id;
    } else {
      this.activeTurnId = null;
    }

    return {
      turn,
      transcript,
      legacyEntryRecorded: turn !== null,
    };
  }
}
