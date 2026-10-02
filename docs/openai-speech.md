# OpenAI text-to-speech

SAWOT can use OpenAI for voice replies and chat read-aloud while keeping
transcription local and choosing the conversation model independently.

1. In **Settings → Connections → AI providers**, add OpenAI with base URL
   `https://api.openai.com/v1` and your OpenAI API key. An existing OpenAI
   provider can be reused.
2. Open **Settings → Speech → Text-to-speech** and select that provider.
3. Choose `gpt-4o-mini-tts`, `tts-1`, or `tts-1-hd`, then choose a voice in
   the **Voice** row. The voice list reflects the selected model.

The key stays on the server in private settings. Text being read aloud is sent
to OpenAI, whose API requires internet access and paid usage. The generated
voice is AI-generated. OpenAI-compatible chat providers are not automatically
treated as speech providers; this integration supports the official OpenAI
endpoint. Local cloned voices remain available when using local speech.

Select **Local** to return to the sidecar's speech engine. Switch speech away
from an OpenAI provider before removing it in Connections. If the current voice
is unsupported after switching models or providers, SAWOT selects a supported
default. Settings apply to the next voice turn or read-aloud request.

Audio uses the existing complete-WAV playback path; incremental streaming is
not implemented. OpenAI requests time out after 60 seconds and accept at most
4096 characters; chat read-aloud retains its existing 2000-character limit.
Longer voice replies produce a message asking for shorter text. Cancellation
aborts the HTTP request and prevents stale playback, but cannot guarantee that
OpenAI stops processing or charging for work already submitted. Cloud failures
are reported without silently switching to another provider.

The public `/v1/audio/*` compatibility routes continue to serve the local
sidecar. Speech selection applies to the app's voice and chat flows.

See the [OpenAI speech guide](https://developers.openai.com/api/docs/guides/text-to-speech)
for model and voice details.
