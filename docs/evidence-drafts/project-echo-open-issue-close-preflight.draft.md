# Project ECHO Open Issue Close Preflight

Global readiness: blocked - [readiness] 6 blocker(s) remain
Open issues checked: 12
Closeable: 0
Blocked: 12

Issue decisions:
- #1 DO NOT CLOSE: P0: Deploy ECHO API proxy and rotate exposed provider keys
  Reason: npm run readiness:echo has not passed: [readiness] 6 blocker(s) remain (production proxy smoke; provider key/session-token rotation)
- #2 DO NOT CLOSE: P0: Split End Practice from Exit ECHO and verify lifecycle cleanup
  Reason: npm run readiness:echo has not passed: [readiness] 6 blocker(s) remain (completed hardware QA manifest)
- #3 DO NOT CLOSE: P1: Reduce G2 HUD to READY, LISTENING, CUE, ACK, and PAUSED states
  Reason: npm run readiness:echo has not passed: [readiness] 6 blocker(s) remain (completed hardware QA manifest)
- #5 DO NOT CLOSE: P1: Wire calibration output into real VAD thresholds
  Reason: npm run readiness:echo has not passed: [readiness] 6 blocker(s) remain (completed 5-user pilot manifest)
- #6 DO NOT CLOSE: P1: Add session guards, AbortController cleanup, and latency instrumentation
  Reason: npm run readiness:echo has not passed: [readiness] 6 blocker(s) remain (completed hardware QA manifest)
- #10 DO NOT CLOSE: P2: Complete real-device QA and portfolio evidence package
  Reason: npm run readiness:echo has not passed: [readiness] 6 blocker(s) remain (completed 5-user pilot manifest; README portfolio evidence links)
- #12 DO NOT CLOSE: P2: Lazy-load Project ECHO voice runtime after device QA
  Reason: npm run readiness:echo has not passed: [readiness] 6 blocker(s) remain (completed hardware QA manifest)
- #13 DO NOT CLOSE: P1: Keep G2 Mic and Phone Mic paths explicit
  Reason: npm run readiness:echo has not passed: [readiness] 6 blocker(s) remain (completed hardware QA manifest)
- #14 DO NOT CLOSE: P0: Preserve explicit G2 wear status states
  Reason: npm run readiness:echo has not passed: [readiness] 6 blocker(s) remain (completed hardware QA manifest)
- #27 DO NOT CLOSE: P0: Harden ECHO API proxy auth, session tokens, rate limits, and schemas
  Reason: npm run readiness:echo has not passed: [readiness] 6 blocker(s) remain (production proxy smoke; provider key/session-token rotation)
- #28 DO NOT CLOSE: P1: Build two-speaker ConversationTurn timeline with Korean translation
  Reason: npm run readiness:echo has not passed: [readiness] 6 blocker(s) remain (completed hardware QA manifest)
- #29 DO NOT CLOSE: P1: Add active-recall learning loop and Custom GPT profile export
  Reason: npm run readiness:echo has not passed: [readiness] 6 blocker(s) remain (completed ChatGPT Action evidence manifest)

Decision: DO NOT BULK-CLOSE OPEN ISSUES
