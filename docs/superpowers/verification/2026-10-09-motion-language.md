# Motion language verification — 2026-10-09

## Implemented

- Shared CSS timing/easing recipes, interruptible GSAP surface controller, and reactive motion/visibility preferences.
- Stable native button targets with compress/release artwork feedback for primary actions, navigation, new chat, and overlay controls.
- Unified settings/history transitions; mobile chat history remains mounted but becomes inert immediately when closed.
- Directional workspace/settings navigation, brief orb entrance without animated blur, and caption arrival keyed to visibility rather than text updates.
- Stable message bodies; common state/reveal recipes for menus, dialogs, disclosures, attachment arrivals, and acknowledgements.
- Immediate logical attachment removal. Existing upload ownership checks and delayed URL cleanup remain intact.
- Hidden-page motion suppression and finite-animation settling on environmental changes, including portals. Reduced motion removes travel and decorative loops. The orb stops continuous rendering while hidden.
- Hover-only color treatments are restricted to hover-capable devices; keyboard focus and selected states remain available.

## Verification results

- Frontend typecheck: passed.
- Production build: passed. Vite still reports a large-chunk advisory; no additional animation dependency was installed.
- Shared motion behavior: 6 tests passed, including retargeting, latest-endpoint settling, disposal, arrival gating, subscription cleanup, and finite versus continuous animation settling.
- Focused regression run: all 7 selected test files passed (motion, mode swipe, orb expression, ink simulation, chat visit, history, and sources).
- Full frontend regression run: 38 files passed; 1 failed. The failing `web/tests/voiceRecording.test.ts` also failed before implementation: its `fake:react` module lacks the default export required by Zustand. This task does not modify that test or its existing voice changes.
- `git diff --check`: passed.

## Browser checks

The actual production-served rebuilt application was verified in isolated headless Chromium, with desktop 1280 × 850 and mobile-width 390 × 850 and 320 × 850 viewports, in both normal and reduced motion:

- Voice/chat navigation and visible microphone controls; no horizontal page overflow.
- Settings open/close/open in rapid succession; latest state wins.
- Tab/Shift-Tab remain in the settings dialog. Escape closes it and restores its trigger.
- Mobile history opens/closes, becomes inert on close, and restores focus to the menu button.
- Reduced motion enabled during opening immediately settles the panel.
- Enter/Space activate navigation normally; resize during panel dismissal leaves it closed and inert.
- No page JavaScript errors during the matrix.

An isolated component fixture built from the same current source exercised simulated chat/speech/upload state, with upload writes intercepted and voice WebSocket traffic replaced:

- Incremental caption text does not restart its arrival.
- Button press leaves the hit rectangle unchanged; pointer cancellation resets its artwork.
- Removing one uploaded preview and adding another leaves only the new preview, with a valid URL.
- Streaming updates while reading older messages preserve scroll position.
- Voice/chat roundtrip restores the reading position during a simulated running response.
- Escape dismisses only the nested memory dialog, leaving settings open underneath.
- Content introduced while hidden is settled when visibility returns, without an old entrance.
- No fixture page JavaScript errors.

The independent reviewer identified CSS arrivals replaying after reduced-motion changes. A production-browser regression reproduced the defect (one old running animation), then passed after the fix (zero). A new automated settling regression also failed before implementation and passed afterward.

## Performance evidence and limits

Matched production idle-orb samples used the same isolated Chromium, desktop viewport, and three-second requestAnimationFrame/PerformanceObserver sampling window:

| Build | Median frame interval | 95th percentile | Long tasks over 50 ms |
| --- | --- | --- | --- |
| Baseline `index-BPJrRdsP.js` | 16.7 ms | 16.8 ms | 0 |
| Final `index-BXKCM7rs.js` | 16.7 ms | 16.7 ms | 0 |

This shows no regression in that sample; it is not a universal device-performance guarantee. Browser interactions were inspected during execution and fixture screenshots were checked for layout. No baseline video was recorded. Real mobile hardware, its on-screen keyboard, and live speech/model/Home Assistant integration were not tested. No real Home Assistant commands were issued. Browser scripts and screenshots remain temporary local verification artifacts, not product dependencies or committed runtime data.

## Execution decisions

- Worked in the existing feature checkout, preserving its earlier edits and a separate source baseline. No commits, pushes, or branch changes were made. Cost: motion changes coexist with earlier uncommitted work and require scoped review when committing.
- Used a separate local browser because the shared browser profile was busy. Cost: results describe this isolated Chromium environment.
- Used native Web Animations for arrivals, reading the same CSS recipes as GSAP. They release their transient transforms after completion. Cost: two animation mechanisms share one vocabulary.
- Kept message bodies static as allowed by the plan; send artwork supplies feedback. Cost: no message entrance flourish.
- Fixed the hover-capability omission as an accepted mobile UX requirement. Cost: devices reporting no hover receive focus/selection/press feedback without hover colors.
- Excluded unrelated work and the existing voice-recording test-stub failure from fixes. The entire checkout therefore still has that known failing test.
- Physical-device, mobile-keyboard, and live integration checks remain unverified; device-specific behavior is a remaining limit.

The independent source review found no new data-loss, attachment-resurrection, or logical input-blocker defect. Its CSS lifecycle finding was fixed and verified. No review findings were deferred as minor work.
