# Project ECHO Conversation Timeline

The conversation timeline is the phone-side review surface for saved
`ConversationTurn` records. The glasses stay a minimal cue surface; the phone
stores and reviews the heavier turn history.

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

Remaining work for issue #28:

- live phone timeline wiring during a session
- real G2/phone/import speaker segmentation evidence
- simulator or hardware proof that the glasses HUD remains cue-only
