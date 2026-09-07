import type { ReactNode } from 'react';
import type { FeedSlide } from '../lib/tiktok';

interface VideoCardProps {
  slide: FeedSlide;
  children?: ReactNode;
}

export function VideoCard({ slide, children }: VideoCardProps) {
  return (
    <article
      data-video-slide
      data-slide-key={slide.slideKey}
      data-video-id={slide.id}
      className="feed-slide w-full bg-black"
    >
      <div className="feed-slide-content">
        <div className="video-stack">
          <div className="video-player-block relative">
            <div className="player-slot video-embed-column relative h-full min-h-0 w-full">
              {children}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
