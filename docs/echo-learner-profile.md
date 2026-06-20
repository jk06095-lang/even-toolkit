# Project ECHO Learner Profile

Project ECHO now mines a local learner profile from session evidence rather than
from raw transcript dumps. The profile is built from validated
`ConversationTurn`, `Cue`, and `AssistEpisode` records.

## Generated Data

`generateExportJSON()` includes a `learner_profile` object with:

- up to three `LearningItem` records per session
- source turn IDs and assist episode IDs
- cue level used, speech act, breakdown type, and last outcome
- conservative scheduling fields for future active recall
- session-local recovery metrics

Learning items are not marked mastered just because a cue was shown or repeated.
All mined items start with `reps: 0`; active recall must collect a later
production attempt before increasing mastery.

## Active Recall Review

`even-app/src/learning/active-recall.ts` turns mined `LearningItem` records into
a local due queue. The phone review flow keeps the saved expression hidden until
the learner has produced an answer, then stores an `Again` / `Hard` / `Good` /
`Easy` grade in `localStorage` under `echo_active_recall_reviews`.

The review state is stored separately from the original session evidence so it
can survive Android WebView relaunches and still be rebuilt from saved
transcripts if local review state is missing. Grades adjust `reps`, `lapses`,
`difficulty`, `stability`, `dueAt`, and transfer-check progress without marking
an immediate cue repeat as mastery. Each attempt also records `captureSource`
as `typed`, `phone_web_speech`, or `g2_bridge` evidence so browser-only voice
attempts cannot be mistaken for G2/audio-level pronunciation proof.
Legacy stored attempts without the field are migrated on load: Web Speech
confidence maps to `phone_web_speech`, and all other attempts map to `typed`.

Imported Review JSON now has a schema-versioned ECHO path. The preferred import
shape uses `schemaVersion: "2.0.0"`, `importKind: "echo_review_items"`, and
stable item IDs. Imported records are normalized into the same `LearningItem`
contract used by session-mined evidence, then mirrored into the active-recall
queue. The v2 runtime guard is a closed contract: unknown fields such as raw
transcript/debug excerpts are rejected instead of being preserved silently. The
older `session_date` / `fsi_stress_level` /
`bottleneck_chunks.interval` report is still accepted, but it is treated as a
legacy migration path and converted into conservative `LearningItem` records
without revealing the saved English phrase in the recall prompt. The Review
screen labels those imports as `Legacy FSI Import`, not as a current stress or
mastery signal, and any fixed interval reminders are shown as legacy intervals.
Stored review reports are also revalidated on load, so older IndexedDB/local
review data with HTML-like text, executable URL schemes, direct contact
identifiers, or stale scheduled reminder text is dropped or rebuilt before it
can reach the Review or Echo Reminders screens.
The Echo Reminders screen also shows an Imported Review Items list with due
time, meaning, speech act, and scenario tag so learners can confirm imported
items are present without exposing the answer before recall.
Scheduled Echo Reminders deliver only a generic `Review due. Open ECHO.`
message to the G2 HUD. They do not flash the saved canonical expression and do
not count as mastery; answer reveal, production evidence, grading, and
rescheduling stay inside the phone-side Active Recall flow.

Each saved attempt also carries a local text evaluation: keyword coverage,
precision, a semantic score, and a suggested grade. The suggestion is a
privacy-safe client-side aid, not an automatic mastery decision. A captured
production attempt is required before mastery can increase: if the learner
reveals the answer and grades an empty attempt as Hard / Good / Easy, the store
saves the review as `Again`, keeps `reps` unchanged, and schedules a short
retry instead of counting answer viewing as recall.

Voice attempts on the phone use a small active-recall Web Speech adapter. It is
gated behind the existing microphone and cloud-processing privacy settings and
falls back to typed attempts when Web Speech is unavailable or the page is not
running on HTTPS / localhost.

The Echo Reminders review surface now keeps voice sources explicit: Phone Voice
uses browser Web Speech, while G2 Voice uses the connected G2 bridge microphone
and the ECHO API proxy transcription path. G2 Voice attempts are saved with
`captureSource: "g2_bridge"` and can include bounded `audioLevelEvidence`
derived from the 16 kHz G2 PCM stream: duration, frame counts, speech-frame
ratio, RMS levels, threshold, and clipping counts. The evidence proves that a
G2 bridge PCM attempt was captured for review; it is not raw audio and does not
pretend to be a phoneme-level pronunciation grade.

When Web Speech supplies a final-result confidence value, active recall stores
it as an optional `pronunciationScore` with source `web_speech_confidence`.
The app does not invent pronunciation scores for typed attempts or speech
providers that omit confidence, and the score is presented as browser speech
confidence rather than a full phoneme-level pronunciation assessment.
G2 bridge attempts therefore keep audio-level evidence separate from
`pronunciationScore` until a real pronunciation evaluator is connected and
hardware evidence is collected. The Action/proxy contract enforces the same
source pairing: `pronunciationScore` is accepted only with
`captureSource: "phone_web_speech"`, while `audioLevelEvidence` is accepted
only with `captureSource: "g2_bridge"`.

After successful recall on two separate calendar days, the prompt moves into
transfer mode. Same-day repeated reveal/grade loops can increase review reps
for scheduling, but they do not unlock transfer by themselves. Transfer prompts
are generated from the item's `speechAct`, scenario tags, and optional
partner-turn context so the learner must use the communication goal in a new
situation instead of reciting the saved phrase. Successful transfer grades
advance to the next generated scenario, and repeated success on the same
generated scenario is not double-counted as new transfer evidence.

## Custom GPT Handoff

`generateCustomGptHandoffFiles()` returns the manual Custom GPT v1 bundle:

- `echo_learner_profile.json`
- `echo_tutor_instructions.md`

Saved sessions in the Review screen expose a `GPT Export` action that downloads
both files for manual Custom GPT Knowledge / instruction setup. This export is
separate from the full session handoff JSON so learners can share a bounded
profile without uploading raw transcript history.

The JSON profile is intended for manual Knowledge upload. It excludes full raw
transcript export and keeps only bounded, redacted learning snippets. Email-like
and phone-like values are replaced before profile generation.

## Custom GPT Action Contract

The next server-synced integration boundary now lives under
`integrations/chatgpt-action/`:

- `openapi.json` defines the future Action API contract for
  `/v1/learner/profile`, `/v1/reviews/next`, `/v1/reviews/attempt`,
  `/v1/roleplays/start`, `/v1/roleplays/result`, and
  `/v1/sessions/import-summary`.
- `mock-server.mjs` is a local reference server for the same bounded endpoints.
  `npm run test:chatgpt-action-mock` starts it on an ephemeral loopback port
  and proves bearer auth, no-store JSON responses, redacted read/write shapes,
  and rejection of raw transcript/audio/contact payloads.
- `echo-api-proxy/server.mjs` now also serves the same bounded Action read/write
  route family behind the proxy's session-token auth, CORS/rate-limit,
  idempotency, and privacy guards. This gives the contract a server-backed
  reference path for learner profile reads, session-summary imports, review
  attempts, and roleplay write-back without requiring provider credentials.
  Set `ECHO_ACTION_STORE_PATH` to persist this bounded Action state across
  proxy restarts in a local JSON file; unset deployments remain process-local.
  The same proxy now includes a reference authorization-code OAuth flow at
  `/oauth/authorize` and `/oauth/token`; OAuth access tokens are scoped to the
  Action route family and cannot be used for provider-bound cue, transcription,
  translation, or session-analysis calls. The proxy keeps Action OAuth access
  tokens as in-memory SHA-256 fingerprints and reports only the non-secret
  `hashed_in_memory` storage boundary through health/smoke evidence.
  `npm --prefix echo-api-proxy run smoke:action-oauth` exercises that deployed
  OAuth flow, all Action endpoints, and privacy rejection checks while writing a
  token-free evidence JSON that can be referenced from the completed Action
  evidence manifest.
- `/v1/reviews/attempt` now requires `captureSource` (`typed`,
  `phone_web_speech`, or `g2_bridge`) so Action write-back preserves the same
  production-attempt boundary as the local phone review store. The route rejects
  mixed-source evidence: Web Speech `pronunciationScore` belongs only to
  `phone_web_speech`, and bounded `audioLevelEvidence` belongs only to
  `g2_bridge` PCM attempts. Deployed smoke evidence may prove phone/Web Speech
  or typed attempts, but it still does not satisfy the separate real-device
  G2/audio-level evidence requirement.
- `ReviewScheduling` carries `independentRecallDays` and
  `successfulTransferScenarioIds` alongside `reps`, `lapses`, `difficulty`,
  `stability`, and `dueAt`. The proxy normalizes legacy records into empty
  arrays, appends a calendar day only after successful hidden
  meaning-to-expression recall, and appends a transfer scenario ID only after a
  successful transfer or roleplay outcome. `/v1/reviews/next` offers transfer
  mode only after at least two separate recall days and before two successful
  transfer scenarios have been recorded.
- `gpt-instructions.md` fixes tutoring behavior for active recall and roleplay
  write-back.
- `privacy-policy.md` records the Action data boundary.

This contract is intentionally server-synced and OAuth-scoped. It is separate
from the local manual Knowledge export. The Action schema does not accept full
raw transcripts, raw audio, direct contact identifiers, provider keys, or
session tokens. Run `npm run validate:chatgpt-action` after edits; the same
check, the local mock smoke test, and the proxy-backed Action route tests are
included in `npm run verify:all`. The mock and proxy reference routes are
pre-deployment contract proof only. They do not replace a real Custom GPT
Action configuration in ChatGPT, production CORS checks, managed production
storage policy, deployed OAuth callback evidence, or G2/audio-level
active-recall evidence.

The deployment evidence shape is captured in
`docs/project-echo-chatgpt-action-evidence.template.json`. Final release
evidence must be copied to
`docs/project-echo-chatgpt-action-evidence.completed.json` and pass
`npm run validate:chatgpt-action-evidence -- docs/project-echo-chatgpt-action-evidence.completed.json`.
Final evidence must describe a non-raw OAuth token storage boundary, such as
hashed fingerprints, encrypted storage, or secret-manager-only storage; raw or
plaintext bearer-token storage is rejected.
The same final manifest must include a `pronunciationScoringPolicy` for the G2
recall evidence. That policy has to name a reviewed G2/audio-level scoring
source, prove Web Speech confidence was not reused as G2 evidence, and confirm
that raw audio was not retained for the evidence package.
It must also include structured `recallTransferProof` and `g2AudioLevelEvidence`
blocks. The former records at least two distinct recall dates, per-attempt
evidence refs, bounded transfer scenario IDs, and same-day repeat evidence. The
latter records the G2 bridge capture source, calibrated speech threshold,
speech-frame ratio, frame counts, clipped-frame count, and `rawAudioRetained:
false` without storing raw audio.
The same completed manifest must include a `buildArtifact` block with the
repo-local `.ehpk` package path, SHA-256 digest, pack command, and confirmations
that the G2 active-recall evidence came from the same artifact used for hardware
QA. The validator recomputes the package digest so a stale or remote-only app
artifact reference cannot satisfy #29.
Run `npm run prepare:echo-evidence-drafts` before deployment checks to generate
`docs/evidence-drafts/project-echo-chatgpt-action-evidence.draft.json` with the
current Action API base URL and contract version prefilled. The generated file
remains draft evidence and does not replace OAuth, endpoint, privacy, or
G2/audio-level recall proof. After running the deployed Action OAuth smoke, pass
its token-free JSON back into draft preparation:

```bash
npm run prepare:echo-evidence-drafts -- --action-oauth-smoke docs/chatgpt-action-oauth-smoke.json
```

That pre-fills only the OAuth endpoint, Action endpoint, and privacy-rejection
fields supported by the smoke output; the manifest stays `draft` until Custom
GPT configuration evidence and G2/audio-level recall evidence are also present.
The final manifest must prove the Custom GPT has the Action schema and privacy
policy configured, OAuth authorization-code flow is server-side, every Action
endpoint returns bounded learner/review/roleplay data, raw transcripts/audio and
direct identifiers are rejected, and G2/audio-level active-recall pronunciation
evidence exists. It must also prove the spaced-recall transfer boundary:
successful hidden recall on at least two separate calendar days, bounded
transfer scenario evidence from transfer review or roleplay write-back, and a
same-day repeat case that does not count as transfer evidence. `npm run
readiness:echo` blocks #29 until that completed manifest is present. The Action
OAuth smoke JSON is endpoint evidence only; it does not replace screenshots or
exports proving that the Custom GPT itself is configured against the deployed
schema and privacy policy.

The completed Action manifest must also fill `tutorBehavior`. That block proves
the Custom GPT follows the ECHO tutoring rules from
`integrations/chatgpt-action/gpt-instructions.md`: conversation flow before
correction, at most one correction per turn, keyword -> sentence starter -> full
sentence cue ladder, brief Korean explanations, no mastery from immediate
repeat-after-reveal, mastery only after two recall days plus transfer, at most
three saved learning items per session, and roleplay write-back that cites
bounded learning item IDs and transfer scenario IDs without sending raw
transcripts.

## Remaining Work

This is the data foundation, first phone review surface, and server-backed
reference Action route family for the active-recall loop. Remaining work is to
deploy and connect it to a real Custom GPT Action, capture the live OAuth
authorization and token exchange evidence against the deployed callback, choose
and review the production storage policy beyond the reference file-backed
store, and collect completed hardware evidence for G2 bridge active-recall
capture plus G2/audio-level pronunciation scoring. The app can now label
G2 bridge recall attempts distinctly and store G2 PCM audio-level evidence, but
the current scoring layer is still limited to optional browser speech
confidence. Web Speech-only evidence remains explicitly insufficient for
closing the G2/audio-level requirement, and completed evidence must not retain
raw audio to compensate for that gap.
