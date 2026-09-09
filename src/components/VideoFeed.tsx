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

type Hit = 'current' | 'up' | 'down' | 'new';

interface Slot {
  id: number;
  hit: Hit;
  slide: FeedSlide | null;
}

const SLOT_IDS = [0, 1, 2, 3] as const;

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

function desiredSlides(
  gated: boolean,
  history: FeedSlide[],
  index: number,
  pending: FeedSlide | null,
): Record<Hit, FeedSlide | null> {
  if (gated) {
    return { current: pending, up: null, down: null, new: null };
  }
  return {
    current: history[index] ?? pending,
    up: history[index - 1] ?? null,
    down: index < history.length - 1 ? history[index + 1] ?? null : null,
    new: index === history.length - 1 ? pending : null,
  };
}

function assignSlots(prev: Slot[], desired: Record<Hit, FeedSlide | null>): Slot[] {
  const next: Slot[] = prev.map((slot) => ({ ...slot, slide: null }));
  const taken = new Set<number>();

  const place = (hit: Hit, slide: FeedSlide | null) => {
    if (!slide) return;
    const keep = next.find((slot) => (
      !taken.has(slot.id)
      && prev.find((entry) => entry.id === slot.id)?.slide?.slideKey === slide.slideKey
    ));
    const slot = keep && !taken.has(keep.id)
      ? keep
      : next.find((entry) => !taken.has(entry.id));
    if (!slot) return;
    slot.hit = hit;
    slot.slide = slide;
    taken.add(slot.id);
  };

  place('current', desired.current);
  place('up', desired.up);
  place('down', desired.down);
  place('new', desired.new);

  const usedHits = new Set(
    next.filter((slot) => taken.has(slot.id)).map((slot) => slot.hit),
  );
  const leftoverHits: Hit[] = (['current', 'up', 'down', 'new'] as const)
    .filter((hit) => !usedHits.has(hit));
  let leftoverIndex = 0;
  for (const slot of next) {
    if (taken.has(slot.id)) continue;
    slot.slide = null;
    slot.hit = leftoverHits[leftoverIndex] ?? 'down';
    leftoverIndex += 1;
  }
  return next;
}

function sameLayout(prev: Slot[], next: Slot[]): boolean {
  return prev.every((slot, index) => (
    slot.hit === next[index].hit
    && slot.slide?.slideKey === next[index].slide?.slideKey
  ));
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
  const [slots, setSlots] = useState<Slot[]>(() => [
    { id: 0, hit: 'current', slide: null },
    { id: 1, hit: 'up', slide: null },
    { id: 2, hit: 'down', slide: null },
    { id: 3, hit: 'new', slide: null },
  ]);

  const historyRef = useRef(history);
  const historyIndexRef = useRef(historyIndex);
  const gatedRef = useRef(gated);
  const pendingRef = useRef(pending);
  const slotsRef = useRef(slots);
  const catalogRef = useRef(catalog);
  const onActivatedRef = useRef(onActivated);
  const activePlaybackRef = useRef<{ toggle: () => void } | null>(null);
  const advancingRef = useRef(false);
  const hidingRef = useRef(false);
  const lastHitRef = useRef<'up' | 'down' | 'new' | null>(null);
  const promoteTimerRef = useRef<number | null>(null);
  const playLockUntilRef = useRef(0);
  const takeHitRef = useRef<(which: 'up' | 'down' | 'new') => void>(() => {});

  historyRef.current = history;
  historyIndexRef.current = historyIndex;
  gatedRef.current = gated;
  pendingRef.current = pending;
  slotsRef.current = slots;
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

  const applyDesired = useCallback((
    nextHistory: FeedSlide[],
    nextIndex: number,
    nextPending: FeedSlide | null,
    nextGated: boolean,
  ) => {
    const desired = desiredSlides(nextGated, nextHistory, nextIndex, nextPending);
    setSlots((prev) => {
      const next = assignSlots(prev, desired);
      return sameLayout(prev, next) ? prev : next;
    });
  }, []);

  const blankCurrentIframe = useCallback(() => {
    const frame = feedRef.current?.querySelector('.player-host.is-current:not(.is-hit) iframe');
    if (frame instanceof HTMLIFrameElement) {
      frame.src = 'about:blank';
    }
  }, [feedRef]);

  useEffect(() => {
    if (pending) return;
    const first = pickRandom(catalog, [], nextSeq());
    if (!first) return;
    pendingRef.current = first;
    setPending(first);
    setSlots([
      { id: 0, hit: 'current', slide: first },
      { id: 1, hit: 'up', slide: null },
      { id: 2, hit: 'down', slide: null },
      { id: 3, hit: 'new', slide: null },
    ]);
  }, [catalog, nextSeq, pending]);

  useEffect(() => {
    if (advancingRef.current || hidingRef.current) return;
    applyDesired(history, historyIndex, pending, gated);
  }, [applyDesired, gated, history, historyIndex, pending]);

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
      if ((event.target as HTMLElement | null)?.closest('.feed-nav-btn, .player-host.is-hit')) return;
      event.preventDefault();
    };
    stage.addEventListener('wheel', blockWheel, { passive: false });
    stage.addEventListener('touchmove', blockTouch, { passive: false });
    return () => {
      stage.removeEventListener('wheel', blockWheel);
      stage.removeEventListener('touchmove', blockTouch);
    };
  }, [feedRef]);

  const recoverLayout = useCallback(() => {
    hidingRef.current = false;
    advancingRef.current = false;
    lastHitRef.current = null;
    if (promoteTimerRef.current !== null) {
      window.clearTimeout(promoteTimerRef.current);
      promoteTimerRef.current = null;
    }
    applyDesired(historyRef.current, historyIndexRef.current, pendingRef.current, gatedRef.current);
  }, [applyDesired]);

  const hideCurrent = useCallback((which: 'up' | 'down' | 'new') => {
    if (gatedRef.current) return;
    if (advancingRef.current) return;
    if (which === 'new' && performance.now() < playLockUntilRef.current) return;
    lastHitRef.current = which;
    if (hidingRef.current) return;
    const current = slotsRef.current.find((slot) => slot.hit === 'current' && slot.slide);
    if (!current?.slide) return;

    hidingRef.current = true;
    blankCurrentIframe();
    flushSync(() => {
      setSlots((prev) => prev.map((slot) => (
        slot.hit === 'current' && slot.slide ? { ...slot, slide: null } : slot
      )));
    });
    if (promoteTimerRef.current !== null) window.clearTimeout(promoteTimerRef.current);
    promoteTimerRef.current = window.setTimeout(() => {
      promoteTimerRef.current = null;
      if (!hidingRef.current) return;
      const hit = lastHitRef.current;
      if (hit) takeHitRef.current(hit);
      if (hidingRef.current) recoverLayout();
    }, 350);
  }, [blankCurrentIframe, recoverLayout]);

  const takeHistory = useCallback((direction: 'up' | 'down') => {
    if (gatedRef.current) {
      recoverLayout();
      return;
    }
    if (advancingRef.current) return;

    const list = historyRef.current;
    const from = historyIndexRef.current;
    const nextIndex = direction === 'up' ? from - 1 : from + 1;
    if (nextIndex < 0 || nextIndex >= list.length) {
      recoverLayout();
      return;
    }

    advancingRef.current = true;
    if (promoteTimerRef.current !== null) {
      window.clearTimeout(promoteTimerRef.current);
      promoteTimerRef.current = null;
    }
    blankCurrentIframe();

    historyIndexRef.current = nextIndex;
    hidingRef.current = false;
    const desired = desiredSlides(false, list, nextIndex, pendingRef.current);
    flushSync(() => {
      setHistoryIndex(nextIndex);
      setSlots((prev) => {
        const withoutCurrent = prev.map((slot) => (
          slot.hit === 'current' && slot.slide ? { ...slot, slide: null } : slot
        ));
        return assignSlots(withoutCurrent, desired);
      });
    });
    advancingRef.current = false;
  }, [blankCurrentIframe, recoverLayout]);

  const takeNew = useCallback(() => {
    if (gatedRef.current) return;
    if (advancingRef.current) return;
    if (performance.now() < playLockUntilRef.current) return;

    const live = slotsRef.current.find((slot) => slot.hit === 'new' && slot.slide)?.slide
      ?? pendingRef.current;
    if (!live) {
      hidingRef.current = false;
      recoverLayout();
      return;
    }

    const list = historyRef.current;
    const existing = list.findIndex((entry) => entry.slideKey === live.slideKey);
    if (existing >= 0 && existing === historyIndexRef.current && !hidingRef.current) {
      return;
    }

    playLockUntilRef.current = performance.now() + 500;
    advancingRef.current = true;
    if (promoteTimerRef.current !== null) {
      window.clearTimeout(promoteTimerRef.current);
      promoteTimerRef.current = null;
    }
    blankCurrentIframe();

    const nextHistory = existing >= 0 ? list : [...list, live];
    const nextIndex = existing >= 0 ? existing : nextHistory.length - 1;
    const nextPending = live.slideKey === pendingRef.current?.slideKey
      ? pickRandom(catalogRef.current, nextHistory, nextSeq())
      : pendingRef.current ?? pickRandom(catalogRef.current, nextHistory, nextSeq());

    historyRef.current = nextHistory;
    historyIndexRef.current = nextIndex;
    pendingRef.current = nextPending;
    hidingRef.current = false;

    const desired = desiredSlides(false, nextHistory, nextIndex, nextPending);
    flushSync(() => {
      setHistory(nextHistory);
      setHistoryIndex(nextIndex);
      setPending(nextPending);
      setSlots((prev) => {
        const withoutCurrent = prev.map((slot) => (
          slot.hit === 'current' && slot.slide ? { ...slot, slide: null } : slot
        ));
        return assignSlots(withoutCurrent, desired);
      });
    });
    advancingRef.current = false;
  }, [blankCurrentIframe, nextSeq, recoverLayout]);

  const takeHit = useCallback((which: 'up' | 'down' | 'new') => {
    if (which === 'new') {
      takeNew();
      return;
    }
    takeHistory(which);
  }, [takeHistory, takeNew]);
  takeHitRef.current = takeHit;

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

  useLayoutEffect(() => {
    const stage = feedRef.current;
    if (!stage) return;

    if (gated) {
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
    }

    const pairs: Array<[string, string]> = [
      ['.feed-nav-btn--up', 'up'],
      ['.feed-nav-btn--down', 'down'],
      ['.feed-nav-btn--new', 'new'],
    ];

    const sync = () => {
      const frame = stage.getBoundingClientRect();
      for (const [selector, name] of pairs) {
        const button = stage.querySelector(selector);
        if (!(button instanceof HTMLElement)) continue;
        const box = button.getBoundingClientRect();
        stage.style.setProperty(`--hit-${name}-top`, `${box.top - frame.top}px`);
        stage.style.setProperty(`--hit-${name}-left`, `${box.left - frame.left}px`);
        stage.style.setProperty(`--hit-${name}-width`, `${box.width}px`);
        stage.style.setProperty(`--hit-${name}-height`, `${box.height}px`);
      }
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(stage);
    for (const [selector] of pairs) {
      const button = stage.querySelector(selector);
      if (button instanceof HTMLElement) observer.observe(button);
    }
    window.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('resize', sync);
    };
  }, [feedRef, gated, slots]);

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

  useEffect(() => {
    if (gated || hidingRef.current || advancingRef.current) return;
    const hasCurrent = slots.some((slot) => slot.hit === 'current' && slot.slide);
    if (hasCurrent) return;
    if (history.length === 0 && !pending) return;
    recoverLayout();
  }, [gated, history.length, pending, recoverLayout, slots]);

  useEffect(() => {
    const stage = feedRef.current;
    if (!stage || gated) return;

    const onPointerDown = (event: PointerEvent) => {
      const button = stage.querySelector('.feed-nav-btn--new');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return;
      const box = button.getBoundingClientRect();
      if (
        event.clientX < box.left
        || event.clientX > box.right
        || event.clientY < box.top
        || event.clientY > box.bottom
      ) {
        return;
      }
      hideCurrent('new');
      takeNew();
    };

    stage.addEventListener('pointerdown', onPointerDown, true);
    return () => stage.removeEventListener('pointerdown', onPointerDown, true);
  }, [feedRef, gated, hideCurrent, takeNew]);

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
        {SLOT_IDS.map((id) => {
          const slot = slots[id];
          if (!slot.slide) {
            return (
              <div
                key={slot.id}
                className={`player-host is-${slot.hit}`}
                hidden
              />
            );
          }

          const isHit = slot.hit !== 'current';
          const isCurrent = slot.hit === 'current';

          return (
            <div
              key={slot.id}
              className={`player-host is-${slot.hit}${isHit ? ' is-hit' : ''}`}
            >
              <VideoCard slide={slot.slide}>
                <TikTokEmbed
                  key={slot.slide.slideKey}
                  videoId={slot.slide.id}
                  videoUrl={slot.slide.url}
                  role={isHit ? 'queued' : 'active'}
                  gated={gated || isHit}
                  awaitGesture={gated || isHit}
                  registerActivePlayback={isCurrent && !gated ? registerActivePlayback : undefined}
                  unregisterActivePlayback={isCurrent && !gated ? unregisterActivePlayback : undefined}
                  onGestureStart={
                    isHit && slot.hit === 'new'
                      ? () => {
                          hideCurrent('new');
                          takeNew();
                        }
                      : isHit
                        ? () => hideCurrent(slot.hit as 'up' | 'down' | 'new')
                        : gated && isCurrent
                          ? startWatching
                          : undefined
                  }
                  onNativePlay={
                    isHit
                      ? () => takeHit(slot.hit as 'up' | 'down' | 'new')
                      : gated && isCurrent
                        ? startWatching
                        : undefined
                  }
                  onUnavailable={onVideoUnavailable}
                />
              </VideoCard>
            </div>
          );
        })}
      </div>

      <div className="feed-nav">
        <div className="feed-nav-history">
          <button
            type="button"
            className={`feed-nav-btn feed-nav-btn--up${hasPrev ? ' is-passthrough' : ''}`}
            aria-label="Previous watched video"
            disabled={!hasPrev}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 14.5 12 8.5l6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className={`feed-nav-btn feed-nav-btn--down${hasHistoryNext ? ' is-passthrough' : ''}`}
            aria-label="Next watched video"
            disabled={!hasHistoryNext}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9.5 12 15.5l6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          className={`feed-nav-btn feed-nav-btn--new${canStartNew ? ' is-passthrough' : ''}`}
          aria-label="Start a new random video"
          disabled={!canStartNew}
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
