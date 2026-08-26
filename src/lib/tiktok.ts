export interface CatalogVideo {
  id: string;
  url: string;
}

export interface EmbedOptions {
  autoplay?: boolean;
  muted?: boolean;
}

const VIDEO_ID_RE = /(?:tiktok\.com\/@[^/]+\/video\/|tiktok\.com\/(?:t\/)?video\/|\/video\/)(\d{15,})/;
const BARE_ID_RE = /^\d{15,}$/;

const YEAR_2020_START = Date.UTC(2020, 0, 1) / 1000;
const YEAR_2021_START = Date.UTC(2021, 0, 1) / 1000;

export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (BARE_ID_RE.test(trimmed)) return trimmed;
  const match = trimmed.match(VIDEO_ID_RE) ?? trimmed.match(/tiktok\.com\/.*\/video\/(\d+)/);
  return match?.[1] ?? null;
}

export function tiktokCreatedUnix(id: string): number | null {
  if (!BARE_ID_RE.test(id)) return null;
  try {
    const seconds = Number(BigInt(id) >> 32n);
    if (!Number.isFinite(seconds) || seconds < 1_200_000_000) return null;
    return seconds;
  } catch {
    return null;
  }
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export interface VideoDateParts {
  year: number;
  month: string;
  day: number;
}

export function getVideoDateParts(id: string): VideoDateParts | null {
  const seconds = tiktokCreatedUnix(id);
  if (seconds == null) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: date.getUTCFullYear(),
    month: MONTHS[date.getUTCMonth()],
    day: date.getUTCDate(),
  };
}

export function isTikTokIdFrom2020(id: string): boolean {
  const seconds = tiktokCreatedUnix(id);
  return seconds != null && seconds >= YEAR_2020_START && seconds < YEAR_2021_START;
}

export function videoUrlFromId(id: string, author?: string): string {
  const handle = author?.replace(/^@/, '') || '_';
  return `https://www.tiktok.com/@${handle}/video/${id}`;
}

export function buildEmbedUrl(videoId: string, options: EmbedOptions = {}): string {
  const { autoplay = true, muted = true } = options;
  const params = new URLSearchParams({
    autoplay: autoplay ? '1' : '0',
    muted: muted ? '1' : '0',
    loop: '1',
    description: '0',
    music_info: '0',
    rel: '0',
    controls: '0',
    progress_bar: '0',
    play_button: '0',
    volume_control: '0',
    fullscreen_button: '0',
    timestamp: '0',
    native_context_menu: '0',
  });
  return `https://www.tiktok.com/player/v1/${videoId}?${params.toString()}`;
}

export interface TikTokPlayerMessage {
  type: string;
  value?: unknown;
  'x-tiktok-player'?: boolean;
}

export function sendPlayerCommand(
  iframe: HTMLIFrameElement | null,
  type: string,
  value?: number,
): void {
  iframe?.contentWindow?.postMessage(
    { type, value, 'x-tiktok-player': true },
    '*',
  );
}

export function attemptUnmute(iframe: HTMLIFrameElement | null): void {
  sendPlayerCommand(iframe, 'unMute');
  sendPlayerCommand(iframe, 'changeVolume', 100);
}

export function playPlayer(iframe: HTMLIFrameElement | null): void {
  sendPlayerCommand(iframe, 'play');
}

export function pausePlayer(iframe: HTMLIFrameElement | null): void {
  sendPlayerCommand(iframe, 'pause');
}

export function mutePlayer(iframe: HTMLIFrameElement | null): void {
  sendPlayerCommand(iframe, 'mute');
  sendPlayerCommand(iframe, 'changeVolume', 0);
}

export function silencePlayer(iframe: HTMLIFrameElement | null): void {
  pausePlayer(iframe);
  mutePlayer(iframe);
}

export function silenceAllTikTokPlayers(): void {
  document.querySelectorAll<HTMLIFrameElement>('iframe[src*="tiktok.com"]').forEach((iframe) => {
    silencePlayer(iframe);
    iframe.src = 'about:blank';
  });
}

export function parsePlayerMessage(data: unknown): TikTokPlayerMessage | null {
  if (!data || typeof data !== 'object') return null;
  const message = data as TikTokPlayerMessage;
  if (!message['x-tiktok-player']) return null;
  return message;
}

export function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
