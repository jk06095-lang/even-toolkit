import { describe, expect, it } from 'vitest';
import {
  ActiveRecallSpeechCapture,
  type ActiveRecallSpeechStatus,
} from '../src/learning/active-recall-speech';

class FakeRecognition {
  static instances: FakeRecognition[] = [];

  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;
  stopCalled = false;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start(): void {
    this.onstart?.();
  }

  stop(): void {
    this.stopCalled = true;
    this.onend?.();
  }

  emitResult(parts: Array<{ text: string; isFinal: boolean }>): void {
    const results = parts.map((part) => ({
      isFinal: part.isFinal,
      0: {
        transcript: part.text,
      },
    }));
    this.onresult?.({
      resultIndex: 0,
      results,
    });
  }
}

describe('active recall speech capture', () => {
  it('reports secure origin requirements before starting recognition', () => {
    const statuses: ActiveRecallSpeechStatus[] = [];
    const capture = new ActiveRecallSpeechCapture(
      {
        onStatus: (status) => statuses.push(status),
      },
      {
        speechRecognitionFactory: () => null,
        isSecureContext: false,
        hostname: 'example.com',
      },
    );

    expect(capture.start()).toEqual({
      ok: false,
      reason: 'secure_origin_required',
    });
    expect(statuses).toEqual(['secure_origin_required']);
  });

  it('captures interim and final voice attempts without logging raw text', () => {
    FakeRecognition.instances = [];
    const interim: string[] = [];
    const final: string[] = [];
    const statuses: ActiveRecallSpeechStatus[] = [];
    const capture = new ActiveRecallSpeechCapture(
      {
        onInterim: (text) => interim.push(text),
        onFinal: (text) => final.push(text),
        onStatus: (status) => statuses.push(status),
      },
      {
        speechRecognitionFactory: () => FakeRecognition,
        isSecureContext: true,
        hostname: 'even.local',
      },
    );

    expect(capture.start()).toEqual({ ok: true });
    const recognition = FakeRecognition.instances[0]!;
    expect(recognition.continuous).toBe(false);
    expect(recognition.interimResults).toBe(true);
    expect(recognition.lang).toBe('en-US');
    expect(statuses).toEqual(['listening']);

    recognition.emitResult([
      { text: 'sorry can you', isFinal: false },
      { text: 'repeat that', isFinal: true },
    ]);

    expect(interim).toEqual(['sorry can you']);
    expect(final).toEqual(['repeat that']);

    capture.stop();
    expect(recognition.stopCalled).toBe(true);
    expect(statuses.at(-1)).toBe('idle');
  });

  it('surfaces unsupported browser state on localhost without blocking the page', () => {
    const statuses: ActiveRecallSpeechStatus[] = [];
    const capture = new ActiveRecallSpeechCapture(
      {
        onStatus: (status) => statuses.push(status),
      },
      {
        speechRecognitionFactory: () => null,
        isSecureContext: false,
        hostname: 'localhost',
      },
    );

    expect(capture.start()).toEqual({
      ok: false,
      reason: 'not_supported',
    });
    expect(statuses).toEqual(['unsupported']);
  });
});
