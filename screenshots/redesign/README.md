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

## Glass vessel refinement

The ink now sits inside a lensed glass sphere: samples bend toward the centre near the rim with a faint chromatic split, a Sobel normal of the density field lights the ink with a slowly orbiting key light, a broad sheen, and a tight glint, and thick ink pools darker while thin ink stays pale and cool. Fresnel, a glass specular, a contact glow below the orb, edge anti-aliasing, and an output dither replace the flat rim. The density texture follows the canvas resolution (256–512 px) and particles carry three size tiers: large soft bodies, mid-weight wisps, and fine dense filaments. The broad overlapping currents are kept; a normalised curl field folds the whole body into organic masses and dark voids. Concentric ribbon currents were tried and rejected as looking unnatural. Resting ink streaks gently along its current. A sharp rise in playback level applies a brief outward and tangential impulse so syllables ripple through the material. `particle-idle.png` and `speaking-390.png` show this pass; earlier shape screenshots predate it.

## Touch-first control cards

Entity cards share one layout: name and area eyebrow with a switch on the right, one large serif reading (brightness percent, current temperature, sensor value, or Off), then controls. Every target is at least 44 px: the switch sits in a 64 × 44 hit area, brightness and warmth are 48 px drag-anywhere bars, colour chips are 44 px, and the thermostat uses 48 px round steppers. Domain accents use the aurora tokens; the outer glow and native range inputs are gone. The brightness bar shows its value only while dragging so it does not duplicate the reading. `devices-desktop.png` shows this pass.

## Thinking animation

While the model works, the whole body of ink turns slowly about the centre, faster near the middle, as if being stirred; the stir ramps in over about a second and unwinds into the normal flow when the reply starts. About eight percent of the fine filaments become sparks that leave the strands, drift in slow loops through the voids at extra weight, and settle back afterwards. The body thins slightly so the sparks read against it, and the vessel breathes on a four-second cycle with the inner glow. Tool shapes still form on top. Reduced motion keeps only the violet palette and glow. `thinking-sheet.png` shows idle, two thinking moments, the handoff into speaking, speaking, and a bulb during thinking.

## Debug bar

A diagnostics strip along the bottom edge, switched on from Settings (or the history drawer). Collapsed, it shows live tiles: status, the last turn's total time, speech-to-text, model, and text-to-speech latencies, tool call count, and server health. Expanded, it has four tabs: Timeline (a stacked bar of the turn's stages with the reply and the orb expression), Events (every backend debug event in order with expandable JSON), Messages (raw traffic in both directions with a filter), and State (live voice, chat, and server state). A turn picker steps back through the last twenty turns and Copy puts a turn's JSON on the clipboard. Chat mode emits the same debug events over its stream, and both modes now trace the final reply with its raw text and parsed expression. All targets are at least 30 px tall. `debugbar-desktop.png` and `debugbar-390.png` show the timeline tab.

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

## Lighter expressions

Only about 45% of the ink forms a symbol. Destinations are sampled with a smooth falloff from the outline and a light translucent fill, so shapes have soft, slightly ragged edges instead of a thick border on a solid slab. Formed ink keeps sliding along the symbol's contour and breathing across it. The remaining ink withdraws into a wide, quiet current near the rim and fades to roughly a quarter of its weight through a per-particle attribute, so the vessel stays alive without a bright band. Readouts use the same share and edge softness with a slightly more inked stroke jitter. `bulb-formed.png`, `thermometer-390.png`, `music-390.png`, `happy-390.png`, and `temperature-390.png` show this pass.

## Open expression catalogue

The model chooses what the orb shows. `ts-backend/src/expressions.ts` holds a catalogue of 28 named expressions (faces, home symbols, statuses, weather) with one-line meanings, and the system prompt lists them all. Three hidden markers may start a spoken reply: `<expression:name>` for a catalogue shape, `<readout:TEXT>` for up to twelve characters of letters, digits and units on one or two lines, and `<sketch:...>` for free polylines in a unit square (at most 8 strokes, 64 points). The backend validates and strips them; unknown or malformed markers become nothing. On the frontend `web/src/lib/inkShapes.ts` defines each catalogue shape as a distance field, `inkReadout.ts` carries a stroke font and the sketch mapper, and catalogue shapes are sampled lazily on first use. An explicit model choice replaces a device activity shape, a verified temperature reading outranks it, and a neutral reply keeps a device shape alive. `expressions-sheet.png` shows twelve samples including a two-line readout and the house sketch from the prompt. The model may also call the `show_on_orb` tool with the same three kinds; reasoning models such as DeepSeek prefer a tool over a hidden marker and otherwise tend to say they drew something without emitting it. Markers are accepted anywhere in the reply and stripped from speech, and sketch coordinates tolerate missing commas, parentheses and line breaks. Every final reply is appended to `data/orb-replies.log` with its raw text, tool choice and parsed expression, truncated past a megabyte, so a missing drawing can be diagnosed. Restart the backend to load the new prompt; sketch quality depends on the model.

## Conversational faces

The voice model chooses happy, sad, or neutral from the conversation using a hidden response marker. The backend strips this marker from speech, captions, and history, and sends the validated expression when synthesized audio is ready. Missing or unknown markers fall back to neutral. This uses the existing reply generation, with no additional model request. Model compliance and tone accuracy depend on the configured model.

Happy and sad faces use the same particle transport as device shapes. They hold for eight seconds, then disperse; active device expressions have priority. New recordings, disconnects, and playback errors clear them. Happy/sad mobile screenshots use simulated WebSocket events. Twenty-one regression tests and both builds passed; live model sentiment accuracy has not been evaluated. Restart the backend to load the voice expression instructions.

## Temperature readouts

Current temperature answers can form numeric ink, with a unit on a second line, e.g. 21.5°C or -4°F. All digits and units are particle destinations; no text overlay or shape mask is rendered. Values round to one decimal, hold for ten seconds with playback, then disperse. Readouts override sentiment and action symbols.

The model selects an entity using a hidden temperature marker. The backend accepts only numeric temperature results fetched during this voice turn, retaining the sensor unit. Unavailable, unknown, non-temperature and invented entity selections produce no reading. Climate readings use current_temperature, not the setpoint, and require an explicit unit. This first readout supports Celsius/Fahrenheit temperatures from -99.9 to 999.9; other measurements remain conversational. Live Home Assistant and model selection accuracy are not covered by simulated tests. Restart the backend to activate the new metadata and sensor attributes.
