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
payloads.
Client recognizer logs use the same privacy boundary: they may report
transcription events and text length, but not learner utterance text.

## Privacy and retention

`Privacy Settings` gate microphone use, ECHO API proxy calls, raw transcript
saving, and transcript retention. The defaults are microphone off, cloud
processing off, and transcript saving off.
The default retention policy is `Delete after session`, so even explicit
transcript-saving opt-in starts from the shortest retention window.

Raw transcript text is stored by `TranscriptStore` only when `Save transcripts`
is enabled. Event analytics are stored separately in `echo_session_events` as
counts and flags only; they do not contain utterance text, hint text, audio, or
request bodies.

Retention is enforced on session finalization and when the Review export list
opens. `Delete after session` keeps no finalized raw transcript. The Review
screen provides current-session deletion, all-transcript deletion, per-session
delete/export, and a full local `Export my data` download.

## Audio modes

- `G2 Mic`: G2 PCM -> VAD -> ECHO API proxy STT
- `Phone Mic`: explicit user selection -> browser microphone -> Web Speech or ECHO API proxy STT
- `Hybrid Experiment`: reserved for explicit future opt-in, not automatic fallback

`SessionEngine` starts the recognizer in bridge-only mode for `G2 Mic`. It does
not start Web Speech or phone microphone capture while the selected source is
G2. A failed G2 microphone start surfaces an error and keeps Phone Mic closed
until the user explicitly selects or accepts a phone fallback path.

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

At session end, `TranscriptStore` persists privacy-safe `eventAnalytics` for
real-device QA exports: audio source, cue latency p50/p95/max, assist counts,
average silence, self-response rate, and calibration threshold/floors. These
analytics remain available through `Export my data` even when raw transcript
saving is off.

## SessionEngine dependency injection

`SessionEngine` owns the core session state machine, but hardware and external
services enter through injected interfaces:

- `AudioDetector` / `AudioDetectorFactory` for VAD and mic lifecycle.
- `SpeechRecognizerFactory` for live speech recognition startup and cleanup.
- `CueProvider` for cue, speech evaluation, and simplification calls.
- `GlassDisplay` for the G2 HUD contract.
- `Clock` and `Random` for timers, latency, request scopes, and blackout tests.

Live final transcripts do not trigger grammar/session-analysis requests during
conversation. Grammar and deeper analysis stay in the post-session/export path
so the real-time path remains transcription plus cue only when needed.

Cue generation remains usable without the proxy. When cloud processing is off,
the proxy is unconfigured, the cue request fails, or the proxy repeats a cue
already shown in the session, `generateChunk()` returns a local fallback cue and
labels it as `source: "fallback"`.

The default dependencies preserve production behavior. Tests can inject fake
VAD, HUD, clock, random, and cue providers so Week 4 blackout, late responses,
cue clearing, pause/resume timers, and audio cleanup run without G2 hardware or
network calls.

The core regression suite also covers pausing while cue generation is still in
flight. That path aborts the active cue request, leaves the engine in `paused`,
and prevents abort rejections or delayed responses from showing a cue later.

## Wear status

G2 connection state and wear state are separate signals. `parseWearingState`
preserves `wearing`, `not-wearing`, and `unavailable`; a connected bridge status
does not force the UI into `wearing` when the sensor reports false or omits wear
data. Only explicit true/false wear sensor tokens are accepted as
`wearing`/`not-wearing`; unknown or unexpected wear payload values remain
`unavailable` for hardware QA and phone UI reporting.

## Assist modes

- `Manual Assist` is the default for every new practice session.
- In Manual Assist, a cue is generated only after an explicit user request from the G2 double click or phone `Cue` button.
- In Manual Assist, silence is recorded as an event but does not automatically call the cue endpoint.
- `Auto Assist` is explicit opt-in from the phone UI.
- Auto Assist is capped at 3 automatic interventions per session.
- Swiping while a cue is visible dismisses it. Two dismissed auto cues pause Auto Assist for the rest of the session.
- Speech start immediately clears the visible cue from the HUD while preserving local usage tracking for the next final transcript.

## G2 HUD contract

During live conversation, the G2 display renders only one of five states:

- `READY`
- `LISTENING`
- `CUE`
- `ACK`
- `PAUSED`

Transcript text, grammar feedback, hint history, expression usage, silence
stats, debrief details, and review planning stay on the phone UI or exported
session data. A `CUE` is clipped to a short glanceable phrase, and `ACK` is a
brief OK confirmation after assisted/adapted cue use.

## Release checks

Use:

```bash
cd even-app
npm run verify
```

This runs tests, typecheck, build, and `.ehpk` packaging.

Before release, also search `even-app/dist` and `even-app/echo.ehpk` for
provider keys, direct Gemini hostnames, SDK imports, and development IPs.
