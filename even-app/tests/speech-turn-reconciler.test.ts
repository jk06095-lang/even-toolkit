import { beforeEach, describe, expect, it } from 'vitest';
import { SpeechTurnReconciler } from '../src/combat/speech-turn-reconciler';
import { TranscriptStore } from '../src/combat/transcript-store';
import type { ConversationTurnSource } from '@toolkit/echo-domain-v2';

class MemoryStorage {
  private data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }
}

function installStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
}

describe('SpeechTurnReconciler', () => {
  let now = 1_000;
  let source: ConversationTurnSource = 'phone';
  let nextId = 1;

  beforeEach(() => {
    installStorage();
    now = 1_000;
    source = 'phone';
    nextId = 1;
  });

  function createStore(): TranscriptStore {
    return new TranscriptStore(1, 'Conversation', 'general', {
      now: () => now,
      defaultTurnSource: 'phone',
      idFactory: () => `turn-${nextId++}`,
    });
  }

  function createReconciler(store: TranscriptStore): SpeechTurnReconciler {
    return new SpeechTurnReconciler(store, {
      now: () => now,
      getTurnSource: () => source,
    });
  }

  it('updates partial and final recognizer text on the same conversation turn', () => {
    const store = createStore();
    const reconciler = createReconciler(store);

    const first = reconciler.recordPartial('Could you', 0.42);
    now += 250;
    const second = reconciler.recordPartial('Could you clarify', 0.58);
    now += 250;
    const final = reconciler.recordFinal('Could you clarify the timeline?', 'live_final', 0.88);

    expect(first?.id).toBe('turn-1');
    expect(second?.id).toBe(first?.id);
    expect(final?.turn?.id).toBe(first?.id);
    expect(final?.legacyEntryRecorded).toBe(true);

    const snapshot = store.getSnapshot();
    expect(snapshot.conversationTurns).toHaveLength(1);
    expect(snapshot.conversationTurns?.[0]).toMatchObject({
      id: 'turn-1',
      transcript: 'Could you clarify the timeline?',
      confidence: 0.88,
      isFinal: true,
      source: 'phone',
    });
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]).toMatchObject({
      text: 'Could you clarify the timeline?',
      source: 'live_final',
      isFinal: true,
      confidence: 0.88,
    });
  });

  it('starts a new turn after the speech segment boundary is reset', () => {
    const store = createStore();
    const reconciler = createReconciler(store);

    const first = reconciler.recordPartial('First segment', 0.5);
    reconciler.resetActiveTurn();
    const second = reconciler.recordPartial('Second segment', 0.6);

    expect(first?.id).toBe('turn-1');
    expect(second?.id).toBe('turn-2');
    expect(store.getSnapshot().conversationTurns).toHaveLength(2);
  });

  it('records a speech-evaluation fallback final when no live partial exists', () => {
    const store = createStore();
    const reconciler = createReconciler(store);

    source = 'g2';
    const final = reconciler.recordFinal('I need a little more time.', 'gemini_eval', undefined);

    expect(final?.turn).toMatchObject({
      id: 'turn-1',
      transcript: 'I need a little more time.',
      source: 'g2',
      isFinal: true,
    });
    expect(final?.legacyEntryRecorded).toBe(true);
    expect(store.getSnapshot().entries[0]).toMatchObject({
      text: 'I need a little more time.',
      source: 'gemini_eval',
      isFinal: true,
    });
  });
});
