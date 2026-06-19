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

Each saved attempt also carries a local text evaluation: keyword coverage,
precision, a semantic score, and a suggested grade. The suggestion is a
privacy-safe client-side aid, not an automatic mastery decision; the learner's
chosen Again / Hard / Good / Easy grade is still the scheduling input.

## Custom GPT Handoff

`generateCustomGptHandoffFiles()` returns the manual Custom GPT v1 bundle:

- `echo_learner_profile.json`
- `echo_tutor_instructions.md`

The JSON profile is intended for manual Knowledge upload. It excludes full raw
transcript export and keeps only bounded, redacted learning snippets. Email-like
and phone-like values are replaced before profile generation.

## Remaining Work

This is the data foundation and first phone review surface for the
active-recall loop. Remaining work is to add real speech-attempt capture,
pronunciation scoring, richer transfer scenarios, and later write-back from
roleplay or Custom GPT Action flows.
