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

## Custom GPT Handoff

`generateCustomGptHandoffFiles()` returns the manual Custom GPT v1 bundle:

- `echo_learner_profile.json`
- `echo_tutor_instructions.md`

The JSON profile is intended for manual Knowledge upload. It excludes full raw
transcript export and keeps only bounded, redacted learning snippets. Email-like
and phone-like values are replaced before profile generation.

## Remaining Work

This is the data foundation for the active-recall loop. The remaining product
work is to add the phone review UI, speech production attempts, Again / Hard /
Good / Easy grading, and transfer checks in new scenarios.
