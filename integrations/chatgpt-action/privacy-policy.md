# Project ECHO Custom GPT Action Privacy Boundary

This Action contract is for a future server-synced Project ECHO learner profile.
It is not the local-only manual GPT export. It exists to keep the eventual
write-back path explicit and testable.

## Data Allowed

- Bounded learner profile metrics and ability scores.
- Up to bounded active learning items.
- Active-recall attempts chosen by the learner.
- Roleplay summaries and learning-item outcomes.
- Redacted session summaries with at most three learning items.

## Data Not Allowed

- Full raw conversation transcripts.
- Raw audio or audio-derived payloads.
- Direct personal contact identifiers.
- Provider keys, session tokens, or device credentials.
- Unbounded free-form profile dumps.

## Authentication

The Action is designed for per-user OAuth. Read and write scopes are separate:
`profile:read`, `review:read`, `review:write`, `roleplay:write`, and
`session:write`.

OpenAI's GPT Action setup requires an OpenAPI schema and authentication
configuration. A GPT can use Actions or Apps, but not both at the same time, so
this contract should not be mixed with a future ChatGPT App integration without
an explicit product decision.
