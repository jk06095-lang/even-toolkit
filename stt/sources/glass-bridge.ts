import type { AudioSource } from '../types';
import { uint8ToPcm16, pcm16ToFloat32 } from '../audio/pcm-utils';

const GLASS_SAMPLE_RATE = 16000;

export interface GlassBridgeSourceConfig {
  /** The EvenHub bridge instance that fires audio events */
  bridge: {
    onEvent(handler: (event: GlassAudioEvent) => void): void;
  };
}

export interface GlassAudioEvent {
  audioEvent?: {
    audioPcm?: Uint8Array;
  };
}

/**
 * AudioSource for G2 smart glasses.
 * Listens for audio PCM events from the EvenHub SDK bridge
 * and converts 16-bit PCM to Float32.
 */
export class GlassBridgeSource implements AudioSource {
  private config: GlassBridgeSourceConfig;
  private listeners: Array<(pcm: Float32Array, sampleRate: number) => void> = [];
  private listening = false;

  constructor(config: GlassBridgeSourceConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.listening) return;
    this.listening = true;

    this.config.bridge.onEvent((event: GlassAudioEvent) => {
      if (!this.listening) return;
      const audioPcm = event.audioEvent?.audioPcm;
      if (!audioPcm || audioPcm.length === 0) return;

      const pcm16 = uint8ToPcm16(audioPcm);
      const float32 = pcm16ToFloat32(pcm16);

      for (const cb of this.listeners) {
        cb(float32, GLASS_SAMPLE_RATE);
      }
    });
  }

  stop(): void {
    this.listening = false;
  }

  onAudioData(cb: (pcm: Float32Array, sampleRate: number) => void): () => void {
    this.listeners.push(cb);
    return () => {
      const idx = this.listeners.indexOf(cb);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this.stop();
    this.listeners.length = 0;
  }
}
