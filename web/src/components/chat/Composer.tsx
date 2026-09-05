import { useRef, useState } from "react";
import { useChatStore } from "../../chatStore";
import { uploadFile } from "../../lib/chatApi";
import { useModels } from "./useModels";

const ACCEPT = "image/*,.pdf,.txt,.md,.csv,.json,.py,.js,.ts,.yaml,.yml,.html,.css";
const MAX_HEIGHT = 184; // ~8 lines of mono at 0.85rem
const VISION_RE = /vl|vision/i;

const Paperclip = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);
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

  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef(null);
  const fileRef = useRef(null);

  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  };

  const canSend = text.trim().length > 0 || pendingAttachments.length > 0;

  const send = () => {
    if (streaming || !canSend) return;
    startStream(text.trim());
    setText("");
    const el = textareaRef.current;
    if (el) el.style.height = "auto";
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const onFiles = async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    for (const file of files) {
      try {
        addAttachment(await uploadFile(file));
      } catch (err) {
        console.error("upload failed", err);
      }
    }
    setUploading(false);
  };

  const hasImage = pendingAttachments.some((a) => a.kind === "image");
  const visionOk = VISION_RE.test(active?.model || "");
  const visionModel = models.find((m) => VISION_RE.test(m));
  const showVisionWarning = hasImage && !visionOk;

  return (
    <div className="composer shrink-0 px-4 pb-1 pt-2 sm:px-6">
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
                    ×
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
                    ×
                  </button>
                </span>
              )
            )}
          </div>
        )}
        <div className="flex items-end gap-2 px-2.5 py-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT}
            onChange={onFiles}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label="Attach files"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-zinc-500 transition-colors duration-300 hover:bg-white/[0.06] hover:text-zinc-200 disabled:animate-pulse-dot disabled:opacity-50"
          >
            <Paperclip />
          </button>
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              autoGrow();
            }}
            onKeyDown={onKeyDown}
            placeholder="Message the assistant…"
            aria-label="Message"
            className="max-h-[184px] min-h-9 flex-1 resize-none self-center bg-transparent py-2 font-sans text-[0.95rem] leading-snug text-zinc-200 outline-none placeholder:text-zinc-500"
          />
          {streaming ? (
            <button
              onClick={stopStream}
              aria-label="Stop generating"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-aurora-ember/50 bg-aurora-ember/15 text-aurora-ember transition-colors duration-300 hover:bg-aurora-ember/25"
            >
              <Stop />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!canSend}
              aria-label="Send message"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-aurora-teal/50 bg-aurora-teal/15 text-aurora-teal transition-colors duration-300 hover:bg-aurora-teal/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-zinc-600"
            >
              <ArrowUp />
            </button>
          )}
        </div>
      </div>
      <p className="composer-hint">
        Enter to send · Shift + Enter for a new line
      </p>
    </div>
  );
}
