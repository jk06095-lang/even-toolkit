# ECHO API Proxy

Project ECHO must never ship provider API keys in the browser client or `.ehpk`.
The app calls a server-side proxy, and only the proxy calls the AI provider.

## Endpoints

- `POST /v1/cue`
- `POST /v1/transcribe`
- `POST /v1/translate`
- `POST /v1/session-analysis`
- `GET /healthz`

The deploy-ready reference implementation lives in `echo-api-proxy/server.mjs`.
It uses Node 20 built-in `http` and `fetch`, returns safe JSON errors, and logs
only request id, method, path, status, and latency. It does not log request
bodies, raw transcripts, or audio payloads.

`/v1/transcribe` may return an optional numeric `confidence` in the range
`0..1` when the upstream STT provider supplies one. The reference Gemini proxy
does not fabricate confidence; clients treat a missing value as unknown.

## Environment

Use `echo-api-proxy/.env.example` as the deployment template.

Required:

- `GEMINI_API_KEY`: provider key kept on the server only.
- `GEMINI_API_BASE_URL`: provider API base URL. Leave this as
  `https://generativelanguage.googleapis.com` in production unless a reviewed
  provider adapter or staging stub is intentionally configured.
- `ECHO_PROXY_ALLOWED_ORIGINS`: comma-separated browser origins allowed to call
  the proxy.
- `ECHO_PROXY_SESSION_TOKENS`: comma-separated short-lived ECHO session tokens
  accepted by the proxy. Clients send one as `Authorization: Bearer <token>` or
  `X-Echo-Session-Token`. Treat these as deploy/session guards, not provider
  secrets; rotate them and prefer an issuer-backed short TTL before production
  traffic.
- `ECHO_PROXY_SESSION_TOKEN_ISSUER`: non-secret identifier for the server-side
  issuer or secret-manager entry that minted the active session tokens.
- `ECHO_PROXY_SESSION_TOKEN_TTL_SECONDS`: maximum client session-token lifetime.
  Release smoke expects a positive value no longer than 86400 seconds.
- `ECHO_PROXY_SESSION_TOKEN_ROTATION_DAYS`: maximum operational rotation
  cadence. Release smoke expects a positive value no longer than 30 days.

Recommended:

- `GEMINI_MODEL=gemini-1.5-flash`
- `ECHO_PROXY_PROVIDER_TIMEOUT_MS=20000`
- `ECHO_PROXY_MAX_BODY_BYTES=6000000`
- `ECHO_PROXY_RATE_LIMIT_WINDOW_MS=60000`
- `ECHO_PROXY_RATE_LIMIT_MAX=60`
- `ECHO_PROXY_IDEMPOTENCY_TTL_MS=600000`
- `ECHO_PROXY_IDEMPOTENCY_MAX_ENTRIES=1000`
- `ECHO_PROXY_CIRCUIT_FAILURE_THRESHOLD=5`
- `ECHO_PROXY_CIRCUIT_COOLDOWN_MS=30000`
- `ECHO_PROXY_QA_DELAY_MS=0`

QA only:

- Set `ECHO_PROXY_QA_DELAY_MS=5000` on a local or staging proxy to delay POST
  responses while testing late-response guards. Leave it unset or `0` for
  production.

Client build:

- `VITE_ECHO_API_BASE_URL=https://api.project-echo.app`
- Do not set `VITE_GEMINI_API_KEY`.
- Do not point `VITE_ECHO_API_BASE_URL` at `generativelanguage.googleapis.com`
  or a `192.168.*` development host for release builds.

Manifest:

- `even-app/app.json` must whitelist the deployed proxy origin.
- The current production origin is `https://api.project-echo.app`.

## Deployment Checklist

1. Deploy `echo-api-proxy/server.mjs` to the server/runtime that owns
   `https://api.project-echo.app`.
2. Set `GEMINI_API_KEY` in the server secret manager only.
3. Set `ECHO_PROXY_ALLOWED_ORIGINS` to the final ECHO app origins.
4. Configure `ECHO_PROXY_SESSION_TOKENS` from a server-side issuer or secret
   manager, set `ECHO_PROXY_SESSION_TOKEN_ISSUER`, set a TTL of 86400 seconds or
   less, and set a rotation cadence of 30 days or less. Keep session tokens out
   of source control, `even-app/dist`, and `.ehpk` artifacts; revoke the old
   smoke token after each production rotation.
5. Set the client build variable `VITE_ECHO_API_BASE_URL` to the same proxy
   origin.
6. Verify the proxy locally with `cd echo-api-proxy && npm run verify`.
7. For client retries, send an `Idempotency-Key` header with each provider-bound
   retryable POST. The key must be a bounded token. The proxy caches only
   successful responses keyed by session, path, key, and request-body hash; it
   does not cache raw request bodies, audio, or transcript text.
8. Confirm `/healthz` reports the expected `rateLimit`, `idempotency`, and
   `circuitBreaker` metadata. If `circuitBreaker.open` is true, the proxy is
   intentionally failing closed before making more provider calls.
9. Smoke-test the deployed proxy without making a provider generation call:

   ```bash
   cd echo-api-proxy
   npm run smoke:deploy -- --base-url https://api.project-echo.app --allowed-origin https://your-client-origin --session-token "$ECHO_PROXY_SMOKE_SESSION_TOKEN" --evidence-out ../docs/proxy-smoke-evidence.json
   ```

   The smoke check requires HTTPS, `/healthz` with `configured: true`, allowed
   CORS, `authConfigured: true`, a supplied smoke session token, blocked
   untrusted origins, missing-token rejection, `qaDelayMs: 0`, configured
   session-token policy metadata, and safe non-echoing error responses. The
   `--evidence-out` JSON is required by the final key-rotation evidence
   validator and by the #1/#27 readiness blockers. Use
   `--allow-http --allow-unconfigured --allow-unauthenticated --allow-qa-delay`
   only for local dry-runs.
10. Build and package the app with `cd even-app && npm run verify`.
11. Search `even-app/dist` and `even-app/echo.ehpk` for provider keys, session
   tokens, direct provider hostnames, SDK imports, and development IPs.
12. Rotate any provider key that was ever embedded in a built `dist` or `.ehpk`
   artifact. Copy `docs/key-rotation-evidence.template.md` to
   `docs/key-rotation-evidence.md`, record the rotation evidence there, and run
   `npm run validate:key-rotation-evidence -- docs/key-rotation-evidence.md`.
   The evidence must use a production HTTPS proxy URL, include the same URL in
   the `smoke:deploy` result, reference the checked-in deployment smoke JSON,
   mark smoke/log/session-token confirmations as passed or verified, prove a
   TTL and rotation cadence inside policy limits, prove old-token revocation,
   and record clean artifact scans such as `0 matches` or `no matches`. This
   same evidence is required before both #1 and #27 can be closed.
13. Confirm proxy logs do not contain request bodies, raw transcript text, or
   audio base64 payloads.

`npm run verify` starts the proxy with no provider key and checks `/healthz`,
session-token rejection, allowed CORS behavior, disallowed-origin rejection,
bounded schema validation, rate limiting, oversized payload rejection, and safe
`proxy_not_configured` errors that do not echo learner text in the response body
or proxy stdout/stderr logs. It also checks successful response idempotency and
provider circuit opening against a local stub provider so retry and failure
behavior does not require real provider traffic. `npm run smoke:deploy` performs
the corresponding remote deployment checks and expects the deployed server to report
`configured: true`, `authConfigured: true`, `tokenPolicy.configured: true`,
and `qaDelayMs: 0` unless local-only override flags are passed for local
testing.
For delayed-response QA, start a local or staging proxy with
`ECHO_PROXY_QA_DELAY_MS=5000`; `/healthz` reports the active `qaDelayMs`.

## Safe Failure Behavior

When the proxy is missing, slow, blocked by CORS, or returns a non-2xx response,
the client treats it as unavailable. Cue generation falls back to local static
templates, translation jobs move to a non-blocking failed state, and
transcription/session analysis paths fail safely without exposing provider
details to the browser.
