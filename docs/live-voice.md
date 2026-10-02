# Live voice trial

Enable **Settings → Advanced → Enable Live voice trial**, then open
**Speech → Live voice** and choose **Live trial**, an OpenAI account, and a voice.
The flag is off by default and applies to the server. Mode, account and voice
choices apply to this browser. Reuse the API key already saved in Connections.

Tap the microphone to connect. GPT-Live handles continuous listening and spoken
interruptions. Tap End (or the microphone again) to disconnect. After 30 seconds
without detected speech, output audio or active tool work, SAWOT ends the session. Hiding the page,
opening Chat, changing Live options, or disabling the trial also ends capture.
Other browsers refresh the feature flag within ten seconds; the server closes
active sessions when it is disabled.

Live can delegate Home Assistant actions and readings, plus web search and page
reading when Brave search is configured. Tool work uses the model selected under
Assistant, with the same home and search connections as Standard voice. Requests
are serialized and each delegation ID runs at most once. Closing Live or disabling
the flag cancels queued work. An already-sent home action may still complete;
uncertain results are reported rather than automatically retried. Live does not
accept pictures; use Standard voice for those.

**Assistant → Personality** includes Angry, Flirty and Crying / whiny, alongside
Sassy, Plain and Custom. Voice personalities apply to Standard and Live;
reconnect Live after changing one. Angry is theatrical and grumpy; Flirty is
warm and playful. Crying / whiny plays a tearful, angry girlfriend character
with trembling delivery, dramatic complaints and sharp fictional dialogue.
This character uses a girlfriend identity instead of an assistant identity and
can interject, overlap speech and initiate dialogue within the scene. Explicit
requests to stop, pause or change character take priority.
Chat retains its separate instructions. The Live prompt invites fictional scenes,
acting and laughter without treating stage directions as real device commands.
The model's actual vocal performance still needs a listening test.

With the Live flag enabled, **Advanced → Live system prompts** exposes editable
conversation and tool prompts, reset buttons, and previews with current settings.
Conversation templates can use `{name}`, `{identity}`, `{personality}`,
`{backchannel_policy}`, `{interruption_policy}`, and `{capabilities}`;
the tool template can use `{device_context}`. Conversation edits apply on the
next Live connection, tool edits to the next delegated task. Tool availability
remains controlled by connections and the feature flag, not by prompt wording.

Microphone audio travels directly to OpenAI over WebRTC while connected. The
voice is AI-generated and paid API usage applies. SAWOT keeps the API key on its
server, requests `store: false`, and adds the displayed transcript to this
browser's voice history when the session ends. Bounded transcript context also
travels to SAWOT and the selected Assistant model for delegated tasks. Starting a session always requires
a tap; the app does not automatically reconnect a paid session.

The server leases sessions using browser heartbeats and attempts remote hangup
when a browser disappears. Failed hangups are retried while SAWOT is running.
Closing the page releases its microphone immediately; network failure can delay
confirmation that the provider has stopped billing. This is a trusted-LAN trial
under the same security model as the rest of SAWOT.

Implementation uses `gpt-live-1`, the Live sessions API, and the `oai-events`
data channel. See the official [WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live)
and [Live conversations guide](https://developers.openai.com/api/docs/guides/live-conversations).

Verification: automated coverage includes flag persistence/validation, origin
checks, key privacy, creation cancellation, abandoned-session cleanup, hangup
retries, transcript overlap, and the 30-second timeout. A synthetic-silence
WebRTC connection reached Listening and returned HTTP 200 on remote hangup.
Automated tool checks use simulated home actions and search results, not real
household device commands. Synthetic checks do not establish voice naturalness, real-device microphone
quality or interruption performance; those need a listening test.
