import { useEffect, useState } from "react";
import { ModelList, useSpeechModels } from "../ModelsSection";
import { useRecorder } from "../../hooks/useRecorder";
import { BUTTON_CLS, Disclosure, FIELD_CLS, Select, Skeleton } from "./fields";

// Read aloud in ten to fifteen seconds; varied sounds, natural rhythm.
const CLONE_PASSAGE =
  "Hi, this is my voice. I like it when the lights come on before I even ask, and when the coffee " +
  "is ready by the time I reach the kitchen. Some days I talk fast, some days I take my time, but " +
  "I always say exactly what I mean.";

function ClonedVoices({ info, setInfo, selectedVoice, onUse }) {
  const [name, setName] = useState("");
  const [clip, setClip] = useState(null); // { blob, url }
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const { start, stop } = useRecorder((buffer) => {
    const blob = new Blob([buffer], { type: "audio/webm" });
    setClip((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { blob, url: URL.createObjectURL(blob) }; });
  });

  async function toggleRecording() {
    setFormError("");
    if (recording) { stop(); setRecording(false); return; }
    try {
      await start();
      setRecording(true);
    } catch {
      setFormError("Couldn't open the microphone — allow access and try again.");
    }
  }

  async function call(url, init, okMessage) {
    setFormError("");
    setBusy(true);
    try {
      const res = await fetch(url, init);
      const body = await res.json();
      if (!res.ok) { setFormError(body.detail || okMessage); return null; }
      setInfo(body);
      return body;
    } catch {
      setFormError("Couldn't reach the server.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const form = new FormData();
    form.append("name", name.trim());
    form.append("file", clip.blob, "clip.webm");
    const body = await call("/api/voices", { method: "POST", body: form }, "Couldn't save the voice — try again.");
    if (!body) return;
    setName("");
    setClip((prev) => { if (prev) URL.revokeObjectURL(prev.url); return null; });
    if (chatterbox) onUse(body.voice);
  }

  async function remove(voice) {
    const body = await call(`/api/voices/${encodeURIComponent(voice)}`, { method: "DELETE" }, "Couldn't remove the voice.");
    if (body && voice === selectedVoice) onUse("default");
  }

  const chatterbox = String(info?.engine ?? "").startsWith("chatterbox-");
  const clones = info?.clones ?? [];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        {!chatterbox && info && (
          <p className="text-sm leading-snug text-zinc-500">
            Cloned voices are spoken by Chatterbox. Switch to Chatterbox Turbo or Nano above to use one; you can still record and delete them here.
          </p>
        )}
        {info && clones.length === 0 && (
          <p className="text-sm leading-snug text-zinc-500">No cloned voices yet.</p>
        )}
        {clones.map((voice) => (
          <div key={voice} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
            <span className="flex min-w-0 items-center gap-2 text-base font-medium text-zinc-200">
              <span className="truncate">{voice}</span>
              {voice === selectedVoice && (
                <span className="rounded-full bg-aurora-teal/15 px-2 py-0.5 font-mono text-sm uppercase tracking-wider text-aurora-teal">in use</span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {chatterbox && voice !== selectedVoice && (
                <button type="button" onClick={() => onUse(voice)} disabled={busy} className={BUTTON_CLS}>Use</button>
              )}
              <button
                type="button"
                onClick={() => remove(voice)}
                disabled={busy}
                aria-label={`Delete voice ${voice}`}
                className="grid h-11 w-11 place-items-center rounded-full border border-white/10 text-zinc-500 transition-colors duration-300 hover:border-red-400/50 hover:text-red-300 disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
        <span className="text-base font-medium text-zinc-200">Clone my voice</span>
        <p className="text-sm leading-snug text-zinc-500">
          Read this aloud in your normal voice, ten to fifteen seconds, somewhere quiet. The voice picks up the mood you read it in.
        </p>
        <p className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-base leading-relaxed text-zinc-300">
          {CLONE_PASSAGE}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={toggleRecording} disabled={busy} className={BUTTON_CLS} aria-pressed={recording}>
            {recording ? "Stop recording" : clip ? "Record again" : "Start recording"}
          </button>
          {recording && (
            <span className="flex items-center gap-1.5 text-sm text-red-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" /> Recording
            </span>
          )}
          {clip && !recording && <audio controls src={clip.url} className="h-8 max-w-full" aria-label="Recording preview" />}
        </div>
        {clip && !recording && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name this voice (e.g. Ed)"
              aria-label="Voice name"
              maxLength={40}
              className={`${FIELD_CLS} w-auto flex-1`}
            />
            <button type="button" onClick={save} disabled={busy || !name.trim()} className={BUTTON_CLS}>
              {busy ? "Saving…" : "Save voice"}
            </button>
          </div>
        )}
      </div>
      {formError && <p className="text-sm leading-snug text-red-400/90">{formError}</p>}
    </div>
  );
}

function activeLabel(models) {
  return models.find((m) => m.active && m.state === "downloaded")?.label ?? "None";
}

export default function SpeechSection({ data, update, active, onSwitched }) {
  const [openRow, setOpenRow] = useState(null);
  const toggle = (key) => setOpenRow((cur) => (cur === key ? null : key));
  const speech = useSpeechModels(active, onSwitched);
  const stt = speech.models.filter((m) => m.kind === "stt");
  const tts = speech.models.filter((m) => m.kind === "tts");
  const [info, setInfo] = useState(null); // { engine, voices, default, clones }
  const [voicesError, setVoicesError] = useState("");
  // A new speech engine brings its own voice list, so refetch on a switch.
  const activeTts = tts.find((m) => m.active)?.id;
  useEffect(() => {
    if (!active) return;
    setVoicesError("");
    fetch("/api/voices").then((r) => r.json()).then(setInfo).catch(() => setVoicesError("Couldn't reach the speech engine."));
  }, [active, activeTts]);
  const clones = info?.clones ?? [];

  if (!data) return <Skeleton />;
  return (
    <div className="flex flex-col">
      <Disclosure id="stt" title="Speech-to-text" summary={activeLabel(stt)} open={openRow === "stt"} onToggle={() => toggle("stt")}>
        <ModelList {...speech} models={stt} />
      </Disclosure>
      <Disclosure id="tts" title="Text-to-speech" summary={activeLabel(tts)} open={openRow === "tts"} onToggle={() => toggle("tts")}>
        <ModelList {...speech} models={tts} />
      </Disclosure>
      <Disclosure id="voice" title="Voice" summary={data.voice} open={openRow === "voice"} onToggle={() => toggle("voice")}>
        <Select
          label=""
          ariaLabel="Voice"
          value={data.voice}
          options={data.voices}
          onChange={(voice) => update({ voice })}
        />
      </Disclosure>
      <Disclosure
        id="clones"
        title="Cloned voices"
        summary={info ? (clones.length === 1 ? "1 voice" : `${clones.length} voices`) : "…"}
        open={openRow === "clones"}
        onToggle={() => toggle("clones")}
      >
        {voicesError && <p className="mb-3 text-sm leading-snug text-red-400/90">{voicesError}</p>}
        <ClonedVoices
          info={info}
          setInfo={setInfo}
          selectedVoice={data.voice}
          onUse={(voice) => update({ voice })}
        />
      </Disclosure>
    </div>
  );
}
