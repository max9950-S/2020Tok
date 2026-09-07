import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { useFeedLayout } from '../hooks/useFeedLayout';
import type { CatalogVideo, FeedSlide } from '../lib/tiktok';
import { StartGate } from './StartGate';
import { TikTokEmbed } from './TikTokEmbed';
import { VideoCard } from './VideoCard';

interface VideoFeedProps {
  catalog: CatalogVideo[];
  onActivated: () => void;
  onVideoUnavailable: (videoId: string) => void;
  feedRef: RefObject<HTMLDivElement | null>;
}

function toSlide(video: CatalogVideo, seq: number): FeedSlide {
  return {
    ...video,
    slideKey: `${video.id}#${seq}`,
  };
}

function pickRandom(catalog: CatalogVideo[], history: FeedSlide[], seq: number): FeedSlide | null {
  if (catalog.length === 0) return null;
  const recent = new Set(history.slice(-12).map((entry) => entry.id));
  const pool = catalog.filter((video) => !recent.has(video.id));
  const source = pool.length > 0 ? pool : catalog;
  const video = source[Math.floor(Math.random() * source.length)];
  return toSlide(video, seq);
}

export function VideoFeed({
  catalog,
  onActivated,
  onVideoUnavailable,
  feedRef,
}: VideoFeedProps) {
  const seqRef = useRef(1);
  const [history, setHistory] = useState<FeedSlide[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [gated, setGated] = useState(true);
  const [pending, setPending] = useState<FeedSlide | null>(null);
  const [current, setCurrent] = useState<FeedSlide | null>(null);

  const historyRef = useRef(history);
  const historyIndexRef = useRef(historyIndex);
  const gatedRef = useRef(gated);
  const pendingRef = useRef(pending);
  const currentRef = useRef(current);
  const catalogRef = useRef(catalog);
  const onActivatedRef = useRef(onActivated);
  const activePlaybackRef = useRef<{ toggle: () => void } | null>(null);
  const advancingRef = useRef(false);

  historyRef.current = history;
  historyIndexRef.current = historyIndex;
  gatedRef.current = gated;
  pendingRef.current = pending;
  currentRef.current = current;
  catalogRef.current = catalog;
  onActivatedRef.current = onActivated;

  const atHistoryEnd = !gated && history.length > 0 && historyIndex === history.length - 1;

  useFeedLayout(feedRef, catalog.length > 0);

  const registerActivePlayback = useCallback((controls: { toggle: () => void } | null) => {
    activePlaybackRef.current = controls;
  }, []);

  const unregisterActivePlayback = useCallback((controls: { toggle: () => void }) => {
    if (activePlaybackRef.current === controls) activePlaybackRef.current = null;
  }, []);

  const nextSeq = useCallback(() => {
    const value = seqRef.current;
    seqRef.current += 1;
    return value;
  }, []);

  const killCurrentEmbed = useCallback(() => {
    const frame = feedRef.current?.querySelector('.player-host.is-current iframe');
    if (frame instanceof HTMLIFrameElement) {
      frame.src = 'about:blank';
    }
    flushSync(() => {
      setCurrent(null);
    });
  }, [feedRef]);

  const showSlide = useCallback((slide: FeedSlide) => {
    currentRef.current = slide;
    flushSync(() => {
      setCurrent(slide);
    });
  }, []);

  useEffect(() => {
    if (pending) return;
    const first = pickRandom(catalog, [], nextSeq());
    if (!first) return;
    pendingRef.current = first;
    setPending(first);
    setCurrent(first);
  }, [catalog, nextSeq, pending]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (gatedRef.current) return;
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
    const stage = feedRef.current;
    if (!stage) return;
    const blockWheel = (event: WheelEvent) => {
      event.preventDefault();
    };
    const blockTouch = (event: TouchEvent) => {
      if ((event.target as HTMLElement | null)?.closest('.feed-nav-btn')) return;
      event.preventDefault();
    };
    stage.addEventListener('wheel', blockWheel, { passive: false });
    stage.addEventListener('touchmove', blockTouch, { passive: false });
    return () => {
      stage.removeEventListener('wheel', blockWheel);
      stage.removeEventListener('touchmove', blockTouch);
    };
  }, [feedRef]);

  const startWatching = useCallback(() => {
    if (!gatedRef.current) return;
    const live = pendingRef.current;
    if (!live) return;
    onActivatedRef.current();
    gatedRef.current = false;
    setGated(false);
    const nextHistory = [...historyRef.current, live];
    historyRef.current = nextHistory;
    historyIndexRef.current = nextHistory.length - 1;
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
    const following = pickRandom(catalogRef.current, nextHistory, nextSeq());
    pendingRef.current = following;
    setPending(following);
  }, [nextSeq]);

  const goNew = useCallback(() => {
    if (gatedRef.current) return;
    if (advancingRef.current) return;
    const list = historyRef.current;
    if (list.length === 0 || historyIndexRef.current !== list.length - 1) return;
    const live = pendingRef.current;
    if (!live) return;

    advancingRef.current = true;
    killCurrentEmbed();

    const nextHistory = [...list, live];
    historyRef.current = nextHistory;
    historyIndexRef.current = nextHistory.length - 1;
    const following = pickRandom(catalogRef.current, nextHistory, nextSeq());
    pendingRef.current = following;
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
    setPending(following);
    showSlide(live);
    advancingRef.current = false;
  }, [killCurrentEmbed, nextSeq, showSlide]);

  const goDown = useCallback(() => {
    if (gatedRef.current) return;
    if (advancingRef.current) return;
    const list = historyRef.current;
    const from = historyIndexRef.current;
    if (from >= list.length - 1) return;
    const next = list[from + 1];
    if (!next) return;

    advancingRef.current = true;
    killCurrentEmbed();
    historyIndexRef.current = from + 1;
    setHistoryIndex(from + 1);
    showSlide(next);
    advancingRef.current = false;
  }, [killCurrentEmbed, showSlide]);

  const goUp = useCallback(() => {
    if (gatedRef.current) return;
    if (advancingRef.current) return;
    const list = historyRef.current;
    const from = historyIndexRef.current;
    if (from <= 0) return;
    const prev = list[from - 1];
    if (!prev) return;

    advancingRef.current = true;
    killCurrentEmbed();
    historyIndexRef.current = from - 1;
    setHistoryIndex(from - 1);
    showSlide(prev);
    advancingRef.current = false;
  }, [killCurrentEmbed, showSlide]);

  useLayoutEffect(() => {
    if (!gated) return;
    const stage = feedRef.current;
    if (!stage) return;
    const host = stage.querySelector('.player-host.is-current') as HTMLElement | null;
    const button = stage.parentElement?.querySelector('.start-gate-button') as HTMLElement | null;
    if (!host || !button) return;

    const sync = () => {
      const box = button.getBoundingClientRect();
      const frame = stage.getBoundingClientRect();
      stage.style.setProperty('--start-hit-top', `${box.top - frame.top}px`);
      stage.style.setProperty('--start-hit-left', `${box.left - frame.left}px`);
      stage.style.setProperty('--start-hit-width', `${box.width}px`);
      stage.style.setProperty('--start-hit-height', `${box.height}px`);
      host.classList.add('is-start-hit');
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(button);
    observer.observe(stage);
    window.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('resize', sync);
      host.classList.remove('is-start-hit');
      stage.style.removeProperty('--start-hit-top');
      stage.style.removeProperty('--start-hit-left');
      stage.style.removeProperty('--start-hit-width');
      stage.style.removeProperty('--start-hit-height');
    };
  }, [feedRef, gated, current]);

  useEffect(() => {
    const ids = new Set(catalog.map((video) => video.id));
    setHistory((prev) => {
      const next = prev.filter((slide) => ids.has(slide.id));
      if (next.length === prev.length) return prev;
      historyRef.current = next;
      const i = Math.min(historyIndexRef.current, Math.max(0, next.length - 1));
      historyIndexRef.current = i;
      setHistoryIndex(i);
      return next;
    });
    setPending((prev) => {
      if (!prev || ids.has(prev.id)) return prev;
      const replacement = pickRandom(catalog, historyRef.current, nextSeq());
      pendingRef.current = replacement;
      return replacement;
    });
  }, [catalog, nextSeq]);

  if (catalog.length === 0) return null;

  const hasPrev = !gated && historyIndex > 0;
  const hasHistoryNext = !gated && historyIndex < history.length - 1;
  const canStartNew = atHistoryEnd && Boolean(pending);

  return (
    <>
    <div
      ref={feedRef}
      className={`feed-stage min-h-0 flex-1 overflow-hidden${gated ? ' is-gated' : ''}`}
    >
      <div className="feed-mover">
        {current ? (
          <div className="player-host is-current">
            <VideoCard slide={current}>
              <TikTokEmbed
                key={current.slideKey}
                videoId={current.id}
                videoUrl={current.url}
                role="active"
                gated={gated}
                awaitGesture={gated}
                registerActivePlayback={!gated ? registerActivePlayback : undefined}
                unregisterActivePlayback={!gated ? unregisterActivePlayback : undefined}
                onNativePlay={gated ? startWatching : undefined}
                onUnavailable={onVideoUnavailable}
              />
            </VideoCard>
          </div>
        ) : (
          <div className="player-host is-current" hidden />
        )}
      </div>

      <div className="feed-nav">
        <div className="feed-nav-history">
          <button
            type="button"
            className="feed-nav-btn feed-nav-btn--up"
            aria-label="Previous watched video"
            disabled={!hasPrev}
            onClick={goUp}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 14.5 12 8.5l6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className="feed-nav-btn feed-nav-btn--down"
            aria-label="Next watched video"
            disabled={!hasHistoryNext}
            onClick={goDown}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9.5 12 15.5l6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          className="feed-nav-btn feed-nav-btn--new"
          aria-label="Start a new random video"
          disabled={!canStartNew}
          onClick={goNew}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
    {gated && <StartGate />}
    </>
  );
}
