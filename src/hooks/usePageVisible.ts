import { useSyncExternalStore } from 'react';

function subscribe(listener: () => void): () => void {
  document.addEventListener('visibilitychange', listener);
  window.addEventListener('pagehide', listener);
  window.addEventListener('pageshow', listener);
  return () => {
    document.removeEventListener('visibilitychange', listener);
    window.removeEventListener('pagehide', listener);
    window.removeEventListener('pageshow', listener);
  };
}

function getSnapshot(): boolean {
  return document.visibilityState !== 'hidden';
}

export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
