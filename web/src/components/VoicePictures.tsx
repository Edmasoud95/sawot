import { useEffect, useState } from 'react';
import type { VoicePicture } from '../hooks/useVoicePictures';

export default function VoicePictures({ items, disabled, onRemove }: {
  items: VoicePicture[]; disabled: boolean; onRemove: (keys: string[]) => void;
}) {
  const [displayed, setDisplayed] = useState(items);
  useEffect(() => {
    setDisplayed(previous => [...items, ...previous.filter(p => !items.some(item => item.key === p.key))]);
    const timer = window.setTimeout(() => setDisplayed(items), 300);
    return () => window.clearTimeout(timer);
  }, [items]);
  return <div className="voice-picture-tray" data-open={items.length > 0} aria-label="Selected pictures">
    <div className="voice-picture-tray-inner">
      <div className="voice-picture-list">
        {displayed.map(picture => {
          const leaving = !items.some(p => p.key === picture.key);
          return <div className="voice-picture-preview" key={picture.key} data-leaving={leaving} aria-hidden={leaving} inert={leaving}>
            <div className="voice-picture-tile">
              <img src={picture.url} alt={picture.name} />
              {picture.uploading && <span className="voice-picture-upload" role="status" aria-label={`Uploading ${picture.name}`} />}
              <button type="button" aria-label={`Remove ${picture.name}`} disabled={disabled} onClick={() => onRemove([picture.key])}>×</button>
            </div>
          </div>;
        })}
      </div>
    </div>
  </div>;
}
