# Minimal ink design

The voice view contains an animated ink orb, a microphone button, and quiet navigation. Captions appear only during a conversation. Chat, devices, history, and settings use the same dark palette.

The orb renders 6,144 persistent moving ink particles into a density texture. Damped attraction forces transport the particles into action shapes and back into free-flowing strands; there is no shape mask in the rendering shader. Its color, flow speed, and audio response follow the assistant state. Assistant playback has a fast attack and gentle release, with stronger expansion, faster flow, and luminous ink; microphone feedback stays subtle. Reduced motion freezes the flow while retaining state feedback.

## Validation

- Frontend TypeScript check and production build passed.
- Browser checks passed at 1440 × 900, 390 × 844, and 320 × 844.
- Checked microphone keyboard access and permission failure, device commands, settings changes, chat creation and streamed replies, dialog focus trapping and restoration, and layout bounds.
- Compared rendered frames to confirm motion, static reduced-motion rendering, and resumption of motion.

Screenshots and interaction checks use simulated API and WebSocket responses. They do not verify a live Home Assistant, speech engine, or language model. The production build still reports the existing large JavaScript bundle warning.

Playback response was checked using injected audio levels: the same quiet signal produced a speech envelope of 0.47 versus 0.03 during recording; a loud phrase reached 0.99 and decayed to 0.04 after a 400 ms pause. Reduced motion suppressed deformation.

## Action expressions

Structured voice activity events guide the ink into a bulb for lights, a thermometer for climate, or musical notes for media. Unsupported domains remain free-flowing. The shapes represent an action being attempted, not a success indicator.

The same particles remain visible through gathering, shape changes, and dispersal. Shape destinations affect acceleration, preserving position and momentum. Completed actions hold briefly before dispersing; failures release the ink. New shapes directly redirect the existing particles. Expiry, a new recording, and disconnection prevent stale expressions. Reduced motion updates shapes without animated morphing.

After installing both packages, run the regression tests from `ts-backend`:

```bash
node --import tsx tests/activity.test.ts
node --import tsx ../web/tests/orbExpression.test.ts
node --import tsx ../web/tests/inkSimulation.test.ts
```

Fourteen regression tests pass, including particle continuity, convergence, retargeting, dispersal, and reduced motion. Browser checks also verified gradual formation, timed dissolution, shape changes, failures, reduced motion, and a circular canvas after resizing. The bulb, thermometer, and music screenshots use simulated activity events. The particle renderer was checked on desktop and mobile with no browser rendering errors; reduced-motion frames were identical and animation resumed when the preference changed. Injected audio produced a speech envelope of 0.48 versus 0.02 for microphone input. Both builds are updated; an already-running backend must restart to emit the new events.

## Conversational faces

The voice model chooses happy, sad, or neutral from the conversation using a hidden response marker. The backend strips this marker from speech, captions, and history, and sends the validated expression when synthesized audio is ready. Missing or unknown markers fall back to neutral. This uses the existing reply generation, with no additional model request. Model compliance and tone accuracy depend on the configured model.

Happy and sad faces use the same particle transport as device shapes. They hold for eight seconds, then disperse; active device expressions have priority. New recordings, disconnects, and playback errors clear them. Happy/sad mobile screenshots use simulated WebSocket events. Twenty-one regression tests and both builds passed; live model sentiment accuracy has not been evaluated. Restart the backend to load the voice expression instructions.

## Temperature readouts

Current temperature answers can form numeric ink, with a unit on a second line, e.g. 21.5°C or -4°F. All digits and units are particle destinations; no text overlay or shape mask is rendered. Values round to one decimal, hold for ten seconds with playback, then disperse. Readouts override sentiment and action symbols.

The model selects an entity using a hidden temperature marker. The backend accepts only numeric temperature results fetched during this voice turn, retaining the sensor unit. Unavailable, unknown, non-temperature and invented entity selections produce no reading. Climate readings use current_temperature, not the setpoint, and require an explicit unit. This first readout supports Celsius/Fahrenheit temperatures from -99.9 to 999.9; other measurements remain conversational. Live Home Assistant and model selection accuracy are not covered by simulated tests. Restart the backend to activate the new metadata and sensor attributes.
