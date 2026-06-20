# Project ECHO Issue Closure Ledger

Last reconciled: 2026-06-20 against the open GitHub issue set on `main`.

This ledger maps every currently open Project ECHO issue to the final evidence
that must exist before the issue can be closed. It is a status document, not
final evidence. Do not close any issue from this ledger until its listed final
artifact validates and `npm run readiness:echo` passes the relevant gate.

Primary handoff: [docs/project-echo-readiness-handoff.md](./project-echo-readiness-handoff.md)

## Current Open Issue Set

- #1 `P0: Deploy ECHO API proxy and rotate exposed provider keys`
- #2 `P0: Split End Practice from Exit ECHO and verify lifecycle cleanup`
- #3 `P1: Reduce G2 HUD to READY, LISTENING, CUE, ACK, and PAUSED states`
- #5 `P1: Wire calibration output into real VAD thresholds`
- #6 `P1: Add session guards, AbortController cleanup, and latency instrumentation`
- #10 `P2: Complete real-device QA and portfolio evidence package`
- #12 `P2: Lazy-load Project ECHO voice runtime after device QA`
- #13 `P1: Keep G2 Mic and Phone Mic paths explicit`
- #14 `P0: Preserve explicit G2 wear status states`
- #27 `P0: Harden ECHO API proxy auth, session tokens, rate limits, and schemas`
- #28 `P1: Build two-speaker ConversationTurn timeline with Korean translation`
- #29 `P1: Add active-recall learning loop and Custom GPT profile export`

## Closure Ledger

| Issue | Local position | Final artifact required before close | Validation gate |
| --- | --- | --- | --- |
| #1 | Proxy code, signed session-token issuer, rate limits, schema guards, and draft key-rotation template exist locally. | `docs/proxy-smoke-evidence.json` and `docs/key-rotation-evidence.md` | `npm run readiness:echo` with production `ECHO_PROXY_*` env plus `npm run validate:key-rotation-evidence -- docs/key-rotation-evidence.md` |
| #27 | Proxy hardening is code-covered, but production deployment proof is still absent. | `docs/proxy-smoke-evidence.json` and `docs/key-rotation-evidence.md` | `npm run readiness:echo` production proxy and key/session-token rotation gates |
| #2 | End Practice / Exit ECHO separation is implemented locally and covered by tests. | `docs/project-echo-hardware-qa.completed.json` lifecycle section | `npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json` |
| #3 | `ACK` and cue-only HUD state behavior are implemented locally. | `docs/project-echo-hardware-qa.completed.json` HUD section | `npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json` |
| #6 | AbortController cleanup, stale response rejection, and latency instrumentation are code-covered. | `docs/project-echo-hardware-qa.completed.json` delayed proxy / lifecycle sections | `npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json` |
| #12 | Voice runtime is lazy-loaded and bundle checks keep it on demand. | `docs/project-echo-hardware-qa.completed.json` voiceRuntime section | `npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json` |
| #13 | G2 Mic and Phone Mic paths are explicit in code and tests. | `docs/project-echo-hardware-qa.completed.json` audioSources section | `npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json` |
| #14 | Wearing, not-wearing, and unavailable states are represented without forcing success. | `docs/project-echo-hardware-qa.completed.json` wearStatus section | `npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json` |
| #28 | `ConversationTurn`, manual speaker correction, Korean translation queue, and phone timeline are code-covered. | `docs/project-echo-hardware-qa.completed.json` conversationTimeline section | `npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json` |
| #5 | Calibration output is wired into VAD behavior locally. | `docs/project-echo-pilot-evidence.completed.json` with VAD calibration exports and environment summaries | `npm run validate:pilot-evidence -- docs/project-echo-pilot-evidence.completed.json` |
| #10 | CI, draft evidence, attribution, portfolio-link promotion, and package evidence scaffolds exist. | `docs/project-echo-pilot-evidence.completed.json`, final case-study/video targets, and README portfolio evidence link block | `npm run validate:pilot-evidence -- docs/project-echo-pilot-evidence.completed.json`, `npm run promote:echo-portfolio-links`, then `npm run readiness:echo` |
| #29 | Active recall, learner profile export, Custom GPT Action contract, and OAuth smoke tooling exist locally. | `docs/project-echo-chatgpt-action-evidence.completed.json` | `npm run validate:chatgpt-action-evidence -- docs/project-echo-chatgpt-action-evidence.completed.json` |

## Evidence Groups

Readiness issue groups: `#1/#27`, `#2/#3/#6/#12/#13/#14/#28`, `#5/#10`,
`#29`, and `#10`.

| Group | Issues | Required final artifacts | Next external action |
| --- | --- | --- | --- |
| Production proxy and key rotation | #1, #27 | `docs/proxy-smoke-evidence.json`, `docs/key-rotation-evidence.md` | Deploy the HTTPS proxy, mint a short-lived signed smoke token, run production smoke, scan artifacts/logs, and fill final key-rotation evidence. |
| Hardware QA | #2, #3, #6, #12, #13, #14, #28 | `docs/project-echo-hardware-qa.completed.json` | Install the tested `.ehpk` via Even Hub Private/Beta Testing and capture lifecycle, HUD, audio-source, wear-state, lazy-runtime, delayed-proxy, and timeline proof. |
| Pilot and portfolio | #5, #10 | `docs/project-echo-pilot-evidence.completed.json`, final case-study/video targets, README portfolio evidence link block | Run the real 5-user G2 A/B/C pilot, attach VAD exports and summaries, publish final case studies/video, then promote README links. |
| Custom GPT Action | #29 | `docs/project-echo-chatgpt-action-evidence.completed.json` | Deploy/connect the OAuth-backed Action, capture privacy rejection proof, and collect Day 1 plus Day 7 G2/audio-level recall evidence. |

## Required Commands

Run these before closing any issue in this ledger:

```bash
npm run status:echo-evidence -- --validate-final
npm run validate:issue-closure-ledger
npm run validate:issue-closure-ledger:github
npm run readiness:echo
```

Issue-specific final validators:

```bash
npm run validate:key-rotation-evidence -- docs/key-rotation-evidence.md
npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json
npm run validate:pilot-evidence -- docs/project-echo-pilot-evidence.completed.json
npm run validate:chatgpt-action-evidence -- docs/project-echo-chatgpt-action-evidence.completed.json
npm run promote:echo-portfolio-links
```

## Non-Negotiables

- Do not close an issue based on a draft file under `docs/evidence-drafts/`.
- Do not use `.draft.` or `.template.` evidence references in completed manifests.
- Do not close hardware issues from simulator-only proof.
- Do not close #29 from endpoint smoke alone; the completed Action manifest must also prove learning transfer.
- Do not close #10 until final README portfolio links match completed pilot evidence.
