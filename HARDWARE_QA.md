# Hardware QA

Use [docs/project-echo-hardware-qa.template.json](./docs/project-echo-hardware-qa.template.json)
as the required physical G2 evidence manifest for issues #2, #3, #4, #6, #12,
#13, and #14.
The draft template is shape-checked by `npm run validate:hardware-template`
inside `npm run verify:all`. Final hardware QA must pass:

```bash
npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json
```

Every final `evidenceRef`, `videoEvidence`, `debugLogRef`, `bundleReportRef`,
and `deviceEvidenceRef` must be a non-placeholder `https://` URL or a repo path
to an evidence file such as `.md`, `.json`, `.log`, image, or video. Plain
status text such as `done` is not accepted as evidence.
For lifecycle QA, final numeric cleanup counters must be recorded as `0`; a
plain boolean pass is not enough for the completed hardware evidence.

## Session lifecycle

- Start and end a practice session 10 times.
- Confirm no duplicate microphone streams remain.
- Confirm no duplicate HUD callbacks remain.
- Confirm pause and resume do not multiply timers.
- Confirm ending a session clears active cue state.
- For every cycle, record zero active mic streams, zero active VAD detectors,
  zero pending timeouts, zero pending intervals, and zero late HUD updates after
  `END PRACTICE`.

## End Practice vs Exit ECHO

`END PRACTICE` and `EXIT ECHO` must be tested separately.

`END PRACTICE` expected cleanup:

- VAD stops.
- G2 audio capture stops.
- Phone/Web Speech recognition stops when active.
- Silence countdown and HUD flash timers clear.
- The current session is finalized; raw transcript storage occurs only when `Save transcripts` is enabled.
- The glasses return to standby.
- Late cue/transcription/grammar responses do not update the HUD.

`EXIT ECHO` expected cleanup:

- Runs the same practice cleanup.
- Does not return to standby first.
- Calls Even Hub page shutdown with exit target `1`.
- Clears HUD event/status listeners.
- Leaves no active audio capture.

Ten-cycle test:

1. Start a G2 Mic session.
2. Trigger the HUD pause menu.
3. Select `END PRACTICE`.
4. Confirm standby returns.
5. Start another session.
6. Repeat until 10 completed cycles.
7. Repeat once with `EXIT ECHO` as the final action.
8. Confirm audio packet callbacks, status polling, and Web Speech callbacks are not duplicated.

Automated coverage added on 2026-06-19:

- `session-engine-core` repeats 10 start/stop cycles with a shared fake clock.
- Each cycle verifies VAD start/stop parity, recognizer start/stop parity, no active detector after cleanup, and zero pending timeouts or intervals.
- Late Web Speech interim/final/error callbacks after cleanup are ignored and do not update HUD or transcript callbacks.
- Late VAD speech/silence callbacks after cleanup do not update HUD state.

Still requires real G2 validation:

- Confirm `END PRACTICE` returns glasses to `READY` standby after physical G2 audio capture stops.
- Confirm `EXIT ECHO` calls Even Hub shutdown target `1`, clears status/audio subscriptions, and leaves no active hardware capture.
- Confirm `EXIT ECHO` records zero active audio captures, zero pending timeouts,
  zero pending intervals, and zero late HUD updates after shutdown.
- Capture the 10-cycle hardware notes under issue #10.

## Audio source separation

- With `G2 Mic` selected, Phone Mic must not open.
- With `Phone Mic` selected, G2 PCM is not required.
- If G2 Mic fails, the app must ask the user to select Phone Mic instead of switching silently.

## VAD calibration QA

- Run calibration, then start a G2 Mic session and confirm the console logs the active BridgeVAD threshold.
- Confirm the calibration result shows VAD threshold and noise floor in the phone UI.
- Quiet room: record threshold, false starts, and missed speech.
- Cafe background: record threshold, false starts, and missed speech.
- Air-conditioner noise: record threshold, false starts, and missed speech.
- Outdoor stationary wind: record threshold, false starts, and missed speech.
- Confirm higher noise-floor environments produce a higher BridgeVAD threshold than quiet room.
- Final pilot evidence must keep `vadSpeechFloorRms` greater than
  `vadNoiseFloorRms`, keep `vadSpeechThreshold` between the two floors, and keep
  cafe/air-conditioner/outdoor noise floor and threshold values at or above the
  quiet-room values.
- If calibration is skipped or produces too few samples, confirm fallback threshold `0.015` is used.
- After each environment run, export `Review -> Export my data` and preserve `eventAnalytics.vadSpeechThreshold`, `vadNoiseFloorRms`, `vadSpeechFloorRms`, `audioSource`, and cue latency fields.
- Summarize exports with `cd even-app && npm run qa:summarize-export -- path/to/echo_my_data.json`.
- Record quiet room, cafe background, air-conditioner noise, and outdoor wind
  results under `vadCalibration.environments` in
  [docs/project-echo-pilot-evidence.template.json](./docs/project-echo-pilot-evidence.template.json).

## Delayed proxy QA

- Start a local or staging ECHO API proxy with `ECHO_PROXY_QA_DELAY_MS=5000`
  and confirm `/healthz` reports `qaDelayMs: 5000`.
- Point the app build/session at that delayed proxy.
- Start a session, trigger a cue request, then select `END PRACTICE` before the proxy returns.
- Confirm the delayed response does not update the G2 HUD or phone cue card after the session ends.
- Repeat the same delayed response test with Pause and Exit ECHO.
- Confirm console/session metadata shows request ID, request scope, network latency, generation latency, HUD rendering latency, and end-to-end latency.
- For each delayed scenario, record `latencyMetadata` with
  `session_request_scope_id`, `request_id`, `request_kind`,
  `silence_detected_at`, `cue_request_started_at`,
  `cue_response_received_at`, `cue_displayed_at`, `network_latency_ms`,
  `generation_latency_ms`, `hud_render_latency_ms`, `end_to_end_latency_ms`,
  `late_response_latency_ms`, and `rawTranscriptInMetadata`.
- When a delayed response is ignored after cleanup, `cue_displayed_at`,
  `hud_render_latency_ms`, and `end_to_end_latency_ms` may be `null`, but the
  request/response timing and latency fields must still be numeric.
- Confirm debug logs do not print raw transcript text as part of latency metadata.

Automated coverage added on 2026-06-19:

- `session-engine-core` verifies `END PRACTICE` aborts an in-flight cue request and ignores its delayed response.
- `session-engine-core` verifies Pause during cue generation aborts the cue request, keeps the engine paused, leaves no pending timers, and does not update HUD/cue callbacks.
- `session-engine-core` verifies live recognizer transcription receives the current session request scope and per-request ID generator.
- `transcript-export` verifies session-analysis requests carry scoped request metadata, skip already-aborted requests, and ignore delayed aborted responses by returning fallback handoff data.
- `security-release` verifies bridge recognizers do not log raw final or interim transcript text.

Still requires real G2 validation:

- Repeat delayed cue tests through the physical G2 HUD pause menu and phone controls.
- Confirm `EXIT ECHO` follows the same delayed-response guard while shutting down the Even Hub page container.

## Privacy controls QA

- With default settings, confirm Live Practice does not start until `Use microphone` is enabled.
- With `Cloud processing` off, start a session and confirm no ECHO API proxy cue, transcription, grammar, or session-analysis requests are sent.
- With `Cloud processing` on, confirm live final transcripts do not trigger
  grammar/session-analysis calls during the conversation; deeper analysis should
  wait for Review/export flows.
- Disconnect or misconfigure the ECHO API proxy and confirm manual cue requests
  still show a local fallback cue instead of blocking the session.
- With `Save transcripts` off, complete a session and confirm `echo_transcripts` and `echo_transcript_buffer` do not contain raw utterance text.
- Confirm `echo_session_events` contains only counts/flags and no utterance, hint, audio, or request body text.
- Confirm `Export my data` includes privacy-safe QA telemetry such as cue latency p50/p95, assist counts, audio source, and VAD calibration fields without raw utterance or cue text when transcript saving is off.
- Confirm the first-run retention selector defaults to `Delete after session`.
- Enable `Save transcripts`, complete a session, and confirm a saved session appears in Review.
- Test each retention option: `Delete after session`, `1 day`, `7 days`, and `Until deleted`.
- Confirm `Delete current session`, per-session `Delete`, `Delete all transcripts`, per-session `Export`, and `Export my data` work from Review.

## Assist mode QA

- Start a new practice session and confirm the phone UI shows `Assist: Manual`.
- Stay silent past the threshold and confirm no cue appears automatically.
- Double click on G2 and confirm a cue appears.
- Press `Cue` on the phone and confirm the same manual cue path works in simulator/browser checks.
- Swipe while a cue is visible and confirm it disappears.
- Start speaking while a cue is visible and confirm the cue clears immediately.
- Switch to `Auto`, stay silent past the threshold, and confirm an auto cue appears.
- Dismiss two auto cues and confirm the phone UI shows `Assist: Auto paused`.
- Confirm auto cue count never exceeds 3 in one session.
- Record final Assist metrics under `assist.metrics`: `manual_request_count`,
  `auto_trigger_count`, `cue_dismissed_count`, `false_trigger_count`, and
  `cue_used_count`. Final hardware QA requires at least one manual request, one
  auto trigger, and two dismissed cues to prove the safety path was exercised.
- Confirm `rawTranscriptInMetrics` is `false`; Assist metrics must be counts and
  flags only, not raw learner utterances or cue text.

Automated coverage added on 2026-06-19:

- `session-engine-core` verifies Manual Assist does not auto-generate cues during silence.
- `hud-controller` verifies active-session G2 cue/dismiss gestures map to `request-cue` and `dismiss-cue`.
- `hud-controller` verifies the pause menu keeps `END PRACTICE` and `EXIT ECHO` as distinct actions.

Still requires real G2 validation:

- Confirm physical double-click, swipe, and select gestures produce the same actions on device.
- Confirm the phone UI displays Manual/Auto status and Auto-paused state during the same hardware run.

## Audio source separation QA

- Start a session with `G2 Mic` selected and confirm VAD reports `bridge`.
- Confirm the speech recognizer mode is `bridge`, not `hybrid`.
- Confirm Web Speech / Phone Mic permission does not start during a G2 Mic session.
- Stop the session, explicitly select `Phone Mic`, and confirm VAD reports `browser`.
- Confirm Phone Mic recognition starts only after that explicit user selection.
- Simulate or trigger a G2 Mic start failure and confirm Phone Mic remains closed
  until the user accepts a fallback prompt.
- Cancel the fallback prompt and confirm no phone microphone capture starts.
- Record this under `audioSources` in
  [docs/project-echo-hardware-qa.template.json](./docs/project-echo-hardware-qa.template.json):
  G2 selected source, VAD source, recognizer mode, Web Speech state, phone mic
  state, fallback prompt behavior, and evidence refs.

Automated coverage added on 2026-06-19:

- `session-engine-core` verifies G2 Mic starts `bridge` recognition and never
  calls the hybrid/Web Speech recognizer path.
- `session-engine-core` verifies Phone Mic starts browser recognition only when
  that source is explicitly selected.
- `session-engine-core` verifies pause/resume keeps G2 recognition in bridge mode.
- `live-practice-controller` verifies the Phone Mic fallback prompt is offered
  only after a G2 Mic start failure, never as a silent fallback.

Still requires real G2 validation:

- Confirm the physical G2/phone permission prompts match the automated source
  policy on device.

## Wear status QA

- With the G2 connected and worn, capture the bridge/status payload and confirm
  `parseWearingState` records `wearing`.
- With the G2 connected but not worn, capture the bridge/status payload and
  confirm the phone UI shows `Not wearing`, not `Wearing`.
- With the G2 connected but no wear sensor field available, confirm the phone UI
  shows `Wear status unavailable`.
- Confirm connection alone never forces `wearing`.
- Record the three cases under `wearingState` in
  [docs/project-echo-hardware-qa.template.json](./docs/project-echo-hardware-qa.template.json),
  including input status payloads, parsed state, phone label, and evidence refs.

Automated coverage added on 2026-06-19:

- `hud-controller` verifies boolean, numeric, string, absent, and
  connected-but-not-wearing status payloads map to `wearing`, `not-wearing`, or
  `unavailable` without using connection as a forced success state.

Still requires real G2 validation:

- Confirm the physical/simulator status payloads and phone labels match the
  automated parser behavior.

## Simplified HUD QA

- Standby screen shows `READY` only.
- Normal live speech shows `LISTENING` only.
- Live transcript, grammar corrections, hint history, expression usage, silence
  stats, and debrief details remain on the phone UI, not on G2.
- Cue display shows `CUE` plus one short phrase only.
- Pause/menu flow never overlaps transcript, cue history, or status metrics.
- Resume returns to `LISTENING`; End Practice returns to `READY`.
- The completed hardware QA manifest must contain exactly `READY`, `LISTENING`,
  `CUE`, and `PAUSED` under `hud.states`; extra live G2 HUD states are rejected.

Automated coverage added on 2026-06-19:

- `hud-controller` verifies live G2 rendering is limited to `READY`, `LISTENING`, `CUE`, and `PAUSED`.
- `hud-controller` verifies transcript text, grammar feedback, and achievement detail do not render on the live G2 surface.
- `hud-controller` verifies long cues are clipped to a glanceable phrase.

Still requires real G2 validation:

- Confirm READY, LISTENING, CUE, PAUSED, and the pause menu render without overlap on the physical glasses or Even Hub simulator.

## Voice runtime lazy-load QA

Run this after any change to `@ricky0123/vad-web`, `onnxruntime-web`, VAD
initialization, or audio source switching.

- Build the app and run `cd even-app && npm run bundle:report`.
- Run `cd even-app && npm run bundle:check`; this is also included in `npm run verify:all`.
- Confirm the report marks `voice-runtime-*` and ONNX/WASM runtime assets as `on demand`.
- Confirm `dist/index.html` does not preload a `voice-runtime-*` chunk.
- Confirm the largest initial JS chunk remains under the Vite warning threshold.
- Record `voiceRuntime.bundleMetrics` from the bundle report: largest initial JS
  kB, initial JS limit kB, voice-runtime JS/gzip kB, ONNX/WASM kB/gzip kB,
  `voiceRuntimeLoad`, `onnxWasmLoad`, and whether `dist/index.html` preloads
  the voice runtime. Final hardware QA requires the initial JS chunk to stay at
  or below `500` kB and both runtime assets to remain `on demand`.
- Start a physical G2 Mic session and confirm G2 audio/VAD starts without opening Phone Mic.
- Select Phone Mic explicitly and confirm the voice runtime loads only after that user action.
- Pause and resume the session; confirm no duplicate VAD/runtime initialization occurs.
- Select `END PRACTICE`; confirm audio capture stops and `READY` returns.
- Switch audio sources through the phone UI and confirm no silent phone fallback occurs.
- Record `bundleReportRef` and `deviceEvidenceRef` under `voiceRuntime` in
  [docs/project-echo-hardware-qa.template.json](./docs/project-echo-hardware-qa.template.json).

## Metrics to capture

- G2 mic success rate
- Phone fallback rate
- False silence detection rate
- Missed speech rate
- Cue p50 latency
- Cue p95 latency
- Crash count
- Reconnect count
- Battery consumption

Record these metrics in
[docs/project-echo-pilot-evidence.template.json](./docs/project-echo-pilot-evidence.template.json)
after the real-device pilot. The draft template is checked by
`npm run validate:pilot-template`; final evidence must pass:

```bash
npm run validate:pilot-evidence -- docs/project-echo-pilot-evidence.completed.json
```

## User test measures

- Time to first utterance
- Cue usage rate
- Cue dismissal rate
- False cue rate
- Phone checks during conversation
- Eye-contact breaks
- Interruption rating from 1 to 7
- Trust rating from 1 to 7
- Privacy concern from 1 to 7
