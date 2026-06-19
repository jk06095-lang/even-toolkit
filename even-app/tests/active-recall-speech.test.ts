import { describe, expect, it } from 'vitest';
import {
  ActiveRecallBridgeSpeechCapture,
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

  emitResult(parts: Array<{ text: string; isFinal: boolean; confidence?: number }>): void {
    const results = parts.map((part) => ({
      isFinal: part.isFinal,
      0: {
        transcript: part.text,
        confidence: part.confidence,
      },
    }));
    this.onresult?.({
      resultIndex: 0,
      results,
    });
  }
}

class FakeHud {
  connected = true;
  captureStates: boolean[] = [];
  listeners: Array<(pcm: Uint8Array) => void> = [];

  onAudioData(cb: (pcm: Uint8Array) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((listener) => listener !== cb);
    };
  }

  async setAudioCapture(enabled: boolean): Promise<void> {
    this.captureStates.push(enabled);
  }

  emitPcm(bytes: Uint8Array): void {
    for (const listener of this.listeners) {
      listener(bytes);
    }
  }
}

class FakeBridgeRecognizer {
  startBridgeCount = 0;
  feedCount = 0;
  speechStartCount = 0;
  speechEndCount = 0;
  stopCount = 0;

  constructor(private readonly callbacks: any) {}

  startBridge(): boolean {
    this.startBridgeCount += 1;
    return true;
  }

  feedPCM(samples: Float32Array): void {
    this.feedCount += 1;
    expect(samples.length).toBeGreaterThan(0);
  }

  notifySpeechStart(): void {
    this.speechStartCount += 1;
  }

  notifySpeechEnd(): void {
    this.speechEndCount += 1;
    this.callbacks.onFinalResult('Could you repeat that?', 0.72);
  }

  stop(): void {
    this.stopCount += 1;
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
    const confidences: Array<number | undefined> = [];
    const statuses: ActiveRecallSpeechStatus[] = [];
    const capture = new ActiveRecallSpeechCapture(
      {
        onInterim: (text) => interim.push(text),
        onFinal: (text, confidence) => {
          final.push(text);
          confidences.push(confidence);
        },
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
      { text: 'repeat that', isFinal: true, confidence: 0.82 },
    ]);

    expect(interim).toEqual(['sorry can you']);
    expect(final).toEqual(['repeat that']);
    expect(confidences).toEqual([0.82]);

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

  it('captures G2 bridge recall attempts without using phone Web Speech confidence', async () => {
    const hud = new FakeHud();
    const statuses: ActiveRecallSpeechStatus[] = [];
    const final: Array<{ text: string; confidence?: number }> = [];
    let recognizer!: FakeBridgeRecognizer;
    const capture = new ActiveRecallBridgeSpeechCapture(
      {
        onFinal: (text, confidence) => final.push({ text, confidence }),
        onStatus: (status) => statuses.push(status),
      },
      {
        hud,
        isEchoApiConfigured: () => true,
        minSilenceFrames: 2,
        recognizerFactory: (callbacks) => {
          recognizer = new FakeBridgeRecognizer(callbacks);
          return recognizer;
        },
      },
    );

    await expect(capture.start()).resolves.toEqual({ ok: true });
    expect(hud.captureStates).toEqual([true]);
    expect(statuses).toEqual(['listening']);
    expect(recognizer.startBridgeCount).toBe(1);

    hud.emitPcm(pcmPacket(5000));
    hud.emitPcm(pcmPacket(5000));
    hud.emitPcm(pcmPacket(0));
    hud.emitPcm(pcmPacket(0));

    expect(recognizer.feedCount).toBe(4);
    expect(recognizer.speechStartCount).toBe(1);
    expect(recognizer.speechEndCount).toBe(1);
    expect(final).toEqual([{ text: 'Could you repeat that?', confidence: 0.72 }]);

    await capture.stop();
    expect(recognizer.stopCount).toBe(1);
    expect(hud.captureStates).toEqual([true, false]);
    expect(statuses.at(-1)).toBe('idle');
  });

  it('keeps G2 bridge recall gated on connection and proxy configuration', async () => {
    const disconnectedHud = new FakeHud();
    disconnectedHud.connected = false;
    const disconnectedStatuses: ActiveRecallSpeechStatus[] = [];
    const disconnected = new ActiveRecallBridgeSpeechCapture(
      { onStatus: (status) => disconnectedStatuses.push(status) },
      { hud: disconnectedHud, isEchoApiConfigured: () => true },
    );

    await expect(disconnected.start()).resolves.toEqual({
      ok: false,
      reason: 'g2_unavailable',
    });
    expect(disconnectedStatuses).toEqual(['g2_unavailable']);
    expect(disconnectedHud.captureStates).toEqual([]);

    const unconfiguredHud = new FakeHud();
    const unconfiguredStatuses: ActiveRecallSpeechStatus[] = [];
    const unconfigured = new ActiveRecallBridgeSpeechCapture(
      { onStatus: (status) => unconfiguredStatuses.push(status) },
      { hud: unconfiguredHud, isEchoApiConfigured: () => false },
    );

    await expect(unconfigured.start()).resolves.toEqual({
      ok: false,
      reason: 'proxy_unconfigured',
    });
    expect(unconfiguredStatuses).toEqual(['proxy_unconfigured']);
    expect(unconfiguredHud.captureStates).toEqual([]);
  });
});

function pcmPacket(value: number): Uint8Array {
  const bytes = new Uint8Array(320);
  const view = new DataView(bytes.buffer);
  for (let offset = 0; offset < bytes.byteLength; offset += 2) {
    view.setInt16(offset, value, true);
  }
  return bytes;
}
