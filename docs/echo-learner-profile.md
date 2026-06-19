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
an immediate cue repeat as mastery.

Imported Review JSON now has a schema-versioned ECHO path. The preferred import
shape uses `schemaVersion: "2.0.0"`, `importKind: "echo_review_items"`, and
stable item IDs. Imported records are normalized into the same `LearningItem`
contract used by session-mined evidence, then mirrored into the active-recall
queue. The older `session_date` / `fsi_stress_level` /
`bottleneck_chunks.interval` report is still accepted, but it is treated as a
legacy migration path and converted into conservative `LearningItem` records
without revealing the saved English phrase in the recall prompt.
The Echo Reminders screen also shows an Imported Review Items list with due
time, meaning, speech act, and scenario tag so learners can confirm imported
items are present without exposing the answer before recall.

Each saved attempt also carries a local text evaluation: keyword coverage,
precision, a semantic score, and a suggested grade. The suggestion is a
privacy-safe client-side aid, not an automatic mastery decision; the learner's
chosen Again / Hard / Good / Easy grade is still the scheduling input.

Voice attempts on the phone use a small active-recall Web Speech adapter. It is
gated behind the existing microphone and cloud-processing privacy settings and
falls back to typed attempts when Web Speech is unavailable or the page is not
running on HTTPS / localhost.

When Web Speech supplies a final-result confidence value, active recall stores
it as an optional `pronunciationScore` with source `web_speech_confidence`.
The app does not invent pronunciation scores for typed attempts or speech
providers that omit confidence, and the score is presented as browser speech
confidence rather than a full phoneme-level pronunciation assessment.

After two successful recall reps, the prompt moves into transfer mode. Transfer
prompts are generated from the item's `speechAct`, scenario tags, and optional
partner-turn context so the learner must use the communication goal in a new
situation instead of reciting the saved phrase. Successful transfer grades
advance to the next generated scenario.

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
- `gpt-instructions.md` fixes tutoring behavior for active recall and roleplay
  write-back.
- `privacy-policy.md` records the Action data boundary.

This contract is intentionally server-synced and OAuth-scoped. It is separate
from the local manual Knowledge export. The Action schema does not accept full
raw transcripts, raw audio, direct contact identifiers, provider keys, or
session tokens. Run `npm run validate:chatgpt-action` after edits; the same
check and the local mock smoke test are included in `npm run verify:all`.
The mock server is pre-deployment contract proof only. It does not replace a
real OAuth-backed Action API, Custom GPT Action configuration, production CORS
checks, or G2/audio-level active-recall evidence.

The deployment evidence shape is captured in
`docs/project-echo-chatgpt-action-evidence.template.json`. Final release
evidence must be copied to
`docs/project-echo-chatgpt-action-evidence.completed.json` and pass
`npm run validate:chatgpt-action-evidence -- docs/project-echo-chatgpt-action-evidence.completed.json`.
Run `npm run prepare:echo-evidence-drafts` before deployment checks to generate
`docs/evidence-drafts/project-echo-chatgpt-action-evidence.draft.json` with the
current Action API base URL and contract version prefilled. The generated file
remains draft evidence and does not replace OAuth, endpoint, privacy, or
G2/audio-level recall proof.
The final manifest must prove the Custom GPT has the Action schema and privacy
policy configured, OAuth authorization-code flow is server-side, every Action
endpoint returns bounded learner/review/roleplay data, raw transcripts/audio and
direct identifiers are rejected, and G2/audio-level active-recall pronunciation
evidence exists. `npm run readiness:echo` blocks #29 until that completed
manifest is present.

## Remaining Work

This is the data foundation and first phone review surface for the
active-recall loop. Remaining work is to add a real server implementation for
the Action contract, deploy and connect it to a real Custom GPT Action with
OAuth, collect G2/audio-level pronunciation scoring evidence, and capture
G2/bridge-based recall evidence. The current pronunciation layer is limited to
optional browser speech confidence; Web Speech-only evidence is explicitly
insufficient for closing the G2/audio-level requirement.
