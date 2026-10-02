<div align="center">

# SAWOT

**Voice, chat, and home control—with an animated ink orb.**

Talk to your home, ask questions, or discuss a picture. Run speech locally and
connect the language model of your choice.

[![CI](https://github.com/Edmasoud95/sawot/actions/workflows/ci.yml/badge.svg)](https://github.com/Edmasoud95/sawot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Get started](#getting-started) · [Features](#features) · [Documentation](#documentation) · [Report a bug](https://github.com/Edmasoud95/sawot/issues)

</div>

![SAWOT demo: asking to turn on the living room lights, followed by a bulb-shaped ink animation and reply](screenshots/lights-demo.gif)

*Simulated interaction in the actual interface; no live devices are controlled.
[View a still image](screenshots/voice.png).*

SAWOT combines local speech recognition and synthesis with a local or hosted
OpenAI-compatible language model. Home Assistant is optional: start with general
chat, then connect your home when you want device tools.

**Work in progress.** Features and setup can change between commits. Existing
screenshots may show older layouts; see the [gallery and capture notes](docs/screenshots.md).

> **Trusted LAN only.** SAWOT has no login or user isolation. Anyone who can
> reach the server can read conversations and use configured home controls.
> HTTPS does not add authentication. Do not expose it to the internet.
> Read [SECURITY.md](SECURITY.md) before installing.

## Features

- **Hands-free voice:** tap to start, speak, and keep the conversation going
  across replies. Tap to interrupt; end the session when finished.
- **An expressive ink orb:** moving particles form expressions, sketches, and
  short readouts. Temperature readouts use validated Home Assistant results.
- **General-purpose chat:** streaming Markdown replies, expandable reasoning,
  saved conversations and drafts, editable dictation, and `/status` context estimates.
- **Home Assistant tools:** ask about devices or control them with inline cards.
  Enable home tools separately for each chat.
- **Pictures, files, and web search:** ask about images, attach text/code files,
  or search and read web pages with Brave-powered tools and source links.
- **Your models and voices:** choose local or hosted AI providers, download speech
  models in Settings, and use Kokoro or optional Chatterbox with cloned voices.

The mobile interface includes swipe navigation, a compact conversation menu,
and home-screen installation. Speech runs through transcribe.cpp; the interface
uses React and Three.js, backed by Fastify and a Python speech service.

[Explore all features and controls →](docs/features.md)

<details>
<summary>Watch: a general question with web search and sources</summary>

![SAWOT answers when the Roman Empire collapsed, shows a date in the ink orb, and opens web sources](screenshots/search-demo.gif)

*Simulated voice and search interaction in the actual interface. The demo shows
search progress, an answer, and the sources panel; it is not a live search recording.*

</details>

## Getting started

You need Docker on an **x86_64 host** for the packaged CPU image, plus a reachable
**OpenAI-compatible language model endpoint**. SAWOT does not bundle an LLM server.
Use a model with tool calling for home/search tools and image input for pictures.
Internet access is needed for installation and initial speech-model downloads.

Prefer Linux/WSL2 without Docker? Follow the [native installation guide](docs/installation.md#native-setup).

### 1. Get the project

```bash
git clone https://github.com/Edmasoud95/sawot.git
cd sawot
cp .env.example .env
```

For a local model server, set `LLM_URL` in `.env` to its OpenAI-compatible base URL
including `/v1`, and optionally set `LLM_MODEL`. The Compose default is
`http://host.docker.internal:1234/v1` (the Docker host). You can also add a hosted
provider through Settings after startup.

### 2. Allow your browser origin

Create `docker-compose.override.yml` beside the supplied Compose file:

```yaml
services:
  sawot:
    environment:
      SAWOT_ALLOWED_ORIGINS: "http://localhost:8765"
```

The base Compose file does not forward this variable. It must match the exact
address you open in the browser. For a phone, use a trusted HTTPS address and
follow the [phone access guide](docs/installation.md#phone-access-and-https).

### 3. Start SAWOT

```bash
mkdir -p data/data/uploads
docker compose up -d
```

Open **http://localhost:8765**. Initial speech loading can take time; inspect logs
with `docker compose logs -f sawot`. To build this checkout instead of using the
published image, use `docker compose up -d --build`.

### 4. Choose your connections and models

- **Settings → Connections:** add AI providers as needed. Home Assistant URL/token,
  Brave Search key, and Hugging Face token are optional connections with setup help.
- **Settings → Assistant:** choose the voice assistant’s model and personality.
  Chat has its own model picker and separate instructions.
- **Settings → Speech:** for voice or dictation, download/select an STT model.
  The defaults are **Parakeet Unified EN** for recognition and **Kokoro** for speech.
- Open Chat and send a message, or grant microphone permission and tap the orb
  screen’s microphone to start a voice session.

Home Assistant credentials are **not required for startup or general chat**.
For details, updates, and optional Chatterbox voices, see [installation and first run](docs/installation.md).

## Documentation

| Guide | Contents |
| --- | --- |
| [Features and usage](docs/features.md) | Voice controls, chat commands, attachments, search, models, and Settings |
| [Installation](docs/installation.md) | Docker, native Linux/WSL2, first run, updates, phone HTTPS, and optional Chatterbox |
| [Configuration](docs/configuration.md) | Startup options, environment variables, connections, and credential migration |
| [Data and privacy](docs/storage.md) | Storage paths, backups, upload deletion, and what leaves the server |
| [Troubleshooting](docs/troubleshooting.md) | Common failures and current limitations |
| [Python sandbox](docs/python-sandbox.md) | Optional isolated Python analysis, deployment and verification requirements |
| [Development](docs/development.md) | Architecture, local development, and verification commands |
| [Screenshot gallery](docs/screenshots.md) | Existing UI captures and their limitations |

## Current limitations

- No authentication, wake word, or spoken interruption during replies; tap to interrupt.
- PDFs can be uploaded, but their text is not extracted for the model.
- Context usage is estimated; there is no automatic history trimming or summarization.
- The packaged Docker image is CPU-only and `linux/amd64`.
- Provider capabilities and real-device microphone/audio behavior vary. Hosted
  models and web search send data outside the local server.

See the [full limitations and troubleshooting guide](docs/troubleshooting.md).

## Contributing

Bug reports and contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md)
for the workflow and commit conventions, and [development](docs/development.md)
for local checks. Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Ed Masoud
