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
- The current session is finalized and saved.
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

## Simplified HUD QA

- Standby screen shows `READY` only.
- Normal live speech shows `LISTENING` only.
- Live transcript, grammar corrections, hint history, expression usage, silence
  stats, and debrief details remain on the phone UI, not on G2.
- Cue display shows `CUE` plus one short phrase only.
- Pause/menu flow never overlaps transcript, cue history, or status metrics.
- Resume returns to `LISTENING`; End Practice returns to `READY`.

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
