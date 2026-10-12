import { API_BASE } from './config';
import type { VoiceSource } from './voiceSearch';

export function linkThumbnailUrl(url: string, source?: VoiceSource) {
  const params = new URLSearchParams({url});
  if (source?.url.split('#')[0] === url.split('#')[0]) {
    if (source.thumbnail) params.set('image', source.thumbnail);
    if (source.blocked) params.set('pageBlocked', 'true');
  }
  return `${API_BASE}/api/chat/link-thumbnail?${params}`;
}
