# Settings Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-column settings dialog and its General/Advanced tabs with three single-concern sections (General, Assistant, Speech), a navigation rail on desktop, a sticky chip row on a full-height sheet on mobile, and a sticky feedback toast.

**Architecture:** `SettingsPanel.tsx` keeps the dialog chrome, data loading and save logic, and becomes a shell that renders `SectionNav`, the active section component, and `Toast`. Each section lives in its own file under `web/src/components/settings/`; shared field primitives move to `fields.tsx`. Layout is plain CSS in `index.css` keyed on the existing 639px breakpoint.

**Tech Stack:** React 19, Tailwind v4 utility classes plus hand-written CSS in `web/src/index.css`, GSAP for the open tween, Vite. No test runner in `web/`; verification is `tsc --noEmit`, `vite build`, and Playwright screenshots.

**Spec:** `docs/superpowers/specs/2026-09-14-settings-sections-design.md`

## Global Constraints

- Node 22 via nvm: prefix every shell command with `export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"`.
- Mobile breakpoint is `@media (max-width: 639px)`, matching the rest of `index.css`.
- Section order and names are exactly: General, Assistant, Speech.
- No backend changes. No new npm dependencies.
- Keep the existing visual tokens: `bg-white/[0.08] text-zinc-100` for the active pill, `text-aurora-teal` for success, red `text-red-300` on `bg-red-400/10 border-red-400/20` for errors.
- Commit messages: imperative sentence, ending with the two attribution lines from the session reminder.

---

### Task 1: Move shared field primitives into `settings/fields.tsx`

**Files:**
- Create: `web/src/components/settings/fields.tsx`
- Modify: `web/src/components/SettingsPanel.tsx` (delete `SectionTitle`, `Toggle`, `FIELD_CLS`, `BUTTON_CLS`, `Select`, `Skeleton`; import them instead)

**Interfaces:**
- Produces: `SectionTitle({children})`, `Toggle({label, hint?, checked, onChange})`, `Select({label, value, options, onChange, disabled?, labels?})`, `Skeleton()`, `FIELD_CLS: string`, `BUTTON_CLS: string`.

- [ ] **Step 1: Create `fields.tsx` with the primitives copied verbatim from `SettingsPanel.tsx`**

```tsx
export const FIELD_CLS =
  "w-full min-w-0 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[0.85rem] text-zinc-200 outline-none backdrop-blur transition-colors duration-300 hover:border-white/25 focus:border-aurora-teal/50 disabled:opacity-50";

export const BUTTON_CLS =
  "rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-[0.8rem] text-zinc-200 transition-colors duration-300 hover:border-aurora-teal/50 hover:text-zinc-100 disabled:opacity-50";

export function SectionTitle({ children }) {
  return (
    <h3 className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-zinc-500">
      {children}
    </h3>
  );
}

export function Toggle({ label, hint, checked, onChange }) {
  // body unchanged from SettingsPanel.tsx
}

export function Select({ label, value, options, onChange, disabled = false, labels = null }) {
  // body unchanged from SettingsPanel.tsx
}

export function Skeleton() {
  // body unchanged from SettingsPanel.tsx
}
```

Copy the bodies exactly. Add `export` to each.

- [ ] **Step 2: Delete the same definitions from `SettingsPanel.tsx` and import them**

```tsx
import { BUTTON_CLS, FIELD_CLS, SectionTitle, Select, Skeleton, Toggle } from "./settings/fields";
```

- [ ] **Step 3: Typecheck**

Run: `cd web && npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/settings/fields.tsx web/src/components/SettingsPanel.tsx
git commit -m "Move the settings field primitives into their own file"
```

---

### Task 2: Extract `GeneralSection`

**Files:**
- Create: `web/src/components/settings/GeneralSection.tsx`
- Modify: `web/src/components/SettingsPanel.tsx` (remove `ProviderRow`, `AddProviderForm`; render `GeneralSection` in place of the Providers block and the Debug toggle)

**Interfaces:**
- Consumes: `fields.tsx` exports.
- Produces: `GeneralSection({ data, debugEnabled, toggleDebug, removeProvider, onProvidersChanged })` where `data` is the settings payload or `null`, `removeProvider(p)` deletes a provider, and `onProvidersChanged(body)` is called with the POST `/api/providers` response.

- [ ] **Step 1: Create the section file**

Move `ProviderRow` and `AddProviderForm` verbatim from `SettingsPanel.tsx` into this file (not exported), importing `FIELD_CLS` from `./fields`. Then add:

```tsx
import { useState } from "react";
import { FIELD_CLS, SectionTitle, Skeleton, Toggle } from "./fields";

// ProviderRow and AddProviderForm here, unchanged.

export default function GeneralSection({ data, debugEnabled, toggleDebug, removeProvider, onProvidersChanged }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <SectionTitle>Providers</SectionTitle>
        {!data && <Skeleton />}
        {data && (data.providers ?? []).map((p) => (
          <ProviderRow key={p.id} p={p} onRemove={removeProvider} />
        ))}
        {data && <AddProviderForm apply={onProvidersChanged} />}
      </div>
      <div className="flex flex-col gap-3">
        <SectionTitle>Developer</SectionTitle>
        <Toggle
          label="Debug bar"
          hint="A diagnostics strip along the bottom: turn timings, events, raw traffic, and live state."
          checked={debugEnabled}
          onChange={() => toggleDebug()}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: In `SettingsPanel.tsx`, replace the Providers block and the Debug bar `Toggle` with**

```tsx
<GeneralSection
  data={data}
  debugEnabled={debugEnabled}
  toggleDebug={toggleDebug}
  removeProvider={removeProvider}
  onProvidersChanged={(body) => { mergeSettings(body); refreshProviders(body.providers ?? []); }}
/>
```

For now render it at the top of the General tab panel, above the Assistant section title. The layout is temporary until Task 5.

- [ ] **Step 3: Typecheck and build**

Run: `cd web && npm run typecheck && npm run build`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/settings/GeneralSection.tsx web/src/components/SettingsPanel.tsx
git commit -m "Extract the providers and debug toggle into a General settings section"
```

---

### Task 3: Extract `AssistantSection`

**Files:**
- Create: `web/src/components/settings/AssistantSection.tsx`
- Modify: `web/src/components/SettingsPanel.tsx` (remove `PERSONALITY_OPTIONS`, `Personality`)

**Interfaces:**
- Consumes: `ModelPicker` from `../ModelPicker`, `fields.tsx` exports.
- Produces: `AssistantSection({ data, update })` where `update(patch)` POSTs the patch to `/api/settings`.

- [ ] **Step 1: Create the section file**

Move `PERSONALITY_OPTIONS` and `Personality` verbatim into this file (not exported), importing `BUTTON_CLS`, `FIELD_CLS`, `Select` from `./fields`. Then add:

```tsx
import ModelPicker from "../ModelPicker";
import { SectionTitle, Skeleton, Toggle } from "./fields";

export default function AssistantSection({ data, update }) {
  if (!data) return <Skeleton />;
  return (
    <div className="flex flex-col gap-5">
      <SectionTitle>Assistant</SectionTitle>
      <ModelPicker
        label="Model"
        value={data.model}
        providers={data.providers ?? []}
        onChange={(model) => update({ model })}
      />
      {data.models_error && (
        <p className="-mt-3 text-[0.75rem] leading-snug text-red-400/90">
          Can't reach the local model server — showing the last saved model.
        </p>
      )}
      <Personality
        value={data.personality ?? "sassy"}
        prompt={data.personalityPrompt ?? ""}
        onChange={update}
      />
      <Toggle
        label="Detailed drawings"
        hint="Lets the model draw with filled shapes (circles, ellipses, rectangles, polygons, arcs) and more strokes. Off keeps simple outlines."
        checked={!!data.detailedDrawings}
        onChange={(detailedDrawings) => update({ detailedDrawings })}
      />
    </div>
  );
}
```

- [ ] **Step 2: In `SettingsPanel.tsx`, replace the ModelPicker, models_error, Personality, and Detailed drawings block with `<AssistantSection data={data} update={update} />`.** Leave the Voice `Select` in place for Task 4.

- [ ] **Step 3: Typecheck and build**

Run: `cd web && npm run typecheck && npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/settings/AssistantSection.tsx web/src/components/SettingsPanel.tsx
git commit -m "Extract the model and personality controls into an Assistant settings section"
```

---

### Task 4: Extract `SpeechSection`

**Files:**
- Create: `web/src/components/settings/SpeechSection.tsx`
- Modify: `web/src/components/SettingsPanel.tsx` (remove `CLONE_PASSAGE`, `ClonedVoices`, the Voice `Select`, the `ModelsSection` block, and the whole Advanced tab panel)

**Interfaces:**
- Consumes: `ModelsSection` from `../ModelsSection`, `useRecorder` from `../../hooks/useRecorder`, `fields.tsx` exports.
- Produces: `SpeechSection({ data, update, active, onSwitched })`. `active` is true only while the dialog is open and Speech is the current section; `onSwitched()` refetches settings after an engine switch.

- [ ] **Step 1: Create the section file**

Move `CLONE_PASSAGE` and `ClonedVoices` verbatim (not exported), fixing the import paths to `../../hooks/useRecorder` and `./fields`. Change the copy inside `ClonedVoices` from "Switch to Chatterbox Turbo or Nano under Text-to-speech to use one" to "Switch to Chatterbox Turbo or Nano above to use one". Then add:

```tsx
import ModelsSection from "../ModelsSection";
import { SectionTitle, Select, Skeleton } from "./fields";

export default function SpeechSection({ data, update, active, onSwitched }) {
  return (
    <div className="flex flex-col gap-8">
      <ModelsSection active={active} onSwitched={onSwitched} />
      <div className="flex flex-col gap-3">
        <SectionTitle>Voice</SectionTitle>
        {!data && <Skeleton />}
        {data && (
          <Select
            label="Voice"
            value={data.voice}
            options={data.voices}
            onChange={(voice) => update({ voice })}
          />
        )}
      </div>
      <ClonedVoices
        active={active}
        selectedVoice={data?.voice}
        onUse={(voice) => update({ voice })}
      />
    </div>
  );
}
```

- [ ] **Step 2: In `SettingsPanel.tsx`, delete the Advanced tab panel and the right-hand `<section>` with `ModelsSection`, and render**

```tsx
<SpeechSection
  data={data}
  update={update}
  active={open && tab === "advanced"}
  onSwitched={() => { fetch("/api/settings").then((r) => r.json()).then(setData).catch(() => {}); }}
/>
```

inside a `tab === "advanced"` branch. This keeps the panel working until Task 5 replaces the tabs.

- [ ] **Step 3: Typecheck and build**

Run: `cd web && npm run typecheck && npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/settings/SpeechSection.tsx web/src/components/SettingsPanel.tsx
git commit -m "Extract the speech engines, voice, and cloning controls into a Speech settings section"
```

---

### Task 5: Section navigation and the shell layout

**Files:**
- Create: `web/src/components/settings/SectionNav.tsx`
- Modify: `web/src/components/SettingsPanel.tsx` (remove `TABS`, `Tabs`; replace `tab` state with `section`; new JSX tree)
- Modify: `web/src/index.css:275-280` and `web/src/index.css:306-308` (replace the `.settings-*` rules)

**Interfaces:**
- Produces: `SectionNav({ sections, value, onChange })` where `sections: {key: string; label: string}[]`. Emits `role="tablist"`; each button has `role="tab"`, `aria-selected`, and `id={`settings-tab-${key}`}`.
- The shell renders the active section inside `<div role="tabpanel" aria-labelledby={`settings-tab-${section}`}>`.

- [ ] **Step 1: Create `SectionNav.tsx`**

```tsx
export default function SectionNav({ sections, value, onChange }) {
  return (
    <nav className="settings-nav" role="tablist" aria-label="Settings sections">
      {sections.map((s) => (
        <button
          key={s.key}
          id={`settings-tab-${s.key}`}
          role="tab"
          aria-selected={value === s.key}
          onClick={() => onChange(s.key)}
          className={`settings-nav-item ${value === s.key ? "is-active" : ""}`}
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Rewrite the JSX in `SettingsPanel.tsx`**

Replace `const [tab, setTab] = useState("general")` with `const [section, setSection] = useState("general")`. Add near the top of the file:

```tsx
const SECTIONS = [
  { key: "general", label: "General" },
  { key: "assistant", label: "Assistant" },
  { key: "speech", label: "Speech" },
];
```

Reset to General on open: inside the existing `useEffect(() => { if (!open) return; ... })` add `setSection("general");` as its first statement after the guard.

Replace everything from `<div ref={panel} ...>` through its closing tag with:

```tsx
<div
  ref={panel}
  inert={!open}
  role="dialog"
  aria-modal="true"
  aria-label="Settings"
  className="settings-panel pointer-events-auto invisible flex w-full flex-col overflow-hidden border border-white/10 bg-ink-900/95 opacity-0 shadow-2xl shadow-black/60 backdrop-blur-2xl"
>
  <header className="settings-header flex items-center justify-between gap-3">
    <h2 className="text-xl font-medium text-zinc-100">Settings</h2>
    <button ref={closeBtn} onClick={() => setOpen(false)} aria-label="Close settings" className="icon-button">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  </header>
  <div className="settings-body">
    <SectionNav sections={SECTIONS} value={section} onChange={setSection} />
    <div className="settings-content modal-scroll" role="tabpanel" aria-labelledby={`settings-tab-${section}`}>
      <div className="settings-page">
        {section === "general" && (
          <GeneralSection
            data={data}
            debugEnabled={debugEnabled}
            toggleDebug={toggleDebug}
            removeProvider={removeProvider}
            onProvidersChanged={(body) => { mergeSettings(body); refreshProviders(body.providers ?? []); }}
          />
        )}
        {section === "assistant" && <AssistantSection data={data} update={update} />}
        {section === "speech" && (
          <SpeechSection
            data={data}
            update={update}
            active={open && section === "speech"}
            onSwitched={() => { fetch("/api/settings").then((r) => r.json()).then(setData).catch(() => {}); }}
          />
        )}
      </div>
      <Toast saved={saved} error={error} />
    </div>
  </div>
</div>
```

`Toast` is created in Task 6. For this task, keep the old header `Saved` span and the `{error && <p ...>}` paragraph temporarily placed just above `<div className="settings-body">`, and skip the `<Toast>` line. Task 6 swaps them.

Also change the wrapper `<div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4 pt-[max(1rem,env(safe-area-inset-top))]">` to `<div className="settings-layer pointer-events-none fixed inset-0 z-50 grid place-items-center">`. Padding moves to CSS so the mobile sheet can drop it.

- [ ] **Step 3: Replace the settings rules in `index.css`**

Delete lines 275-280 (`.settings-panel` through `.settings-content h3`) and the three `.settings-*` lines inside the `@media (max-width: 639px)` block (lines 306-308). Add in their place, at the same position as the old desktop rules:

```css
.settings-layer { padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom)); }
.settings-panel { max-width: 940px; max-height: min(88vh, 48rem); background: #10141e; border-radius: 20px; }
.settings-header { padding: 22px 28px; border-bottom: 1px solid var(--line); }
.settings-header h2 { font-family: var(--font-sans); font-size: 20px; font-style: normal; }
.settings-body { display: grid; grid-template-columns: 180px minmax(0, 1fr); flex: 1; min-height: 0; }
.settings-nav { display: flex; flex-direction: column; gap: 4px; padding: 20px 14px; border-right: 1px solid var(--line); }
.settings-nav-item { text-align: left; padding: 9px 14px; border-radius: 999px; font-size: 13.5px; color: var(--muted); transition: color .25s, background .25s; }
.settings-nav-item:hover { color: #e1e9fa; }
.settings-nav-item.is-active { color: #f0f3f9; background: #ffffff14; }
.settings-content { position: relative; display: flex; flex-direction: column; overflow-y: auto; }
.settings-page { padding: 28px; max-width: 40rem; width: 100%; }
.settings-content h3 { font-family: var(--font-sans); font-size: 11px; letter-spacing: .1em; color: #aab7ce; }
```

And inside the existing `@media (max-width: 639px)` block, where the old three lines were:

```css
  .settings-layer { padding: 0; }
  .settings-panel { max-width: none; max-height: none; height: 100%; border-radius: 0; border: 0; }
  .settings-header { padding: max(16px, env(safe-area-inset-top)) 18px 12px; }
  .settings-body { display: flex; flex-direction: column; }
  .settings-nav { flex-direction: row; gap: 6px; padding: 10px 18px; border-right: 0; border-bottom: 1px solid var(--line); overflow-x: auto; scrollbar-width: none; scroll-snap-type: x proximity; }
  .settings-nav::-webkit-scrollbar { display: none; }
  .settings-nav-item { flex-shrink: 0; scroll-snap-align: start; padding: 7px 14px; }
  .settings-page { padding: 20px 18px; }
```

- [ ] **Step 4: Typecheck and build**

Run: `cd web && npm run typecheck && npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/settings/SectionNav.tsx web/src/components/SettingsPanel.tsx web/src/index.css
git commit -m "Lay the settings out as sections with a rail on desktop and a chip row on phones"
```

---

### Task 6: Sticky feedback toast

**Files:**
- Create: `web/src/components/settings/Toast.tsx`
- Modify: `web/src/components/SettingsPanel.tsx` (remove the header `Saved` span and the inline error paragraph; render `<Toast>`)
- Modify: `web/src/index.css` (add `.settings-toast` rules next to `.settings-page`)

**Interfaces:**
- Produces: `Toast({ saved: boolean, error: string })`. Renders nothing when both are falsy.

- [ ] **Step 1: Create `Toast.tsx`**

```tsx
export default function Toast({ saved, error }) {
  if (!saved && !error) return null;
  if (error) {
    return (
      <div className="settings-toast" role="alert">
        <span className="settings-toast-inner border-red-400/20 bg-red-400/10 text-red-300">{error}</span>
      </div>
    );
  }
  return (
    <div className="settings-toast" role="status">
      <span className="settings-toast-inner border-aurora-teal/20 bg-ink-900 text-aurora-teal">
        <span className="h-1.5 w-1.5 rounded-full bg-aurora-teal" />
        Saved
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Add the CSS after `.settings-page`**

```css
.settings-toast { position: sticky; bottom: 0; display: flex; justify-content: center; margin-top: auto; padding: 8px 18px max(12px, env(safe-area-inset-bottom)); pointer-events: none; }
.settings-toast-inner { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; padding: 8px 14px; border: 1px solid; border-radius: 999px; font-size: 12.5px; box-shadow: 0 8px 30px #00000080; backdrop-filter: blur(12px); pointer-events: auto; }
```

- [ ] **Step 3: In `SettingsPanel.tsx`, delete the `role="status"` Saved span, delete the `{error && <p className="mx-6 ...">}` paragraph, import `Toast`, and add `<Toast saved={saved} error={error} />` as the last child of `.settings-content` (after `.settings-page`).**

Keep the `setSaved(true)` / 1.5-second reset logic as is.

- [ ] **Step 4: Typecheck and build**

Run: `cd web && npm run typecheck && npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/settings/Toast.tsx web/src/components/SettingsPanel.tsx web/src/index.css
git commit -m "Show save and error feedback in a toast pinned to the bottom of the settings"
```

---

### Task 7: Screenshot verification

**Files:**
- Create: `/tmp/claude-1000/-home-ed-HomeAssistantVoice/da5eedf6-5dbb-4c06-85c9-a12232954054/scratchpad/shots.mjs` (throwaway)
- Output: `screenshots/redesign/settings-*.png` (keep the desktop General, Speech, and the phone Speech-with-toast shots; these feed the README later)

- [ ] **Step 1: Build and start preview**

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
cd web && npm run build && (npm run preview -- --port 4173 --strictPort > /dev/null 2>&1 &)
```

- [ ] **Step 2: Write the Playwright script**

Mock `/api/settings`, `/api/providers/*/models`, `/api/models`, `/api/voices`, and the POST `/api/settings` so a save returns 200. Open the dialog, take shots per section at 1280x900 and 400x800, and on the phone Speech page scroll to the bottom, change the voice select, and capture the toast.

```js
import { chromium } from "playwright";

const settings = {
  model: "local::qwen3-8b", voice: "default", voices: ["default", "ed"],
  personality: "custom", personalityPrompt: "Dry British butler.", detailedDrawings: true,
  providers: [{ id: "local", name: "Local", baseUrl: "http://localhost:1234/v1", builtin: true, models: ["qwen3-8b"], state: "ready" }],
};
const models = { models: [
  { id: "parakeet", kind: "stt", label: "Parakeet Unified EN 0.6B", description: "Very fast and accurate; English only", state: "downloaded", active: true, selectable: true, recommended: true, size_mb: 731, downloaded: 731, total: 731 },
  { id: "whisper", kind: "stt", label: "Whisper Large v3 Turbo", description: "Multilingual all-rounder", state: "missing", selectable: true, size_mb: 886, downloaded: 0, total: 886 },
  { id: "kokoro", kind: "tts", label: "Kokoro", description: "Fast, many voices", state: "downloaded", active: true, selectable: true, size_mb: 330, downloaded: 330, total: 330 },
  { id: "cb-turbo", kind: "tts", label: "Chatterbox Turbo", description: "Cloning and performance tags", state: "downloaded", selectable: true, size_mb: 2100, downloaded: 2100, total: 2100 },
]};
const voices = { engine: "kokoro", voices: ["default"], default: "default", clones: ["ed"] };

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
async function shoot(name, viewport, fn) {
  const page = await browser.newPage({ viewport });
  await page.route("**/api/settings", (r) => r.fulfill({ json: settings }));
  await page.route("**/api/providers/*/models", (r) => r.fulfill({ json: { models: ["qwen3-8b"] } }));
  await page.route("**/api/models", (r) => r.fulfill({ json: models }));
  await page.route("**/api/voices", (r) => r.fulfill({ json: voices }));
  await page.route("**/ws**", (r) => r.abort());
  await page.goto("http://localhost:4173/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(700);
  await fn(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `screenshots/redesign/${name}.png` });
  await page.close();
}
const desk = { width: 1280, height: 900 }, phone = { width: 400, height: 800 };
for (const [vp, tag] of [[desk, "desktop"], [phone, "390"]]) {
  await shoot(`settings-general-${tag}`, vp, async () => {});
  await shoot(`settings-assistant-${tag}`, vp, (p) => p.getByRole("tab", { name: "Assistant" }).click());
  await shoot(`settings-speech-${tag}`, vp, (p) => p.getByRole("tab", { name: "Speech" }).click());
}
await shoot("settings-speech-toast-390", phone, async (p) => {
  await p.getByRole("tab", { name: "Speech" }).click();
  await p.waitForTimeout(300);
  const sel = p.getByLabel("Voice", { exact: true });
  await sel.scrollIntoViewIfNeeded();
  await sel.selectOption("ed");
  await p.waitForTimeout(300);
});
await browser.close();
```

- [ ] **Step 3: Run it and inspect every image**

```bash
cd <repository-root> && node <scratchpad>/shots.mjs
```

Read each PNG. Check: the rail shows on desktop with the active pill; the phone sheet fills the viewport with a chip row under the title; no horizontal scrollbar on the body; the toast reads "Saved" at the bottom of the phone Speech shot.

- [ ] **Step 4: Fix anything wrong and re-shoot**, then stop the preview server (`pkill -f "vite preview"`).

- [ ] **Step 5: Commit the kept screenshots**

```bash
git add screenshots/redesign/settings-general-desktop.png screenshots/redesign/settings-speech-desktop.png screenshots/redesign/settings-speech-toast-390.png
git commit -m "Add screenshots of the sectioned settings panel"
```

---

### Task 8: README screenshot and docs

**Files:**
- Modify: `README.md` (the settings screenshot reference and any text that mentions the Advanced tab)
- Modify: `AGENTS.md` only if it describes the settings panel layout

- [ ] **Step 1: Search for stale references**

```bash
grep -n -i "advanced\|settings.png\|General tab" README.md AGENTS.md
```

- [ ] **Step 2: Replace `screenshots/settings.png` with the new desktop General shot**

```bash
cp screenshots/redesign/settings-general-desktop.png screenshots/settings.png
```

Update any sentence that mentions the Advanced tab or the two-column layout to describe the three sections.

- [ ] **Step 3: Commit**

```bash
git add README.md screenshots/settings.png
git commit -m "Refresh the settings screenshot and describe the three settings sections"
```
