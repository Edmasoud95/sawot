# SAWOT motion language

Status: proposed design for review; implementation has not started.

## Intent

Make SAWOT noticeably expressive and playful while keeping every action immediate,
predictable, accessible, and inexpensive to render. Motion should communicate a
shared personality across voice, chat, navigation, settings, and transient UI.
The agreed direction is expressive during interaction and settled during reading.

The ink orb remains the expressive center. Preserve the minimal interface, solid
background, existing information hierarchy, and existing particle-based expressions.

## Current evidence

Inspected the current working tree on 2026-10-09:

- `web/src/index.css` mixes independent timings and easings, including a 1.6-second
  blurred orb entrance and a 0.9-second rise-in preset.
- `SettingsPanel.tsx` and `HistoryDrawer.tsx` use GSAP panel tweens of 0.55 seconds
  and scrim tweens of 0.4 seconds. Their effects do not explicitly handle motion
  preferences or cancel competing tweens.
- `App.tsx` conditionally mounts voice and chat; transitions must respect those
  lifecycles instead of retaining a second live workspace for animation.
- `MessageList.tsx` preserves conversation scroll positions and follows streaming
  only when appropriate. Motion must preserve those behaviors.
- `Orb.tsx` already observes reduced motion and keeps audio updates outside React
  state. Preserve live shader uniform updates, expression expiry, and audio timing.
- GSAP is already installed. No additional animation library is needed.

These are source findings, not browser measurements. The working tree contains
substantial unrelated changes; implementation must preserve and reconcile them.

## Approach and alternatives

Use shared CSS motion tokens plus a small GSAP adapter for interruptible panel and
workspace transitions. This fits the existing app and provides one vocabulary
without replacing its rendering or navigation architecture.

A CSS-only approach is suitable for controls but makes existing panel lifecycle
coordination harder. A new spring-animation framework adds migration cost and a
second runtime without a demonstrated need. Neither is selected.

## Shared vocabulary

Use a small set of named recipes, not arbitrary timings at each call site.
These are initial tuning values; changes during browser review update the shared
recipe rather than introduce local exceptions.

| Recipe | Duration | Movement and purpose |
| --- | --- | --- |
| Press | 80 ms | Compress eligible button artwork to 0.96 scale; keep its hit area fixed |
| Release | 200 ms | Return to rest with one restrained overshoot, at most 1.015 scale |
| Reveal | 180 ms | Fade and move 6 px from the trigger direction |
| Surface | 280 ms open, 180 ms close | Panel movement with decisive deceleration; no panel bounce |
| Navigate | 220 ms | Incoming content moves at most 12 px in navigation direction |
| State | 140 ms | Color/opacity acknowledgement without moving surrounding content |

Use a common deceleration curve, initially cubic-bezier(0.22, 1, 0.36, 1), for
reveals and surfaces. Press uses a short ease-out; release owns the playful settle.
Drawers travel from their existing screen edge. Large text surfaces never overshoot.
Exit reverses the entry's spatial relationship and finishes faster.

## Interaction design

### Controls

Microphone, send, new-chat, and navigation controls share press/release behavior.
Keep the actual action on its existing event semantics; animation introduces no
delay and does not change click actions to pointer-down actions. Pointer cancellation
and leaving a pressed target reset its appearance. Keyboard activation gets the
same acknowledgement, with visible focus preserved. Disabled controls stay still.
Hover treatment applies only on devices that support hover.

### Panels, menus, and settings

History draws from its existing edge; settings lifts gently into place. Menus reveal
from their trigger. Animate each surface as a unit instead of staggering every row.
Scrims fade concurrently. Rapid open/close/open retargets from the current visual
position and cancels superseded work. Closed content becomes inert immediately;
focus management follows logical state, not animation completion. Closing scrims
must not intercept input while their last visual frame fades.

Settings section changes use a short directional reveal without resetting focus
unexpectedly. Expandable sections preserve native layout and scroll semantics;
avoid broad height animations that repeatedly move content during interaction.

### Voice and navigation

Remove the long blurred orb entrance. Reveal its container briefly while preserving
the existing ink simulation and state transitions. Playback remains more expressive
than microphone input. Do not add particle counts, shader passes, or decorative loops.

Voice/chat switching commits the new mode immediately and reveals the incoming
workspace in the direction of navigation. Do not keep duplicate live chat/voice
trees mounted for an exit effect. Preserve gesture exclusions for scrolling, text
selection, sliders, and dialogs; this overhaul does not introduce a new drag engine.
Captions reveal once on arrival, never repeatedly as their text updates.

### Chat and transient content

Newly submitted messages can receive one restrained arrival treatment. Restored
history and streamed text never replay entrance animations. Do not animate every
token or animate message heights. Preserve the current reading position and follow
behavior, including returning to an active response.

Attachment previews, activity disclosure, model menus, copy feedback, and toasts use
the same reveal/state recipes. Loading indicators remain local and quiet. Existing
errors remain readable and stable; no shaking or repeated attention effects.

## Implementation boundaries

Introduce shared CSS tokens in a dedicated motion stylesheet and a small typed
motion module for GSAP recipes. Keep one authoritative set of duration/easing
values; the adapter reads shared values instead of maintaining divergent copies.
Provide a shared reactive reduced-motion preference and reusable tween lifecycle
handling: overwrite competing transforms, clean up on unmount, and apply the
latest endpoint immediately when reduced motion becomes active.

Migrate existing motion by interaction family: controls; overlays; navigation and
voice framing; chat and transient UI. Inspect each affected component first,
including dialog focus and mobile history implementations. Avoid global selectors
that add transforms to all buttons or interfere with existing positioned elements.
One owner controls each animated transform.

Business state, network work, recording, and focus must not depend on a tween
callback or an animation-end event. Cleanup removes visual work only. No backend,
provider, Home Assistant, or speech protocol changes are part of this overhaul.

## Accessibility and performance

Reduced motion removes spatial travel, scale, overshoot, and decorative loops;
state and focus updates remain immediate. Apply this to both CSS and JavaScript,
including preference changes while a transition runs. Status remains understandable
without motion. Include pseudo-elements in the CSS policy.

Prefer transform and opacity. Avoid animated blur, large shadows, layout-dependent
movement, permanent compositor promotion, and per-frame React state. Only add
temporary `will-change` where profiling demonstrates a benefit. Pause decorative
continuous activity when the page is hidden; resume without catch-up bursts.

Measure against the current app on the same browser/device. Target smooth 60 Hz
interaction where supported, with no new animation-attributable long tasks over
50 ms in representative traces. Treat these as verification targets, not universal
device guarantees. If an effect misses the budget, simplify the recipe rather than
delay an action or obscure functionality.

## Verification and acceptance

- Capture a before/after browser pass on the production-served build at desktop,
  390 px, and 320 px, with normal and reduced motion.
- Exercise rapid panel reversals, repeated navigation, Escape, keyboard traversal,
  pointer cancellation, resizing, mobile keyboard, and changing motion preference
  mid-transition. Assert no invisible blockers, stale transforms, or focus traps.
- Exercise streaming while reading older messages, return to a running chat,
  restored history, attachments, and caption updates. Reading position stays stable
  and entrance effects do not replay on incremental updates.
- Inspect actual moving transitions and performance traces with the orb active;
  screenshots alone do not establish smoothness. Distinguish desktop mobile
  emulation from a physical-device check.
- Run frontend typecheck/build and relevant existing interaction regressions. Add
  focused tests for cancellation, reduced-motion changes, and lifecycle behavior
  where new shared logic is introduced; avoid tests that only restate token values.
- Rebuild before using `run.sh`; it does not rebuild existing output directories.
  Do not issue real Home Assistant commands to verify motion. Label simulated
  streaming/audio checks and report unavailable live checks explicitly.

Success means a visibly shared personality, immediate usable controls, stable
reading surfaces, interruption-safe transitions, and no measured performance
regression attributable to the new motion.
