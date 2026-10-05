## Purpose

Remember user-provided personal facts across conversations with grounded capture, relevant recall, and explicit control over corrections and deletion.

## ADDED Requirements

### Requirement: Grounded personal capture
The system SHALL save clear personal facts stated by the user and honor explicit remember requests when memory is enabled. It MUST distinguish assertions from hypothetical examples and MUST NOT treat external content or assistant-generated text as permission to write memories.

#### Scenario: Personal hardware fact
- **WHEN** the user says “I own an RTX 5070 Ti”
- **THEN** the assistant saves a sourced personal hardware fact and exposes the successful operation in chat

#### Scenario: Explicit preference
- **WHEN** the user says “Remember that I prefer Python examples”
- **THEN** the preference is saved for future conversations

#### Scenario: Hypothetical ownership
- **WHEN** the user says “If I owned an RTX 5070 Ti, could I run this?”
- **THEN** the system does not save GPU ownership as a fact

#### Scenario: Unsuccessful capture
- **WHEN** a model fails to call a memory tool or persistence fails
- **THEN** the system does not display a successful memory operation or represent the fact as durably saved

### Requirement: Recall across conversations
Saved facts SHALL survive restart and model changes under one server-assigned personal profile. The system MUST NOT automatically inject saved memories into prompts. The assistant SHALL be instructed to search memories before answering questions requiring personal information, using focused topic queries. Each search SHALL return at most three matching facts and at most 3,000 characters of fact text. Recalled activity MUST identify facts actually supplied to the model.

#### Scenario: Implicit reference in a new chat
- **WHEN** a GPU fact is saved and the user asks “Can my GPU run this?” in a new chat
- **THEN** the assistant is instructed to search for GPU facts, the tool returns matching facts without unrelated personal details, and chat shows successful recall

#### Scenario: Greeting with saved memories
- **WHEN** ten personal facts are saved and the user says “Hello”
- **THEN** none of those saved facts are automatically included in the model request and no automatic recall activity appears

### Requirement: Correction and deduplication
The system SHALL update a clearly corrected fact, avoid duplicate copies from retries, and reject stale edits. It SHALL ask for clarification when the intended existing fact is ambiguous.

#### Scenario: Moving city
- **WHEN** Warsaw is saved as the current city and the user states “I moved to Kraków”
- **THEN** the current city becomes Kraków and chat shows an update instead of two conflicting current locations

#### Scenario: Stale edit
- **WHEN** a details dialog submits an edit to a revision that has changed
- **THEN** the system preserves the newer record and asks the user to reload the current details

### Requirement: Targeted deletion through chat
The assistant SHALL delete a specifically identified memory when requested. Ambiguous targets MUST remain unchanged until clarified. Broad clearing MUST be refused through chat and redirected to Settings; repeated individual calls MUST NOT implement a broad clear request.

#### Scenario: Specific GPU deletion
- **WHEN** the user asks “Forget which GPU I own” and one fact matches
- **THEN** that fact is deleted and chat displays the successful deletion

#### Scenario: Clear request through chat
- **WHEN** the user asks “Forget everything you remember about me”
- **THEN** no memories are deleted and the assistant directs the user to Settings

#### Scenario: Attempted deletion loop
- **WHEN** the model tries successive individual deletions to fulfill a broad clear request
- **THEN** the backend rejects those operations and preserves the collection

### Requirement: Settings-only collection clearing
The system SHALL provide collection clearing only through a dedicated Settings action with confirmation. The model MUST NOT have access to that operation. Clearing MUST invalidate pending memory writes and remove all active memories.

#### Scenario: Confirmed clearing
- **WHEN** the user confirms Delete all memories in Settings
- **THEN** all active facts are removed and writes started before clearing cannot restore them

#### Scenario: Cancelled clearing
- **WHEN** the user cancels the Settings confirmation
- **THEN** the saved collection is unchanged

### Requirement: Deletion and replay semantics
Deleted facts SHALL cease to appear in future recall and stored memory-activity details. Old conversation replay, regeneration, and retried operations MUST NOT recreate them. Original chat text SHALL remain independent of saved memories.

#### Scenario: Reopening an old chat
- **WHEN** a fact is deleted and its source conversation is reopened or regenerated
- **THEN** the fact is not automatically saved again and historical memory details no longer expose its content

#### Scenario: New statement after deletion
- **WHEN** the user states the fact again in a newly submitted message after deleting it
- **THEN** it is eligible to be saved as a new sourced fact

### Requirement: Disable and ownership boundaries
The user SHALL be able to disable capture and recall without deleting stored facts. All memory operations SHALL be scoped to a server-assigned owner, initially a single personal profile. Selected facts sent to a provider SHALL be disclosed as such in Settings.

#### Scenario: Disabled memory
- **WHEN** memory is disabled and the user sends a chat message
- **THEN** no memory capture or recall occurs, while existing records remain manageable in Settings
