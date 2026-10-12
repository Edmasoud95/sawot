# Motion and haptics integration — 2026-10-09

Implemented directly on the existing SAWOT interface after approval of the proposal's motion. No prototype palette, navigation pill, layout, or model-picker replacement was brought into the app. `ModelPicker.tsx` and `EffortSlider.tsx` are unchanged.

## Behavior

- Press artwork uses the approved finite damped spring and retains velocity when retargeted. Native hit targets, pointer cancellation, disabled controls and keyboard activation remain intact.
- Settings switches use the same spring family. Panels settle over 440 ms when opening and 320 ms when closing; their background workspace does not move. View changes fade in place.
- Settings disclosures expand/collapse with immediate inertness on close and interruption support. Focus into a disclosure finishes its animation so the existing model dropdown remains usable and unclipped. Closed content unmounts after the exit.
- Existing message/attachment arrivals share the revised timing. Streamed text and reading-position logic are unchanged.
- Short optional haptics accompany accepted send gestures, changed modes, settings switches, and the pre-existing effort/long-press cues.
- A confirmation tap accompanies a successful chat response in the visible active chat, including a resumed live stream. Duplicate completion events, failed/stopped replies, old history snapshots, other chats and voice mode do not tap.
- Standard voice requests a confirmation tap after decoded reply audio starts playback, with microphone capture already released. Cancelled decoding/turns do not tap. Live voice remains vibration-free while its microphone is active.
- Settings → Advanced → Interaction → Touch feedback controls this device's preference. It persists locally and updates across tabs. Unsupported browsers show a disabled control.
- A shared suppression lease cancels vibration and blocks new pulses during microphone startup and capture for standard voice, Live voice, dictation and cloned-voice recording. Cancellation, errors and teardown release their own leases.
- Reduced motion and hidden-page changes settle finite motion without idle animation loops. No added dependencies.

## Verification

- Frontend typecheck and production build pass; the existing large-bundle warning remains.
- Full TypeScript backend/frontend regression suite: **563 tests passed**, with local socket access required for backend mock servers. Initial sandbox failures were reproduced as `listen EPERM`; the complete suite passed outside that restriction.
- Repaired the pre-existing voice orchestration test fixture's missing device-control boundary stub, allowing its actual lifecycle assertions to run.
- Real production-served app checked at 1280, 390 and 320 px, normal and reduced motion: panel interruption, inertness, Escape/focus restoration, mode switching, and no horizontal overflow or page errors.
- Additional browser checks against the production bundle with synthetic model data and mocked vibration: 1,200-model search, unclipped inline model dropdown, press hit-target stability, stationary workspace, interrupted disclosure, preference persistence, haptic on/off and reduced-motion disclosure behavior. No real model requests or home commands were used for these checks.
- Microphone suppression unit coverage includes pending permission, cancellation, restart, independent release and post-capture feedback. Hardware failure remains non-blocking.
- `git diff --check` passes.

The frontend was rebuilt and SAWOT was started with its existing launcher. Physical haptic strength, actual microphone recordings, real model/speech calls and target-device performance were not tested. The browser Vibration API only requests pulse duration; it cannot guarantee native-quality intensity or support on every device.

## Completion and speech cues — 2026-10-10

- Added the two automatic cues above using the existing preference, visibility, rate-limit and microphone guards.
- Frontend regression suite: all 41 test files passed. Focused completion tests cover 14 success, duplicate, cancellation, recovery, visibility and suppression scenarios. Voice orchestration and audio tests verify playback readiness and stale-turn cancellation using mocked browser/audio boundaries.
- Frontend typecheck and production build passed; the existing bundle-size warning remains. No hardware vibration or real speech was tested.
- The app was stopped at the user's request before this follow-up and was not restarted.
