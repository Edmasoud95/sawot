# SAWOT Motion Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Recommended execution: native, sequential work in this session, followed by independent review.

**Goal:** Give SAWOT a noticeably playful, unified motion language without delaying actions, destabilizing reading, or degrading measured performance.

**Architecture:** Shared CSS tokens define motion recipes; a small GSAP adapter owns interruptible imperative motion. A reactive motion preference and visibility policy cover CSS, panels, and the orb. Existing state, focus, streaming, and gesture systems retain ownership of behavior.

**Tech Stack:** React 19, TypeScript, CSS, installed GSAP, existing Three.js/R3F orb, Node test runner through the backend's installed tsx.

**Spec:** `docs/superpowers/specs/2026-10-09-motion-language-design.md` (approved).

## Global Constraints

- No additional animation library is needed.
- Business state, network work, recording, and focus must not depend on a tween callback or an animation-end event.
- No backend, provider, Home Assistant, or speech protocol changes are part of this overhaul.
- Playback remains more expressive than microphone input.
- Do not keep duplicate live chat/voice trees mounted for an exit effect.
- Prefer transform and opacity. No animated blur, per-frame React state, or permanent compositor promotion.
- Reduced motion removes spatial travel, scale, overshoot, and decorative loops.
- Recipes: press 80 ms / 0.96 artwork scale; release 200 ms / maximum 1.015 overshoot; reveal 180 ms / 6 px; surface 280 ms open and 180 ms close; navigate 220 ms / maximum 12 px; state 140 ms. Common deceleration: cubic-bezier(0.22, 1, 0.36, 1).
- Preserve the existing dirty working tree. Inspect diffs before edits; do not stash, reset, or commit unrelated work. If execution requires isolation, follow using-git-worktrees and ensure the reviewed current source, including relevant uncommitted changes, is available without altering the original workspace.
- No commits or pushes are requested. Each task ends with a reviewed diff checkpoint. Commit only if subsequently requested; a public push additionally requires oss-audit.

## Review Focus

1. Rapid open/close/open and a breakpoint change mid-transition must not leave a hidden input blocker (Task 2).
2. Reduced-motion changes and tab hiding mid-animation must settle to the newest state without replaying old work (Tasks 1 and 4).
3. Keyboard activation, pointer cancellation, and nested dialogs must preserve event semantics and focus (Tasks 2 and 3).
4. Streaming updates, restored history, and switching conversations must not replay arrivals or move a reader (Tasks 4 and 5).
5. Removing an uploading attachment and immediately adding another must not revoke the new URL or resurrect the removed item (Task 5).

## File ownership and boundaries

- Create `web/src/motion.css`: authoritative recipe values, opted-in control styles, reduced-motion and visibility rules.
- Create `web/src/lib/motion.ts`: token reading and a cancelable tween controller; no React or application state.
- Create `web/src/hooks/useMotionPreferences.ts`: shared reactive preference/visibility subscription.
- Create `web/src/hooks/useSurfaceMotion.ts`: React lifecycle bridge for mounted overlay elements.
- Modify existing components by task below; keep their data fetching and state ownership intact.
- Create `web/tests/motion.test.ts`: shared controller behavior using a fake tween driver and event sources, following existing node:test conventions.
- Create `docs/superpowers/verification/2026-10-09-motion-language.md`: measured before/after evidence, browser checks, limitations.

## Task 1: Shared motion foundation

**Files:** create the stylesheet, motion module, preference hook, and test file above; import the stylesheet from `web/src/index.css`; add page visibility data at `web/src/App.tsx`.

**Interfaces:**
- `MotionPreferences = { reduced: boolean; hidden: boolean }`; `useMotionPreferences(): MotionPreferences` uses useSyncExternalStore and responds to matchMedia changes and visibilitychange.
- `MotionRecipe = 'press' | 'release' | 'reveal' | 'surfaceOpen' | 'surfaceClose' | 'navigate' | 'state'`.
- `readMotionRecipe(element: HTMLElement, recipe: MotionRecipe): { duration: number; ease: string }` reads CSS variables; duration returned in seconds. Use the same numeric cubic-bezier in CSS and GSAP's installed CustomEase support, registered once; confirm that import resolves in the production build.
- `createMotionController(target: HTMLElement, driver?: MotionDriver): { to(vars: MotionTarget, recipe: MotionRecipe, instant: boolean): void; finish(): void; dispose(): void }`.
- `MotionTarget` permits only x, y, xPercent, scale, autoAlpha numeric fields. `MotionDriver` provides `to(target, vars): { kill(): void }` and `set(target, vars): void`; the production adapter delegates to GSAP. Store the latest endpoint, kill only owned work, and retarget from the rendered position.

- [ ] Capture baseline browser recordings/traces on the currently served build before modifying product code. Record build identity, viewport, browser, and whether data/audio are simulated. Use read-only flows and discover available browser tools; do not install a new product dependency.
- [ ] Write controller tests: `retarget kills prior tween without resetting position`, `finish applies latest endpoint`, `instant creates no tween`, and `dispose kills owned work and prevents later writes`. Assert endpoint equality and fake-driver call ordering, not token snapshots.
- [ ] Run from `ts-backend`: `node --import tsx --test ../web/tests/motion.test.ts`; confirm failure from missing implementation.
- [ ] Implement the interfaces and tokens. Add an injectable preference subscription helper for tests: `subscribeMotionEnvironment(query: MediaQueryList, page: Document, notify: () => void): () => void`; assert both events notify and cleanup removes both listeners.
- [ ] Add reduced-motion CSS covering pseudo-elements and a root visibility flag that pauses decorative CSS loops. Keep state indicators readable when static.
- [ ] Run the new tests and `npm run typecheck` from `web`; inspect the diff. Do not retain broad blanket animation rules that conflict with the new policy.

## Task 2: Interruptible overlays and focus

**Files:** create `web/src/hooks/useSurfaceMotion.ts`; modify `SettingsPanel.tsx`, `HistoryDrawer.tsx`, `chat/Sidebar.tsx`, `chat/CommandResultDrawer.tsx`, `chat/ChatView.tsx`, `hooks/useDialogFocus.ts`, and relevant rules in `index.css`.

**Interfaces:** `useSurfaceMotion({ panel, scrim, open, placement, enabled = true })` accepts HTMLElement refs, boolean state, and placement `'left' | 'right' | 'lift'`; returns void. It consumes Task 1, uses surface recipes, and settles instantly when reduced, hidden, or disabled. Disabled means a visible static desktop panel where the component requires one, not a closed drawer.

- [ ] Inspect each listed component, including portal and responsive behavior, before editing. Capture a failing browser case for rapid reversal and reduced motion in the current GSAP panels.
- [ ] Implement the hook; migrate panel/scrim tweens. Set visibility before the existing focus hook's frame, and keep focus restoration independent of tween completion. Scrim pointer events and panel inert follow logical open state immediately. Preserve topmost-dialog keyboard ownership.
- [ ] Use one 280 ms surface opening and one 180 ms closing recipe with concurrent scrim fading. On resize, kill stale travel and apply the correct desktop/mobile endpoint. Do not animate the desktop sidebar as an overlay.
- [ ] Browser-check open/close/open within 100 ms, Escape during opening, Tab/Shift-Tab, nested dialogs, switching mobile/desktop mid-close, and closing then clicking an underlying control. Assert only the newest state wins and no hidden blocker remains. Capture results in the verification document.
- [ ] Run shared motion tests and frontend typecheck; inspect the focused diff.

## Task 3: Consistent tactile controls

**Files:** modify `motion.css`, `components/ModeSwitch.tsx`, `MobileHeader.tsx`, `PushToTalk.tsx`, `chat/Composer.tsx`, `chat/Sidebar.tsx`, `chat/ChatHeader.tsx`, and panel buttons migrated in Task 2.

**Interfaces:** opted-in `.motion-control` owns an inner `.motion-control-artwork` transform; the outer button retains its size, hit target, positioning, and handler. Add `usePressMotion(ref: RefObject<HTMLButtonElement | null>): void` in `web/src/hooks/usePressMotion.ts` only for the shared pointer/keyboard lifecycle, consuming Task 1 rather than inventing another animator.

- [ ] Capture baseline pointer/keyboard behavior of send, microphone, mode switch, and new chat. Preserve their existing click/recording semantics.
- [ ] Implement press and release on artwork: 0.96 compression over 80 ms and a bounded release over 200 ms, never above 1.015. Pointercancel, lost capture, blur, pointer leave, and becoming disabled settle safely; Enter and Space mirror acknowledgement without firing the action twice. Do not acquire pointer capture if it conflicts with the existing control.
- [ ] Apply to the listed primary actions and matching overlay close controls; use hover color only under hover-capable media queries. No global transform on every button, sliders, or text input.
- [ ] Browser-check canceled touch, dragged-off press, keyboard activation, disabled send, and rapid repeated clicks. Assert actions execute on their original event and remain usable during settling; reduced motion yields no scale effect.
- [ ] Run frontend typecheck and inspect the diff. Visual rules do not need token-mirroring unit tests.

## Task 4: Navigation, captions, and orb lifecycle

**Files:** modify `App.tsx`, `components/SettingsPanel.tsx`, `components/Captions.tsx`, `components/Orb.tsx`, `index.css`; create `web/src/hooks/useArrivalMotion.ts`.

**Interfaces:** `useArrivalMotion(ref: RefObject<HTMLElement | null>, key: string | number | null, recipe: 'reveal' | 'navigate', direction: -1 | 0 | 1 = 0): void` starts only when a non-null arrival key changes. Retain latest key while hidden/reduced so old arrivals never replay. Use Task 1 controller and preferences.

- [ ] Add tests to `motion.test.ts` for an extracted key gate `shouldReveal(previous: string | number | null, next: string | number | null): boolean`: equal keys and null next return false; changed non-null next returns true. Browser checks below establish correct keys at call sites.
- [ ] Reveal the newly mounted voice/chat workspace at 220 ms with at most 12 px horizontal travel according to existing MODE_ORDER. Preserve flex sizing, mobile viewport height, gesture exclusions, and one live workspace. Settings sections use their existing order with short incoming motion, no row staggering.
- [ ] Replace the orb's 1.6-second blur entrance with a brief opacity reveal. Share preference subscription with the orb and stop its continuous frame loop while hidden; invalidate on resume without accumulating elapsed hidden time. Preserve shader uniforms, particle count, expression expiry, audio readiness, and reduced-motion static updates.
- [ ] Replace caption text-dependent blur tweens with one reveal on empty-to-nonempty arrival; text edits during the same caption remain stable. Remove the artificial assistant delay. Clear/reset handles on empty captions and unmount.
- [ ] Browser-check rapid mode switching, streaming caption increments, reduced-motion changes mid-navigation, hide/resume while speaking with simulated audio, mobile keyboard and resize. No duplicate workspace, stale hidden transform, or replayed captions.
- [ ] From `ts-backend`, run `node --import tsx --test ../web/tests/motion.test.ts ../web/tests/modeSwipe.test.ts ../web/tests/orbExpression.test.ts ../web/tests/inkSimulation.test.ts`. Run frontend typecheck and inspect the diff.

## Task 5: Chat, attachments, and transient UI

**Files:** modify `components/ModelPicker.tsx`, `VoicePictures.tsx`, `VoiceSources.tsx`, `settings/Toast.tsx`, `chat/Message.tsx`, `chat/MessageList.tsx`, `chat/Composer.tsx`, `chat/AttachmentPicker.tsx`, `chat/ToolActivity.tsx`, `chat/MemoryActivity.tsx`, `chat/AnalysisActivity.tsx`, `chat/ToolChip.tsx`, `chat/ThinkingBlock.tsx`, `chat/dictation.css`, `index.css`; inspect `hooks/useVoicePictures.ts` URL lifecycle before changing retention.

**Interfaces:** consume shared reveal/state recipes and arrival hook. Keep existing message and conversation keys. Newly submitted message animation is optional in the approved spec: leave message bodies static in this pass; animate send acknowledgement instead. This avoids introducing submission metadata into the chat store solely for decoration.

- [ ] Inspect all listed surfaces and inventory remaining ad hoc transitions, including Tailwind animation classes and native popovers. Map every retained effect to a named recipe or document why it is a functional progress indicator.
- [ ] Migrate menus, attachment arrivals, toast arrivals, activity disclosures, and copy acknowledgements. Anchor reveals to their trigger and animate a surface once. Keep streamed text, restored history, error copy, and message heights static. No new attention loops.
- [ ] Remove VoicePictures' animation-dependent display retention in favor of immediate logical removal; animate only newly added previews. Immediate removal allows existing delayed URL revocation to remain safe without coupling product behavior to animation duration. Do not broaden upload handling or alter file limits.
- [ ] Browser-check remove-during-upload, remove/add quickly, reduced motion, upload failure, and leaving voice mode. Assert removed previews do not return, new URLs stay valid, and controls are usable immediately.
- [ ] Browser-check streaming while scrolled up, expanding activity, returning to a running chat, restoring history, and incremental caption/text updates. Assert scroll position and focus remain stable, loading remains understandable when static, and old content does not replay entrances.
- [ ] Run frontend typecheck and from `ts-backend`: `node --import tsx --test ../web/tests/chatVisit.test.ts ../web/tests/chatHistory.test.ts ../web/tests/chatSources.test.ts ../web/tests/motion.test.ts`. Inspect the diff for changes to business logic.

## Task 6: Production verification and final tuning

**Files:** complete `docs/superpowers/verification/2026-10-09-motion-language.md`; adjust only shared recipes or directly implicated components when evidence warrants it.

- [ ] Run from `web`: `npm run typecheck` and `npm run build`. From `ts-backend`, run `node --import tsx --test ../web/tests/*.test.ts`. Record any pre-existing failures separately; do not expand into unrelated fixes.
- [ ] Verify the actual production-served build includes these changes. Rebuild before using `run.sh`; do not launch duplicate services or restart unrelated processes. Check the current runtime first.
- [ ] Repeat baseline flows at desktop, 390 px, and 320 px, normal/reduced motion. Include the full interruption, keyboard, attachments, streaming, and visibility matrix from Tasks 2–5. Inspect live movement, not only still screenshots.
- [ ] Record comparable traces with orb active and with simulated streaming. Target smooth 60 Hz where supported and no new animation-attributable tasks over 50 ms. Compare frame-time distribution and long tasks to baseline; distinguish actual device measurements from desktop emulation. Simplify any regressing effect and rerun only affected checks.
- [ ] Review all remaining CSS and JS motion call sites against the recipe inventory. Confirm no animation gates actions, no animated blur remains, and hidden/reduced behavior applies to decorative pseudo-elements and the orb.
- [ ] Run `git diff --check`, verify generated builds and runtime data are excluded, and review only task-related changes. Record passed checks, unavailable real-device/live checks, and remaining risks. Request independent code review under the selected execution workflow before claiming completion.

## Handoff

Recommended: native sequential execution because tasks share one motion adapter and several already-edited components. Review the plan and choose native execution or subagent-driven execution before product changes begin. No implementation was performed while writing this plan.
