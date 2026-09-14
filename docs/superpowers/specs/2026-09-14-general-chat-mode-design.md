# Chat mode: general assistant with optional Home Assistant

Date: 2026-09-14

## Problem

The Chat mode has a general chat interface: server-stored conversations,
streaming replies with a collapsible thinking block, a per-conversation model
picker, image, text and PDF uploads, markdown rendering with highlighted code
blocks and a copy button. But the backend feeds it the voice system prompt
unchanged. That prompt tells the model it is a smart-home voice assistant that
speaks out loud, must answer in one or two sentences, and must not use
markdown or lists. It then appends the whole device list and gives the model
only the Home Assistant tools.

The result is a chat window whose model gives clipped spoken-style answers and
thinks of itself as a home controller. The goal is a chat mode that serves
everyday AI use: full-length answers, markdown, current information from the
web, and Home Assistant control only when the user wants it. Voice mode is
unchanged.

## Decisions

- Home Assistant is optional per conversation and off by default. A toggle in
  the chat header turns the device context and tools on for that conversation.
- Chat has its own instructions, a free-text field in Settings, empty by
  default. Empty means a neutral, capable general assistant. The voice
  personality (sassy, plain, custom) does not apply to chat.
- Web search uses the Brave Search API, configured by an API key. A companion
  page-read tool fetches a URL and returns its text so the model can go past
  search snippets.
- Code blocks already have syntax highlighting and copy buttons. No work.

## Backend

### Chat system prompt

New module `ts-backend/src/chatPrompt.ts`:

```ts
export interface ChatPromptOptions {
  name: string;            // assistant name from config
  instructions: string;    // user's chat instructions, may be empty
  today: string;           // e.g. "Monday 14 September 2026"
  homeAssistant: boolean;  // conversation flag
  entitySummary: string;   // device list, used only when homeAssistant
  search: boolean;         // web_search and fetch_page are available
}
export function buildChatSystemPrompt(o: ChatPromptOptions): string;
```

Prompt content, in order:

1. Identity: "You are {name}, a general-purpose AI assistant in a chat app."
   Answer as fully as the question needs. Use markdown where it helps: headings
   for long answers, lists, tables, fenced code blocks with a language tag.
   Today's date.
2. Instructions block, present only when `instructions.trim()` is non-empty:
   "Instructions from the user:\n{instructions}".
3. Search block, present only when `search` is true: use `web_search` for
   current events, facts that may have changed, or anything the user asks to
   look up; use `fetch_page` to read a result when the snippet is not enough;
   cite sources as markdown links in the answer; never invent URLs.
4. Home Assistant block, present only when `homeAssistant` is true. It reuses
   the existing `FUNCTIONAL` device text and summary from `agent.ts`, exported
   as a function so both prompts share one copy. The sentence "You may also
   answer general questions conversationally" is dropped in the chat copy
   because the identity section already covers it.

The voice prompt in `agent.ts` is not changed apart from exporting the device
block.

### Search and page-read tools

New module `ts-backend/src/search.ts`:

```ts
export interface SearchResult { title: string; url: string; description: string; }
export interface SearchClient { search(query: string, count: number): Promise<SearchResult[]>; }
export class BraveSearchClient implements SearchClient { constructor(apiKey: string, fetchFn = fetch) }
export function buildSearchTools(client: SearchClient, fetchFn = fetch): Tool[];
```

`buildSearchTools` returns two tools of the existing `Tool` shape.

`web_search`: parameters `query` (string, required) and `count` (integer, 1 to
8, default 5). Calls Brave `GET https://api.search.brave.com/res/v1/web/search`
with `X-Subscription-Token`, maps `web.results[]` to `{title, url, description}`
and returns `{ results }`. Brave errors surface as `{ error }` with the HTTP
status, never the key. Ten second timeout.

`fetch_page`: parameter `url` (string, required). Rules before fetching:

- Scheme must be `http:` or `https:`.
- The host must not resolve to a loopback, link-local, or private address
  (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7). This stops
  the model reaching Home Assistant or anything else on the LAN. The check
  runs on the resolved address, not only the hostname text.
- Ten second timeout, at most five redirects, at most 2 MB read, response
  `Content-Type` must be `text/html` or `text/plain`.

HTML is reduced to text without a new dependency: drop `<script>`, `<style>`,
`<noscript>`, `<svg>` and `<head>`, replace block-level tags with newlines,
strip remaining tags, decode the common entities, collapse whitespace. The
result is cut at 20 000 characters and returned as `{ url, title, text,
truncated }`. Failures return `{ error }`.

Neither tool declares `touchedIds`, so search never triggers device cards.

### Configuration

`config.yaml` gains an optional section, mirrored by an environment variable:

```yaml
search:
  brave_api_key: ""   # Brave Search API key; leave empty to disable web search
```

`BRAVE_API_KEY` maps to `["search", "brave_api_key"]` in `ENV_KEYS`. `Config`
gains `braveApiKey: string`. The key is a secret under the same rules as the
Home Assistant token: never logged, never returned by any route, never in
example files with a real value. `config.example.yaml` and the README document
it.

### Chat route

`ChatCtx` changes:

- `tools` is removed. Add `haTools: Tool[]`, `searchTools: Tool[]` (empty when
  no key), and `getEntitySummary: () => string`.
- `getSystemPrompt` is removed. Add `getChatInstructions: () => string` and
  `name: string`.

The message handler builds the prompt and tool list per request:

```ts
const homeAssistant = Boolean(conv.homeAssistant);
const tools = [...ctx.searchTools, ...(homeAssistant ? ctx.haTools : [])];
const system = buildChatSystemPrompt({ ... homeAssistant, search: ctx.searchTools.length > 0 ... });
const getCards = homeAssistant && ctx.ha ? (ids) => ctx.ha.getCards(ids) : undefined;
```

`runChat` gets one small change: when the tool list is empty it omits the
`tools` field from the completion request instead of sending an empty array,
which some servers reject.

The auto-title call stays as is.

### Conversation flag

Conversation files gain `homeAssistant: boolean`. `ChatStore.create(model,
homeAssistant = false)` writes it. Files without the field read as false. The
routes:

- `POST /api/chat/conversations` accepts `homeAssistant` in the body.
- `PATCH /api/chat/conversations/:cid` accepts `homeAssistant` alongside
  `title` and `model`, coerced with `Boolean`.
- `GET /api/chat/conversations` includes `homeAssistant` in each listing entry.

### Settings

`SettingsState` gains `chatInstructions: string`. It is loaded from
`settings.json`, persisted by `persist`, returned by `GET /api/settings`, and
accepted by `POST /api/settings` with the same validation as
`personalityPrompt`: a string of at most 2000 characters, trimmed on save. It
has no config.yaml default; the setting is UI-only.

## Frontend

### Chat header

The header keeps the title and the model picker and adds a Home Assistant
toggle button between them: a house outline icon, `aria-pressed`, label
"Home Assistant on" or "Home Assistant off". Pressed state uses the existing
pill highlight (`bg-white/[0.08] text-zinc-100`); unpressed uses the muted icon
button style. Clicking calls a new store action `setHomeAssistant(on)` which
patches the conversation and updates `active` and the listing entry, following
`renameModel`. On phone widths the model picker is already narrow; the toggle is
a 32 px square and fits on the same row.

### Sidebar

Conversation rows are unchanged. No HA badge; the header shows the state.

### Settings, Assistant section

A new Disclosure row "Chat instructions" after Personality. Summary text is
"Default" when empty, otherwise the first 40 characters of the instructions.
Inside: a textarea (5 rows, max 2000 characters, placeholder "How the assistant
should behave in chat, e.g. 'Answer concisely, prefer Python examples, call me
Ed.' Leave empty for a neutral assistant."), a Save button enabled when the
draft differs from the saved value, and an "Unsaved changes" note, matching the
custom personality box. Saving calls `update({ chatInstructions })`.

### Tool chips

Unchanged. Search and page-read calls appear as chips during streaming with
the query or URL as the summary. Persisted messages carry citations as inline
markdown links written by the model.

### Welcome screen

Unchanged.

## Documentation

README: the Chat subsection describes a general assistant with a
per-conversation Home Assistant toggle, web search with a Brave key, and the
Chat instructions setting. The configuration section lists `search.brave_api_key`
and `BRAVE_API_KEY`. AGENTS.md's project line changes from "voice and chat
assistant for Home Assistant" to name the general chat mode, and the
architecture list mentions the search tools.

## Testing

Backend tests in the existing `node --import tsx tests/x.test.ts` style:

- `chatPrompt.test.ts`: no HA and no search gives a prompt with no device or
  search text; HA on includes the summary; search on includes the tool
  guidance; instructions appear only when non-empty; the date is present.
- `search.test.ts`: Brave response shaping with a fake fetch; error status
  returns `{ error }` without the key; `fetch_page` rejects `file:`, a private
  IP literal, and a hostname resolving to a private address (DNS lookup
  injected); HTML reduction drops scripts and styles and keeps paragraph text;
  truncation flag at the cap.
- `chatRoutes.test.ts`: with a stubbed `runChat`, a conversation with
  `homeAssistant: false` receives only the search tools and no `getCards`;
  with it true receives both tool sets; PATCH toggles the flag and it round
  trips through the store.
- `settings.test.ts` additions: `chatInstructions` validation and persistence.

Config test: `BRAVE_API_KEY` populates `braveApiKey`; missing key gives an empty
string.

Manual verification: typecheck and build both packages, run the app, hold one
general conversation (markdown answer, a search question with a cited link) and
one with Home Assistant on (device card appears), and check the header toggle
at 390 px width.

## Out of scope

- Persisting tool calls or a separate sources list on messages.
- A page-read tool for PDFs or JavaScript-rendered pages.
- Per-conversation instructions or a chat-specific model default.
- A "Chat" settings section; one row in Assistant is enough for now.
