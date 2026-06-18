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

The deploy-ready Node reference proxy lives in `echo-api-proxy/server.mjs`.
Deployment and key-rotation steps are documented in `docs/echo-api-proxy.md`.
Proxy logs must not include request bodies, raw transcript text, or audio
payloads unless a future explicit retention control enables that behavior.

## Audio modes

- `G2 Mic`: G2 PCM -> VAD -> ECHO API proxy STT
- `Phone Mic`: browser microphone -> Web Speech or ECHO API proxy STT
- `Hybrid Experiment`: reserved for explicit future opt-in, not automatic fallback

## Calibration-to-VAD path

Calibration records normalized RMS samples while the user speaks. The app
derives `noiseFloorRms`, `speechFloorRms`, `speechThreshold`, and `calibratedAt`
from those samples and stores them with the calibration result.

Runtime path:

```text
runCalibration()
  -> SessionEngine
  -> VADManager
  -> BridgeVAD.speechThreshold
```

When calibration is missing or sparse, BridgeVAD uses the conservative fallback
threshold `0.015`. Debug logs print the active BridgeVAD threshold plus the
calibrated noise and speech floors when available.

## Request guards and latency

Each live proxy request receives a per-session request scope plus request ID.
The session engine aborts in-flight proxy calls on pause and end, and ignores
responses whose request scope no longer matches the current session.

Cue latency records include:

- `silence_detected_at`
- `cue_request_started_at`
- `cue_response_received_at`
- `cue_displayed_at`
- `network_latency_ms`
- `generation_latency_ms`
- `hud_render_latency_ms`
- `end_to_end_latency_ms`

Latency records are stored as metadata only. They do not include raw transcript
text, audio payloads, or cue request bodies.

## Assist modes

- `Manual Assist` is the default for every new practice session.
- In Manual Assist, a cue is generated only after an explicit user request from the G2 double click or phone `Cue` button.
- In Manual Assist, silence is recorded as an event but does not automatically call the cue endpoint.
- `Auto Assist` is explicit opt-in from the phone UI.
- Auto Assist is capped at 3 automatic interventions per session.
- Swiping while a cue is visible dismisses it. Two dismissed auto cues pause Auto Assist for the rest of the session.
- Speech start immediately clears the visible cue from the HUD while preserving local usage tracking for the next final transcript.

## G2 HUD contract

During live conversation, the G2 display renders only one of four states:

- `READY`
- `LISTENING`
- `CUE`
- `PAUSED`

Transcript text, grammar feedback, hint history, expression usage, silence
stats, debrief details, and review planning stay on the phone UI or exported
session data. A `CUE` is clipped to a short glanceable phrase.

## Release checks

Use:

```bash
cd even-app
npm run verify
```

This runs tests, typecheck, build, and `.ehpk` packaging.

Before release, also search `even-app/dist` and `even-app/echo.ehpk` for
provider keys, direct Gemini hostnames, SDK imports, and development IPs.
