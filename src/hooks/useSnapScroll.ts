import { useEffect, type RefObject } from 'react';

function snapToNearestSlide(container: HTMLElement): number {
  const slideHeight = container.clientHeight;
  if (slideHeight <= 0) return 0;
  const index = Math.round(container.scrollTop / slideHeight);
  const targetTop = index * slideHeight;
  if (Math.abs(container.scrollTop - targetTop) > 1) {
    container.scrollTo({ top: targetTop, behavior: 'auto' });
  }
  return index;
}

export function useSnapScroll(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  onSnap?: (slideIndex: number) => void,
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const handleSnap = () => {
      onSnap?.(snapToNearestSlide(container));
    };

    container.addEventListener('scrollend', handleSnap);
    let scrollTimer: number | undefined;
    const handleScroll = () => {
      if (container.classList.contains('is-dragging')) return;
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(handleSnap, 120);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scrollend', handleSnap);
      container.removeEventListener('scroll', handleScroll);
      window.clearTimeout(scrollTimer);
    };
  }, [containerRef, enabled, onSnap]);
}
