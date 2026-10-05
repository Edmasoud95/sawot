## 1. Memory persistence and lifecycle

- [x] 1.1 Add versioned, owner-scoped memory records and serialized atomic storage beneath configured runtime data; verify restart persistence, size limits, invalid input handling, and concurrent writes with temporary-directory tests.
- [x] 1.2 Add revisions, topic deduplication, operation identities, source tracking, and transactional activity records; verify duplicate retries and stale edits cannot overwrite current facts.
- [x] 1.3 Implement deletion redaction, source replay suppression, and generation invalidation on clear-all; verify old in-flight operations and regeneration cannot recreate deleted records or expose deleted activity snapshots.

## 2. Chat capture, recall, and deletion

- [x] 2.1 Implement on-demand lexical search (at most three facts per call, no automatic injection) with explicit record IDs/revisions; verify GPU/location/occupation examples, limits, deduplication, and disabled-memory behavior.
- [x] 2.2 Add scoped save/update/search tools and prompt guidance grounded in the latest user-authored message; verify asserted facts, explicit requests, hypotheticals, quoted third-party content, corrections, credentials rejection, and duplicate tool calls using mocked provider turns.
- [x] 2.3 Add targeted delete authorization and one-success-per-turn enforcement without a model clear-all operation; verify specific deletion, ambiguous requests, broad requests, deletion loops, and forged or stale target IDs.
- [x] 2.4 Wire memory service into `index.ts`, `chatRoutes.ts`, and prompt/tool assembly; verify new-chat recall, model switching, context budget accounting, final-answer budget, and no false success when tools or storage fail.
- [x] 2.5 Add typed memory SSE and conversation recovery from canonical activity records; verify committed operations survive failed/cancelled responses and reload without duplication, and old chats remain readable.
- [x] 2.6 Redact memory tool content from generic debug events and browser debug storage; verify memory text appears only in intended memory details/context and original chat text.

## 3. Management API and chat UI

- [x] 3.1 Add scoped list/search/edit/individual-delete routes, enable/disable setting, and a separate confirmed Settings clear-all flow; verify validation, revision conflicts, owner enforcement, cancellation, and generation invalidation with route tests.
- [x] 3.2 Extend `chatApi.ts` and `chatStore.ts` for memory stream/recovery state; verify interrupted SSE reconciliation and navigation do not mix activity between turns or conversations.
- [x] 3.3 Add compact memory activity buttons and accessible details dialog to chat rendering; verify saved/updated/recalled/deleted states, source links, editing, deletion, historical revisions, and unavailable records.
- [x] 3.4 Add memory management under Settings Assistant, including provider disclosure and delete-all confirmation; verify list/search, toggling, editing, individual deletion, and clearing through the UI.

## 4. Integration validation and documentation

- [x] 4.1 Run backend/frontend typechecks, builds, and affected regression tests per CI; record actual results and distinguish mocked provider tests from live checks.
- [ ] 4.2 Exercise synthetic personal facts across new chats, restart, model changes, correction, and deletion with an available tool-capable model; verify actual UI activity matches persisted backend operations and record provider-specific limitations without sending Home Assistant commands.
- [x] 4.3 Inspect desktop and 320-pixel mobile layouts in a browser; verify keyboard focus, dialog closure, streaming/reload behavior, and no changes to the voice orb interface.
- [x] 4.4 Document memory scope, Settings controls, provider context disclosure, original transcript retention, model-dependent capture, and future owner migration; verify documentation against implemented behavior and run `git diff --check`.

## Verification record

- Backend and frontend typecheck/build passed. Frontend retains the existing large-chunk advisory.
- Full TypeScript regression suite: 459 passed, 0 failed. Provider interactions in these tests are mocked.
- Browser checks used an isolated local server with synthetic facts: desktop and 320px layouts, saved/recalled details, editing, historical revisions, deleted-detail redaction, Settings clear confirmation/cancel, nested Escape handling, focus restoration, and no horizontal overflow. A mocked 409 confirmed edit errors and drafts remain visible. Voice/WebSocket services were deliberately absent from the fixture.
- OpenSpec strict validation and git diff whitespace checks passed.
- Task 4.2 remains pending: automatic approval review rejected synthetic live-model testing because the configured endpoint trust/destination was not established. User approval was requested; no live-model request was sent.

- Selective-recall revision: automatic injection removed, compact search-first guidance added, search capped at three matching facts. Backend typecheck/build and targeted memory/chat/prompt regressions passed with mocked providers. Ten-fact greeting and selective GPU search scenarios verified.
