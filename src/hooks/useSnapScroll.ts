import { useEffect, type RefObject } from 'react';

const SETTLE_DELAY_MS = 140;
const CORRECTION_THRESHOLD_PX = 2;

/**
 * Desktop-only assist for wheel scrolling. Touch devices are left entirely to CSS
 * scroll-snap, because a JS scrollTo during iOS momentum fights the native snap and
 * delays activation. Activation itself lives in the feed's IntersectionObserver.
 */
export function useSnapScroll(containerRef: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    let settleTimer: number | undefined;

    const correct = () => {
      if (container.classList.contains('is-dragging')) return;
      const slideHeight = container.clientHeight;
      if (slideHeight <= 0) return;
      const targetTop = Math.round(container.scrollTop / slideHeight) * slideHeight;
      if (Math.abs(container.scrollTop - targetTop) <= CORRECTION_THRESHOLD_PX) return;
      container.scrollTo({ top: targetTop, behavior: 'auto' });
    };

    const handleScroll = () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(correct, SETTLE_DELAY_MS);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    container.addEventListener('scrollend', correct);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('scrollend', correct);
      window.clearTimeout(settleTimer);
    };
  }, [containerRef, enabled]);
}
