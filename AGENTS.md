# SAWOT agent guide

## Project

SAWOT is a voice and chat assistant for Home Assistant. Preserve its minimal,
orb-centered interface and fluid ink animation. The GitHub repository is
`Edmasoud95/sawot` and is public.

## Architecture

- `web/`: React, TypeScript, Vite, Zustand, Three.js/React Three Fiber.
- `ts-backend/`: Fastify, voice WebSocket pipeline, chat streaming, Home Assistant
  tools, provider registry, and settings.
- `sidecar/`: Python FastAPI speech service.
- `server/`: shared Python speech engines, model management, configuration, and
  OpenAI-compatible audio routes. Current STT uses `transcribe-cpp`; TTS uses Kokoro.
- `tests/`: Python tests. `ts-backend/tests/` and `web/tests/`: TypeScript regression tests.
- `screenshots/redesign/`: visual references and notes. Some screenshots represent
  earlier iterations; inspect current code and rendering before treating them as a specification.

Read the affected code before changing it. requirements.txt, pyproject.toml and
server/stt.py all describe the current transcribe-cpp speech stack.

## Development and verification

Run commands from the indicated directory. Dependencies are installed separately
in `web/`, `ts-backend/`, and the root Python `.venv/`.

From `web/`:

```sh
npm run dev
npm run typecheck
npm run build
```

From `ts-backend/`:

```sh
npm run dev
npm run typecheck
npm run build
node --import tsx tests/activity.test.ts
node --import tsx tests/temperature.test.ts
node --import tsx ../web/tests/orbExpression.test.ts
node --import tsx ../web/tests/inkSimulation.test.ts
```

From the repository root:

```sh
.venv/bin/pytest -q
./run.sh
```

`run.sh` starts the Python sidecar and compiled backend. It builds missing `dist/`
directories, but does not rebuild existing ones. Rebuild changed packages before
using this launcher, and restart the backend after changing its code.

Run checks appropriate to the change; use `.github/workflows/ci.yml` for CI commands.
A sandboxed Python test run has previously stalled while the same suite passed
outside the sandbox. Diagnose a stalled run rather than assuming a product failure.
Report actual results and distinguish mocked tests from live HA/model/speech checks.
For documentation-only edits, check accuracy and `git diff --check`; builds are unnecessary.

## Orb and interaction rules

- Keep the voice screen quiet: an orb, microphone, compact navigation, and
  conversation captions. Avoid unsolicited panels, explanatory text, or controls.
- Keep the resting orb visibly filled with ink. Assistant playback should drive
  stronger motion than microphone input.
- Shapes must form by moving existing ink particles, preserving their positions
  and momentum through transitions. Do not substitute a cutout mask or icon overlay.
- `web/src/lib/inkSimulation.ts` transports particles; `inkReadout.ts` generates
  numeric stroke destinations; `shaders/orb.ts` renders the accumulated ink.
- The model chooses expressions through hidden markers or the `show_on_orb` tool:
  catalogue shapes, readouts, and sketches (`ts-backend/src/expressions.ts`).
- `orbExpression.ts` owns expression selection, priority, and expiry. Device shapes
  take priority over sentiment; validated temperature readouts take priority over both.
- Hidden model markers must stay out of speech, captions, and conversational history.
  Temperature values must come from validated live tool results, not invented model data.
- Trigger answer expressions with audio readiness so synthesis latency does not
  consume their display lifetime. Clear stale expressions on recording, disconnect,
  and errors. Preserve expiry and reduced-motion behavior.
- Update the live shader material's uniforms inside the frame loop. R3F may copy
  uniform wrappers, so mutating only the original memoized object can freeze animation.
- Keep high-frequency audio levels outside React state. Preserve a circular canvas
  when resizing, dialog focus management, keyboard access, and reduced-motion support.
- Check visual changes in a browser, including mobile widths and actual transitions;
  a still screenshot alone cannot establish that ink is moving correctly.

## Working practices

Inspect `git status` before editing. Preserve unrelated work and avoid destructive
Git commands. Commit and push when requested, with accurate descriptions of the
changes and verification. Keep generated builds, downloaded models, and local
runtime data out of commits.

Never commit or print secrets from `.env`, `config.yaml`, `settings.json`, `certs/`,
or provider credentials. Public provider responses must not expose API keys.
Use example configuration files for documentation. Follow SECURITY.md: this service
has no authentication and is intended for a trusted LAN. Do not expose it publicly
or send real Home Assistant commands merely to test a UI change.
