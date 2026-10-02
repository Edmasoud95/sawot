# Data storage and privacy

[← Back to SAWOT](../README.md)

For a standard native installation, these paths are under the repository root.
With `SAWOT_DATA_DIR`, they are under that directory instead. Docker sets it to
`/data`, mapped to the host's `./data`.

| Contents | Native path | Host path with the supplied Compose mount |
| --- | --- | --- |
| Chat conversations and saved drafts | `data/conversations/` | `data/data/conversations/` |
| Uploaded pictures and files | `data/uploads/` | `data/data/uploads/` |
| Voice reply/expression diagnostic log | `data/orb-replies.log` | `data/data/orb-replies.log` |
| Settings and provider credentials | `settings.json` | `data/settings.json` |
| Downloaded speech models | `models/` | `data/models/` |
| Cloned voice recordings | `models/tts/voices/` | `data/models/tts/voices/` |

Uploads persist across restarts. **Deleting a chat also deletes its associated
uploads**, including unsent files uploaded to that chat. Files referenced by another
chat are kept until that chat is deleted. Removing an attachment from the composer
keeps its file until the conversation is deleted. Older unattached uploads and
voice uploads have no automatic cleanup. Voice session history is distinct from saved chat conversations;
the diagnostic reply log can still contain voice response text.

Runtime data, credentials, and models are gitignored, but are not encrypted by
the app. Back them up and protect access to the host. Debug exports can contain
conversation content and device information.

When you select a hosted LLM, conversation content and attached images used in
requests leave the local server. Web search sends queries to Brave and fetches
external pages. Local speech processing does not make those features local.

Optional [Python analysis](python-sandbox.md) stores private files and manifests in
`analysis/` below `SAWOT_DATA_DIR` (`data/analysis/` on the host with the default
Docker volume). These files have conversation quotas and are served only as
attachments. Printed analysis data is sent to the selected model provider.
