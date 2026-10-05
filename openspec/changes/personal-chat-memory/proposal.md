## Why

SAWOT persists individual conversations but does not provide personal memory across chats. The user wants the assistant to remember stated personal facts and explicit remember requests, with visible, editable memory activity and control over deletion.

## What Changes

- Automatically save clear personal facts stated by the user, such as their city, occupation, and owned hardware; also honor explicit remember requests.
- Recall relevant facts across conversations and model changes, and update facts when corrected.
- Display persistent, clickable saved, recalled, updated, and deleted memory activity in chat; open details with edit/delete actions for existing memories.
- Allow targeted deletion through chat. Clearing all memories is exclusively a confirmed action in Settings; the model cannot perform it, including by repeated individual deletions.
- Add Settings memory management, including edit, individual delete, memory enable/disable, and delete all.
- Use one server-assigned personal owner now, with ownership in every record for future account integration.

## Capabilities

### New Capabilities

- `personal-memory`: Persistent personal facts, grounded capture, recall, correction, targeted deletion, and Settings-only clearing.
- `memory-activity`: Durable chat activity and accessible memory details/management UI.

### Modified Capabilities

None. No existing main capability specs were present during inspection.

## Impact

- Backend: new memory store/service/tools/routes; integration with `chatRoutes.ts`, `chat.ts`, `chatPrompt.ts`, and startup in `index.ts`.
- Frontend: chat SSE/state/history rendering and new memory details and Settings components.
- Local runtime storage beneath the configured data directory; memory contents must stay outside Git and routine debug payloads.
- Recalled facts are sent to the selected provider as context; document this in Settings. Actual provider tool support affects automatic capture reliability.
- Initial scope is text chat (including dictated chat messages). Dedicated voice/Live sessions and account authentication are deferred.
