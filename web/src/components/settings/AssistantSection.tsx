import { useEffect, useState } from "react";
import ModelPicker from "../ModelPicker";
import { BUTTON_CLS, FIELD_CLS, Select, Skeleton, Toggle } from "./fields";

const PERSONALITY_OPTIONS = [
  { value: "sassy", label: "Sassy", hint: "Rita gets witty and teases you." },
  { value: "plain", label: "Plain", hint: "Friendly and to the point." },
  { value: "custom", label: "Custom", hint: "Describe the character yourself, or let the model write it." },
];

function Personality({ value, prompt, onChange }) {
  const [draft, setDraft] = useState(prompt ?? "");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  // A save from elsewhere (or first load) refreshes the draft; typing does not.
  useEffect(() => { setDraft(prompt ?? ""); }, [prompt]);
  const dirty = draft.trim() !== (prompt ?? "").trim();
  const current = PERSONALITY_OPTIONS.find((o) => o.value === value) ?? PERSONALITY_OPTIONS[0];

  async function refine() {
    setFormError("");
    setBusy(true);
    try {
      const res = await fetch("/api/personality/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft }),
      });
      const body = await res.json();
      if (!res.ok) {
        setFormError(body.detail || "The model couldn't refine that — try again.");
        return;
      }
      setDraft(body.text);
    } catch {
      setFormError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Select
        label="Personality"
        value={value}
        options={PERSONALITY_OPTIONS.map((o) => o.value)}
        labels={Object.fromEntries(PERSONALITY_OPTIONS.map((o) => [o.value, o.label]))}
        onChange={(personality) => onChange({ personality })}
      />
      <p className="-mt-1 text-[0.78rem] leading-snug text-zinc-500">{current.hint}</p>
      {value === "custom" && (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="A few words are enough — e.g. “dry British butler, unflappable, calls me sir”. Refine turns notes into a full brief; leave it empty to have the model invent one."
            aria-label="Custom personality"
            rows={5}
            maxLength={2000}
            disabled={busy}
            className={`${FIELD_CLS} resize-y leading-snug`}
          />
          {formError && <p className="text-[0.75rem] leading-snug text-red-400/90">{formError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={refine} disabled={busy} className={BUTTON_CLS}>
              {busy ? "Asking the model…" : draft.trim() ? "Refine with model" : "Write one for me"}
            </button>
            <button
              type="button"
              onClick={() => onChange({ personalityPrompt: draft })}
              disabled={busy || !dirty}
              className={BUTTON_CLS}
            >
              Save personality
            </button>
            {dirty && !busy && <span className="text-[0.72rem] text-zinc-500">Unsaved changes</span>}
          </div>
        </>
      )}
    </div>
  );
}

export default function AssistantSection({ data, update }) {
  if (!data) return <Skeleton />;
  return (
    <div className="flex flex-col gap-5">
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
