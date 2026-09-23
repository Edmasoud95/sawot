import { useVoiceStore } from "../store";
import AttachmentPicker from "./chat/AttachmentPicker";
import VoicePictures from "./VoicePictures";
import type { useVoicePictures } from "../hooks/useVoicePictures";

const LABELS = {
  connecting: "Connecting…",
  idle: "Tap to talk",
  starting: "Starting microphone…",
  listening: "Listening",
  recording: "Hearing you…",
  thinking: "Thinking…",
  speaking: "Speaking",
};

const ACTIONS = {
  connecting: "Connecting",
  idle: "Start voice session",
  starting: "Cancel microphone startup",
  listening: "Send speech now",
  recording: "Send speech now",
  thinking: "Interrupt and listen",
  speaking: "Interrupt and listen",
};

export default function PushToTalk({ onTap, onEnd, pictures, onSendPictures }: {
  onTap: () => void; onEnd: () => void; pictures: ReturnType<typeof useVoicePictures>; onSendPictures: () => void;
}) {
  const status = useVoiceStore((s) => s.status);
  const sessionActive = useVoiceStore((s) => s.sessionActive);
  const recording = status === "recording";
  const busy = status === "thinking" || status === "speaking";
  const locked = sessionActive || status !== "idle";
  return (
    <div className="talk-dock" data-status={status}>
      <VoicePictures items={pictures.items} disabled={locked} onRemove={pictures.remove} />
      <p id="voice-session-status" role="status" aria-live="polite" aria-atomic="true" className="talk-status">
        {pictures.error || (pictures.uploading ? "Adding pictures…" : LABELS[status])}
      </p>
      <div className="talk-controls">
        <AttachmentPicker imagesOnly disabled={locked || pictures.items.length >= 4} onFiles={pictures.add} />
        <button
          type="button"
          aria-label={ACTIONS[status]}
          title={ACTIONS[status]}
          aria-describedby="voice-session-status"
          disabled={status === "connecting" || pictures.uploading}
          onClick={onTap}
          className={`talk-button ${recording ? "is-recording" : ""}`}
        >
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {status === "starting" ? <path d="m7 7 10 10M17 7 7 17" />
              : recording ? <path d="M12 19V5m-6 6 6-6 6 6" />
                : busy ? <><path d="M9 5v14M15 5v14" /></>
                  : <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-3 0h6" /></>}
          </svg>
        </button>
        {sessionActive ? (
          <button className="voice-session-end" type="button" aria-label="End voice session" title="End voice session · Escape" onClick={onEnd}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
            <span>End</span>
          </button>
        ) : (
          <button className="voice-picture-send" type="button" aria-label="Send pictures" title="Send pictures"
            data-visible={pictures.items.length > 0} tabIndex={pictures.items.length ? 0 : -1}
            aria-hidden={!pictures.items.length} disabled={locked || pictures.uploading || !pictures.items.length} onClick={onSendPictures}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}
