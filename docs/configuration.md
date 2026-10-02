# Configuration reference

[← Back to SAWOT](../README.md)

Settings has four sections: **Connections**, **Assistant**, **Speech**, and
**Advanced**. Service credentials belong in Connections; diagnostics are in
Advanced. See [features and usage](features.md#settings) for the full map.

Start with [config.example.yaml](../config.example.yaml) and [.env.example](../.env.example).
Startup configuration changes require a restart; choices exposed in Settings
persist in `settings.json` and are applied at runtime.

| Purpose | YAML key | Environment variable |
| --- | --- | --- |
| Home Assistant connection | Settings → Connections (legacy: `home_assistant.url`) | `HA_URL` (migration only) |
| Built-in LLM server/model | `llm.url`, `llm.model` | `LLM_URL`, `LLM_MODEL` |
| Speech recognition | `stt.model`, `stt.language` | `STT_MODEL`, `STT_LANGUAGE` |
| Kokoro voice/language | `tts.voice`, `tts.lang_code` | `TTS_VOICE`, `TTS_LANG_CODE` |
| Name/personality | `assistant.name`, `assistant.personality` | `ASSISTANT_NAME`, `ASSISTANT_PERSONALITY` |
| Custom personality | `assistant.personality_prompt` | `ASSISTANT_PERSONALITY_PROMPT` |
| Bind address/port | `server.host`, `server.port` | `SERVER_HOST`, `SERVER_PORT` |
| Voice browser origins | `server.allowed_origins` (list) | `SAWOT_ALLOWED_ORIGINS` (comma-separated) |
| Direct HTTPS | `tls.certfile`, `tls.keyfile` | `TLS_CERTFILE`, `TLS_KEYFILE` |
| Runtime storage root | — | `SAWOT_DATA_DIR` |
| Backend → sidecar URL | — | `SAWOT_SIDECAR_URL` |
| Optional Python runner socket | — | `SAWOT_RUNNER_SOCKET` (see [sandbox setup](python-sandbox.md)) |
| Sidecar listening port | — | `SAWOT_SIDECAR_PORT` |

`controls` in YAML overrides the direct device-control service whitelist.
Home Assistant, Brave Search, Hugging Face, and AI providers are
managed in Settings → Connections and stored in `settings.json`. Credential fields show only
whether a key is configured; saved secrets are never sent back to the browser.
Blank replacement fields leave keys unchanged; **Remove** clears a saved key.
Home Assistant’s URL and token can be saved together. Chat’s Home Assistant
toggle is unavailable until both are configured, with a shortcut to setup.
The info button beside each connection explains what to enter and how to get it.

On upgrade, the backend imports the Home Assistant URL from `HA_URL` or
`home_assistant.url`, plus legacy `HA_TOKEN`, `BRAVE_API_KEY`, `HF_TOKEN`
(or `HUGGING_FACE_HUB_TOKEN`), and YAML `search.brave_api_key` values only when
the corresponding saved setting is absent. Saved values always win, including
explicit removals. After the first successful startup, remove the old credential
entries from `.env`, YAML, and deployment environment configuration. Compose
forwards optional legacy variables for migration; none are required for startup.
A cached `hf auth login` is used only if no Hugging Face setting exists; removing
a saved token disables that fallback too.
Both processes coordinate settings writes using `settings.json.lock`. If a crash
leaves that directory behind and saves report that settings are busy, stop SAWOT,
remove the stale lock directory, and start it again.
For Docker, explicitly forward additional environment variables in Compose;
its `.env` file is an interpolation source, not an automatic container env file.

## Response notifications

In **Settings → Assistant → Response notifications**, enable notifications on each
browser installation that should receive them. Only the device that sends a chat
turn is notified when its saved answer finishes, including regenerated answers.
Permission is requested only when you press Enable. Notifications show only
**Chat title — Your response is ready.** The chat title may appear on the lock screen; message content is not included. Untitled chats fall back to **SAWOT**. Tapping opens the matching conversation.

Use trusted HTTPS. Sending and receiving Web Push requires outbound internet
access to the browser vendor; SAWOT remains on your trusted LAN. Opening the chat
still needs LAN or private VPN access. The worker handles push and clicks only;
it does not cache the app for offline use.

The backend creates `data/push-notifications.json` under its configured data
directory with restrictive permissions. This private file contains stable VAPID
keys and device registrations; preserve it across restarts and do not publish it.
Optional `SAWOT_VAPID_SUBJECT` overrides the default project contact URL with a
valid HTTPS or `mailto:` contact. Forward this variable explicitly in Docker if
needed. Delivery uses a bounded in-memory queue, so restarting between saving an
answer and sending its notification can lose that notification, but not the answer.
