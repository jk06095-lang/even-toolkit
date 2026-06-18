# Hardware QA

## Session lifecycle

- Start and end a practice session 10 times.
- Confirm no duplicate microphone streams remain.
- Confirm no duplicate HUD callbacks remain.
- Confirm pause and resume do not multiply timers.
- Confirm ending a session clears active cue state.

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
- If calibration is skipped or produces too few samples, confirm fallback threshold `0.015` is used.
- After each environment run, export `Review -> Export my data` and preserve `eventAnalytics.vadSpeechThreshold`, `vadNoiseFloorRms`, `vadSpeechFloorRms`, `audioSource`, and cue latency fields.
- Summarize exports with `cd even-app && npm run qa:summarize-export -- path/to/echo_my_data.json`.

## Delayed proxy QA

- Configure a delayed proxy response for cue generation.
- Start a session, trigger a cue request, then select `END PRACTICE` before the proxy returns.
- Confirm the delayed response does not update the G2 HUD or phone cue card after the session ends.
- Repeat the same delayed response test with Pause and Exit ECHO.
- Confirm console/session metadata shows request ID, request scope, network latency, generation latency, HUD rendering latency, and end-to-end latency.
- Confirm debug logs do not print raw transcript text as part of latency metadata.

Automated coverage added on 2026-06-19:

- `session-engine-core` verifies `END PRACTICE` aborts an in-flight cue request and ignores its delayed response.
- `session-engine-core` verifies Pause during cue generation aborts the cue request, keeps the engine paused, leaves no pending timers, and does not update HUD/cue callbacks.

Still requires real G2 validation:

- Repeat delayed cue tests through the physical G2 HUD pause menu and phone controls.
- Confirm `EXIT ECHO` follows the same delayed-response guard while shutting down the Even Hub page container.

## Privacy controls QA

- With default settings, confirm Live Practice does not start until `Use microphone` is enabled.
- With `Cloud processing` off, start a session and confirm no ECHO API proxy cue, transcription, grammar, or session-analysis requests are sent.
- With `Save transcripts` off, complete a session and confirm `echo_transcripts` and `echo_transcript_buffer` do not contain raw utterance text.
- Confirm `echo_session_events` contains only counts/flags and no utterance, hint, audio, or request body text.
- Confirm `Export my data` includes privacy-safe QA telemetry such as cue latency p50/p95, assist counts, audio source, and VAD calibration fields without raw utterance or cue text when transcript saving is off.
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

Automated coverage added on 2026-06-19:

- `session-engine-core` verifies Manual Assist does not auto-generate cues during silence.
- `hud-controller` verifies active-session G2 cue/dismiss gestures map to `request-cue` and `dismiss-cue`.
- `hud-controller` verifies the pause menu keeps `END PRACTICE` and `EXIT ECHO` as distinct actions.

Still requires real G2 validation:

- Confirm physical double-click, swipe, and select gestures produce the same actions on device.
- Confirm the phone UI displays Manual/Auto status and Auto-paused state during the same hardware run.

## Simplified HUD QA

- Standby screen shows `READY` only.
- Normal live speech shows `LISTENING` only.
- Live transcript, grammar corrections, hint history, expression usage, silence
  stats, and debrief details remain on the phone UI, not on G2.
- Cue display shows `CUE` plus one short phrase only.
- Pause/menu flow never overlaps transcript, cue history, or status metrics.
- Resume returns to `LISTENING`; End Practice returns to `READY`.

Automated coverage added on 2026-06-19:

- `hud-controller` verifies live G2 rendering is limited to `READY`, `LISTENING`, `CUE`, and `PAUSED`.
- `hud-controller` verifies transcript text, grammar feedback, and achievement detail do not render on the live G2 surface.
- `hud-controller` verifies long cues are clipped to a glanceable phrase.

Still requires real G2 validation:

- Confirm READY, LISTENING, CUE, PAUSED, and the pause menu render without overlap on the physical glasses or Even Hub simulator.

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
