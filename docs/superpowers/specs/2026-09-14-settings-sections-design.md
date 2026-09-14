# Settings panel: sectioned layout

Date: 2026-09-14

## Problem

The settings dialog is a two-column card. The left column mixes the voice model,
voice select, a debug toggle, personality, drawing detail, and provider
management under one "Assistant" label. The right column lists local speech
engines. An "Advanced" tab in the header hides voice cloning. On phones the
columns stack into one long scroll, the header row is overcrowded, and the
"Saved" indicator fades in next to the title where a scrolled user cannot see
it.

The app is also growing: the Chat mode is becoming a general AI chat that can
control Home Assistant rather than a home-assistant-only flow. Settings should
be grouped so that voice-specific, shared, and future chat-specific concerns
each have a clear home.

## Structure

Three sections, each a single page inside the dialog. Order is the order shown.

| Section   | Contents                                                                                   |
|-----------|--------------------------------------------------------------------------------------------|
| General   | Providers list and add-provider form; Debug bar toggle                                     |
| Assistant | Model picker; Personality (select, custom brief, refine and save); Detailed drawings toggle |
| Speech    | Speech-to-text engine cards; Text-to-speech engine cards; Voice select; Cloned voices list and "Clone my voice" recorder |

Reasons:

- Providers are shared by voice and chat, so they live in General.
- The chat model is chosen per conversation in the chat header, so there is no
  Chat section yet. If chat gains its own settings, a Chat section is added
  after Assistant.
- Everything about how the assistant hears and sounds sits in Speech. Today the
  voice select, the TTS engine, and cloned voices are in three places.
- Voice cloning is a headline feature. It is no longer labelled "Advanced".
- The debug bar is a developer switch. It sits last in General, below the
  providers.

Within Speech, the order is: Speech-to-text, Text-to-speech, Voice, Cloned
voices. The voice select and clones depend on the active TTS engine, so they
follow it. The existing note "Cloned voices are spoken by Chatterbox…" stays
and now points at the cards directly above it.

## Layout

### Desktop (width 640px and up)

The dialog keeps its centered card, max width 940px, max height
min(88vh, 48rem). Inside it:

- Header row: title "Settings" on the left, close button on the right. No tabs.
- Body: a two-column grid. The left column is a navigation rail, 180px wide,
  listing the three sections as vertical buttons. The active section uses the
  existing pill highlight (`bg-white/[0.08] text-zinc-100`); the others use
  muted text with a hover state. The right column is the active section's
  content, scrolling on its own, max content width 40rem.
- A toast slot is pinned to the bottom of the content column (see Feedback).

### Mobile (width below 640px)

The dialog becomes a full-height sheet: `inset: 0`, no outer padding, square
top corners, safe-area padding top and bottom.

- Header row: title and close button, as on desktop.
- Directly under the header, a horizontally scrolling chip row with the three
  section names. It is sticky so it stays visible while the content scrolls.
  The active chip uses the same pill highlight. `scrollbar-width: none` and
  scroll snapping so a partially visible chip hints that the row scrolls.
- Content scrolls below the chip row.
- The toast slot is pinned to the bottom of the sheet above the safe area.

The section switch is one `useState` in the shell. There is no routing and no
persisted "last section".

### Feedback

One toast slot replaces both the header "Saved" fade and the inline error
paragraph.

- Success: "Saved" with the teal dot, shown for 1.5 seconds after a successful
  settings save, as today.
- Error: the error text on the existing red surface, shown until the next
  successful action or until the dialog closes.
- The slot is `position: sticky; bottom: 0` inside the scrolling content, so it
  is visible at any scroll offset on both breakpoints. It uses `role="status"`
  for saves and `role="alert"` for errors.

Field-level errors stay inline: the add-provider form error, the personality
refine error, the voice recorder error, and the speech model select error.

## Components

`web/src/components/SettingsPanel.tsx` becomes a shell that owns:

- open state, GSAP open/close tween, scrim, focus trap, and trigger button
  (unchanged);
- settings data loading, `mergeSettings`, `refreshProviders`, `update`, and
  `removeProvider` (unchanged logic);
- the active section state and the toast state.

New folder `web/src/components/settings/` holds:

| File                  | Exports                                                                 |
|-----------------------|-------------------------------------------------------------------------|
| `SectionNav.tsx`      | Rail on desktop, chip row on mobile. Props: sections, value, onChange. Renders `role="tablist"` with `aria-orientation` set per breakpoint. |
| `GeneralSection.tsx`  | ProviderRow, AddProviderForm, Debug toggle. Props: data, debugEnabled, toggleDebug, onProvidersChanged, removeProvider. |
| `AssistantSection.tsx`| ModelPicker, Personality, Detailed drawings. Props: data, update.       |
| `SpeechSection.tsx`   | ModelsSection, Voice select, ClonedVoices. Props: data, update, active, onSwitched. |
| `Toast.tsx`           | The sticky feedback slot. Props: saved, error.                          |
| `fields.tsx`          | SectionTitle, Toggle, Select, Skeleton, FIELD_CLS, BUTTON_CLS, moved out of SettingsPanel unchanged. |

`ProviderRow`, `AddProviderForm`, `Personality`, and `ClonedVoices` move into
their section files with no behaviour change. `ModelsSection.tsx` and
`ModelPicker.tsx` are reused as they are.

The existing `.settings-panel`, `.settings-header`, and `.settings-content`
rules in `web/src/index.css` are replaced by rules for the rail, chip row,
sheet, and toast. The mobile breakpoint stays at 639px to match the rest of the
stylesheet.

## Data and behaviour

- `ClonedVoices` refreshes when the Speech section becomes active, replacing
  the `active && tab === "advanced"` condition.
- `ModelsSection` polls only while the Speech section is active, not while the
  dialog is open on another section.
- Switching sections keeps loaded settings data; nothing refetches on a
  section change.
- Opening the dialog always starts on General.

## Out of scope

- Home Assistant connection settings stay in the YAML config.
- No chat-specific settings are added.
- No backend changes.

## Verification

The web package has no test runner. Verification is:

1. `npm run typecheck` and `npm run build` in `web/` pass.
2. Screenshots at 1280px and 400px widths of each section, checked for: no
   horizontal scroll, chip row scrolls on mobile, toast visible after a save
   while scrolled to the bottom of Speech, focus trap and Escape still work.
