# ECHO API Proxy

Project ECHO must never ship provider API keys in the browser client or `.ehpk`.
The app calls a server-side proxy, and only the proxy calls the AI provider.

## Endpoints

- `POST /v1/cue`
- `POST /v1/transcribe`
- `POST /v1/session-analysis`
- `GET /healthz`

The deploy-ready reference implementation lives in `echo-api-proxy/server.mjs`.
It uses Node 20 built-in `http` and `fetch`, returns safe JSON errors, and logs
only request id, method, path, status, and latency. It does not log request
bodies, raw transcripts, or audio payloads.

## Environment

Use `echo-api-proxy/.env.example` as the deployment template.

Required:

- `GEMINI_API_KEY`: provider key kept on the server only.
- `ECHO_PROXY_ALLOWED_ORIGINS`: comma-separated browser origins allowed to call
  the proxy.

Recommended:

- `GEMINI_MODEL=gemini-1.5-flash`
- `ECHO_PROXY_PROVIDER_TIMEOUT_MS=20000`
- `ECHO_PROXY_MAX_BODY_BYTES=6000000`
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
4. Set the client build variable `VITE_ECHO_API_BASE_URL` to the same proxy
   origin.
5. Verify the proxy locally with `cd echo-api-proxy && npm run verify`.
6. Smoke-test the deployed proxy without making a provider generation call:

   ```bash
   cd echo-api-proxy
   npm run smoke:deploy -- --base-url https://api.project-echo.app --allowed-origin https://your-client-origin
   ```

   The smoke check requires HTTPS, `/healthz` with `configured: true`, allowed
   CORS, blocked untrusted origins, `qaDelayMs: 0`, and safe non-echoing error
   responses. Use `--allow-http --allow-unconfigured --allow-qa-delay` only for
   local dry-runs.
7. Build and package the app with `cd even-app && npm run verify`.
8. Search `even-app/dist` and `even-app/echo.ehpk` for provider keys, direct
   provider hostnames, SDK imports, and development IPs.
9. Rotate any provider key that was ever embedded in a built `dist` or `.ehpk`
   artifact. Copy `docs/key-rotation-evidence.template.md` to
   `docs/key-rotation-evidence.md`, record the rotation evidence there, and run
   `npm run validate:key-rotation-evidence -- docs/key-rotation-evidence.md`.
   The evidence must use a production HTTPS proxy URL, include the same URL in
   the `smoke:deploy` result, mark smoke/log confirmations as passed or
   verified, and record clean artifact scans such as `0 matches` or `no matches`.
10. Confirm proxy logs do not contain request bodies, raw transcript text, or
   audio base64 payloads.

`npm run verify` starts the proxy with no provider key and checks `/healthz`,
allowed CORS behavior, disallowed-origin rejection, and safe `proxy_not_configured`
errors that do not echo learner text. `npm run smoke:deploy` performs the
corresponding remote deployment checks and expects the deployed server to report
`configured: true` and `qaDelayMs: 0` unless local-only override flags are
passed for local testing.
For delayed-response QA, start a local or staging proxy with
`ECHO_PROXY_QA_DELAY_MS=5000`; `/healthz` reports the active `qaDelayMs`.

## Safe Failure Behavior

When the proxy is missing, slow, blocked by CORS, or returns a non-2xx response,
the client treats it as unavailable. Cue generation falls back to local static
templates, and transcription/session analysis paths fail safely without exposing
provider details to the browser.
