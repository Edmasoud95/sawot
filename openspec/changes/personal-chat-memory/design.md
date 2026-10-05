## Context

See proposal.md for the agreed scope. `ChatStore` currently saves conversations as JSON; `chatRoutes.ts` assembles prompt/history/tools and streams results from `runChat`. Generic tool events are streamed but are not a sufficient durable user-facing memory record. Analysis activity already demonstrates persisted events and interrupted-stream recovery. `SettingsPanel.tsx` has an Assistant section suitable for memory management. The backend has no database dependency. Runtime paths come from `config.dataDir`.

## Goals / Non-Goals

Goals: grounded personal memory, visible backend-confirmed actions, bounded context, durable deletion semantics, and owner-scoped interfaces.

Non-goals: account authentication, voice/Live integration, historical transcript mining, embeddings infrastructure, and automatic migration of memories between people. A fixed owner is a migration aid, not an authentication boundary.

## Decisions

### 1. Dedicated local memory service

Use a versioned JSON store under `<dataDir>/data/memory/` for the initial personal collection, following the project's current storage approach. Although a database was suggested during discussion, a serialized read/merge/atomic-replace store avoids adding a database runtime for this bounded collection. Keep persistence behind a service interface so SQLite can replace it later. Every operation receives the server-assigned owner `default`; never accept ownership from model arguments or browser input.

Store stable IDs, canonical topic keys, short fact text, category, source conversation/message IDs, capture mode, timestamps, and revision. Use optimistic revision checks for edits. Serialize mutations; persist the record change and its activity event together before publishing SSE. Maintain operation IDs for retry deduplication and an owner generation counter for invalidating work after clear-all. Recover committed events after crashes independently of assistant completion.

Limit each fact to 1,000 characters and the collection to 500 active facts initially; report capacity errors without evicting existing facts. Keep facts as plain text, not executable instructions. Do not store credentials. Settings explains that recalled text goes to the chosen model provider.

### 2. Capture and correction during the existing chat turn

Provide scoped `save_memory`, `update_memory`, `search_memories`, and `delete_memory` tools. Instruct tool-capable models to save direct, durable personal statements and explicit remember requests. A save/update must cite a span of the current user-authored message; the backend verifies the source message and quoted span. This proves provenance, not semantic correctness; prompts and reviewable UI handle semantic judgment. Attachments, fetched pages, assistant prose, and prior transcripts cannot authorize writes.

Automatic capture concerns asserted facts, not guesses, hypothetical examples, negations, or other people's facts. Explicit remember requests may cover additional user-selected information. Match normalized topics and existing records before insertion; a clear correction updates a matching record. Ambiguous identity or conflicting facts require clarification. Repeated tool calls use the same operation identity. Regeneration never repeats committed writes.

Use the existing tool loop and final-answer budget. No hidden second extraction model or background pass in the first version. Document and test that actual tool support and model behavior influence capture; do not infer capabilities from model names or claim successful saving without an acknowledged operation. Settings editing remains available when a model does not call tools.

### 3. Bounded recall with observable evidence

Do not preload saved facts into any prompt. Instruct the model to call `search_memories` before answering a question requiring personal information or claiming it does not know. Include short examples: GPU ownership or compatibility → `gpu`; current city → `location`. Greetings and general questions require no search. Return at most three relevant records per query, bounded by each fact's 1,000-character limit (3,000 fact-text characters total), with only ID, revision, topic, and text in model results. Use lexical matching and existing topic aliases; refine the query when necessary instead of injecting the collection. Empty queries provide only a three-record overview; Settings provides the complete list. Model compliance remains dependent on actual tool use. Preserve the existing clickable recall activity and deletion invalidation.

Record recalled activity only for records actually attached to a submitted inference request or returned successfully as tool context. The label means supplied context, not proven causal influence on the answer. Mark memory text as reference data below user/system instructions. Recheck revisions immediately before submission; edits/deletes affect later requests. Context already sent cannot be withdrawn.

### 4. Targeted deletion and a separate clear-all path

The model deletion tool accepts one exact ID and revision, never a wildcard, query, list, or clear flag. Require a current user request identifying the specific fact. Resolve a target against that request before executing; ambiguous or unbounded requests receive clarification or a Settings link. Issue a turn-scoped authorization for the resolved target, permit at most one successful deletion per turn, and consume it on success. Do not derive authorization from the model's requested ID alone. Explicitly test broad requests and attempts to loop through IDs. A specific request may delete the final remaining fact; intent and target, not collection size, govern eligibility.

If target resolution is uncertain, leave memory unchanged. This semantic intent check is fallible and must not be described as authentication. The hard boundary is that the chat tool registry has no clear-all operation and cannot route arbitrary HTTP requests to the Settings API.

Settings uses separate list/edit/delete endpoints and a dedicated clear-all endpoint, invoked after an explicit confirmation dialog. Clear-all increments owner generation, removes active facts, and invalidates all in-flight memory write authorizations and recall caches. Cancellation changes nothing. Requests from analysis/web tools cannot access this endpoint; preserve existing network isolation and SSRF protections.

### 5. Deletion, history, and activity retention

Process only the newly submitted user message for capture. Record processed source IDs, revision/generation, and content-free deletion tombstones to block retries, regeneration, and old in-flight writes. Editing a fact also invalidates older writes. A newly stated fact in a later message can be saved again; rereading an old chat cannot restore it.

Deleted facts must disappear from the memory store, search indexes/caches, and stored activity snapshots. Keep only a generic deleted event, operation/time, and opaque IDs. Historical activity can say “Memory deleted” without retaining the deleted fact text; the original user/assistant transcript remains and may still contain it. Deleting memory does not promise transcript erasure or removal from requests already sent to a provider. Clear-all applies the same redaction to all memory activity. Avoid memory text in generic debug tool arguments/results and browser debug stores.

### 6. Durable chat activity and management UI

Add typed memory SSE events and persisted activity references keyed by turn and operation. Recover them when fetching conversations, including failed/cancelled turns with committed operations. Maintain one canonical event store rather than retaining duplicate fact snapshots in conversation JSON. Existing chats with no memory activity remain valid.

Render compact buttons: “Memory saved”, “Memory updated”, “Memories recalled · N”, and “Memory deleted”. Open an accessible details dialog showing supplied revision details for surviving facts, current status, source link when available, and Edit/Delete controls. After edits, distinguish the historical supplied revision from the current value. After deletion, redact all old fact snapshots; disable actions for missing records. A missing source conversation does not delete the independent memory.

Add Memory management under Settings → Assistant, with enable/disable, list/search, edit, targeted delete, and a confirmed Delete all memories action. Disabling stops capture and recall, retains records, and leaves management available. Use the existing modal/focus conventions and mobile layout. Keep memory activity out of the voice orb view.

## Risks / Trade-offs

- Model extraction can misinterpret a statement → source checks, bounded tools, truthful notices, edit/delete access, semantic regression examples, and live model checks before claiming reliability.
- Simple retrieval can miss paraphrases in large collections → focused queries and topic aliases; evaluate embeddings later using actual misses.
- Atomic JSON assumes one backend writer → serialize all service mutations and document single-process operation; replace persistence before adding multiple backend writers.
- A mutation can succeed before the response fails → commit activity with mutations and reconcile on reload; do not undo successful writes implicitly.
- Deleting memory does not erase original transcripts → explain the distinction in deletion details and Settings.
- Old provider requests may already contain a deleted fact → cancel/invalidate local pending memory work; never claim remote context was retracted.

## Migration Plan

Create an empty versioned store on first use; do not scan old conversations. Add optional activity fields/references so old chats remain readable. Default the newly introduced feature to enabled, with visible notices and a Settings toggle. Keep runtime data ignored. Future account migration must explicitly assign the default owner's records; never copy them into every account. Rollback disables memory wiring and preserves the versioned data for recovery; existing conversation text remains usable.
