export function measureFeedHeight(container: HTMLElement): number {
  const measured = container.getBoundingClientRect().height;
  if (measured >= 120) return measured;
  const visual = window.visualViewport?.height ?? 0;
  if (visual >= 120) return visual;
  return window.innerHeight;
}
