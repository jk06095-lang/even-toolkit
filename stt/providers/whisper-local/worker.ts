// WebWorker for Whisper local inference via @huggingface/transformers

let pipe: any = null;

self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data;

  if (type === 'init') {
    try {
      const { pipeline } = await import('@huggingface/transformers');
      pipe = await pipeline(
        'automatic-speech-recognition',
        e.data.modelId ?? 'onnx-community/whisper-tiny',
        {
          progress_callback: (p: any) => self.postMessage({ type: 'progress', ...p }),
        },
      );
      self.postMessage({ type: 'ready' });
    } catch (err: any) {
      self.postMessage({ type: 'error', message: err?.message ?? 'Failed to load model' });
    }
  }

  if (type === 'transcribe') {
    if (!pipe) {
      self.postMessage({ type: 'error', message: 'Model not loaded' });
      return;
    }

    try {
      const result = await pipe(e.data.audio, {
        language: e.data.language ?? 'en',
        return_timestamps: false,
      });
      self.postMessage({ type: 'result', text: result.text, confidence: 0.95 });
    } catch (err: any) {
      self.postMessage({ type: 'error', message: err?.message ?? 'Transcription failed' });
    }
  }
};
