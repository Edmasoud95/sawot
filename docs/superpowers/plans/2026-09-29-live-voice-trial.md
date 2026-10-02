# Live voice trial

Approved scope: optional GPT-Live voice-only trial in the existing orb interface.
Keep standard voice and chat read-aloud available. Reuse an existing OpenAI
provider key on the server. Do not execute Home Assistant tools in the trial.

The entire trial is behind Advanced → Enable Live voice trial, off by default.
Disabled means hidden Live controls, blocked creation, and closed active sessions.

The user selected a 30-second inactivity timeout, paused during speech or work.
The initial trial has no delegated work; requests requiring tools return an
explicit unavailable result. Starting is a deliberate microphone tap. Ending,
timeout, navigation, hiding the app, and connection errors release the microphone
and close the remote session. Browser audio activity drives the orb without
high-frequency React updates. Captions are separate for overlapping speakers.

Implementation sequence:

- [x] Add origin-checked session creation/closure and a lost-client watchdog.
      Verify server-only keys, provider selection, validation, startup cancellation,
      provider errors, and remote session cleanup with simulated HTTP responses.
- [x] Add a WebRTC client with the documented GPT-Live events, live captions,
      audio levels, interruption support, and a tested 30-second idle clock.
- [x] Add device-local Live mode/provider/voice selection in Speech settings;
      reuse microphone/End controls, keep pictures and home actions in Standard.
- [x] Build both packages, run regression tests, review the change, check mobile
      and desktop behavior, and run a bounded synthetic live connection test.

Important boundaries: no automatic paid session on page load, no automatic retry
of creation, no credentials or provider error bodies in browser responses, no
fallback from an explicitly selected provider, no claim that synthetic audio
proves naturalness on the user's microphone. Live sound comparison remains a
user listening test. No commit or push is requested.


## Approved follow-up

The user requested real home actions and web searches, theatre/acting support,
Angry and Flirty personalities, editable prompts in Advanced, and a centered
microphone during active sessions. This extends the original voice-only scope.

- Live delegates bounded transcript context to SAWOT's existing Agent and tools.
- Per-session request IDs are deduplicated; work is serial and cancelled on close.
- Work pauses inactivity; results and search sources return to the voice UI.
- Fictional acting stays conversational, with real device actions distinguished.
- Advanced exposes conversation/tool templates, resolved previews and reset.
- Personality choices apply to both voice paths; Chat keeps separate instructions.
- Remove Live's asymmetric spacers and verify inactive/active desktop/mobile centers.
- Verify with mocked tools; do not operate household devices during testing.
