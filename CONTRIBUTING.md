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

## Commit messages

All new commits must follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).
This convention applies going forward; existing published commits stay unchanged.
Use the same format for pull request titles when squash merging.

```text
type(scope): short description
```

The scope is optional. Use a lowercase type and a concise, imperative description
of the change. Useful scopes include `voice`, `chat`, `web`, `sidecar`, and `security`.

- `feat`: new functionality.
- `fix`: a bug or security fix.
- `docs`: documentation changes.
- `refactor`: restructuring without changing behavior.
- `perf`: performance improvements.
- `test`: test additions or corrections.
- `build`: build tooling or dependency changes.
- `ci`: continuous integration changes.
- `style`: formatting changes without behavior changes.
- `chore`: other maintenance.
- `revert`: reverting an earlier change; identify it in the body.

```text
feat(voice): support interrupting a response
fix(security): reject untrusted WebSocket origins
docs: clarify local HTTPS setup
```

Mark breaking changes with `!` before the colon or a `BREAKING CHANGE:` footer.
Explain the impact and required migration in the body or footer. For example:

```text
fix(security)!: require explicit voice origins

BREAKING CHANGE: Voice clients must configure server.allowed_origins before upgrading.
```

Keep each commit focused. When useful, include the reason for the change and
the checks performed in a body separated from the title by a blank line.
