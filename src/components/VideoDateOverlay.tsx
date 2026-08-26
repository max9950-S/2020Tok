import type { VideoDateParts } from '../lib/tiktok';

export function VideoDateOverlay({ date }: { date: VideoDateParts }) {
  return (
    <div className="pointer-events-none absolute bottom-2 left-2.5 z-[46] flex flex-wrap gap-0.5">
      <span className="rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium backdrop-blur-sm">
        {date.year}
      </span>
      <span className="rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium backdrop-blur-sm">
        {date.month}
      </span>
      <span className="rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium backdrop-blur-sm">
        {date.day}
      </span>
    </div>
  );
}
