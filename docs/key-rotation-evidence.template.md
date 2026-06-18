# Project ECHO Key Rotation Evidence

Copy this file to `docs/key-rotation-evidence.md` after production proxy
deployment and provider key rotation are complete. Do not paste raw provider
keys, tokens, secrets, request bodies, learner transcripts, or audio payloads.

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
