# Development and verification

[← Back to SAWOT](../README.md)

| Directory | Responsibility |
| --- | --- |
| `web/` | React, TypeScript, Vite, Zustand, Three.js ink renderer |
| `ts-backend/` | Fastify, voice WebSocket pipeline, streaming chat, providers, Home Assistant and search tools |
| `sidecar/` | Python FastAPI speech service |
| `server/` | Speech engines, model downloads, voice clips, configuration and audio API |
| `tests/`, `ts-backend/tests/`, `web/tests/` | Python and TypeScript regression tests |

From the repository root, after installing dependencies:

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest -q
(cd ts-backend && npm run typecheck && npm run build)
(cd web && npm run typecheck && npm run build)
(cd ts-backend && node --import tsx --test tests/*.test.ts ../web/tests/*.test.ts)
```

Use `npm run dev` in `web/` for frontend hot reload and in `ts-backend/` for
backend watch mode. The backend still needs the Python sidecar; run
`./run_sidecar.sh` separately. Add the actual Vite origin (normally
`http://localhost:5173`) to the voice allowlist. The current Vite configuration
only proxies `/ws`; full chat/settings development also needs `/api` and the
relevant audio routes proxied to the backend. The compiled UI on port 8765
avoids this limitation. Avoid starting a second backend on an occupied port.

CI commands are in [.github/workflows/ci.yml](../.github/workflows/ci.yml).
Mocked tests and screenshot fixtures do not verify real microphones, speech
quality, provider compatibility, or live Home Assistant actions.

For extensions, start with `ts-backend/src/tools.ts` (tools),
`ts-backend/src/expressions.ts` and `web/src/lib/inkShapes.ts` (orb expressions),
`ts-backend/src/providers.ts` (providers), or `server/stt.py` and `server/tts.py`
(speech engines). Contribution and commit conventions are in
[CONTRIBUTING.md](../CONTRIBUTING.md).
