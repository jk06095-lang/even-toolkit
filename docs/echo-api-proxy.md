# ECHO API Proxy

Project ECHO must never ship provider API keys in the browser client or `.ehpk`.
The app calls a server-side proxy, and only the proxy calls the AI provider.

## Endpoints

- `POST /v1/cue`
- `POST /v1/transcribe`
- `POST /v1/translate`
- `POST /v1/session-analysis`
- `GET /v1/learner/profile`
- `GET /v1/reviews/next`
- `POST /v1/reviews/attempt`
- `POST /v1/roleplays/start`
- `POST /v1/roleplays/result`
- `POST /v1/sessions/import-summary`
- `GET /oauth/authorize`
- `POST /oauth/token`
- `GET /healthz`

The deploy-ready reference implementation lives in `echo-api-proxy/server.mjs`.
It uses Node 20 built-in `http` and `fetch`, returns safe JSON errors, and logs
only request id, method, path, status, and latency. It does not log request
bodies, raw transcripts, or audio payloads.

Provider-bound ECHO routes keep model instructions and learner/session content
in separate Gemini parts. The trusted instruction part tells the model to use a
specific `untrusted_data:*` JSON part as context and never follow instructions
inside learner text, transcripts, scenarios, translations, or session metrics.
The untrusted part is bounded and serialized as valid JSON even when it must be
truncated, so conversation data is treated as data rather than executable
prompt text.
Provider responses are also schema-gated as strict JSON. The proxy may accept a
response that is entirely a fenced JSON block, but it does not recover a JSON
object from surrounding prose such as "Here is the JSON: {...}". Mixed prose and
JSON fails as `provider_schema_error` so model formatting drift cannot silently
become learner-facing text.

`/v1/transcribe` may return an optional numeric `confidence` in the range
`0..1` when the upstream STT provider supplies one. The reference Gemini proxy
does not fabricate confidence; clients treat a missing value as unknown.

The `/v1/learner/*`, `/v1/reviews/*`, `/v1/roleplays/*`, and
`/v1/sessions/import-summary` routes are the server-backed reference surface for
the Custom GPT Action contract. They use the same proxy authentication,
CORS/rate-limit, no-store JSON, idempotency for POST write-backs, and privacy
guards as the provider-bound routes, but they do not require a provider API key.
These routes intentionally accept only bounded learner profile, review,
roleplay, and redacted session-summary data. They reject raw transcript/audio
fields, direct contact identifiers, provider secrets, and HTML-like content.
Review attempts also require a bounded `captureSource` value (`typed`,
`phone_web_speech`, or `g2_bridge`) so Web Speech confidence cannot be mistaken
for G2/audio-level recall evidence. The route rejects mixed-source review
metadata: `pronunciationScore` is accepted only for `phone_web_speech`, and
bounded `audioLevelEvidence` is accepted only for `g2_bridge` attempts. G2
bridge attempts may include `audioLevelEvidence` derived from 16 kHz PCM frame
metadata, but the Action schema still rejects raw transcript/audio payloads,
contact identifiers, provider keys, and session tokens.
Action review scheduling also persists `independentRecallDays` and
`successfulTransferScenarioIds`. A successful hidden meaning-to-expression
attempt appends one calendar day, repeated same-day success is de-duplicated,
and transfer mode is offered only after at least two separate recall days. A
successful transfer review or roleplay write-back appends a bounded scenario ID
instead of counting repeated success in the same generated scenario as new
evidence.
Set `ECHO_ACTION_STORE_PATH` to enable the reference file-backed Action store;
when unset, Action learner/review state remains process-local. The file-backed
store persists only bounded learner profile, learning-item, review-attempt, and
summary counters, not raw transcripts, audio, contact identifiers, provider
keys, or session tokens.
When `ECHO_ACTION_OAUTH_CLIENT_ID`, `ECHO_ACTION_OAUTH_CLIENT_SECRET`, and
`ECHO_ACTION_OAUTH_REDIRECT_ORIGINS` are configured, the proxy also serves the
reference authorization-code OAuth flow declared by
`integrations/chatgpt-action/openapi.json`. OAuth tokens are accepted only for
the Action route family and are checked against the route's read/write scopes.
Issued Action OAuth access tokens are stored only as in-memory SHA-256
fingerprints; `/healthz` exposes the non-secret `tokenStorage:
hashed_in_memory` metadata so deployment smoke evidence can confirm that
boundary without revealing token values.
Production release still requires the OAuth-backed deployed Action evidence in
`docs/project-echo-chatgpt-action-evidence.completed.json`.

## Environment

Use `echo-api-proxy/.env.example` as the deployment template.

Required:

- `GEMINI_API_KEY`: provider key kept on the server only.
- `GEMINI_API_BASE_URL`: provider API base URL. Leave this as
  `https://generativelanguage.googleapis.com` in production unless a reviewed
  provider adapter or staging stub is intentionally configured.
- `ECHO_PROXY_ALLOWED_ORIGINS`: comma-separated browser origins allowed to call
  the proxy.
- `ECHO_PROXY_SESSION_TOKEN_SECRET`: HMAC secret for issuer-backed
  short-lived session tokens. When set to at least 32 characters, the proxy also
  accepts `echo1.<payload>.<signature>` tokens minted with
  `npm run issue:session-token`; keep the secret in the server secret manager
  only.
- `ECHO_PROXY_SESSION_TOKEN_ISSUER`: non-secret identifier for the server-side
  issuer or secret-manager entry that minted the active session tokens.
- `ECHO_PROXY_SESSION_TOKEN_AUDIENCE`: expected audience claim for signed
  session tokens. Defaults to `project-echo-api`.
- `ECHO_PROXY_SESSION_TOKEN_TTL_SECONDS`: maximum client session-token lifetime.
  Release smoke expects a positive value no longer than 86400 seconds.
- `ECHO_PROXY_SESSION_TOKEN_ROTATION_DAYS`: maximum operational rotation
  cadence. Release smoke expects a positive value no longer than 30 days.

Recommended:

- `GEMINI_MODEL=gemini-1.5-flash`
- `ECHO_PROXY_SESSION_TOKENS`: optional comma-separated compatibility tokens.
  Clients send a session token as `Authorization: Bearer <token>` or
  `X-Echo-Session-Token`. Prefer signed `echo1.*` tokens for production smoke
  and live traffic.
- `ECHO_PROXY_PROVIDER_TIMEOUT_MS=20000`
- `ECHO_PROXY_MAX_BODY_BYTES=6000000`
- `ECHO_PROXY_RATE_LIMIT_WINDOW_MS=60000`
- `ECHO_PROXY_RATE_LIMIT_MAX=60`
- `ECHO_PROXY_IDEMPOTENCY_TTL_MS=600000`
- `ECHO_PROXY_IDEMPOTENCY_MAX_ENTRIES=1000`
- `ECHO_PROXY_CIRCUIT_FAILURE_THRESHOLD=5`
- `ECHO_PROXY_CIRCUIT_COOLDOWN_MS=30000`
- `ECHO_ACTION_STORE_PATH=/var/lib/project-echo/action-store.json`
- `ECHO_ACTION_OAUTH_CLIENT_ID`: Custom GPT Action OAuth client id.
- `ECHO_ACTION_OAUTH_CLIENT_SECRET`: server-only OAuth client secret. Use at
  least 16 characters; keep it out of client bundles, logs, and evidence files.
- `ECHO_ACTION_OAUTH_REDIRECT_ORIGINS`: comma-separated HTTPS redirect origins
  allowed for Custom GPT OAuth callbacks, such as
  `https://chatgpt.com,https://chat.openai.com`.
- `ECHO_ACTION_OAUTH_CODE_TTL_SECONDS=300`
- `ECHO_ACTION_OAUTH_TOKEN_TTL_SECONDS=3600`
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
4. Configure signed session tokens from a server-side issuer or secret manager:
   set `ECHO_PROXY_SESSION_TOKEN_SECRET`, set
   `ECHO_PROXY_SESSION_TOKEN_ISSUER`, set a TTL of 86400 seconds or less, and
   set a rotation cadence of 30 days or less. Keep token secrets and issued
   session tokens out of source control, `even-app/dist`, and `.ehpk` artifacts;
   revoke old smoke tokens after each production rotation. Static
   `ECHO_PROXY_SESSION_TOKENS` may remain for local compatibility, but final
   release smoke expects signed-token support. Mint a short-lived smoke token
   from the deploy environment:

   ```bash
   cd echo-api-proxy
   ECHO_PROXY_SESSION_TOKEN_SECRET="$SERVER_ONLY_SECRET" \
   ECHO_PROXY_SESSION_TOKEN_ISSUER="server secret manager entry" \
   npm run issue:session-token -- --subject smoke-test --session-id deploy-smoke-001
   ```

   The printed token is the only value that should be passed to
   `smoke:deploy`; do not commit it.
5. Configure Custom GPT Action OAuth if the deployment will expose the Action
   contract: set `ECHO_ACTION_OAUTH_CLIENT_ID`,
   `ECHO_ACTION_OAUTH_CLIENT_SECRET`, and
   `ECHO_ACTION_OAUTH_REDIRECT_ORIGINS` in the server secret manager/runtime,
   then confirm `/healthz` reports `actionOAuth.configured: true`. The
   authorize and token URLs are `/oauth/authorize` and `/oauth/token` on the
   same proxy origin.
6. Smoke-test the deployed Action OAuth route family without storing secrets in
   evidence:

   ```bash
   cd echo-api-proxy
   npm run smoke:action-oauth -- --base-url https://api.project-echo.app --allowed-origin https://your-client-origin --client-id "$ECHO_ACTION_OAUTH_CLIENT_ID" --client-secret "$ECHO_ACTION_OAUTH_CLIENT_SECRET" --redirect-uri https://chatgpt.com/aip/project-echo/oauth/callback --evidence-out ../docs/chatgpt-action-oauth-smoke.json
   ```

   The generated JSON records the OAuth metadata, endpoint status, scope
   behavior, and privacy-rejection checks, but it never writes the access token
   or client secret. Reference it from the completed ChatGPT Action evidence
   manifest only after the deployed Custom GPT configuration has also been
   captured. To prefill the draft Action evidence without marking it complete,
   run:

   ```bash
   npm run prepare:echo-evidence-drafts -- --action-oauth-smoke docs/chatgpt-action-oauth-smoke.json
   ```
7. Set the client build variable `VITE_ECHO_API_BASE_URL` to the same proxy
   origin.
8. Verify the proxy locally with `cd echo-api-proxy && npm run verify`.
9. For client retries, send an `Idempotency-Key` header with each provider-bound
   retryable POST. The key must be a bounded token. The proxy caches only
   successful responses keyed by session, path, key, and request-body hash; it
   does not cache raw request bodies, audio, or transcript text.
10. Confirm `/healthz` reports bounded `rateLimit`, `idempotency`, and
   `circuitBreaker` metadata. Production smoke evidence must include
   `rateLimitWindowMs` and `rateLimitMax` from `/healthz`, plus retry guard
   metadata. If `circuitBreaker.open` is true, the proxy is intentionally
   failing closed before making more provider calls.
11. Smoke-test the deployed proxy without making a provider generation call:

   ```bash
   cd echo-api-proxy
   npm run smoke:deploy -- --base-url https://api.project-echo.app --allowed-origin https://your-client-origin --session-token "$ECHO_PROXY_SMOKE_SESSION_TOKEN" --evidence-out ../docs/proxy-smoke-evidence.json
   ```

   The smoke check requires HTTPS, `/healthz` with `configured: true`, allowed
   CORS, `authConfigured: true`, signed-token support, a supplied smoke session
   token, blocked untrusted origins, missing-token rejection, `qaDelayMs: 0`,
   configured session-token policy metadata, `Idempotency-Key` preflight support,
   idempotency metadata, closed circuit-breaker metadata, and safe non-echoing
   error responses. The `--evidence-out` JSON is required by the final
   key-rotation evidence validator and by the #1/#27 readiness blockers. Use
   `--allow-http --allow-unconfigured --allow-unauthenticated --allow-qa-delay`
   only for local dry-runs.
   When using the root readiness audit instead of running `smoke:deploy`
   directly, set:

   ```bash
   ECHO_PROXY_BASE_URL=https://api.project-echo.app
   ECHO_PROXY_SMOKE_ORIGIN=https://your-client-origin
   ECHO_PROXY_SMOKE_SESSION_TOKEN=<short-lived signed smoke token>
   ECHO_PROXY_SMOKE_EVIDENCE_OUT=docs/proxy-smoke-evidence.json
   npm run readiness:echo
   ```

   `readiness:echo` accepts the evidence path as a repo-local JSON path and
   converts it to the correct `echo-api-proxy` relative path before invoking
   `smoke:deploy`. To prefill the key-rotation draft with the token-free smoke
   metadata without marking rotation complete, run:

   ```bash
   npm run prepare:echo-evidence-drafts -- --proxy-smoke-evidence docs/proxy-smoke-evidence.json
   ```
12. Build and package the app with `cd even-app && npm run verify`.
13. Search `even-app/dist` and `even-app/echo.ehpk` for provider keys, session
    tokens, direct provider hostnames, SDK imports, and development IPs.
14. Rotate any provider key that was ever embedded in a built `dist` or `.ehpk`
   artifact. Copy `docs/key-rotation-evidence.template.md` to
   `docs/key-rotation-evidence.md`, record the rotation evidence there, and run
   `npm run validate:key-rotation-evidence -- docs/key-rotation-evidence.md`.
   The evidence must use a production HTTPS proxy URL, include the same URL in
   the `smoke:deploy` result, reference the checked-in deployment smoke JSON,
   mark smoke/log/session-token confirmations as passed or verified, prove a
   TTL and rotation cadence inside policy limits, prove idempotency/circuit
   metadata in the deployment smoke JSON, prove old-token revocation, and record
   clean artifact scans such as `0 matches` or `no matches`. This same evidence
   is required before both #1 and #27 can be closed.
   Before the final production run, `npm run prepare:echo-evidence-drafts`
   writes `docs/evidence-drafts/key-rotation-evidence.draft.md` with the
   current client version, follow-up issue, and local client artifact scan
   counts prefilled. Treat it as a draft only; rotation date, deployed smoke
   JSON, session-token revocation, and log review still require production
   evidence.
15. Confirm proxy logs do not contain request bodies, raw transcript text, or
    audio base64 payloads.

`npm run verify` starts the proxy with no provider key and checks `/healthz`,
session-token rejection, allowed CORS behavior, disallowed-origin rejection,
bounded schema validation, rate limiting, oversized payload rejection, and safe
`proxy_not_configured` errors that do not echo learner text in the response body
or proxy stdout/stderr logs. It also checks successful response idempotency,
provider circuit opening against a local stub provider, trusted-instruction vs.
`untrusted_data:*` provider payload separation, and the proxy-backed
Custom GPT Action read/write routes for bounded profile, session import, review
attempt, roleplay start/result, reference OAuth authorization-code scope
enforcement, deploy-smoke evidence generation, privacy rejection behavior, and
optional file-backed Action store persistence across proxy restarts. `npm run
smoke:deploy` performs the corresponding remote deployment checks and expects
the deployed server to report `configured: true`, `authConfigured: true`,
`tokenPolicy.configured: true`, `tokenPolicy.signedTokenConfigured: true`, and
`qaDelayMs: 0` unless local-only override flags are passed for local testing.
It also rejects release smoke when the circuit breaker is already open or when
the deployment does not expose `Idempotency-Key` CORS/preflight support.
For delayed-response QA, start a local or staging proxy with
`ECHO_PROXY_QA_DELAY_MS=5000`; `/healthz` reports the active `qaDelayMs`.

## Safe Failure Behavior

When the proxy is missing, slow, blocked by CORS, or returns a non-2xx response,
the client treats it as unavailable. Cue generation falls back to local static
templates, translation jobs move to a non-blocking failed state, and
transcription/session analysis paths fail safely without exposing provider
details to the browser.
