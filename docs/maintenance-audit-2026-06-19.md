# Maintenance Audit - 2026-06-19

## Scope

GitHub issue #11 asked for npm vulnerability review in the repository root and
`even-app`, plus a decision on the large Vite production chunk warning.

## Vulnerability Decisions

### Root package

- Initial `npm audit --json`: 2 vulnerabilities.
  - `react-router`: high, direct dev dependency, fixed within the current `^7.0.0` range.
  - `js-yaml`: moderate, transitive, fixed by lockfile refresh.
- Action: ran `npm audit fix` without `--force`.
- Result: `react-router` moved from 7.13.1 to 7.18.0 in the lockfile, `js-yaml`
  moved from 4.1.1 to 4.2.0, and root `npm audit --json` now reports 0
  vulnerabilities.

### even-app

- Initial `npm audit --json`: 7 vulnerabilities.
  - `vite`: high, direct dev dependency, fixed in Vite 6.4.3.
  - `protobufjs`: high/moderate transitive advisories, fixed in 7.6.4.
  - `js-yaml`: moderate transitive advisory, fixed in 4.2.0.
  - `vitest`: critical advisory in the 2.x line; no patched 2.x release exists.
  - `esbuild`, `vite-node`, `@vitest/mocker`: inherited through the old Vitest
    stack.
- Action:
  - Ran `npm audit fix` without `--force` for safe lockfile updates.
  - Upgraded `vitest` from `^2.1.9` to `^3.2.6`.
- Rationale:
  - Vitest 3.2.6 is the smallest reviewed major upgrade that clears the
    advisory while retaining broad Node compatibility (`^18 || ^20 || >=22`).
  - Vitest 4.1.9 was not chosen because it requires Node `^20 || ^22 || >=24`,
    which is a larger runtime support change for this app.
- Result: `even-app` `npm audit --json` now reports 0 vulnerabilities.

## Chunk Warning Decision

Before chunk tuning, the production build emitted one large JS chunk:

- `assets/index-*.js`: 1,078.45 kB minified, 312.06 kB gzip.

The large payload is driven by the local voice stack, especially
`@ricky0123/vad-web` and `onnxruntime-web`, plus copied ONNX/WASM assets needed
for local microphone/VAD behavior.

Action: added Vite `manualChunks` routing in `even-app/vite.config.ts`:

- `voice-runtime`: `@ricky0123/vad-web` and `onnxruntime-web`.
- `vendor`: remaining `node_modules`.

After chunk tuning:

- `assets/index-*.js`: 160.24 kB minified, 45.98 kB gzip.
- `assets/vendor-*.js`: 135.01 kB minified, 52.94 kB gzip.
- `assets/voice-runtime-*.js`: 782.36 kB minified, 212.60 kB gzip.

The Vite warning remains because `voice-runtime` is still above 500 kB. This is
accepted for now because the remaining large chunk is isolated to the required
local VAD/ONNX runtime. Reducing it further would require a behavior-affecting
lazy-load change to the session/audio lifecycle and should be handled as a
separate performance task after device QA.

## Verification

- Root `npm audit --json`: 0 vulnerabilities.
- `even-app` `npm audit --json`: 0 vulnerabilities.
- `cd even-app && npm run verify`: passed on Vitest 3.2.6 and Vite 6.4.3.
- Root `npm run build`: passed.
