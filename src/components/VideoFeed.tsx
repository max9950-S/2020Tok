import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useDragScroll } from '../hooks/useDragScroll';
import { useFeedLayout } from '../hooks/useFeedLayout';
import { useSnapScroll } from '../hooks/useSnapScroll';
import type { CatalogVideo } from '../lib/tiktok';
import { TikTokEmbed } from './TikTokEmbed';
import { VideoCard } from './VideoCard';

interface VideoFeedProps {
  videos: CatalogVideo[];
  onNearEnd: () => void;
  feedRef: RefObject<HTMLDivElement | null>;
}

function PlayerPortal({
  slot,
  video,
  isActive,
  activationEpoch,
  registerActivePlayback,
}: {
  slot: Element;
  video: CatalogVideo;
  isActive: boolean;
  activationEpoch: number;
  registerActivePlayback: (controls: { toggle: () => void } | null) => void;
}) {
  return createPortal(
    <TikTokEmbed
      videoId={video.id}
      videoUrl={video.url}
      isActive={isActive}
      activationEpoch={activationEpoch}
      registerActivePlayback={registerActivePlayback}
    />,
    slot,
  );
}

export function VideoFeed({ videos, onNearEnd, feedRef }: VideoFeedProps) {
  const [activeVideoId, setActiveVideoId] = useState<string | null>(videos[0]?.id ?? null);
  const [activationEpoch, setActivationEpoch] = useState(0);
  const [slots, setSlots] = useState<Record<string, Element>>({});
  const lastActiveIdRef = useRef<string | null>(videos[0]?.id ?? null);
  const ratiosRef = useRef<Map<string, number>>(new Map());
  const activePlaybackRef = useRef<{ toggle: () => void } | null>(null);

  const registerActivePlayback = useCallback((controls: { toggle: () => void } | null) => {
    activePlaybackRef.current = controls;
  }, []);

  const activateSlide = useCallback((slideIndex: number) => {
    const video = videos[slideIndex];
    if (!video) return;

    if (lastActiveIdRef.current !== video.id) {
      lastActiveIdRef.current = video.id;
      setActiveVideoId(video.id);
      setActivationEpoch((epoch) => epoch + 1);
    }

    if (slideIndex >= videos.length - 3) onNearEnd();
  }, [onNearEnd, videos]);

  const handleSnap = useCallback((slideIndex: number) => {
    activateSlide(slideIndex);
  }, [activateSlide]);

  useDragScroll(feedRef, videos.length > 0);
  useSnapScroll(feedRef, videos.length > 0, handleSnap);
  useFeedLayout(feedRef, videos.length > 0);

  useLayoutEffect(() => {
    const root = feedRef.current;
    if (!root) return;
    const next: Record<string, Element> = {};
    root.querySelectorAll('[data-video-slide]').forEach((slide) => {
      const id = slide.getAttribute('data-video-id');
      const slot = slide.querySelector('.player-slot');
      if (id && slot) next[id] = slot;
    });
    setSlots(next);
  }, [feedRef, videos]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      const target = event.target;
      if (
        target instanceof HTMLElement
        && target.closest('input, textarea, select, button, a, [contenteditable="true"]')
      ) {
        return;
      }
      if (!activePlaybackRef.current) return;
      event.preventDefault();
      activePlaybackRef.current.toggle();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  useEffect(() => {
    const container = feedRef.current;
    if (!container || videos.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute('data-video-id');
          if (!id) continue;
          ratiosRef.current.set(id, entry.intersectionRatio);
        }
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const [id, ratio] of ratiosRef.current.entries()) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        if (bestId && bestRatio >= 0.55 && lastActiveIdRef.current !== bestId) {
          lastActiveIdRef.current = bestId;
          setActiveVideoId(bestId);
          setActivationEpoch((epoch) => epoch + 1);
          const index = videos.findIndex((video) => video.id === bestId);
          if (index >= videos.length - 3) onNearEnd();
        }
      },
      { root: container, threshold: [0, 0.25, 0.55, 0.75, 1] },
    );

    container.querySelectorAll('[data-video-slide]').forEach((slide) => observer.observe(slide));
    return () => {
      observer.disconnect();
      ratiosRef.current.clear();
    };
  }, [feedRef, onNearEnd, videos]);

  useEffect(() => {
    if (videos.length === 0) {
      setActiveVideoId(null);
      lastActiveIdRef.current = null;
      return;
    }

    setActiveVideoId((current) => {
      if (current && videos.some((video) => video.id === current)) return current;
      const nextId = videos[0]?.id ?? null;
      lastActiveIdRef.current = nextId;
      setActivationEpoch((epoch) => epoch + 1);
      return nextId;
    });
  }, [videos]);

  const activeIndex = videos.findIndex((video) => video.id === activeVideoId);
  const mountedVideos = [videos[activeIndex], videos[activeIndex + 1]].filter(
    (video): video is CatalogVideo => Boolean(video),
  );

  if (videos.length === 0) return null;

  return (
    <div ref={feedRef} className="feed-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} />
      ))}
      {mountedVideos.map((video) => {
        const slot = slots[video.id];
        if (!slot) return null;
        return (
          <PlayerPortal
            key={video.id}
            slot={slot}
            video={video}
            isActive={video.id === activeVideoId}
            activationEpoch={activationEpoch}
            registerActivePlayback={registerActivePlayback}
          />
        );
      })}
    </div>
  );
}
