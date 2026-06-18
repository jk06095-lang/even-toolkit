# Privacy

Project ECHO handles microphone input and conversation transcripts. The release posture is data-minimizing by default.

## Current client behavior

- The browser client calls an ECHO API proxy instead of provider APIs directly.
- If the proxy is not configured or fails, cue generation falls back to local static prompts.
- G2 Mic and Phone Mic are explicit modes; the app does not silently open Phone Mic after G2 Mic failure.
- Transcript export remains local until the user downloads or shares it.

## Required production controls

- Cloud processing consent before sending audio or transcript segments.
- Transcript saving off by default.
- Separate retention choices: immediately, 1 day, 7 days, until deleted.
- Delete current session.
- Delete all transcripts.
- Export my data.

## Analytics guideline

Production analytics should prefer event metadata such as cue requests, cue use, dismissals, and latency. Raw transcript text should be stored only when the user has explicitly enabled transcript saving.

## Proxy logging

The ECHO API proxy should log only operational metadata: request id, method,
path, status, and latency. It must not log raw transcripts, audio base64
payloads, or full request bodies by default.
