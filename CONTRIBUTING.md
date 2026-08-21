# Contributing

Thanks for your interest in SAWOT! Contributions are welcome.

## Development setup

See the [README](README.md) for prerequisites and setup.

## Running tests

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest
```

Some tests (`tests/test_stt.py`, `tests/test_tts.py`) download models and
may require a GPU; they can be skipped on machines without CUDA.

## Frontend

The UI lives in `web/` (React + Vite). During development:

```bash
cd web && npm run dev   # hot reload; proxies /ws to the server on 8765
```

## Guidelines

- Keep changes small and focused — one concern per pull request.
- Add or update tests for behavior changes.
- Run `pytest` and `cd web && npm run build` before submitting.
