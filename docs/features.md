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
- **Device cards** appear as Home Assistant tools finish, before the final chat
  answer. One or two devices use compact cards; larger sets use a scrollable
  list capped at 30 devices, with expandable controls.
- **Touch controls** for lights and switches, brightness, colour temperature,
  light colour, and thermostat targets where supported by the entity. Changes
  appear immediately with an updating status, then reconcile with Home Assistant.
  Failed or unconfirmed changes restore the last confirmed display with an error;
  a lost confirmation does not guarantee the physical device was unchanged.
  Rapid changes are ordered per device, and refreshes fetch only that device.
- **Optional home tools in chat:** enable Home Assistant per conversation.
  Voice mode exposes home tools by default; configure Home Assistant before
  using them. General chat works without a Home Assistant connection.

## General-purpose chat

- **Selected result cards:** after searching, the assistant selects short result IDs
  with `present_results`. The app supplies the retrieved titles, links and thumbnails;
  new replies do not depend on model-written card JSON or special Markdown. Only
  selected results become cards; other results stay in Sources and citations remain
  ordinary links. News cards are wide and stacked vertically. Product cards are tall
  in a horizontal row with touch scrolling, arrow controls and keyboard navigation.
  Unknown prices are omitted. Selections survive reloads and remain in model context
  for follow-up questions. Images load near the viewport through the bounded thumbnail
  service. Older saved card markup remains readable.
- **Blocked pages:** HTTP 403 from page-reading tools produces a non-retryable,
  link-only result. Both page readers share a five-minute, per-URL cooldown, including
  known redirect targets. Chat also prevents retrying that page through the file
  downloader during the turn. A repeated attempt ends tool use and requests a final
  answer; if the model still asks for tools, the app supplies a plain-link explanation.
  Selected blocked pages stay plain links and do not request thumbnail previews.

- **Personal memory:** chat, Voice, and Live voice can save personal facts and explicit “remember this”
  requests, then recall them across conversations and model changes. The assistant
  is instructed to proactively save useful details as they are shared, such as
  preferences, relationships, equipment, and ongoing goals, while skipping passing
  states and hypothetical statements. Click
  **Memory saved**, **Memory updated**, or **Memories recalled** to inspect the
  facts, open their source chat when available, edit them, or delete them. Voice
  captures are labeled as coming from a voice session. Recall means
  the facts were supplied to the model, not that it necessarily used them.
- **Memory controls:** **Settings → Assistant → Memory** lists saved facts and
  provides search, editing, individual deletion, and an enable/disable switch.
  The assistant can forget a specifically identified fact. **Delete all memories** is
  available only in Settings, with confirmation; the model has no bulk-delete
  tool. Disabling memory retains saved facts while stopping capture and recall.
  Editing, deleting, or disabling memory can stop a reply in progress to prevent
  stale personal context from being sent again.
- **Memory scope and privacy:** this release uses one personal profile for the
  whole installation. It applies to chat, including dictated chat messages, and to Voice and Live sessions. Facts are stored locally under
  the configured data directory, but recalled facts are sent to the selected
  model provider. Deleting a memory removes its stored activity details; it does
  not erase original conversation messages or retract context already sent.
  Old chats are not mined for memories, and regeneration cannot recreate deleted
  facts. Capture depends on the model correctly calling memory tools; source
  checks are conservative and currently recognize English intent. Inspect and
  correct memories when needed. Saved memories are not added to every prompt.
  The assistant is instructed to recall relevant facts before answering personal
  questions and before searches, recommendations, comparisons, or plans that
  depend on personal context, including shopping region for product searches. Each
  search returns at most three matching facts (up to 3,000 characters of fact text).
  Retrieval uses lexical search; there is no semantic/vector index. Storage supports one backend writer
  and keeps owner identifiers for a future account migration.
- **Private memories:** mark a fact private in its editor, or let the assistant mark
  sensitive facts private when saving with a trusted provider. In Settings →
  Connections, enable **Allow private memories** only for providers you trust.
  Access defaults off for every provider, including the built-in model server.
  Non-private providers cannot recall or modify private facts; only the user can
  remove a fact's private flag. Existing memories remain non-private until changed.
  Chats that save or recall private facts stay restricted to trusted providers,
  including branches. Marking an old fact private also restricts its source and
  earlier recall conversations. Start a fresh chat to use a non-private provider.
  Read-aloud uses local speech or an explicitly trusted speech provider for those
  chats. Voice private recall requires a trusted model and local or trusted speech;
  Live voice requires both its speech provider and backend model to be trusted.
  Sessions that use private facts cannot continue through untrusted providers;
  reload to start a fresh voice session. Web search stays enabled, so search queries can still transmit sensitive
  content. The setting controls access; it does not verify a provider's location,
  encrypt memory storage, or retract data already sent to a service.
- **Multiple saved conversations** with automatic titles, deletion,
  and a model choice for each conversation. History has date groups and searches
  titles, drafts, and message text with short matching excerpts. Failed history
  and new-conversation requests show a retry action.
- **Streaming replies**, collapsible model reasoning when supplied, Markdown,
  and highlighted code blocks. Scrolling up pauses following and preserves your
  reading position; a Latest / New reply button returns to the bottom. Returning
  to a running conversation catches up with the current response and resumes
  live text, reasoning, and tool activity. Reconnection does not restart the
  request; Stop explicitly cancels it. Rapid text updates are batched to keep
  rendering responsive.
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
  picker beside the composer controls. The burger menu opens chat history
  and New chat. Hold a message or tap its three-dot button for a compact
  context menu with larger touch targets. Supported devices give a brief
  vibration just before a held message's menu opens; scrolling cancels the hold.
- **Branch in new conversation:** use a saved message's actions to copy the
  conversation through that message into a separate chat. The branch keeps
  the model, reasoning effort, tool settings, attachments, and generated files,
  starts with an empty composer, and leaves the original conversation intact.
- **Chat continuity:** switching between Chat, Voice, and Settings preserves the
  selected conversation, draft, and reading position. On a fresh app visit,
  chats used within 30 minutes or still responding on the server reopen
  automatically. After a longer absence, a fresh composer offers a compact
  **Continue previous chat** or **Resume draft** shortcut. Explicit New chat
  choices and notification destinations take priority. The browser stores only
  the last conversation ID, visit time, and scroll position for this feature.
- **Saved text drafts:** even short drafts are preserved with their conversation.
  Drafts of at least three words appear in history; conversations with a sent
  message appear regardless of length.
- **Click-to-toggle dictation:** click to start, click to stop, then edit the
  transcript and press Send yourself. Dictation does not automatically send.
- **Image and text attachments:** PNG, JPEG, WebP, GIF, and common text/code
  formats, up to 10 MB per upload. Images require a vision-capable model.
  Image support is based on explicit provider metadata; absent metadata is shown
  as unknown. The composer only suggests switching to a model with verified
  image-input support. Chat tools distinguish permission from service availability.
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
  At startup, local speech models stay unloaded until the first transcription
  or speech request. Voice-list queries do not load weights. Speech engines
  release weights after ten idle minutes and reload on use;
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
