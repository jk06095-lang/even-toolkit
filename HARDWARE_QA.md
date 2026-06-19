# Hardware QA

Use [docs/project-echo-hardware-qa.template.json](./docs/project-echo-hardware-qa.template.json)
as the required physical G2 evidence manifest for open issues #2, #3, #6,
#12, #13, #14, and #28.
The draft template is shape-checked by `npm run validate:hardware-template`
inside `npm run verify:all`. Final hardware QA must pass:

```bash
npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json
```

Every final `evidenceRef`, `videoEvidence`, `debugLogRef`, `bundleReportRef`,
and `deviceEvidenceRef` must be a non-placeholder `https://` URL or a repo path
to an evidence file such as `.md`, `.json`, `.log`, image, or video. Plain
status text such as `done` is not accepted as evidence. Repo-path evidence must
point to a file that exists in the repository; future filenames are not accepted
as completed evidence.
Final hardware QA must also record `buildArtifact.packagePath` as the exact
repo-local `.ehpk` installed for the run, a SHA-256 digest that matches that
file, the packaging command, and confirmation that the same artifact was
installed through a private or beta build before the physical G2 checks.
Final background/lifecycle evidence must be captured from a private or beta
install, not QR/local testing, and must separately prove locked-phone launch,
gesture-only core flow, 2-minute idle responsiveness, unlock/use-another-app/
re-lock continuity, Android-style cold-start rebuild from `localStorage`, audio
capture re-enable after foreground, and WebSocket reconnect handling or explicit
non-use. It must also record the reviewer-parity root-page double-tap system
exit dialog, permission-denial path, and console sanity check.
The final `runDate` must be a valid ISO `YYYY-MM-DD` calendar date.
For lifecycle QA, final numeric cleanup counters must be recorded as `0`; a
plain boolean pass is not enough for the completed hardware evidence.
The final `device.appVersion` must match the current `even-app/package.json`
version so hardware evidence cannot be reused from an older app build.

Before the field run, prepare draft manifests and local artifact evidence:

```bash
npm run prepare:echo-evidence-drafts
```

This writes draft files under `docs/evidence-drafts/`, including the current app
version, `even-app/echo.ehpk` SHA-256 when present, and bundle metrics when
`even-app/dist` exists. It also writes
`docs/evidence-drafts/project-echo-field-runbook.draft.md`, which gathers the
hardware QA, pilot, proxy, portfolio, and Custom GPT Action evidence queue into
one field-run checklist. The generated files remain `draft`; they are a
starting point for the physical run, not completed hardware QA.

Official Even Realities
[simulator docs](https://hub.evenrealities.com/docs/test/simulator) treat the
simulator as a layout and logic preview, not a hardware emulator. Use simulator
screenshots and headless automation as pre-submission smoke evidence only;
timing, BLE behavior, background lifecycle, locked-phone operation, and
microphone permission behavior must be confirmed on real G2 hardware through a
private or beta build before release.
The official Even beta-testing flow uses an `.ehpk` package for a review-like
private install, so preserve the package hash and install evidence with the
completed manifest.

## Build artifact evidence

- Run `cd even-app && npm run verify` to build, bundle-check, and package
  `echo.ehpk`.
- Record the exact repo-local package path in `buildArtifact.packagePath`.
- Record the SHA-256 digest in `buildArtifact.sha256`; final validation hashes
  `buildArtifact.packagePath` and rejects mismatches.
- Record the packaging command in `buildArtifact.packCommand`.
- Confirm `sourceAppJson` is `even-app/app.json` and `sourceDistDir` is
  `even-app/dist`.
- Install the same `.ehpk` through the private or beta build path before
  hardware QA.
- Confirm the physical G2 QA run used the same package digest, not a local dev
  server or simulator-only preview.
- Keep the phone locked for at least 5 minutes during a session and confirm the
  package behaves like the reviewer path, not only an unlocked dev session.
- Preserve install notes, package digest output, and screenshots/logs under
  `buildArtifact.evidenceRef`.

## Background lifecycle and reviewer parity

Official Even review uses a beta-build path for locked-phone testing. QR/local
testing can be useful before submission, but it cannot prove the locked-phone
reviewer path because the WebView may die when backgrounded. Capture this
section only from a private or beta install of the same `.ehpk` digest recorded
under `buildArtifact`.

- Lock the phone for at least 5 minutes with the Even Realities App
  backgrounded, then launch ECHO from the glasses and confirm it renders within
  a reasonable time with no black screen, no infinite spinner, and no stale
  in-memory-only state.
- Complete the core glasses flow with G2 or R1 gestures alone while the phone is
  locked; every press, double press, swipe, and select must show visible
  feedback.
- Leave the app idle for at least 2 minutes while locked and confirm it stays
  responsive without freeze, loop, or crash.
- Unlock the phone, use another app, re-lock, and confirm the glasses session is
  unaffected.
- Treat Android suspend as a cold start: confirm important session/setup state
  is rebuilt from persisted storage and that audio capture is re-enabled after
  foreground instead of assuming `audioControl(true)` survived.
- If a WebSocket is used in the tested build, force a background/relaunch close
  and confirm reconnect behavior; if no WebSocket is used, record
  `webSocketReconnectHandledOrNotUsed: true` with notes explaining that ECHO's
  current provider calls use fetch/proxy requests rather than a live socket.
- From the root page, double-tap and confirm the system exit confirmation dialog
  appears through the official Even shutdown path, not a custom replacement.
- Deny a requested permission in the review-like install path and confirm the
  app shows a recoverable phone-side state instead of a black screen or silent
  fallback.
- Capture a console/log sanity pass for the same package digest: no uncaught
  errors, no raw transcript/audio payloads, no provider keys, and no session
  tokens.
- After `EXIT ECHO`, relaunch a first-party app such as Conversate and confirm
  it starts without restarting the glasses.
- Record these results under `backgroundLifecycle` in
  [docs/project-echo-hardware-qa.template.json](./docs/project-echo-hardware-qa.template.json),
  including `lockDurationMinutes`, an evidence ref, and a video ref.

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
- Calls `bridge.shutDownPageContainer(1)` through the Even Hub shutdown path,
  not only a custom in-app exit state.
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
- `hud-controller` verifies a pending `ACK` return timer cannot switch the G2
  HUD back to `LISTENING` after the session is stopped or the HUD returns to
  standby.

Still requires real G2 validation:

- Confirm `END PRACTICE` returns glasses to `READY` standby after physical G2 audio capture stops.
- Confirm `EXIT ECHO` calls `bridge.shutDownPageContainer(1)`, shows the
  system exit confirmation dialog from the root page, clears status/audio
  subscriptions, and leaves no active hardware capture.
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
- Automated calibration coverage also treats enough-but-unseparated samples as
  unavailable calibration and falls back to `0.015`, so silent or malformed
  saved calibration cannot be exported as a valid VAD threshold.
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
  `hud_render_latency_ms`, and `end_to_end_latency_ms` must be `null`; otherwise
  the evidence says the stale cue was still displayed. The request/response
  timing and latency fields must still be numeric, and the response timestamp
  must be later than the request timestamp.
- Confirm debug logs do not print raw transcript text as part of latency metadata.

Automated coverage added on 2026-06-19:

- `session-engine-core` verifies `END PRACTICE` aborts an in-flight cue request and ignores its delayed response.
- `session-engine-core` verifies Pause during cue generation aborts the cue request, keeps the engine paused, leaves no pending timers, and does not update HUD/cue callbacks.
- `session-engine-core` verifies live recognizer transcription receives the current session request scope and per-request ID generator.
- `session-engine-core` verifies cue latency records include request scope, request ID, timing fields, and latency values without raw transcript text.
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

Automated coverage added on 2026-06-19:

- `echo-api-proxy` verifies safe `proxy_not_configured` errors do not echo learner text in response bodies or proxy stdout/stderr logs.

## Assist mode QA

- Start a new practice session and confirm the phone UI shows `Assist: Manual`.
- Stay silent past the threshold and confirm no cue appears automatically.
- Double click on G2 and confirm a cue appears.
- Press `Cue` on the phone and confirm the same manual cue path works in simulator/browser checks.
- Swipe while a cue is visible and confirm it disappears.
- Start speaking while a cue is visible and confirm the cue clears immediately.
- Switch to `Auto`, confirm the experimental Auto Assist prompt is shown, cancel
  it once, and verify the mode remains `Manual`.
- Switch to `Auto` again, accept the prompt, and verify the phone UI changes to
  `Assist: Auto`.
- Switch to `Auto`, stay silent past the threshold without a recent breakdown signal, and confirm no auto cue appears.
- In Auto, say a breakdown phrase such as `I think maybe...` or repeated filler words, then stay silent past the threshold and confirm an auto cue appears.
- In Auto, say a breakdown phrase, cross the silence threshold, start speaking again within the 400 ms grace window, and confirm the pending auto cue is cancelled.
- Confirm Auto and speech-evaluation cues never exceed level 2 in exported evidence.
- Confirm level 3/full-structure cues appear only after an explicit Manual Assist request.
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
- `session-engine-core` verifies Auto Assist does not generate from silence alone without a breakdown signal.
- `session-engine-core` verifies Auto Assist cancels a pending auto cue when speech resumes during the grace window.
- `session-engine-core` verifies Auto Assist and speech-evaluation cues are capped at level 2, while Manual Assist can still request level 3.
- `session-engine-core` verifies Auto Assist pauses after two dismissed auto cues.
- `session-engine-core` verifies Auto Assist is capped at three automatic cue generations per session.
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

## Conversation timeline QA

- Run one G2 Mic conversation, one Phone Mic conversation, and one imported
  transcript flow that each produce ordered `ConversationTurn` records.
- Confirm each source records at least one learner turn and one partner turn
  with timing, finality, source, language, and confidence-policy metadata.
- Confirm each source records the expected `inputEvidence`: G2 Mic turns use
  `inputMode: "g2_bridge_pcm"` with `sampleRateHz: 16000`, `channelCount: 1`,
  and `encoding: "pcm_s16le_mono"`; Phone Mic turns use
  `inputMode: "phone_web_speech"`; imported transcript rows use
  `inputMode: "imported_text"`.
- Confirm `unknownTurnCount` is recorded as a number, even when it is `0`, so
  diarization uncertainty is explicit instead of hidden.
- Confirm imported transcript rows exercise speaker prefixes such as `Partner:`,
  `Me:`, `Speaker 1:`, and `Speaker 2:`.
- Confirm malformed imported rows are skipped and deterministic import turn IDs
  are preserved.
- In Review, manually correct at least one speaker label and confirm
  `correctedByUser` is persisted and exported.
- With cloud processing enabled, confirm Korean translation appears on the
  phone timeline for at least one turn.
- Confirm partner turns are translated before learner/unknown turns when a
  pending batch contains mixed speaker roles.
- Confirm a low-confidence transcript keeps a visible warning beside the Korean
  translation so reviewers know to compare it with the original turn.
- With the translation proxy unavailable or failing, confirm the original turn
  remains visible and the failed translation state is non-blocking.
- During the same run, confirm the phone timeline is visible but G2 does not
  show conversation history, speaker labels, Korean translations, or debrief
  details.
- Record this under `conversationTimeline` in
  [docs/project-echo-hardware-qa.template.json](./docs/project-echo-hardware-qa.template.json).
  Final hardware QA requires evidence refs for G2 Mic, Phone Mic, import,
  translation/correction review, and a video proving the HUD boundary.

## Wear status QA

- With the G2 connected and worn, capture the bridge/status payload and confirm
  `parseWearingState` records `wearing`.
- With the G2 connected but not worn, capture the bridge/status payload and
  confirm the phone UI shows `Not wearing`, not `Wearing`.
- With the G2 connected but no wear sensor field available, confirm the phone UI
  shows `Wear status unavailable`.
- With the G2 connected and an unexpected/unknown wear token, confirm the phone
  UI keeps `Wear status unavailable` rather than treating it as `Not wearing`.
- Confirm connection alone never forces `wearing`.
- Record the three cases under `wearingState` in
  [docs/project-echo-hardware-qa.template.json](./docs/project-echo-hardware-qa.template.json),
  including input status payloads, parsed state, phone label, and evidence refs.

Automated coverage added on 2026-06-19:

- `hud-controller` verifies boolean, numeric, string, absent, and
  connected-but-not-wearing status payloads map to `wearing`, `not-wearing`, or
  `unavailable` without using connection as a forced success state. It also
  rejects unknown wear tokens as `unavailable` instead of silently converting
  them to `not-wearing`.

Still requires real G2 validation:

- Confirm the physical/simulator status payloads and phone labels match the
  automated parser behavior.

## Simplified HUD QA

- Standby screen shows `READY` only.
- Normal live speech shows `LISTENING` only.
- Live transcript, grammar corrections, hint history, expression usage, silence
  stats, and debrief details remain on the phone UI, not on G2.
- Cue display shows `CUE` plus one short phrase only.
- Successful assisted/adapted cue use shows a short `ACK` / `OK` state and then
  returns to `LISTENING` without showing transcript or achievement detail.
- Pause/menu flow never overlaps transcript, cue history, or status metrics.
- Resume returns to `LISTENING`; End Practice returns to `READY`.
- The completed hardware QA manifest must contain exactly `READY`, `LISTENING`,
  `CUE`, `ACK`, and `PAUSED` under `hud.states`; extra live G2 HUD states are rejected.

Automated coverage added on 2026-06-19:

- `hud-controller` verifies live G2 rendering is limited to `READY`, `LISTENING`, `CUE`, `ACK`, and `PAUSED`.
- `hud-controller` verifies the short `ACK` state clears its return timer before
  session stop or standby, preventing a late `LISTENING` render after cleanup.
- `hud-controller` verifies transcript text, grammar feedback, and achievement detail do not render on the live G2 surface.
- `hud-controller` verifies long cues are clipped to a glanceable phrase.

Still requires real G2 validation:

- Confirm READY, LISTENING, CUE, ACK, PAUSED, and the pause menu render without overlap on the physical glasses or Even Hub simulator.

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
