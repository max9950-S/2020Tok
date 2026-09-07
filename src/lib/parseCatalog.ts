import {
  extractVideoId,
  isTikTokIdFrom2020,
  videoUrlFromId,
  type CatalogVideo,
} from './tiktok';

export function parseVideosTxt(
  text: string,
  blockedIds: ReadonlySet<string> = new Set(),
): CatalogVideo[] {
  const found = new Map<string, CatalogVideo>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const id = extractVideoId(line);
    if (!id || !isTikTokIdFrom2020(id) || found.has(id) || blockedIds.has(id)) continue;

    found.set(id, {
      id,
      url: line.includes('tiktok.com') ? line : videoUrlFromId(id),
    });
  }

  return [...found.values()];
}
