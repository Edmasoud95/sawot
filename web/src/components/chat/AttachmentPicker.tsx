import { useEffect, useId, useRef, useState } from "react";

const ACCEPT = "image/*,.pdf,.txt,.md,.csv,.json,.py,.js,.ts,.yaml,.yml,.html,.css";

function CameraPreview({ onPhoto, onFallback }: { onPhoto: (file: File) => void; onFallback: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | undefined;
    mounted.current = true;
    const start = async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera preview isn’t available in this browser. Use your phone’s camera or choose a photo below.");
        }
        const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } });
        if (cancelled) { acquired.getTracks().forEach((track) => track.stop()); return; }
        stream = acquired;
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
        }
      } catch (err) {
        stream?.getTracks().forEach((track) => track.stop());
        if (!cancelled) setError(err instanceof Error && err.message.startsWith("Camera preview")
          ? err.message : "Couldn’t open the camera. Use your phone’s camera or choose a photo below.");
      }
    };
    void start();
    return () => {
      cancelled = true;
      mounted.current = false;
      stream?.getTracks().forEach((track) => track.stop());
      if (video.current) video.current.srcObject = null;
    };
  }, []);

  const capture = () => {
    const source = video.current;
    if (!source?.videoWidth || !source.videoHeight || capturing) return;
    setCapturing(true);
    const canvas = document.createElement("canvas");
    // Keep phone camera images comfortably below the upload limit.
    const scale = Math.min(1, 2048 / Math.max(source.videoWidth, source.videoHeight));
    canvas.width = Math.round(source.videoWidth * scale);
    canvas.height = Math.round(source.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) { setCapturing(false); setError("Couldn’t capture a photo. Choose a photo below instead."); return; }
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!mounted.current) return;
      setCapturing(false);
      if (!blob) { setError("Couldn’t capture a photo. Please try again."); return; }
      onPhoto(new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
    }, "image/jpeg", 0.9);
  };

  return (
    <div className="attachment-camera">
      {!error && <>
        <video ref={video} autoPlay muted playsInline aria-label="Camera preview" onLoadedData={() => setReady(true)} />
        {!ready && <p role="status">Opening camera…</p>}
        <button type="button" className="attachment-action" disabled={!ready || capturing} onClick={capture}>
          {capturing ? "Capturing…" : "Take photo"}
        </button>
      </>}
      {error && <p role="status">{error}</p>}
      <button type="button" className="attachment-action" onClick={onFallback}>Use phone camera</button>
    </div>
  );
}

export default function AttachmentPicker({ disabled, onFiles }: { disabled: boolean; onFiles: (files: File[]) => void }) {
  const [open, setOpen] = useState(false);
  const [camera, setCamera] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const nativeCamera = useRef<HTMLInputElement>(null);
  const title = useId();
  const close = () => { setOpen(false); setCamera(false); };

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); trigger.current?.focus(); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onVisibility = () => { if (document.hidden) setCamera(false); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [open]);

  const pick = (input: HTMLInputElement | null) => {
    // Close the modal synchronously so it cannot make the file input inert.
    dialog.current?.close();
    close();
    input?.click();
  };
  const selected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selectedFiles.length) onFiles(selectedFiles);
  };

  return <>
    <input ref={photos} type="file" accept="image/*" multiple hidden onChange={selected} aria-label="Choose photos" />
    <input ref={files} type="file" accept={ACCEPT} multiple hidden onChange={selected} aria-label="Choose files" />
    <input ref={nativeCamera} type="file" accept="image/*" capture="environment" hidden onChange={selected} aria-label="Take photo with phone camera" />
    <button ref={trigger} type="button" onClick={() => setOpen(true)} disabled={disabled}
      aria-label="Attach files" aria-haspopup="dialog" aria-expanded={open}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-zinc-500 transition-colors duration-300 hover:bg-white/[0.06] hover:text-zinc-200 disabled:animate-pulse-dot disabled:opacity-50">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      </svg>
    </button>
    {open && <dialog ref={dialog} className="model-sheet attachment-sheet" aria-labelledby={title} onCancel={close}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
      }}>
      <div className="model-sheet-heading">
        <h2 id={title}>Add attachment</h2>
        <button type="button" aria-label="Close attachments" onClick={close}><span className="ui-text-icon" aria-hidden="true">×</span></button>
      </div>
      {camera ? <CameraPreview onPhoto={(file) => { close(); onFiles([file]); }} onFallback={() => pick(nativeCamera.current)} />
        : <button type="button" className="attachment-action" onClick={() => setCamera(true)}>Camera</button>}
      <button type="button" className="attachment-action" onClick={() => pick(photos.current)}>Photo library</button>
      <button type="button" className="attachment-action" onClick={() => pick(files.current)}>Files</button>
    </dialog>}
  </>;
}
