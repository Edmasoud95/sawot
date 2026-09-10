import { useEffect, useId, useMemo, useRef, useState } from "react";
import { rankModels, type ProviderLike } from "../lib/fuzzy";

interface Props {
  label?: string;
  value: string;
  providers: ProviderLike[];
  onChange: (value: string) => void;
  compact?: boolean;
}

function Highlight({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const marks = new Set(indices);
  return <>{[...text].map((ch, i) => (marks.has(i) ? <mark key={i}>{ch}</mark> : ch))}</>;
}

/** A searchable model picker: type to fuzzy-filter every provider's models,
 *  grouped by provider, with providers still loading shown as such. */
export default function ModelPicker({ label = "Model", value, providers, onChange, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const groups = useMemo(() => rankModels(query, providers), [query, providers]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const current = value.includes("::") ? value.split("::")[1] : value;
  const loading = providers.some((p) => (p.state ?? "ready") === "pending");
  const anyModels = providers.some((p) => p.models.length);

  useEffect(() => { setCursor(0); }, [query, open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  const choose = (v: string) => { onChange(v); setOpen(false); setQuery(""); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setCursor((c) => Math.min(flat.length - 1, c + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (open && flat[cursor]) choose(flat[cursor].value); else setOpen(true); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); setQuery(""); }
  };

  let index = -1;
  return (
    <div ref={root} className="mpick" data-open={open} data-compact={compact}>
      {label && !compact && <span className="mpick-label">{label}</span>}
      <div className="mpick-field">
        <input
          ref={input}
          role="combobox"
          aria-label={label}
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
        <span className="mpick-caret" aria-hidden="true">{loading ? <span className="mpick-spinner" /> : "⌄"}</span>
      </div>
      {open && (
        <div className="mpick-pop">
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
        </div>
      )}
    </div>
  );
}
