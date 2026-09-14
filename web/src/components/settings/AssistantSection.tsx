import { useEffect, useState } from "react";
import ModelPicker from "../ModelPicker";
import { BUTTON_CLS, Disclosure, FIELD_CLS, Select, Skeleton, Toggle } from "./fields";

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

function ChatInstructions({ value, onChange }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  const dirty = draft.trim() !== (value ?? "").trim();
  return (
    <div className="flex flex-col gap-2.5">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="How the assistant should behave in chat, e.g. “Answer concisely, prefer Python examples, call me Ed.” Leave empty for a neutral assistant."
        aria-label="Chat instructions"
        rows={5}
        maxLength={2000}
        className={`${FIELD_CLS} resize-y leading-snug`}
      />
      <p className="-mt-1 text-[0.78rem] leading-snug text-zinc-500">
        Applies to Chat only. Voice keeps its personality above.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ chatInstructions: draft.trim() })}
          disabled={!dirty}
          className={BUTTON_CLS}
        >
          Save instructions
        </button>
        {dirty && <span className="text-[0.72rem] text-zinc-500">Unsaved changes</span>}
      </div>
    </div>
  );
}

export default function AssistantSection({ data, update }) {
  const [openRow, setOpenRow] = useState(null);
  const toggle = (key) => setOpenRow((cur) => (cur === key ? null : key));
  if (!data) return <Skeleton />;
  const modelName = String(data.model ?? "").includes("::") ? data.model.split("::")[1] : data.model;
  const personality = PERSONALITY_OPTIONS.find((o) => o.value === (data.personality ?? "sassy")) ?? PERSONALITY_OPTIONS[0];
  const instructions = String(data.chatInstructions ?? "").trim();
  const instructionsSummary = instructions ? (instructions.length > 40 ? instructions.slice(0, 40) + "…" : instructions) : "Default";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col">
        <Disclosure id="model" title="Model" summary={modelName || "Not set"} open={openRow === "model"} onToggle={() => toggle("model")}>
          <div className="flex flex-col gap-2">
            <ModelPicker
              label=""
              value={data.model}
              providers={data.providers ?? []}
              onChange={(model) => update({ model })}
            />
            {data.models_error && (
              <p className="text-[0.75rem] leading-snug text-red-400/90">
                Can't reach the local model server — showing the last saved model.
              </p>
            )}
          </div>
        </Disclosure>
        <Disclosure id="personality" title="Personality" summary={personality.label} open={openRow === "personality"} onToggle={() => toggle("personality")}>
          <Personality
            value={data.personality ?? "sassy"}
            prompt={data.personalityPrompt ?? ""}
            onChange={update}
          />
        </Disclosure>
        <Disclosure id="chat-instructions" title="Chat instructions" summary={instructionsSummary} open={openRow === "chat-instructions"} onToggle={() => toggle("chat-instructions")}>
          <ChatInstructions value={data.chatInstructions ?? ""} onChange={update} />
        </Disclosure>
      </div>
      <Toggle
        label="Detailed drawings"
        hint="Lets the model draw with filled shapes (circles, ellipses, rectangles, polygons, arcs) and more strokes. Off keeps simple outlines."
        checked={!!data.detailedDrawings}
        onChange={(detailedDrawings) => update({ detailedDrawings })}
      />
    </div>
  );
}
