import type { CatalogVideo } from '../lib/tiktok';

interface VideoCardProps {
  video: CatalogVideo;
}

export function VideoCard({ video }: VideoCardProps) {
  return (
    <article
      data-video-slide
      data-video-id={video.id}
      className="feed-slide w-full bg-black"
    >
      <div className="feed-slide-content">
        <div className="video-stack">
          <div className="video-player-block relative">
            <div className="player-slot video-embed-column relative h-full min-h-0 w-full" />
          </div>
        </div>
      </div>
    </article>
  );
}
