# Project ECHO Conversation Timeline

The conversation timeline is the phone-side review surface for saved
`ConversationTurn` records. The glasses stay a minimal cue surface; the phone
stores and reviews the heavier turn history.

## Translation Queue

`even-app/src/combat/translation-queue.ts` tracks Korean translation work for
final non-Korean turns. It deliberately stores only session IDs, turn IDs,
language metadata, status, attempts, errors, and completed Korean translations.
Raw utterance text remains in the saved `ConversationTurn` record instead of
being duplicated in the queue.

This keeps translation failures non-blocking:

- `pending` means a final non-Korean turn is waiting for a provider.
- `failed` means the provider failed, but the original turn remains visible and
  exportable.
- `translated` means `translationKo` has been written back to the stored
  `ConversationTurn`.

The queue uses `localStorage`, matching Even Hub's Android lifecycle guidance:
important phone WebView state must be persisted because in-memory state can be
lost when the app backgrounds or the screen locks.

## Current Boundary

The current implementation does not invent Korean translations locally. It adds
the durable queue and UI state that a translation provider can consume later.

Remaining work for issue #28:

- provider integration for pending translation jobs
- live phone timeline wiring during a session
- real G2/phone/import speaker segmentation evidence
- simulator or hardware proof that the glasses HUD remains cue-only
