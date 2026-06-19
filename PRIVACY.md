# Privacy

Project ECHO is data-minimizing by default. Microphone use, cloud processing,
and raw transcript saving are separate user controls in the Live Practice privacy
settings card.

## Current Client Behavior

- `Use microphone` is off by default. A Live Practice session will not start until the
  user enables microphone use.
- `Cloud processing` is off by default. When it is off, the client does not send
  audio, transcript text, cue requests, grammar requests, or session handoff
  requests to the ECHO API proxy. Cue generation uses local fallback phrases.
- `Save transcripts` is off by default. When it is off, raw transcript text is
  kept only in memory for the active interaction and is not written to
  `sessionStorage` or `localStorage`.
- Transcript retention choices are `Delete after session`, `1 day`, `7 days`,
  and `Until deleted`. The default retention selector is `Delete after session`.
- Transcript export remains local until the user downloads or shares the file.

## Raw Transcript Storage

Raw transcript storage requires explicit opt-in through `Save transcripts`.
When enabled, live session buffers are written to `sessionStorage` for active
session durability and finalized sessions are written to `localStorage` only if
the selected retention policy keeps data after the session.

Retention is enforced when a session is finalized and when the stored session
list is opened. `Delete after session` clears the active session buffer and does
not keep a finalized raw transcript.

## Delete And Export Controls

The Review screen provides:

- `Export my data`: downloads privacy settings, saved raw transcripts, and
  transcript-free event analytics.
- `Delete current session`: deletes the newest saved raw transcript and matching
  event analytics record.
- `Delete all transcripts`: deletes all saved raw transcripts and the active
  session buffer from this device.
- Per-session `Export` and `Delete` controls for saved raw transcripts.

## Event Analytics

Production event analytics are stored separately from raw transcript text.
The local `echo_session_events` store contains metadata counts such as speech
count, hint count, silence count, hint-used count, and whether a raw transcript
was saved. It does not contain utterance text, hint text, audio, or request
bodies.

## Proxy Logging

The ECHO API proxy should log only operational metadata: request id, method,
path, status, and latency. It must not log raw transcripts, audio base64
payloads, or full request bodies by default.

Client-side recognizer logs follow the same rule. Bridge transcription logs may
record operational metadata such as whether a final or interim transcript was
received and its character count, but they must not print the transcript text.
