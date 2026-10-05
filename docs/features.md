# Features and usage

[← Back to SAWOT](../README.md)

## Voice and pictures

- **Hands-free voice:** tap the microphone to start a session. A soft cue and
  teal listening orb signal that capture is ready. Speak naturally; about 1.4
  seconds of quiet sends the turn, or tap to send sooner. Listening resumes
  automatically after each spoken reply; the microphone
  is released during playback. Captions accompany the conversation.
- **Interrupt a reply:** tap the microphone to interrupt and listen again.
  Choose **End** or press Escape to release the microphone. Switching to chat,
  leaving the page, or losing the connection also ends the session. Pending
  results are discarded; device actions already sent to Home Assistant cannot
  be undone by interruption.
- **Ask about pictures:** attach up to four images before starting a voice
  session, then ask a question aloud, or use **Send pictures** without starting
  a session. Requires an image-capable model.
- **Camera, Photo library, and Files:** take a picture or select an existing
  image. File selection remains available if live camera capture fails.
- **Session history:** revisit voice turns in the history drawer.
- **Keyboard and reduced-motion support:** the microphone works with Space or
  Enter, and the orb respects the browser's reduced-motion preference.

## An orb that responds

- **Moving ink:** 6,144 persistent particles gather into shapes, form a knot
  while thinking, and react to speech playback.
- **28 catalogue expressions:** faces, home devices, weather, and status symbols.
- **Readouts and sketches:** short text or numbers, simple drawings, and an
  optional detailed-drawing mode. The model chooses what to show; drawing
  quality depends on the model.
- **Verified temperatures:** numeric temperature expressions use validated
  readings returned by Home Assistant during the turn.
- **Quiet captions:** expression markers stay out of speech and visible history.

## Home Assistant

- **Read and control entities** through model tool calls.
- **Device cards** for entities used in a reply, available inline in chats
  with Home Assistant enabled.
- **Touch controls** for lights and switches, brightness, colour temperature,
  light colour, and thermostat targets where supported by the entity.
- **Optional home tools in chat:** enable Home Assistant per conversation.
  Voice mode exposes home tools by default; configure Home Assistant before
  using them. General chat works without a Home Assistant connection.

## General-purpose chat

- **Personal memory:** chat can save personal facts and explicit “remember this”
  requests, then recall them across conversations and model changes. Click
  **Memory saved**, **Memory updated**, or **Memories recalled** to inspect the
  facts, open their source conversation, edit them, or delete them. Recall means
  the facts were supplied to the model, not that it necessarily used them.
- **Memory controls:** **Settings → Assistant → Memory** lists saved facts and
  provides search, editing, individual deletion, and an enable/disable switch.
  Chat can forget a specifically identified fact. **Delete all memories** is
  available only in Settings, with confirmation; the model has no bulk-delete
  tool. Disabling memory retains saved facts while stopping capture and recall.
  Editing, deleting, or disabling memory can stop a reply in progress to prevent
  stale personal context from being sent again.
- **Memory scope and privacy:** this release uses one personal profile for the
  whole installation. It applies to chat, including dictated chat messages;
  dedicated Voice and Live sessions do not use it. Facts are stored locally under
  the configured data directory, but recalled facts are sent to the selected
  model provider. Deleting a memory removes its stored activity details; it does
  not erase original conversation messages or retract context already sent.
  Old chats are not mined for memories, and regeneration cannot recreate deleted
  facts. Capture depends on the model correctly calling memory tools; source
  checks are conservative and currently recognize English intent. Inspect and
  correct memories when needed. Saved memories are not added to every prompt.
  The assistant is instructed to search before answering personal questions; each
  search returns at most three matching facts (up to 3,000 characters of fact text).
  Retrieval uses lexical search; there is no semantic/vector index. Storage supports one backend writer
  and keeps owner identifiers for a future account migration.
- **Multiple saved conversations** with automatic titles, deletion,
  and a model choice for each conversation.
- **Streaming replies**, collapsible model reasoning when supplied, Markdown,
  and highlighted code blocks.
- **Chat commands:** `/status` shows the current model and estimated conversation
  context used, capacity, and remaining space; `/help` lists commands. Estimates
  include instructions, enabled tools, and readable attachments, with a rough
  allowance for images. Capacity is labelled as LM Studio reported or assumed.
  Results open in a dismissible drawer. Commands and results are not saved in
  the conversation and do not call the model or enter its context.
  Type `/` in the composer to browse command suggestions. Use arrow keys and
  Enter or Tab, or tap a suggestion, to insert it; send when ready. Escape closes
  the suggestions.
- **Mobile swipes:** move between Voice and Chat, or between Settings
  sections. Gestures avoid interactive controls and horizontally scrolling content.
- **Mobile conversation view** with history behind a menu and a compact model
  picker beside the composer controls.
- **Saved text drafts:** drafts of at least three words appear in history;
  conversations with a sent message appear regardless of length.
- **Click-to-toggle dictation:** click to start, click to stop, then edit the
  transcript and press Send yourself. Dictation does not automatically send.
- **Image and text attachments:** PNG, JPEG, WebP, GIF, and common text/code
  formats, up to 10 MB per upload. Images require a vision-capable model.
  PDFs can be uploaded, but their contents are **not yet extracted**.
- **Separate chat instructions** editable in Settings, independent of the
  voice assistant's personality.

## Web search

- **Brave-powered search** in voice and chat when a Brave Search API key is set.
- **Page reading and phrase lookup** through `web_search`, `fetch_page`, and
  `find_in_page`, with source links in chat and a compact source popover in voice.
- **Per-conversation search toggle** in chat. Search and page retrieval require
  internet access.

## Models, speech, and personality

- **A built-in local model endpoint plus custom providers** with their own base
  URLs and API keys. Provider model lists load independently into a searchable
  picker, so one unavailable server does not block the others. Dedicated
  non-chat models are filtered using available metadata and model-name heuristics.
- **OpenAI-compatible transports**, including a Responses API fallback for
  supported provider errors. Compatibility still depends on the provider and model.
- **Local speech recognition** through transcribe.cpp. The catalogue includes
  Parakeet Unified EN, Parakeet TDT v3, Cohere Transcribe, Whisper Large v3 Turbo,
  and Canary; language coverage varies by model.
- **Kokoro speech synthesis** by default. Optional Chatterbox Turbo and Nano
  support expressive sound tags and cloned voices.
- **Voice cloning:** record, name, and delete voice clips in Settings, then use
  them with Chatterbox. A WAV in `models/tts/voices/` also becomes a named voice.
  Selecting Chatterbox’s default voice restores its built-in voice after using a clone.
- **Download and switch speech models** from Settings, with download progress.
  Speech engines release weights after ten idle minutes and reload on use;
  the first request after that pause may take longer.
- **Custom personality:** use Rita's default sassy persona, choose plain, or
  write a custom brief. The selected model can generate or refine the brief.
- **Persistent settings:** model, voice, personality, drawing detail, providers,
  and chat instructions can be changed without editing source code.

## Diagnostics and integration

- **Optional debug bar** in **Settings → Advanced**: resolved model/provider,
  request outcomes, STT/model/tool/TTS timing, events, raw messages, and state,
  with JSON copy for a turn.
- **Live resource usage:** the running terminal and debug bar report RAM and CPU
  for the backend, speech service, and their named subprocesses. The **Resources**
  tab also shows CPU/GPU hardware names and NVIDIA GPU activity and VRAM, refreshed
  about every five seconds. CPU 100% means one logical core; RAM is summed resident
  memory. Subprocess rows are included in their parent component totals. Device-wide
  GPU readings include other applications. Unsupported counters
  show N/A, including per-process VRAM on WSL. External model servers and browsers
  are excluded from SAWOT process totals. The backend exposes the same readings at
  `GET /api/resources`; resource monitoring does not run inference or wake models.
- **OpenAI-compatible audio endpoints:** `POST /v1/audio/speech`,
  `POST /v1/audio/transcriptions`, and `GET /v1/models` through the backend.
- **Phone home-screen installation:** standalone app presentation with an icon.
  It still needs a connection to the SAWOT server.


## Settings

| Section | What you can change |
| --- | --- |
| Connections | AI providers, Home Assistant URL and token, Brave Search key, Hugging Face token; each connection includes setup help. |
| Assistant | Voice model, personality, custom personality brief, drawing detail, and separate chat instructions. |
| Speech | Speech model downloads and selection, output voice, and Chatterbox voice clips. |
| Advanced | Debug bar with turn timings, events, raw traffic, live state, and component resource usage. |

See [configuration](configuration.md) for startup options and credential migration.
