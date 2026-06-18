# Architecture

Project ECHO is structured around a companion web app, the G2 HUD bridge, local audio/VAD handling, and a server-side AI proxy.

## AI boundary

```text
ECHO app
  -> ECHO API proxy
  -> AI provider
```

The client uses three proxy endpoints:

- `POST /v1/cue`
- `POST /v1/transcribe`
- `POST /v1/session-analysis`

The client does not import provider SDKs or read provider API keys from Vite environment variables.

## Audio modes

- `G2 Mic`: G2 PCM -> VAD -> ECHO API proxy STT
- `Phone Mic`: browser microphone -> Web Speech or ECHO API proxy STT
- `Hybrid Experiment`: reserved for explicit future opt-in, not automatic fallback

## Release checks

Use:

```bash
cd even-app
npm run verify
```

This runs tests, typecheck, build, and `.ehpk` packaging.
