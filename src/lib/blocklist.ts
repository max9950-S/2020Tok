const STORAGE_KEY = 'covidtok:blocked-videos';

/**
 * Runtime blocks are session-scoped on purpose: a TikTok outage should not
 * permanently shrink the catalog, since the offline oEmbed gate owns durable state.
 */
export function readRuntimeBlocklist(): string[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

export function addToRuntimeBlocklist(id: string): void {
  try {
    const current = readRuntimeBlocklist();
    if (current.includes(id)) return;
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...current, id]));
  } catch {
    // Storage is best-effort; the in-memory set still holds for this session.
  }
}
