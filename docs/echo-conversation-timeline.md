# Project ECHO Conversation Timeline

The conversation timeline is the phone-side review surface for live and saved
`ConversationTurn` records. The glasses stay a minimal cue surface; the phone
shows the heavier turn history during practice and stores it for review when
raw transcript retention is enabled.

## Translation Queue

`even-app/src/combat/translation-queue.ts` tracks and processes Korean
translation work for final non-Korean turns. It deliberately stores only session
IDs, turn IDs, language metadata, status, attempts, errors, and completed
Korean translations. Raw utterance text remains in the saved
`ConversationTurn` record instead of being duplicated in the queue.

This keeps translation failures non-blocking:

- `pending` means a final non-Korean turn is waiting for a provider.
- `failed` means the provider failed, but the original turn remains visible and
  exportable.
- `translated` means `translationKo` has been written back to the stored
  `ConversationTurn`.

The queue uses `localStorage`, matching Even Hub's Android lifecycle guidance:
important phone WebView state must be persisted because in-memory state can be
lost when the app backgrounds or the screen locks.

When `allowCloudProcessing` is enabled, the phone debrief surface can process
pending jobs through `POST /v1/translate` on the ECHO API proxy. The request
sends the saved final turn text only at processing time; if the proxy is missing,
slow, or rejects the request, the failure is stored on the job and the original
conversation turn remains usable.

## Current Boundary

The current implementation does not invent Korean translations locally. It uses
the deployed proxy boundary when cloud processing is allowed and otherwise keeps
pending jobs local.

Live Practice emits in-memory `SessionTranscript` snapshots whenever finalized
turns are recorded. The phone UI renders the latest recognized final turns from
that snapshot without adding conversation history to the glasses HUD. Placeholder
speech-detection events remain analytics/cache events and are not displayed as
phone timeline turns.

The Live Practice timeline also exposes a compact speaker selector for each
final turn. Changing `Me`, `Partner`, or `Unknown` updates the active in-memory
`ConversationTurn`, sets `correctedByUser: true`, and immediately re-emits the
phone timeline snapshot. When raw transcript retention is enabled, the same
update path flushes to saved session storage; when retention is disabled, the
correction remains session-local and is not written to persistent transcript
history.

Live final turns now preserve the selected audio input boundary explicitly:
G2/bridge recognition writes `source: "g2"`, while phone Web Speech recognition
writes `source: "phone"`. This is input provenance only; real speaker
segmentation still requires the hardware/simulator evidence listed below. New
live G2/Phone turns therefore default to `speaker: "unknown"` until the learner
corrects them in the phone timeline; the app no longer treats a recognized live
turn as `learner` merely because it came from the active microphone path.

Cue recovery is evaluated in the `SessionEngine` outcome path. The phone
controller no longer emits ACKs from exact hint-string matches, so the glasses
only show `ACK` after the shared cue outcome evaluator marks a cue as
`assisted_exact` or `assisted_adapted`.

Imported line transcripts can be converted into v2 `ConversationTurn` rows with
speaker prefixes such as `Partner:`, `Me:`, `Speaker 1:`, and `Speaker 2:`.
Imported rows use `source: "import"`, deterministic import turn IDs, ordered
timing offsets, `isFinal: true`, and the same domain guard as stored live turns;
malformed imported records are skipped instead of being coerced into valid
conversation history.

`ConversationTurn.confidence` is pass-through metadata only. The app preserves
browser or provider STT confidence when it is supplied, but it does not invent a
confidence score for G2 audio or Gemini transcription responses that do not
include one.

Remaining work for issue #28:

- real G2/phone speaker segmentation and hardware/simulator evidence
- simulator or hardware proof that the glasses HUD remains cue-only

Those proof points are now part of the final hardware QA evidence contract under
`conversationTimeline` in `docs/project-echo-hardware-qa.template.json`. A
completed `docs/project-echo-hardware-qa.completed.json` must prove G2 Mic,
Phone Mic, and import segmentation, manual speaker correction persistence,
Korean translation review, and the phone-only timeline / cue-only G2 HUD
boundary before #28 can be closed.
