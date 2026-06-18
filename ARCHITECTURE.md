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

## Assist modes

- `Manual Assist` is the default for every new practice session.
- In Manual Assist, a cue is generated only after an explicit user request from the G2 double click or phone `Cue` button.
- In Manual Assist, silence is recorded as an event but does not automatically call the cue endpoint.
- `Auto Assist` is explicit opt-in from the phone UI.
- Auto Assist is capped at 3 automatic interventions per session.
- Swiping while a cue is visible dismisses it. Two dismissed auto cues pause Auto Assist for the rest of the session.
- Speech start immediately clears the visible cue from the HUD while preserving local usage tracking for the next final transcript.

## Release checks

Use:

```bash
cd even-app
npm run verify
```

This runs tests, typecheck, build, and `.ehpk` packaging.
