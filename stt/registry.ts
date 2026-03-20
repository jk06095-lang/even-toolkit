import type { STTProvider } from './types';

export async function createProvider(type: string): Promise<STTProvider> {
  switch (type) {
    case 'web-speech': {
      const { WebSpeechProvider } = await import('./providers/web-speech');
      return new WebSpeechProvider();
    }
    case 'whisper-local': {
      const { WhisperLocalProvider } = await import('./providers/whisper-local/provider');
      return new WhisperLocalProvider();
    }
    case 'whisper-api': {
      const { WhisperApiProvider } = await import('./providers/whisper-api');
      return new WhisperApiProvider();
    }
    case 'deepgram': {
      const { DeepgramProvider } = await import('./providers/deepgram');
      return new DeepgramProvider();
    }
    default:
      throw new Error(`Unknown STT provider: ${type}`);
  }
}
