import { useState, useRef, useEffect, useCallback } from 'react';
import type { UseSTTConfig, UseSTTReturn, STTState, STTError } from '../types';
import { STTEngine } from '../engine';

export function useSTT(config: UseSTTConfig = {}): UseSTTReturn {
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadProgress] = useState(0);
  const [error, setError] = useState<STTError | null>(null);
  const [state, setState] = useState<STTState>('idle');

  const engineRef = useRef<STTEngine | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    // Dispose previous engine
    engineRef.current?.dispose();

    const cfg = configRef.current;
    const engine = new STTEngine({
      provider: cfg.provider ?? 'web-speech',
      source: cfg.source,
      language: cfg.language,
      mode: cfg.mode,
      apiKey: cfg.apiKey,
      modelId: cfg.modelId,
      continuous: cfg.continuous,
      vad: cfg.vad,
      fallback: cfg.fallback,
    });

    engineRef.current = engine;

    // Subscribe to events
    engine.onTranscript((t) => {
      if (t.isFinal) {
        setTranscript((prev) => (prev ? prev + ' ' + t.text : t.text));
        setInterimTranscript('');
      } else {
        setInterimTranscript(t.text);
      }
      cfg.onTranscript?.(t.text, t.isFinal);
    });

    engine.onStateChange((s) => {
      setState(s);
      setIsListening(s === 'listening');
      setIsLoading(s === 'loading');
      if (s === 'idle') {
        setInterimTranscript('');
      }
    });

    engine.onError((e) => {
      setError(e);
    });

    setError(null);
    await engine.start();
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
  }, []);

  const abort = useCallback(() => {
    engineRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    engineRef.current?.abort();
    setTranscript('');
    setInterimTranscript('');
    setError(null);
    setState('idle');
    setIsListening(false);
    setIsLoading(false);
  }, []);

  // Auto-start if configured
  useEffect(() => {
    if (config.autoStart) {
      start();
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    transcript,
    interimTranscript,
    isListening,
    isLoading,
    loadProgress,
    error,
    state,
    start,
    stop,
    abort,
    reset,
  };
}
