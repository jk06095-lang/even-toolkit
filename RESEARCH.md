# Research Plan

ECHO's core hypothesis is that a short 3-5 word cue helps users resume speaking faster than no help, while distracting less than full-sentence suggestions.

Do not present ECHO as a finished portfolio flagship until the real-device evidence package below is completed on Even Realities G2 hardware.

## Conditions

| Condition | Assist behavior | Purpose |
| --- | --- | --- |
| A | No assistance | Baseline for natural pause recovery. |
| B | Full sentence suggestion | Tests whether complete answers are useful or too intrusive. |
| C | 3-5 word cue | Tests the intended ECHO intervention. |

## Minimum Pilot

- Test at least 5 users on comparable scenarios.
- Run each user through A, B, and C with counterbalanced order when possible.
- Use the same scenario family and difficulty level across conditions.
- Record pre/post release behavior on real G2 hardware.
- Capture system metrics, behavior metrics, subjective ratings, and video evidence.

## Session Protocol

1. Confirm microphone consent and transcript/privacy settings.
2. Run G2 connection, VAD calibration, and audio source check.
3. Start the assigned condition and scenario.
4. Record the conversation segment and observer notes.
5. End practice with `END PRACTICE`; final session also tests `EXIT ECHO`.
6. Record system metrics, user ratings, and any failures before moving to the next condition.

## System Metrics

| Metric | Definition | Target capture |
| --- | --- | --- |
| G2 mic success rate | G2 sessions that start and receive packets without fallback | Per user and aggregate |
| Phone fallback rate | Sessions requiring Phone Mic instead of G2 Mic | Per condition |
| False silence detection rate | Silence triggers while the user is still speaking or thinking naturally | Per minute |
| Missed speech rate | User speech that fails to reset/listen correctly | Per session |
| Cue p50 latency | Median cue request-to-display latency | Per condition |
| Cue p95 latency | 95th percentile cue request-to-display latency | Per condition |
| Crash count | App, bridge, or page container failures | Per test run |
| Reconnect count | G2 reconnects required during a run | Per test run |
| Battery consumption | Battery delta over the test block | Per device |

Privacy-safe session telemetry is available in the Review tab through
`Export my data` -> `eventAnalytics`. It includes audio source, cue latency
p50/p95/max, assist counts, average silence, self-response rate, and VAD
calibration threshold/floors without raw utterance, cue text, or audio payloads.

After exporting one or more `echo_my_data_*.json` files, summarize the system
metrics with:

```bash
cd even-app
npm run qa:summarize-export -- path/to/echo_my_data.json
```

The generated Markdown can be pasted into the pilot scorecard sections below.

## Evidence Manifest Gate

Use [docs/project-echo-pilot-evidence.template.json](./docs/project-echo-pilot-evidence.template.json)
as the required evidence manifest for issue #10. The checked-in template is a
draft scaffold; it is shape-checked during `npm run verify:all` with
`npm run validate:pilot-template`.

For final evidence, copy the template to a completed manifest, fill all five
participants, A/B/C runs, VAD calibration environments, metrics, artifact
references, and case-study links, then run:

```bash
npm run validate:pilot-evidence -- docs/project-echo-pilot-evidence.completed.json
```

The final command intentionally fails if the manifest still has `TBD`, missing
numeric metrics, fewer than 5 participants, missing A/B/C runs, missing VAD
environment results, missing real G2 video evidence, non-link case-study/video
references, or README links not marked as updated. Case-study links must be
`https://` URLs or repo paths such as `docs/project-echo-case-study.ko.md`; video
evidence must be an `https://` URL or a repo path to a video file.

## UX Metrics

| Metric | Definition | Target capture |
| --- | --- | --- |
| Time to first utterance | Time from scenario start to first user utterance | Per condition |
| Cue usage rate | Shown cues that are spoken or adapted by the user | Per condition |
| Cue dismissal rate | Shown cues dismissed without use | Per condition |
| False cue rate | Cues shown when the user did not need help | Per condition |
| Phone checks | Times user looks at the phone during conversation | Per condition |
| Eye-contact breaks | Visible gaze breaks caused by the system | Per condition |
| Interruption rating | User 1-7 rating; lower is better | After each condition |
| Trust rating | User 1-7 rating; higher is better | After each condition |
| Privacy concern | User 1-7 rating; lower is better | After each condition |

## Pilot Evidence Log

| User | Order | Scenario | G2 mic | Cue p50/p95 | False silence | Cue used/dismissed | Interruption | Trust | Privacy | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P01 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| P02 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| P03 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| P04 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| P05 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

## A/B/C Summary

| Condition | Time to first utterance | Cue use | False cue | Interruption | Trust | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| A: no assistance | TBD | N/A | N/A | TBD | TBD | TBD |
| B: full sentence | TBD | TBD | TBD | TBD | TBD | TBD |
| C: 3-5 word cue | TBD | TBD | TBD | TBD | TBD | TBD |

## Case Study Package

- One short product problem statement.
- One architecture diagram showing G2, phone UI, local privacy controls, and ECHO API proxy.
- One real G2 video showing READY, LISTENING, CUE, PAUSED, END PRACTICE, and EXIT ECHO.
- Pilot scorecard with the tables above filled in.
- Clear limitations: small sample, controlled scenarios, English practice focus, and hardware-specific constraints.
- README links to the completed case study and video assets only after the evidence is captured.
- Put each final README portfolio marker on the same markdown link line:
  `project-echo-case-study-ko`, `project-echo-case-study-en`, and
  `project-echo-real-g2-video`. The link targets must match the completed pilot
  manifest.

## Defer Until Core Stability

- New AI models
- Camera features
- Extra learning phases
- More animation
- Complex gamification
- Social ranking
- Multilingual expansion
- New AR projects
