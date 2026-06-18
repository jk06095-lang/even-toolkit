# Credits

This repository combines the original `even-toolkit` foundation with the Project ECHO application work.

## Original toolkit scope

- G2 bridge helpers
- Even Realities G2 design-system primitives
- Shared web components
- Shared icon catalog
- Glasses display utilities
- Speech-to-text toolkit utilities

The original toolkit metadata points to `fabioglimb/even-toolkit` and is licensed under MIT.

## Project ECHO contribution scope

- ECHO product concept and learning experience
- G2 HUD interaction model
- Live Practice session flow
- SessionEngine orchestration
- G2 microphone and VAD connection
- Phone microphone mode selection
- AI cue policy and fallback cue behavior
- Transcript analysis and export flow
- Release-safety checks for credentials, manifests, and packaging

## Release note

The browser client must not contain provider API keys or direct provider SDK imports. ECHO calls a server-side API proxy for cue generation, transcription, and session analysis.
