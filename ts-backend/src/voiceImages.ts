import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type OpenAI from 'openai';

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

/** Only resolve bounded local uploads, never paths or URLs supplied by a client. */
export async function loadVoiceImages(ids: unknown, directory: string): Promise<OpenAI.Chat.Completions.ChatCompletionContentPartImage[]> {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length > 4 || ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{12}$/.test(id))) {
    throw new Error('Choose up to four pictures.');
  }
  if (!ids.length) return [];
  const files = await readdir(directory).catch(() => [] as string[]);
  return Promise.all(ids.map(async id => {
    const file = files.find(file => file.startsWith(id + '.') && TYPES[extname(file)]);
    if (!file) throw new Error('Picture unavailable. Please attach it again.');
    const path = join(directory, file);
    if ((await stat(path)).size > 10 * 1024 * 1024) throw new Error('Pictures must be 10 MB or smaller.');
    const data = await readFile(path);
    const mime = TYPES[extname(file)];
    const valid = mime === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mime === 'image/jpeg' ? data[0] === 255 && data[1] === 216 && data[2] === 255
      : mime === 'image/gif' ? /^GIF8[79]a$/.test(data.subarray(0, 6).toString())
      : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP';
    if (!valid) throw new Error('Use a PNG, JPEG, WebP, or GIF picture.');
    return { type: 'image_url', image_url: { url: `data:${mime};base64,${data.toString('base64')}` } };
  }));
}
