import { useEffect, useRef, useState } from 'react';
import { uploadFile } from '../lib/chatApi';

export type VoicePicture = { key: string; id?: string; name: string; url: string; uploading: boolean };

export function useVoicePictures() {
  const [items, setItems] = useState<VoicePicture[]>([]);
  const [error, setError] = useState('');
  const current = useRef<VoicePicture[]>([]);
  const mounted = useRef(true);
  const urls = useRef(new Set<string>());
  const update = (next: VoicePicture[]) => { current.current = next; setItems(next); };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; urls.current.forEach(URL.revokeObjectURL); urls.current.clear(); };
  }, []);

  const remove = (keys: string[]) => {
    const removed = current.current.filter(item => keys.includes(item.key));
    update(current.current.filter(item => !keys.includes(item.key)));
    // Keep object URLs alive through the thumbnail's exit animation.
    window.setTimeout(() => removed.forEach(item => {
      URL.revokeObjectURL(item.url); urls.current.delete(item.url);
    }), 350);
  };

  const add = (files: File[]) => {
    setError('');
    for (const file of files) {
      if (current.current.length >= 4) { setError('Choose up to four pictures.'); break; }
      if (!/\.(png|jpe?g|webp|gif)$/i.test(file.name)) { setError('Choose a PNG, JPEG, WebP, or GIF picture.'); continue; }
      if (file.size > 10 * 1024 * 1024) { setError('Pictures must be 10 MB or smaller.'); continue; }
      const item = { key: crypto.randomUUID(), name: file.name, url: URL.createObjectURL(file), uploading: true };
      urls.current.add(item.url);
      update([...current.current, item]);
      void uploadFile(file).then(result => {
        if (!mounted.current || !current.current.some(p => p.key === item.key)) return;
        if (result.kind !== 'image' || typeof result.id !== 'string') throw new Error('Couldn’t upload this picture.');
        update(current.current.map(p => p.key === item.key ? { ...p, id: result.id, uploading: false } : p));
      }).catch(() => {
        if (!mounted.current || !current.current.some(p => p.key === item.key)) return;
        remove([item.key]);
        setError('Couldn’t upload the picture. Please try again.');
      });
    }
  };

  return { items, current, error, add, remove, uploading: items.some(item => item.uploading) };
}
