import { useEffect, type RefObject } from 'react';
import { measureFeedHeight } from '../lib/layout';

export function useFeedLayout(
  feedRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    const container = feedRef.current;
    if (!container || !enabled) return;

    const applyLayout = () => {
      const height = measureFeedHeight(container);
      if (height < 120) return;
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      document.documentElement.style.setProperty('--feed-height', `${height}px`);
      document.documentElement.style.setProperty('--viewport-width', `${viewportWidth}px`);
    };

    applyLayout();
    const observer = new ResizeObserver(applyLayout);
    observer.observe(container);
    window.addEventListener('resize', applyLayout);
    window.visualViewport?.addEventListener('resize', applyLayout);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', applyLayout);
      window.visualViewport?.removeEventListener('resize', applyLayout);
    };
  }, [enabled, feedRef]);
}
