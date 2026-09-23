import { useEffect, useId, useRef, useState } from "react";
import { useChatStore } from "../../chatStore";
import { uploadFile } from "../../lib/chatApi";
import ModelPicker from "../ModelPicker";
import AttachmentPicker from "./AttachmentPicker";
import ToolsMenu from "./ToolsMenu";
import DictationButton from "./DictationButton";
import { useModels, useProviders } from "./useModels";
import { commandSuggestions } from "../../lib/chatCommands";
import CommandSuggestions from "./CommandSuggestions";

const MAX_HEIGHT = 184; // ~8 lines of mono at 0.85rem
const VISION_RE = /vl|vision/i;

const ArrowUp = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
const Stop = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
const FileIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
);

export default function Composer() {
  const active = useChatStore((s) => s.active);
  const streaming = useChatStore((s) => s.streaming);
  const pendingAttachments = useChatStore((s) => s.pendingAttachments);
  const addAttachment = useChatStore((s) => s.addAttachment);
  const removeAttachment = useChatStore((s) => s.removeAttachment);
  const startStream = useChatStore((s) => s.startStream);
  const stopStream = useChatStore((s) => s.stopStream);
  const models = useModels();
  const providers = useProviders();
  const renameModel = useChatStore((s) => s.renameModel);

  const text = active?.draftText ?? "";
  const setText = useChatStore((s) => s.setDraftText);
  const draftError = useChatStore((s) => s.draftError);
  useEffect(() => {
    const save = () => { void useChatStore.getState().flushDraft().catch(() => {}); };
    const unload = () => { void useChatStore.getState().flushDraft(true).catch(() => {}); };
    window.addEventListener("pagehide", unload);
    return () => { window.removeEventListener("pagehide", unload); save(); };
  }, []);
  const [uploading, setUploading] = useState(false);
  const [dictating, setDictating] = useState(false);
  const textareaRef = useRef(null);
  const [uploadError, setUploadError] = useState("");
  const [focused, setFocused] = useState(false);
  const [dismissedCommand, setDismissedCommand] = useState<string | null>(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const commandListId = useId();
  const commands = commandSuggestions(text);
  const commandKey = `${active?.id}:${text}`;
  const showCommands = focused && !streaming && !uploading && !dictating
    && commands.length > 0 && dismissedCommand !== commandKey;
  const selectedCommand = Math.min(commandIndex, commands.length - 1);
  useEffect(() => { setCommandIndex(0); }, [text, active?.id]);

  const chooseCommand = (name: string) => {
    setDismissedCommand(`${active?.id}:${name}`);
    setText(name);
    textareaRef.current?.focus();
  };

  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  };

  useEffect(() => { autoGrow(); }, [text, active?.id]);

  const canSend = text.trim().length > 0 || pendingAttachments.length > 0;

  const send = () => {
    if (streaming || uploading || dictating || !canSend) return;
    startStream(text.trim());
    const el = textareaRef.current;
    if (el) el.style.height = "auto";
  };

  const onKeyDown = (e) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (showCommands) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setCommandIndex((selectedCommand + (e.key === "ArrowDown" ? 1 : -1) + commands.length) % commands.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedCommand(commandKey);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        chooseCommand(commands[selectedCommand].name);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const onFiles = async (files: File[]) => {
    if (!files.length || uploading) return;
    const conversationId = useChatStore.getState().activeId;
    setUploading(true);
    setUploadError("");
    const failures: string[] = [];
    try {
      for (const file of files) {
        try {
          const attachment = await uploadFile(file, conversationId);
          if (useChatStore.getState().activeId === conversationId) addAttachment(attachment);
        } catch (err) {
          failures.push(`${file.name}: ${err instanceof Error ? err.message : "Upload failed"}`);
        }
      }
      setUploadError(failures.join(" · "));
    } finally {
      setUploading(false);
    }
  };

  const hasImage = pendingAttachments.some((a) => a.kind === "image");
  const visionOk = VISION_RE.test(active?.model || "");
  const visionModel = models.find((m) => VISION_RE.test(m));
  const showVisionWarning = hasImage && !visionOk;

  return (
    <div className="composer shrink-0 px-4 pb-1 pt-2 sm:px-6">
      {draftError && <p role="alert" className="attachment-feedback">{draftError}</p>}
      {uploading && <p role="status" className="attachment-feedback">Uploading attachments…</p>}
      {uploadError && <p role="alert" className="attachment-feedback">{uploadError}</p>}
      {showVisionWarning && (
        <div className="mx-auto mb-2 flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-aurora-ember/30 bg-aurora-ember/10 px-3 py-1.5 font-mono text-[0.65rem] text-aurora-ember">
          <span>model may not support images</span>
          {visionModel && (
            <button
              onClick={() => useChatStore.getState().renameModel(visionModel)}
              className="rounded border border-aurora-ember/40 px-2 py-0.5 uppercase tracking-[0.12em] transition-colors duration-200 hover:bg-aurora-ember/20"
            >
              switch to {visionModel}
            </button>
          )}
        </div>
      )}
      <div className="composer-field mx-auto max-w-3xl">
        {showCommands && <CommandSuggestions id={commandListId} commands={commands}
          selected={selectedCommand} onSelect={chooseCommand} />}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-white/5 px-3 pb-2 pt-2.5">
            {pendingAttachments.map((a) =>
              a.kind === "image" ? (
                <span key={a.id} className="group relative block">
                  <img
                    src={`/api/chat/uploads/${a.id}`}
                    alt={a.name}
                    className="h-14 w-14 rounded-lg border border-white/10 object-cover"
                  />
                  <button
                    onClick={() => removeAttachment(a.id)}
                    aria-label={`Remove ${a.name}`}
                    className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-white/15 bg-ink-900 text-zinc-400 transition-colors duration-200 hover:bg-white/10 hover:text-zinc-100"
                  >
                    <span className="ui-text-icon" aria-hidden="true">×</span>
                  </button>
                </span>
              ) : (
                <span
                  key={a.id}
                  className="flex max-w-[180px] items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] py-1 pl-2.5 pr-1.5 font-mono text-[0.62rem] text-zinc-300"
                >
                  <span className="text-zinc-500">
                    <FileIcon />
                  </span>
                  <span className="truncate">{a.name}</span>
                  <button
                    onClick={() => removeAttachment(a.id)}
                    aria-label={`Remove ${a.name}`}
                    className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-zinc-500 transition-colors duration-200 hover:bg-white/10 hover:text-zinc-200"
                  >
                    <span className="ui-text-icon" aria-hidden="true">×</span>
                  </button>
                </span>
              )
            )}
          </div>
        )}
        <textarea
          ref={textareaRef}
          rows={2}
          value={text}
          onChange={(e) => {
            setDismissedCommand(null);
            setText(e.target.value);
            autoGrow();
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); void useChatStore.getState().flushDraft().catch(() => {}); }}
          onKeyDown={onKeyDown}
          placeholder="Message the assistant…"
          aria-label="Message"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={showCommands}
          aria-controls={showCommands ? commandListId : undefined}
          aria-activedescendant={showCommands ? `${commandListId}-${selectedCommand}` : undefined}
          className="block w-full max-h-[184px] min-h-[64px] resize-none self-center bg-transparent px-4 pt-3 pb-2 font-sans text-base leading-snug text-zinc-200 outline-none placeholder:text-zinc-500"
        />
        <div className="flex items-center gap-2 px-2.5 pb-2">
          <div className="composer-controls" data-dictating={dictating}>
          <div className="composer-settings" inert={dictating}>
          <AttachmentPicker key={active?.id} disabled={uploading} onFiles={onFiles} />
          <ToolsMenu key={`tools-${active?.id}`} />
          <div className="ml-auto min-w-0">
            <ModelPicker presentation="sheet" value={active?.model || ""} providers={providers} onChange={renameModel} />
          </div>
          </div>
          <DictationButton key={active?.id} disabled={streaming || uploading}
            onBusy={setDictating}
            onText={(transcript) => {
              const state = useChatStore.getState();
              if (state.activeId !== active?.id) return;
              const existing = state.active?.draftText ?? "";
              state.setDraftText(existing + (existing && !/\s$/u.test(existing) ? " " : "") + transcript);
            }} />
          </div>
          {streaming ? (
            <button
              onClick={stopStream}
              aria-label="Stop generating"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-aurora-ember/50 bg-aurora-ember/15 text-aurora-ember transition-colors duration-300 hover:bg-aurora-ember/25"
            >
              <Stop />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!canSend || uploading || dictating}
              aria-label="Send message"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-aurora-teal/50 bg-aurora-teal/15 text-aurora-teal transition-colors duration-300 hover:bg-aurora-teal/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-zinc-600"
            >
              <ArrowUp />
            </button>
          )}
        </div>
      </div>
      <p className="composer-hint">
        Enter to send · Shift + Enter for a new line · /help for commands
      </p>
    </div>
  );
}
