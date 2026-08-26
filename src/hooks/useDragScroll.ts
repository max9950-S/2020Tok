import { useEffect, type RefObject } from 'react';

const DRAG_THRESHOLD_PX = 6;

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('a, button, input, textarea, select, label, [data-playback-toggle]'));
}

export function useDragScroll(containerRef: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (!finePointer.matches) return;

    let pointerId: number | null = null;
    let startY = 0;
    let startScrollTop = 0;
    let dragging = false;
    let suppressClick = false;

    const snapToNearestSlide = () => {
      const slideHeight = container.clientHeight;
      if (slideHeight <= 0) return;
      const index = Math.round(container.scrollTop / slideHeight);
      container.scrollTo({ top: index * slideHeight, behavior: 'auto' });
    };

    const endDrag = () => {
      if (dragging) {
        snapToNearestSlide();
        container.dispatchEvent(new Event('scrollend'));
      }
      dragging = false;
      pointerId = null;
      container.classList.remove('is-dragging');
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || isInteractiveTarget(event.target)) return;
      pointerId = event.pointerId;
      startY = event.clientY;
      startScrollTop = container.scrollTop;
      dragging = false;
      suppressClick = false;
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      const deltaY = event.clientY - startY;
      if (!dragging && Math.abs(deltaY) <= DRAG_THRESHOLD_PX) return;
      if (!dragging) {
        dragging = true;
        suppressClick = true;
        container.classList.add('is-dragging');
        container.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      container.scrollTop = startScrollTop - deltaY;
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      if (container.hasPointerCapture(event.pointerId)) {
        container.releasePointerCapture(event.pointerId);
      }
      endDrag();
    };

    const handleClick = (event: MouseEvent) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick = false;
    };

    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerup', handlePointerUp);
    container.addEventListener('pointercancel', handlePointerUp);
    container.addEventListener('click', handleClick, true);

    return () => {
      container.classList.remove('is-dragging');
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', handlePointerUp);
      container.removeEventListener('pointercancel', handlePointerUp);
      container.removeEventListener('click', handleClick, true);
    };
  }, [containerRef, enabled]);
}
