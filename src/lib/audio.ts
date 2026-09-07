const INTENT_KEY = 'covidtok:sound-intent';
const GESTURE_GRACE_MS = 600;

// A touch scroll is pointerdown -> moves -> pointerup/touchend, and both ends of that
// sequence grant transient activation even though `scroll` and `wheel` do not. The
// window is ~5s, so a video that becomes active right after a flick can still take
// sound off that flick.
const GESTURE_ACTIVATION_MS = 4000;

/**
 * Browsers reject unmuted playback until the document has been activated by a real
 * gesture, and activation does not cross into a cross-origin iframe. So the sound
 * preference is remembered across reloads, but a fresh gesture is still required in
 * every new document before we attempt to unmute anything.
 */
let wantsSound = readIntent();
let gestureSeen = false;
let enabledAt = 0;
let lastGestureAt = 0;

const listeners = new Set<() => void>();
const gestureConsumers = new Set<() => void>();

function readIntent(): boolean {
  try {
    return window.sessionStorage.getItem(INTENT_KEY) === '1';
  } catch {
    return false;
  }
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function isSoundEnabled(): boolean {
  return wantsSound && gestureSeen;
}

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function enableSound(): void {
  if (wantsSound && gestureSeen) return;
  wantsSound = true;
  gestureSeen = true;
  enabledAt = Date.now();
  try {
    window.sessionStorage.setItem(INTENT_KEY, '1');
  } catch {
    // Private-mode storage failures are not worth surfacing.
  }
  notify();
}

/** True right after the gesture that enabled sound, so that tap does not also pause. */
export function didJustEnableSound(withinMs = GESTURE_GRACE_MS): boolean {
  return enabledAt > 0 && Date.now() - enabledAt < withinMs;
}

/** True while the browser should still honour sound off the most recent gesture. */
export function hasFreshGesture(withinMs = GESTURE_ACTIVATION_MS): boolean {
  return lastGestureAt > 0 && Date.now() - lastGestureAt < withinMs;
}

/**
 * Consumers run synchronously inside the trusted event's own task, which is the only
 * place a player command still carries the gesture with it.
 */
export function registerGestureConsumer(consume: () => void): () => void {
  gestureConsumers.add(consume);
  return () => {
    gestureConsumers.delete(consume);
  };
}

export function installSoundUnlockListener(): () => void {
  const handle = () => {
    lastGestureAt = Date.now();
    enableSound();
    gestureConsumers.forEach((consume) => consume());
  };
  const options = { capture: true, passive: true } as const;
  const events = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const;
  events.forEach((name) => document.addEventListener(name, handle, options));
  return () => {
    events.forEach((name) => document.removeEventListener(name, handle, options));
  };
}
