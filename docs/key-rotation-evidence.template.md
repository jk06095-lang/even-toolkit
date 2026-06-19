# Project ECHO Key Rotation Evidence

Copy this file to `docs/key-rotation-evidence.md` after production proxy
deployment and provider key rotation are complete. Do not paste raw provider
keys, tokens, secrets, request bodies, learner transcripts, or audio payloads.
Final confirmation fields should use clear positive results such as `true`,
`passed`, `confirmed`, or `verified`. Artifact scan fields should state a clean
result such as `0 matches`, `no matches`, `none found`, `clean`, or `passed`.
The production smoke command result must include the production proxy URL and
must not use local-only override flags. Production smoke JSON must prove
signed-token support, `Idempotency-Key` preflight support, idempotency metadata,
rate-limit metadata, and closed circuit-breaker metadata. Final evidence must use an ISO
`YYYY-MM-DD` rotation date and list the current `even-app/package.json` version
under `Client build or package version`. Final evidence must also point to the
JSON file written by `smoke:deploy -- --evidence-out ...`. Session token
evidence must prove short-lived server-side issuance, signed-token or server
secret-manager storage, client artifact scans, and old-token revocation after
rotation.
The `Development IP scan result` field is for private LAN development origins
such as `192.168.*`; localhost strings used only for secure-origin checks are
not release network origins and should not be treated as provider deployment
evidence.
After production smoke runs, `npm run prepare:echo-evidence-drafts --
--proxy-smoke-evidence docs/proxy-smoke-evidence.json` can prefill deployment
smoke fields in the draft, but the final file still needs the rotation date,
owner, key, revocation, and log-review evidence filled by the operator.

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

## Session Token Rotation

- Session token issuer:
- Session token TTL:
- Session token rotation cadence:
- Session token revocation evidence:
- Session token storage boundary:
- Session token client artifact scan result:

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
