# Chat reasoning effort

Open the model picker in the chat composer. Models with known effort support
show a stepped **Effort** slider below the list, with a visible dot for each
level and a round handle that snaps between them. Tap a stop, drag, or use the
arrow keys to change it. The label names the model the
slider controls, even while searching for another model.

- **Medium** is the default when the model supports it, including existing
  conversations without an explicit selection. Previously chosen levels stay
  unchanged. Models without Medium retain a **Default** step that lets the
  provider choose.
- Other steps are the values supported by that provider/model combination.
- The selection is saved with the conversation. Switching to a model that cannot
  use the selected level resets it to Medium when supported, otherwise the provider default.
- If support disappears, use **Reset to Default** in the picker.
- An explicit effort rejected by the provider is shown as an error. SAWOT does
  not silently turn reasoning off or remove that selection.

Higher effort can take longer and use more reasoning tokens. These controls
apply to chat replies and their tool-call rounds. Voice mode and automatic
conversation titles retain their existing behavior.

## Where capabilities come from

The backend owns capability discovery and validation; the browser does not infer
support from a model name.

1. An OpenAI-compatible provider can advertise an explicit
   `supported_reasoning_efforts` array in each `/models` entry. This is an optional
   SAWOT extension, not a standard field guaranteed by OpenAI's models API.
   Recognized values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`,
   and `ultra`. Only values actually advertised become selectable. An empty or
   malformed field disables effort control for that model.
2. For the official `https://api.openai.com/v1` endpoint, a small catalogue in
   `ts-backend/src/effort.ts` supplies documented levels for verified model IDs
   and their dated snapshots. It does not assume that similarly named models
   on proxies or local servers share the same contract.
3. DeepSeek's official endpoint uses the `effort.supported_levels` metadata from
   `/models`, plus `none` for thinking off. When metadata is absent, the verified
   `deepseek-flash` and `deepseek-v4-pro` IDs offer None, Low, High, and Max.
   Default leaves the choice to DeepSeek (currently High); Medium is not added
   as a duplicate of High. See [model metadata](https://api-docs.deepseek.com/api/list-models/)
   and [request parameters](https://api-docs.deepseek.com/api/create-chat-completion/).
4. LM Studio uses `capabilities.reasoning.allowed_options` from its native
   [`/api/v1/models` endpoint](https://lmstudio.ai/docs/developer/rest/list), matched
   by model key or loaded-instance ID. Advertised grades become slider steps;
   `off` maps to `none`. Models offering only On/Off or always-on thinking do not
   receive a graded slider. LM Studio 0.4.8 introduced this metadata and Chat
   Completions effort support. Older servers or missing native metadata leave
   the slider hidden unless the explicit extension above supplies its levels.
   Native discovery is bounded to 1.5 seconds and also works for custom providers.
5. Unknown models and providers do not show a slider. A generic reasoning-support
   flag or `supported_parameters` list is not enough to establish valid levels.

The initial catalogue was checked on 2026-09-27 against the official model pages,
including [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra),
[GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol),
[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), and
[GPT-5.2](https://developers.openai.com/api/docs/models/gpt-5.2).
Variants such as `-pro`, `-codex`, and `-chat-latest` need their own verified entry;
SAWOT does not copy the base model's levels to those variants.

The control respects reduced-motion preferences. On browsers that support
`navigator.vibrate()`, changing steps requests a brief, throttled vibration pulse.
Actual feedback depends on the device and its settings; iPhone PWAs do not
provide this general vibration API. Visual and keyboard feedback work without it.
