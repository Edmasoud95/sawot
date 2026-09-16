import { useEffect, useId, useMemo, useRef, useState } from "react";
import { rankModels, type ProviderLike } from "../lib/fuzzy";
import ChevronDown from "./ChevronDown";

interface Props {
  label?: string;
  value: string;
  providers: ProviderLike[];
  onChange: (value: string) => void;
  compact?: boolean;
  presentation?: "inline" | "sheet";
}

function Highlight({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const marks = new Set(indices);
  return <>{[...text].map((ch, i) => (marks.has(i) ? <mark key={i}>{ch}</mark> : ch))}</>;
}

/** A searchable model picker: type to fuzzy-filter every provider's models,
 *  grouped by provider, with providers still loading shown as such. */
export default function ModelPicker({ label = "Model", value, providers, onChange, compact = false, presentation = "inline" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const sheet = presentation === "sheet";

  const groups = useMemo(() => rankModels(query, providers), [query, providers]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const current = value.includes("::") ? value.split("::")[1] : value;
  const loading = providers.some((p) => (p.state ?? "ready") === "pending");
  const anyModels = providers.some((p) => p.models.length);

  useEffect(() => { setCursor(0); }, [query, open]);
  useEffect(() => {
    if (!open || sheet) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, sheet]);
  useEffect(() => {
    if (!open || !sheet) return;
    const el = dialog.current;
    el?.showModal();
    input.current?.focus();
    return () => { el?.close(); trigger.current?.focus(); };
  }, [open, sheet]);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  const choose = (v: string) => { onChange(v); setOpen(false); setQuery(""); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setCursor((c) => Math.max(0, Math.min(flat.length - 1, c + 1))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (open && flat[cursor]) choose(flat[cursor].value); else setOpen(true); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); setQuery(""); }
  };

  let index = -1;
  const field = (
    <div className="mpick-field">
      <input
        ref={input}
        role="combobox"
        aria-label={label || "Model"}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && flat[cursor] ? `${listId}-${cursor}` : undefined}
        className="mpick-input"
        placeholder={open ? "Search models" : current}
        value={open ? query : current}
        readOnly={!open}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="mpick-caret" aria-hidden="true">{loading ? <span className="mpick-spinner" /> : <ChevronDown />}</span>
    </div>
  );
  const list = (
    <ul id={listId} role="listbox" className="mpick-list">
      {groups.map((g) => (
        <li key={g.id} role="presentation" className="mpick-group">
          <div className="mpick-group-head">
            <span>{g.name}</span>
            <span className="mpick-group-meta" data-state={g.state}>
              {g.state === "pending" ? "loading" : g.state === "error" ? "unreachable" : `${g.items.length}`}
            </span>
          </div>
          {g.items.map((item) => {
            index += 1;
            const i = index;
            return (
              <div
                key={item.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={item.value === value}
                data-index={i}
                data-active={i === cursor}
                className="mpick-option"
                onPointerEnter={() => setCursor(i)}
                onClick={() => choose(item.value)}
              >
                <Highlight text={item.model} indices={item.indices} />
              </div>
            );
                })}
                {g.state === "pending" && !g.items.length && <div className="mpick-hint">Loading models…</div>}
                {g.state === "error" && !g.items.length && <div className="mpick-hint">Unreachable, check the URL and key</div>}
              </li>
            ))}
            {!groups.length && <li className="mpick-hint">{anyModels ? "No models match" : loading ? "Loading models…" : "No models available"}</li>}
          </ul>
  );
  return (
    <div ref={root} className="mpick" data-open={open} data-compact={compact}>
      {sheet ? (
        <>
          <button ref={trigger} type="button" className="composer-model" aria-haspopup="dialog" aria-expanded={open}
            aria-label={`Choose model: ${current || "Select model"}`} title={current}
            onClick={() => { setQuery(""); setOpen(true); }}>
            <span>{current || "Select model"}</span><ChevronDown />
          </button>
          {open && (
            <dialog ref={dialog} className="model-sheet" aria-labelledby={`${listId}-title`}
              onCancel={() => { setOpen(false); setQuery(""); }}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                const r = e.currentTarget.getBoundingClientRect();
                if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) setOpen(false);
              }}>
              <div className="model-sheet-heading">
                <h2 id={`${listId}-title`}>Choose model</h2>
                <button type="button" aria-label="Close model picker" onClick={() => setOpen(false)}><span className="ui-text-icon" aria-hidden="true">×</span></button>
              </div>
              {field}
              {list}
            </dialog>
          )}
        </>
      ) : (
        <>
          {label && !compact && <span className="mpick-label">{label}</span>}
          {field}
          {open && <div className="mpick-pop">{list}</div>}
        </>
      )}
    </div>
  );
}
