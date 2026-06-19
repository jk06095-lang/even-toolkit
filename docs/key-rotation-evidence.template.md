# Project ECHO Key Rotation Evidence

Copy this file to `docs/key-rotation-evidence.md` after production proxy
deployment and provider key rotation are complete. Do not paste raw provider
keys, tokens, secrets, request bodies, learner transcripts, or audio payloads.
Final confirmation fields should use clear positive results such as `true`,
`passed`, `confirmed`, or `verified`. Artifact scan fields should state a clean
result such as `0 matches`, `no matches`, `none found`, `clean`, or `passed`.
The production smoke command result must include the production proxy URL and
must not use local-only override flags. Final evidence must use an ISO
`YYYY-MM-DD` rotation date and list the current `even-app/package.json` version
under `Client build or package version`. Final evidence must also point to the
JSON file written by `smoke:deploy -- --evidence-out ...`.

## Rotation Date

- Date:
- Rotation owner:
- Production proxy URL:
- Client build or package version:

## Rotated Provider Keys

- Provider:
- Previous key location removed from:
- New key location:
- Server secret manager reference:
- Browser artifact key scan result:

## Production Log Review

- Reviewed time window:
- Log source:
- Log allowlist confirmation:
- Raw transcript/audio log exclusion:

## Deployment Smoke Evidence

- Deployment smoke command result:
- Deployment smoke evidence JSON:
- /healthz configured true:
- Allowed origin passed:
- Untrusted origin blocked:
- Safe non-echoing error response verified:

## Artifact Scan Evidence

- even-app/dist scan result:
- even-app/echo.ehpk scan result:
- Direct provider hostname scan result:
- Development IP scan result:

## Follow-up Owner

- Follow-up owner:
- Follow-up issue or ticket:
- Notes:
