## Purpose

Make personal memory operations visible and inspectable in chat and provide accessible controls for managing the facts the assistant remembers.

## ADDED Requirements

### Requirement: Explicit persistent activity
Chat SHALL display clickable saved, updated, recalled, and deleted memory activity based on actual backend operations. Activity MUST survive reload and interrupted replies. Recalled SHALL mean supplied model context, without claiming the model relied on it.

#### Scenario: Saved fact followed by interruption
- **WHEN** a save succeeds and the response stream subsequently disconnects
- **THEN** reloading the conversation shows the successful save activity without duplicating the fact

#### Scenario: Multiple recalled facts
- **WHEN** two memories are supplied to the model
- **THEN** a recall indicator opens details identifying those two records and their supplied revisions

### Requirement: Interactive details and controls
Clicking memory activity SHALL open accessible details with source information and Edit/Delete controls for existing memories. Missing or deleted records SHALL have an explicit unavailable state without stale edit controls or retained deleted fact text.

#### Scenario: Editing a recalled memory
- **WHEN** the user edits a fact from recall details and saves successfully
- **THEN** later recall uses the new value and the UI distinguishes it from the revision previously supplied

#### Scenario: Deleted memory details
- **WHEN** the user opens activity for a deleted record
- **THEN** the UI shows a generic deleted state without the fact text or active Edit/Delete controls

### Requirement: Settings memory management
Settings SHALL provide a memory list with search, edit, individual deletion, enable/disable, and confirmed collection clearing. Chat requests for collection clearing SHALL point to these controls.

#### Scenario: Reviewing remembered facts
- **WHEN** the user opens memory management in Settings
- **THEN** the saved facts are available for inspection, editing, or deletion

### Requirement: Accessible compact presentation
Memory activity and dialogs SHALL support keyboard navigation, accessible labels, focus restoration, and mobile widths without obscuring chat text or altering the voice orb screen.

#### Scenario: Keyboard interaction
- **WHEN** the user opens details using the keyboard and closes the dialog
- **THEN** focus returns to the initiating activity control

#### Scenario: Narrow viewport
- **WHEN** chat and details are displayed at a 320-pixel viewport width
- **THEN** memory controls remain usable without horizontal page overflow
