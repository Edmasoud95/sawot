# Hands-free voice implementation plan

**Goal:** Replace hold-to-talk with an explicitly started voice session that detects utterances, resumes after replies, and uses the ink orb as its primary feedback.

**Approved design:** Tap to start; one readiness cue; speak freely; send after a thoughtful pause or tap to send; tap during a reply to interrupt; explicit end button releases the mic. Preserve the minimal orb interface, picture attachment behavior, keyboard access and reduced motion.

**Architecture:** A browser AudioWorklet captures mono PCM while one microphone stream stays open. A bounded local detector keeps a short prefix, ignores very short impulses, and ends utterances after 1.4 seconds of quiet. Encode WAV for existing backend transcription. Only listen while ready, discard input while thinking/speaking, and drop pending work on cancellation. End on hidden page, chat mode, disconnection or device failure.

**Constraints:** No backend protocol changes, no actual HA commands in verification, no automatic microphone activation, no commit/push requested. Existing uncommitted changes are part of the working app and must be preserved. Work in this checkout to keep those dependencies intact.

## Tasks
- [x] 1. Capture/detection: add `voiceTurnDetector.ts`, `voiceSessionRecorder.ts`, and `voiceCapture.worklet.js`. Test silence, impulse filtering, prefix retention, pauses, manual flush, bounded recording, cancellation, reuse, failures and WAV output. Run new tests before/after implementation.
- [x] 2. Integration: update `useVoice.ts` and store with session lifecycle; pause capture for backend/playback, automatically resume after playback, tap interruption, end/escape, visibility/mode cleanup, and picture snapshots. Update hook regression tests to exercise the new contract.
- [x] 3. Interface: replace hold gestures with accessible tap controls and an end-session button. Add listening/starting orb states, voice responsiveness, subtle readiness feedback and reduced-motion-safe transitions. Update App and scoped CSS; preserve picture controls.
- [x] 4. Verification: run frontend regression suites/typecheck/build; inspect browser desktop/mobile transitions with synthetic audio and intercepted voice transport, including automatic send, reply/resume, interruption, end and hidden-page cleanup. Document real-device/noisy-room limitations. Update README voice instructions.

## Decisions and progress
- A simple local adaptive energy detector avoids a model download and keeps startup light. It detects sound activity, not semantic sentence completion; pause timing and noisy-room behavior need real-device tuning. Use minimum speech duration, a noise floor, bounded prefix and bounded turn duration.
- Shared microphone capture does not mean full-duplex conversation: reply audio is excluded and interruption is an explicit tap.

## Verification
- All 18 frontend regression test files passed; frontend typecheck and production build passed (existing bundle-size warning remains).
- Browser: real AudioWorklet with synthetic input and intercepted voice transport; automatic send, manual send, reply/resume, tap interruption, keyboard start/end, track release, 320px/390px/desktop layout and reduced motion checked. Production preview also captured and sent WAV successfully; moving ink verified across frames.
- Actual Python STT audio decoder accepted generated 48 kHz WAV and resampled it to 16 kHz with amplitude preserved. No model inference or HA commands were invoked.
- Scoped review found and resolved short syllabic onset and delayed manual-send issues; added regressions including bounded candidate memory and muted-device cleanup.
- Real mobile hardware, microphone permissions and noisy-room speech remain unverified. No commits or pushes performed.
