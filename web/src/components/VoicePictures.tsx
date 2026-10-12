import ControlIcon from "./ControlIcon";
import type { VoicePicture } from '../hooks/useVoicePictures';

export default function VoicePictures({ items, disabled, onRemove }: {
  items: VoicePicture[]; disabled: boolean; onRemove: (keys: string[]) => void;
}) {
  return <div className="voice-picture-tray" data-open={items.length > 0} aria-label="Selected pictures">
    <div className="voice-picture-tray-inner">
      <div className="voice-picture-list">
        {items.map(picture => {
          return <div className="voice-picture-preview" key={picture.key}>
            <div className="voice-picture-tile">
              <img src={picture.url} alt={picture.name} />
              {picture.uploading && <span className="voice-picture-upload" role="status" aria-label={`Uploading ${picture.name}`} />}
              <button type="button" aria-label={`Remove ${picture.name}`} disabled={disabled} onClick={() => onRemove([picture.key])}><ControlIcon name="close" /></button>
            </div>
          </div>;
        })}
      </div>
    </div>
  </div>;
}
