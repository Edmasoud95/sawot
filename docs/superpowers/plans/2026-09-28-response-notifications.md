# Response Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Notify an opted-in phone when its chat response finishes and open that conversation when tapped.

**Architecture:** Persist device subscriptions and stable VAPID keys separately from settings. A successful chat save queues bounded Web Push delivery independently of the chat request. A push-only service worker displays generic notifications and routes clicks through existing draft-preserving navigation.

**Tech Stack:** Fastify, TypeScript, React, Zustand, Web Push, `web-push`, Node test runner, existing browser tooling.

**Spec:** [Approved design](../specs/2026-09-28-response-notifications-design.md)

## Global Constraints

- The lock screen shows **SAWOT — Your response is ready.** No conversational or home-device content.
- Notify only the originating opted-in installation, including when visible.
- Permission requires a deliberate click; never prompt on application launch.
- Notify completed normal and regenerated replies; exclude commands, failed/stopped turns, and deleted conversations.
- Delivery cannot delay final chat events, hold the turn lock, or fail a saved response.
- `/sw.js` handles push and clicks only: no fetch interception or HTML/asset caching.
- Keep the trusted-LAN deployment; no inbound public endpoint or real Home Assistant test commands.
- No durable notification queue in v1; phone delivery remains subject to browser policy and connectivity.
- Preserve unrelated work. No commits, pushes, or public deployment without the user's instruction.

## Review Focus

1. Disk-save failure or conversation deletion after generation must not produce a completion notification (Task 2).
2. An expired in-flight subscription must not delete a replacement registration; disabling must invalidate queued delivery (Task 1).
3. Existing browser permission with missing local registration must recover without a new permission prompt (Task 3).
4. A notification click racing mobile startup must open exactly its target, preserving the previous draft (Task 4).
5. A notification opened off-LAN must retain a retryable target rather than create an unrelated blank conversation (Task 4).

---

## File responsibilities

| File | Responsibility |
| --- | --- |
| `ts-backend/src/pushNotifications.ts` | Private persistence, subscription validation, capability lookup, bounded delivery |
| `ts-backend/src/pushRoutes.ts` | Public key, register, unregister; origin and body limits |
| `ts-backend/src/chatRoutes.ts` | Capture optional recipient; completion callback after successful persistence |
| `ts-backend/src/index.ts` | Construct and wire notification service and routes |
| `ts-backend/package.json`, `ts-backend/package-lock.json` | `web-push` and TypeScript declarations |
| `web/src/lib/pushNotifications.ts` | Device-local state, permission/subscription lifecycle, backend registration |
| `web/src/components/settings/NotificationSettings.tsx` | Device-local notification control |
| `web/src/components/settings/AssistantSection.tsx` | Place control in Assistant settings |
| `web/public/sw.js` | Generic notification and same-origin click handling |
| `web/src/lib/notificationNavigation.ts` | Validate and coordinate pending conversation targets |
| `web/src/main.tsx`, `web/src/chatStore.ts`, `web/src/components/chat/ChatView.tsx` | Startup, request recipient, and navigation integration |
| New backend/frontend notification tests; existing chat regression tests | Contract, lifecycle, and race coverage |
| `docs/configuration.md`, `docs/troubleshooting.md` | Verified setup and delivery limitations |

## Task 1: Private subscription store and delivery

**Files:** Create `ts-backend/src/pushNotifications.ts`, `ts-backend/tests/pushNotifications.test.ts`; modify backend package files.

**Interfaces:** Export `PushSubscriptionData = { endpoint: string; keys: { p256dh: string; auth: string } }`, `ChatCompletionNotice = { conversationId: string; turnId: string; notificationDevice: string }`, and `PushNotifications` with `publicKey(): string`, `register(subscription: PushSubscriptionData, capability?: string): string`, `remove(capability: string): void`, `enqueue(notice: ChatCompletionNotice): void`. Constructor accepts private file path, VAPID subject, and injectable send/schedule dependencies for deterministic tests. `enqueue` returns immediately and contains all delivery failures.

- [x] Write tests named `keys survive restart`, `private file is atomic and restrictive`, `invalid subscriptions are rejected`, `refresh requires matching capability`, `registration limit preserves existing devices`, and `failed persistence leaves memory unchanged`. Assert stable key pair, mode `0600`, no partial file, maximum 100 registrations, and no secret-bearing errors.
- [x] Run `node --import tsx --test tests/pushNotifications.test.ts` from `ts-backend`; confirm missing implementation fails.
- [x] Add maintained `web-push` dependency and declarations, verifying current official package interfaces before implementation. Implement atomic temp-write/rename under `data/push-notifications.json`. Corrupt/unwritable storage disables notifications with a sanitized diagnostic; do not replace lost keys silently or prevent chat startup. Use cryptographically random 32-byte base64url capabilities.
- [x] Implement validation: HTTPS, no credentials or fragment, default HTTPS port only, endpoint length at most 4096, decoded `p256dh` 65-byte uncompressed P-256 key and `auth` 16 bytes. Allow exact `fcm.googleapis.com`, exact `updates.push.services.mozilla.com`, and boundary-checked Apple `web.push.apple.com` hosts; verify vendor endpoint documentation before finalizing the list. Reject redirects and arbitrary destinations. Deduplicate identical endpoints without returning another capability to an unauthenticated refresh.
- [x] Add `delivery is bounded and generic`, `expiry removes only matching subscription version`, `disabled queued recipient is skipped`, and `transient failure retries once` tests. Assert 5-second timeout per attempt, at most two attempts with a 1-second delay for network/429/5xx only, 404/410 removal, immutable turn ID, no retry for other 4xx, and no private material in logs.
- [x] Implement delivery with recipient lookup at dispatch and again before retry. Payload is exactly `{ type: "chat-complete", conversationId, turnId }`; TTL is one hour. Queue is bounded to 100 pending notices with sanitized dropped-outcome logging. Use default subject `https://github.com/Edmasoud95/sawot` and optional validated `SAWOT_VAPID_SUBJECT`. Error logging contains only outcome, numeric status, and turn ID.
- [x] Run the task tests and backend typecheck; expect all pass.

## Task 2: Registration API and saved-response hook

**Files:** Create `ts-backend/src/pushRoutes.ts`, `ts-backend/tests/pushRoutes.test.ts`; modify `ts-backend/src/chatRoutes.ts`, `ts-backend/src/index.ts`, `ts-backend/tests/chatRoutes.test.ts`.

**Interfaces:** `registerPushRoutes(app: FastifyInstance, notifications: PushNotifications | null, allowedOrigins: readonly string[]): void`. `GET /api/notifications/key` returns `{ available: boolean, publicKey: string | null }`. `POST /api/notifications/subscription` accepts `{ subscription: PushSubscriptionData, capability?: string }`, returns `{ capability: string }`. `DELETE` at the same path accepts `{ capability: string }`, returns 204 idempotently. Add optional `ChatCtx.onResponseCompleted?: (notice: ChatCompletionNotice) => void | Promise<void>`. Chat message/regeneration JSON accepts optional `notificationDevice: string`.

- [x] Write API tests asserting public responses contain only the declared fields; malformed bodies, untrusted/missing Origin, unsupported endpoints, and oversized requests are rejected. Same-origin and configured exact origins pass. Set mutation body limit to 16 KiB; unavailable service returns a safe 503 for mutation, available=false for key lookup.
- [x] Run `node --import tsx --test tests/pushRoutes.test.ts`; confirm failure before implementation.
- [x] Implement route validation using the existing exact-origin conventions. Do not trust arbitrary forwarding headers or add global CORS allowances. Wire the private service in `index.ts` without exposing state through shared settings.
- [x] Add chat tests `completion follows successful save once`, `disconnect still notifies`, `regeneration notifies originating device`, `failed or stopped turns do not notify`, `commands and deleted chats do not notify`, `save failure does not notify`, and `throwing or pending completion handler cannot fail or lock chat`. Assert two registrations do not receive each other's turns; missing/invalid capability leaves chat successful.
- [x] Run `node --import tsx --test tests/chatRoutes.test.ts`; confirm the new assertions fail.
- [x] Capture the bounded optional capability and a new unique turn ID at request start. Correct the persistence-success bookkeeping: the current `persisted` flag is set before lookup/save and cannot prove successful persistence. Track success only after `store.save` returns. Queue the callback once for completed, saved, non-aborted, non-command responses after final SSE and lock cleanup; isolate synchronous throws and rejected promises. Do not await push delivery. Preserve existing partial-save and regeneration rollback behavior.
- [x] Run both task suites and backend typecheck; expect all pass.

## Task 3: Device opt-in and push-only worker

**Files:** Create `web/src/lib/pushNotifications.ts`, `web/src/components/settings/NotificationSettings.tsx`, `web/public/sw.js`, `web/tests/pushNotifications.test.ts`, `web/tests/pushWorker.test.ts`; modify `web/src/components/settings/AssistantSection.tsx`, `web/src/main.tsx`, `web/src/chatStore.ts`.

**Interfaces:** Export `NotificationState = { status: "unsupported" | "disabled" | "enabled" | "blocked" | "busy" | "error"; message?: string }`, `initializeNotifications(): Promise<NotificationState>`, `enableNotifications(): Promise<NotificationState>`, `disableNotifications(): Promise<NotificationState>`, and `getNotificationDevice(): string | undefined`. Local key `sawot-notifications` stores capability and opt-in intent only. Use backend contracts from Task 2. Worker push data uses Task 1 payload; click message is `{ type: "open-chat", conversationId: string }`.

- [x] Write lifecycle tests for unsupported/insecure context, denied permission, enable, disable, permission revoked, backend registration failure, and existing permission with missing capability. Assert initialization never calls `requestPermission`, failed registration never reports enabled, opt-out prevents request targeting immediately, and unsubscribe/removal failures remain retryable without losing the removal capability.
- [x] Run `node --import tsx --test ../web/tests/pushNotifications.test.ts` from `ts-backend`; confirm failure before implementation.
- [x] Implement worker registration at `/sw.js` with root scope and lifecycle reconciliation. Request permission only inside the enable click flow. Reuse an existing subscription and refresh with its capability; reconcile changed VAPID keys without silent permission prompts. Guard unavailable localStorage and stale concurrent operations. Add accessible controls in Settings → Assistant using existing styling and actionable Brave/Android permission text.
- [x] Add device capability to normal and regeneration requests when opted in, excluding commands. Keep all notification state outside shared assistant settings.
- [x] Write worker tests for valid/malformed push payload, generic copy, duplicate turn tags, and absence of fetch handlers/cache calls. Assert `showNotification("SAWOT", { body: "Your response is ready.", ... })`, safe conversation ID, and stable tag `sawot-chat-${turnId}`. Malformed payload must not open arbitrary URLs or display arbitrary text.
- [x] Run worker tests to observe failure; implement push handler using `event.waitUntil`, fixed copy, and validated data. Do not introduce asset caching or reload-on-update behavior.
- [x] Run both task suites and frontend typecheck; expect all pass.

## Task 4: Tap-to-chat navigation and startup races

**Files:** Create `web/src/lib/notificationNavigation.ts`, `web/tests/notificationNavigation.test.ts`; modify `web/public/sw.js`, `web/src/main.tsx`, `web/src/chatStore.ts`, `web/src/components/chat/ChatView.tsx`, `web/tests/pushWorker.test.ts`, `web/tests/chatHistory.test.ts`.

**Interfaces:** Export `initializeNotificationNavigation(): () => void`, `hasPendingNotificationTarget(): boolean`, and `openPendingNotificationTarget(): Promise<boolean>`. Validate conversation IDs with the backend's existing 12-lowercase-hex contract. Initialization captures `?chat=` and worker messages before React chat startup; the returned function removes listeners. Opening returns true only after the matching conversation is active, and clears query/pending state only then.

- [x] Write tests `click focuses existing same-origin window`, `cold click opens validated query URL`, `foreign windows and malformed IDs are ignored`, `mobile startup preserves notification target`, `navigation flushes previous draft`, `offline target survives retry`, and `strict mode and duplicate messages open once`. Assert no unwanted new conversation and no lost pending attachments/draft.
- [x] Run `node --import tsx --test ../web/tests/notificationNavigation.test.ts ../web/tests/pushWorker.test.ts ../web/tests/chatHistory.test.ts`; confirm new cases fail.
- [x] Implement worker click close/focus/message using same-origin window clients (including uncontrolled clients); fall back to `clients.openWindow` with `/?chat=<id>`. Never accept an arbitrary destination from push data.
- [x] Initialize navigation before React mounts, switch existing voice-mode state to chat for a valid target, and use existing `openConversation` draft-preserving flow. Coordinate ChatView's asynchronous conversation loading and mobile auto-new effect through pending target state; do not allow its delayed callback to overwrite a notification navigation already completed. Keep failed off-LAN targets retryable on online/focus, showing a readable connection error.
- [x] Run all task suites and frontend typecheck; expect all pass.

## Task 5: Integrated verification and operator guidance

**Files:** Update `docs/configuration.md` and `docs/troubleshooting.md` narrowly; preserve their unrelated content.

- [x] Run backend regression command `node --import tsx --test tests/*.test.ts ../web/tests/*.test.ts` from `ts-backend`; expect zero failures. Use approved host access if sandbox loopback restrictions prevent route tests.
- [x] Run `npm run typecheck` and `npm run build` independently in `web` and `ts-backend`; expect successful exits. Run `git diff --check`.
- [x] Exercise Settings controls and click navigation in controlled browser fixtures at desktop and mobile widths. Check denial, unsupported APIs, existing-window draft preservation, cold mobile launch, offline target recovery, and console errors. Use mocked push delivery; do not request permission on the user's behalf or call real model/home tools for UI verification.
- [x] Document trusted HTTPS, per-device opt-in, outbound internet requirement, Brave/Android permissions, LAN/VPN access on tap, generic content, VAPID storage/subject override, and the non-durable queue limitation. Do not claim mocked checks prove Android delivery.
- [x] Rebuild changed packages before restarting the local launcher. Preserve its current environment without printing secrets, then verify local health and served worker/current assets. Do not claim the unknown phone origin is verified from loopback checks.
- [x] Report implemented behavior and exact verification results. Ask the user to enable notifications in their Android Brave PWA and verify app-open, background, and closed delivery plus tap-to-chat; this is the remaining real-device acceptance check.

## Self-review

The five tasks cover the approved specification without adding foreground detection, public hosting, or a durable queue. Each cross-task interface is named above; each Review Focus case has an owning regression test. Backend completion and frontend recovery remain separate concerns. Implementation must inspect current worktree changes again before editing because unrelated work is active in this repository.

## Execution results

Implemented and independently reviewed on 2026-09-28. Fixed both review findings with failing-then-passing regression tests: mobile new-chat response racing notification navigation, and deletion during queued push delivery/retry. Final full TypeScript suite: **392 passed, 0 failed**. Both packages typecheck and build successfully; `git diff --check` is clean. Controlled Chromium checks cover mobile cold navigation, device permission enable/disable, blocked permission, and mobile/desktop layout. Local backend and sidecar are healthy; the served worker and frontend asset match the build and the notification API reports available.

Real Android Brave delivery remains unverified until the user opts in and tests app-open, background, and closed behavior. Changes remain uncommitted in the existing checkout; unrelated concurrent work is preserved.
