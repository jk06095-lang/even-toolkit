# Project ECHO Readiness Handoff

This handoff maps the attached product review, the open GitHub issues, and the
official Even Hub release boundary into the next execution order. It is a
status document, not final evidence. Do not rename draft manifests to completed
manifests unless the external evidence has actually been captured.

## Current Local Position

The P0 code and contract items from the review are now represented in the repo:

| Review item | Tracking | Current local status |
| --- | --- | --- |
| Remove external-string DOM injection | #24, #31 | Closed. Debrief/import text is validated and rendered through text nodes or `textContent`; dynamic text dirs are scanned for HTML injection sinks. |
| Add `ACK` / `showGoodJob()` behavior | #25, #3 | Code covered. Final close still needs G2/simulator HUD evidence in hardware QA. |
| Unify cue success evaluation | #25, #26 | Closed locally. `TranscriptAnalyzer` uses the shared speech-act outcome evaluator, and unrelated three-word speech is not cue recovery. |
| Fix `hintsSimplified` and `selfResponses` semantics | #26 | Closed locally. Simplified hints are counted as simplified, and ordinary listening speech does not inflate self-response rate. |
| Remove three-word success heuristic | #25 | Closed locally. Outcome tests cover unrelated three-word speech as failed/missed. |
| Harden proxy auth, rate limits, schemas, and safe errors | #27 | Code covered. Final close still needs production HTTPS smoke and key/session-token rotation evidence. |
| Wire latest verify gate to CI | #10 | `.github/workflows/verify.yml` runs `npm run verify:all` on push, PR, and manual dispatch. |

## Remaining Evidence Gates

`npm run readiness:echo` is the source of truth for closure. It is expected to
fail until these external artifacts exist and validate:

| Issues | Required final artifact | Gate |
| --- | --- | --- |
| #1/#27 | `docs/proxy-smoke-evidence.json` plus `docs/key-rotation-evidence.md` | `npm run readiness:echo` production proxy and key-rotation checks pass |
| #2/#3/#6/#12/#13/#14/#28 | `docs/project-echo-hardware-qa.completed.json` | `npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json` |
| #5/#10 | `docs/project-echo-pilot-evidence.completed.json` | `npm run validate:pilot-evidence -- docs/project-echo-pilot-evidence.completed.json` |
| #29 | `docs/project-echo-chatgpt-action-evidence.completed.json` | `npm run validate:chatgpt-action-evidence -- docs/project-echo-chatgpt-action-evidence.completed.json` |
| #10 | README portfolio link block | `npm run promote:echo-portfolio-links` after completed pilot evidence passes |

For the issue-by-issue close/no-close map, keep
`docs/project-echo-issue-closure-ledger.md` in sync with these gates and validate
it with `npm run validate:issue-closure-ledger`.

## Official Even Hub Boundary

The next work must follow the official Even Hub boundary:

- Use the packaged `.ehpk`, not a dev server, for final hardware evidence.
- Use Private Testing or Beta Testing for reviewer-parity checks.
- Treat simulator/local testing as pre-submission smoke, not final hardware
  proof.
- Keep production network access behind whitelisted origins with real CORS and
  no provider keys or session tokens bundled into `.ehpk`/`dist`.
- Keep the G2 surface minimal: cue/status/ACK only; heavier transcript,
  translation, and speaker-correction surfaces belong on the phone.

Useful official references:

- https://hub.evenrealities.com/docs/get-started/overview
- https://hub.evenrealities.com/docs/test
- https://hub.evenrealities.com/docs/test/beta-testing
- https://hub.evenrealities.com/docs/reference/cli
- https://hub.evenrealities.com/docs/ship/app-submission

## Next Execution Order

1. Run `npm run prepare:echo-field-run` on a clean checkout before external
   field capture. It runs the ECHO app verify/package step, regenerates draft
   evidence, validates the workspace `.ehpk` SHA against those drafts, and
   prints final-gate status without promoting draft evidence.
2. Run `npm run verify:all` before committing any regenerated package or draft
   updates.
3. Run `npm run status:echo-evidence` to inspect the missing final artifacts
   plus production proxy and Action OAuth smoke env preflights without promoting
   any draft evidence.
4. Run `npm run prepare:echo-evidence-drafts` and review
   `docs/evidence-drafts/project-echo-field-runbook.draft.md`.
5. Confirm the package step inside field prep completed with
   `npm --prefix even-app run pack`.
6. Record `even-app/echo.ehpk` path and SHA-256 in the hardware, pilot, and
   Action evidence packages. The final validators reject stale or remote-only
   package proof.
7. Install the `.ehpk` through the Even Hub private/beta path.
8. Capture hardware QA evidence first: lifecycle, HUD states including `ACK`,
   explicit G2/Phone mic separation, delayed-proxy cleanup, voice-runtime
   lazy-load behavior, wear status, and the phone-only conversation timeline.
9. Run the 5-user A/B/C pilot on that same package digest, including quiet
   room, cafe, air-conditioner, and outdoor wind VAD calibration exports plus
   summaries.
10. Deploy the production proxy, mint a short-lived signed smoke token from
   server-side secrets, then run readiness with `ECHO_PROXY_*` smoke env vars.
11. Deploy/connect the OAuth-backed Custom GPT Action, capture privacy rejection
   evidence, and collect Day 1 recall plus Day 7 transfer proof with G2
   audio-level evidence.
12. Validate all completed manifests.
13. Run `npm run promote:echo-portfolio-links`.
14. Run `npm run status:echo-evidence -- --validate-final` to distinguish
    present-but-invalid artifacts from validated final evidence.
15. Run `npm run validate:issue-closure-ledger` to confirm each open issue still
    maps to the correct final evidence gate.
16. Run `npm run preflight:echo-issue-close -- <issue-number>` for each issue
    before closing it; pass the number without `#`, for example
    `npm run preflight:echo-issue-close -- 10`.
17. Run `npm run readiness:echo`; only close the remaining issues after it
    passes.

## Non-Negotiables

- Do not fabricate pilot, hardware, proxy, key-rotation, Action, or portfolio
  evidence.
- Do not point completed manifests or final key-rotation evidence at
  `docs/evidence-drafts/`, `.draft.`, or `.template.` files; final validators
  reject those paths.
- Do not use Web Speech confidence as G2 pronunciation evidence.
- Do not use same-day repeat attempts as transfer proof.
- Do not publish raw transcripts, raw audio, participant contact identifiers,
  provider keys, session tokens, or local-only proxy URLs.
- Do not update README final portfolio links before the completed pilot
  manifest and target files/URLs exist.
