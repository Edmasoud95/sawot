import { useEffect, useId, useMemo, useRef, useState } from "react";
import { rankModels, type ProviderLike } from "../lib/fuzzy";
import { useModelFavorites } from "../lib/modelFavorites";
import EffortSlider from "./EffortSlider";
import ChevronDown from "./ChevronDown";

interface Props {
  label?: string;
  value: string;
  providers: ProviderLike[];
  onChange: (value: string) => void | Promise<void>;
  effort?: string | null;
  onEffortChange?: (value: string | null) => void | Promise<void>;
  disabled?: boolean;
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
export default function ModelPicker({ label = "Model", value, providers, onChange, compact = false, presentation = "inline", effort = null, onEffortChange, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const choosing = useRef(false);
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const sheet = presentation === "sheet";

  const { favorites, toggleFavorite } = useModelFavorites();
  const groups = useMemo(() => rankModels(query, providers, favorites), [query, providers, favorites]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const current = value.includes("::") ? value.split("::")[1] : value;
  const providerId = value.includes("::") ? value.slice(0, value.indexOf("::")) : null;
  const provider = providers.find(p => providerId ? p.id === providerId : p.builtin);
  const levels = provider?.effortLevels?.[current] ?? [];
  const loading = providers.some((p) => (p.state ?? "ready") === "pending");
  const anyModels = providers.some((p) => p.models.length);

  useEffect(() => { setCursor(0); }, [query, open, favorites]);
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

  const choose = async (v: string) => {
    if (disabled || choosing.current) return;
    choosing.current = true;
    setSaving(true);
    setError("");
    try {
      await onChange(v);
      if (!onEffortChange) setOpen(false);
      setQuery("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not change model. Try again."); }
    finally { choosing.current = false; setSaving(false); }
  };
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
        disabled={disabled || saving}
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
              <div key={item.value} className="mpick-row" role="presentation">
              <div
                id={`${listId}-${i}`}
                role="option"
                aria-disabled={disabled || saving}
                aria-selected={item.value === value}
                data-index={i}
                data-active={i === cursor}
                className="mpick-option"
                onPointerEnter={() => setCursor(i)}
                onClick={() => choose(item.value)}
              >
                <span className="mpick-model-name"><Highlight text={item.model} indices={item.indices} />
                  {g.favorites && <small>{item.providerName}</small>}
                </span>
              </div>
              <button type="button" className="mpick-favorite" disabled={disabled || saving}
                aria-label={`${favorites.includes(item.value) ? "Unfavorite" : "Favorite"} ${item.model} (${item.providerName ?? g.name})`}
                aria-pressed={favorites.includes(item.value)} title={favorites.includes(item.value) ? "Remove from favorites" : "Add to favorites"}
                onClick={() => { toggleFavorite(item.value); input.current?.focus(); }}>
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
                  fill={favorites.includes(item.value) ? "currentColor" : "none"} aria-hidden="true">
                  <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z" />
                </svg>
              </button>
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
  const resetEffort = async () => {
    if (disabled || saving || !onEffortChange) return;
    setSaving(true);
    setError("");
    try { await onEffortChange(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not reset effort."); }
    finally { setSaving(false); }
  };
  const effortControl = onEffortChange && (levels.length > 0 && (effort === null || levels.includes(effort)) ? (
    <EffortSlider key={value} model={current} levels={levels} value={effort} onChange={onEffortChange} disabled={disabled || saving} />
  ) : effort !== null ? (
    <div className="mpick-effort mpick-effort-heading"><span>Effort unavailable</span>
      <button type="button" disabled={disabled || saving} onClick={() => void resetEffort()}>Reset to Default</button>
    </div>
  ) : null);
  return (
    <div ref={root} className="mpick" data-open={open} data-compact={compact}>
      {sheet ? (
        <>
          <button ref={trigger} disabled={disabled} type="button" className="composer-model" aria-haspopup="dialog" aria-expanded={open}
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
              {effortControl}
              {error && <p role="alert" className="mpick-error">{error}</p>}
            </dialog>
          )}
        </>
      ) : (
        <>
          {label && !compact && <span className="mpick-label">{label}</span>}
          {field}
          {open && <div className="mpick-pop">{list}{effortControl}{error && <p role="alert" className="mpick-error">{error}</p>}</div>}
        </>
      )}
    </div>
  );
}
