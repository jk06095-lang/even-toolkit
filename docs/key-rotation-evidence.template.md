# Project ECHO Key Rotation Evidence

Copy this file to `docs/key-rotation-evidence.md` after production proxy
deployment and provider key rotation are complete. Do not paste raw provider
keys, tokens, secrets, request bodies, learner transcripts, or audio payloads.

## Rotation Date

- Date:
- Owner:
- Production proxy URL:
- Client build or package version:

## Rotated Provider Keys

- Provider:
- Previous key location removed from:
- New key location:
- Server secret manager reference:
- Confirmation that browser builds and `.ehpk` artifacts do not contain provider
  keys:

## Production Log Review

- Reviewed time window:
- Log source:
- Confirmation that logs contain only request ids, route, status, and latency:
- Confirmation that logs do not contain request bodies, raw transcripts, or audio
  base64 payloads:

## Deployment Smoke Evidence

- `npm --prefix echo-api-proxy run smoke:deploy -- --base-url <url> --allowed-origin <origin>` result:
- `/healthz` reports `configured: true`:
- Allowed origin passed:
- Untrusted origin blocked:
- Safe non-echoing error response verified:

## Artifact Scan Evidence

- `even-app/dist` scan result:
- `even-app/echo.ehpk` scan result:
- Direct provider hostname scan result:
- Development IP scan result:

## Follow-up Owner

- Owner:
- Follow-up issue or ticket:
- Notes:
