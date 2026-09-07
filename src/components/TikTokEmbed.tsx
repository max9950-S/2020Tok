import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  buildEmbedUrl,
  getVideoDateParts,
  mutePlayer,
  parsePlayerMessage,
  pausePlayer,
  playPlayer,
  seekPlayer,
  unmutePlayer,
} from '../lib/tiktok';
import { didJustEnableSound, isSoundEnabled, subscribeSound } from '../lib/audio';
import { usePageVisible } from '../hooks/usePageVisible';
import { VideoDateOverlay } from './VideoDateOverlay';

export type PlayerRole = 'active' | 'held' | 'queued';

interface TikTokEmbedProps {
  videoId: string;
  videoUrl: string;
  role: PlayerRole;
  gated?: boolean;
  forcePause?: boolean;
  nativePlay?: boolean;
  awaitGesture?: boolean;
  registerActivePlayback?: (controls: { toggle: () => void } | null) => void;
  unregisterActivePlayback?: (controls: { toggle: () => void }) => void;
  registerQueuedPlayback?: (controls: { play: () => void } | null) => void;
  unregisterQueuedPlayback?: (controls: { play: () => void }) => void;
  onNativePlay?: () => void;
  onGestureStart?: () => void;
  onReady?: () => void;
  onUnavailable?: (videoId: string) => void;
}

interface PlayerState {
  playing: boolean;
  muted: boolean;
}

const RECONCILE_BACKOFF_MS = [150, 300, 600, 1200, 2400];
const MAX_REDRIVES_PER_INTENT = 8;
const LOAD_RETRY_BACKOFF_MS = [700, 2000];
const HANDSHAKE_TIMEOUT_MS = 15000;

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function TikTokEmbed({
  videoId,
  videoUrl,
  role,
  gated = false,
  forcePause = false,
  nativePlay = false,
  awaitGesture = false,
  registerActivePlayback,
  unregisterActivePlayback,
  registerQueuedPlayback,
  unregisterQueuedPlayback,
  onNativePlay,
  onGestureStart,
  onReady,
  onUnavailable,
}: TikTokEmbedProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const soundEnabled = useSyncExternalStore(subscribeSound, isSoundEnabled, () => false);
  const pageVisible = usePageVisible();
  const lastIdRef = useRef(videoId);
  const awaitNativeTap = useRef(awaitGesture);
  if (lastIdRef.current !== videoId) {
    lastIdRef.current = videoId;
    awaitNativeTap.current = awaitGesture;
  }

  const [loadNonce, setLoadNonce] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [pauseArmed, setPauseArmed] = useState(!gated);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const intentRef = useRef<PlayerState>({ playing: false, muted: true });
  const reportedRef = useRef<PlayerState>({ playing: false, muted: true });
  const attemptRef = useRef(0);
  const redriveRef = useRef(0);
  const reconcileTimerRef = useRef<number | null>(null);

  const loadedRef = useRef(false);
  const userPausedRef = useRef(false);
  const nativeStartedRef = useRef(false);
  const loadAttemptRef = useRef(0);
  const loadRetryTimerRef = useRef<number | null>(null);
  const handshakeTimerRef = useRef<number | null>(null);
  const unavailableRef = useRef(false);
  const roleRef = useRef(role);
  const gatedRef = useRef(gated);
  const forcePauseRef = useRef(forcePause);
  const onNativePlayRef = useRef(onNativePlay);
  const onGestureStartRef = useRef(onGestureStart);
  const onReadyRef = useRef(onReady);
  const awaitGestureRef = useRef(awaitGesture);
  roleRef.current = role;
  gatedRef.current = gated;
  forcePauseRef.current = forcePause;
  onNativePlayRef.current = onNativePlay;
  onGestureStartRef.current = onGestureStart;
  onReadyRef.current = onReady;
  awaitGestureRef.current = awaitGesture;

  const embedSrc = useMemo(
    () => buildEmbedUrl(videoId, awaitNativeTap.current
      ? { autoplay: false, muted: false }
      : { autoplay: true, muted: false }),
    [videoId],
  );
  const createdDate = useMemo(() => getVideoDateParts(videoId), [videoId]);

  const clearReconcileTimer = useCallback(() => {
    if (reconcileTimerRef.current === null) return;
    window.clearTimeout(reconcileTimerRef.current);
    reconcileTimerRef.current = null;
  }, []);

  const clearHandshakeTimer = useCallback(() => {
    if (handshakeTimerRef.current === null) return;
    window.clearTimeout(handshakeTimerRef.current);
    handshakeTimerRef.current = null;
  }, []);

  const clearLoadRetryTimer = useCallback(() => {
    if (loadRetryTimerRef.current === null) return;
    window.clearTimeout(loadRetryTimerRef.current);
    loadRetryTimerRef.current = null;
  }, []);

  const notifyNativePlay = useCallback(() => {
    if (nativeStartedRef.current) return;
    if (!awaitGestureRef.current) return;
    nativeStartedRef.current = true;
    onNativePlayRef.current?.();
  }, []);

  const reconcile = useCallback(() => {
    clearReconcileTimer();
    const iframe = frameRef.current;
    if (!iframe || !loadedRef.current || unavailableRef.current) return;
    if (roleRef.current === 'queued' || gatedRef.current) return;

    const intent = intentRef.current;
    const reported = reportedRef.current;
    const playingMismatch = intent.playing !== reported.playing;
    const mutedMismatch = intent.muted !== reported.muted;

    if (!playingMismatch && !mutedMismatch) {
      attemptRef.current = 0;
      return;
    }
    if (attemptRef.current >= RECONCILE_BACKOFF_MS.length) return;

    if (playingMismatch) {
      if (intent.playing) playPlayer(iframe);
      else pausePlayer(iframe);
    }
    if (mutedMismatch) {
      if (intent.muted) mutePlayer(iframe);
      else unmutePlayer(iframe);
    }

    const delay = RECONCILE_BACKOFF_MS[attemptRef.current];
    attemptRef.current += 1;
    reconcileTimerRef.current = window.setTimeout(() => {
      reconcileTimerRef.current = null;
      reconcile();
    }, delay);
  }, [clearReconcileTimer]);

  const setIntent = useCallback((next: PlayerState) => {
    const current = intentRef.current;
    if (current.playing === next.playing && current.muted === next.muted) return;
    intentRef.current = next;
    attemptRef.current = 0;
    redriveRef.current = 0;
    reconcile();
  }, [reconcile]);

  const syncReported = useCallback((patch: Partial<PlayerState>) => {
    const previous = reportedRef.current;
    const next = { ...previous, ...patch };
    if (next.playing === previous.playing && next.muted === next.muted) return;
    reportedRef.current = next;

    if (next.playing) notifyNativePlay();

    const intent = intentRef.current;
    if (intent.playing === next.playing && intent.muted === next.muted) {
      attemptRef.current = 0;
      clearReconcileTimer();
      return;
    }
    if (reconcileTimerRef.current !== null) return;
    if (redriveRef.current >= MAX_REDRIVES_PER_INTENT) return;
    redriveRef.current += 1;
    attemptRef.current = 0;
    reconcile();
  }, [clearReconcileTimer, notifyNativePlay, reconcile]);

  const failLoad = useCallback((reason: 'error' | 'silent') => {
    if (unavailableRef.current) return;
    clearHandshakeTimer();
    clearReconcileTimer();
    clearLoadRetryTimer();

    if (reason === 'silent' && roleRef.current === 'queued') {
      return;
    }

    const maxAttempts = reason === 'error' ? LOAD_RETRY_BACKOFF_MS.length : 1;
    if (loadAttemptRef.current < maxAttempts) {
      const delay = LOAD_RETRY_BACKOFF_MS[Math.min(loadAttemptRef.current, LOAD_RETRY_BACKOFF_MS.length - 1)];
      loadAttemptRef.current += 1;
      loadRetryTimerRef.current = window.setTimeout(() => {
        loadRetryTimerRef.current = null;
        loadedRef.current = false;
        reportedRef.current = { playing: false, muted: true };
        setLoaded(false);
        setReady(false);
        setLoadNonce((nonce) => nonce + 1);
      }, delay);
      return;
    }

    if (reason !== 'error') return;
    unavailableRef.current = true;
    onUnavailable?.(videoId);
  }, [clearHandshakeTimer, clearLoadRetryTimer, clearReconcileTimer, onUnavailable, videoId]);

  useEffect(() => {
    loadedRef.current = false;
    userPausedRef.current = false;
    nativeStartedRef.current = false;
    unavailableRef.current = false;
    loadAttemptRef.current = 0;
    attemptRef.current = 0;
    redriveRef.current = 0;
    intentRef.current = { playing: false, muted: true };
    reportedRef.current = { playing: false, muted: true };
    setLoaded(false);
    setReady(false);
    setUserPaused(false);
    setPauseArmed(false);
    setCurrentTime(0);
    setDuration(0);
    return () => {
      clearReconcileTimer();
      clearHandshakeTimer();
      clearLoadRetryTimer();
    };
  }, [clearHandshakeTimer, clearLoadRetryTimer, clearReconcileTimer, videoId]);

  useEffect(() => {
    if (gated) {
      setPauseArmed(false);
      return;
    }
    const timer = window.setTimeout(() => setPauseArmed(true), 600);
    return () => window.clearTimeout(timer);
  }, [gated]);

  useEffect(() => {
    if (unavailableRef.current) {
      setIntent({ playing: false, muted: true });
      return;
    }
    if (role === 'queued') {
      if (nativePlay) {
        unmutePlayer(frameRef.current);
        return;
      }
      if (awaitGesture) return;
      nativeStartedRef.current = false;
      userPausedRef.current = false;
      pausePlayer(frameRef.current);
      return;
    }
    if (gated) {
      return;
    }
    if (role === 'held') {
      pausePlayer(frameRef.current);
      return;
    }
    if (forcePause) {
      return;
    }
    if (!pageVisible) {
      pausePlayer(frameRef.current);
      return;
    }
    if (nativeStartedRef.current && !userPaused) {
      intentRef.current = { playing: true, muted: false };
      attemptRef.current = 0;
      redriveRef.current = 0;
      if (reportedRef.current.muted) unmutePlayer(frameRef.current);
      return;
    }
    setIntent({
      playing: !userPaused,
      muted: false,
    });
  }, [awaitGesture, forcePause, gated, nativePlay, pageVisible, role, setIntent, soundEnabled, userPaused]);

  useEffect(() => {
    const iframe = frameRef.current;
    if (!iframe) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const message = parsePlayerMessage(event.data);
      if (!message) return;

      clearHandshakeTimer();

      switch (message.type) {
        case 'onPlayerReady':
          setReady(true);
          if (roleRef.current !== 'queued' && !gatedRef.current) reconcile();
          break;
        case 'onPlayerError':
          failLoad('error');
          break;
        case 'onMute':
          syncReported({ muted: Boolean(message.value) });
          break;
        case 'onStateChange': {
          const playing = message.value === 1;
          if (playing) setReady(true);
          syncReported({ playing });
          break;
        }
        case 'onCurrentTime': {
          const timing = message.value as { currentTime?: number; duration?: number } | undefined;
          if (timing?.currentTime != null) setCurrentTime(timing.currentTime);
          if (timing?.duration != null) setDuration(timing.duration);
          if (timing?.currentTime != null && timing.currentTime > 0) setReady(true);
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [clearHandshakeTimer, failLoad, notifyNativePlay, reconcile, syncReported, videoId, loadNonce]);

  useEffect(() => {
    if (!ready) return;
    onReadyRef.current?.();
  }, [ready, role, onReady]);

  const handleGestureStart = useCallback(() => {
    if (!awaitGestureRef.current) return;
    if (roleRef.current !== 'queued') return;
    onGestureStartRef.current?.();
  }, []);

  const handleFrameLoad = useCallback(() => {
    loadedRef.current = true;
    setLoaded(true);
    clearHandshakeTimer();
    handshakeTimerRef.current = window.setTimeout(() => {
      handshakeTimerRef.current = null;
      failLoad('silent');
    }, HANDSHAKE_TIMEOUT_MS);
    if (roleRef.current !== 'queued' && !gatedRef.current) reconcile();
  }, [clearHandshakeTimer, failLoad, reconcile]);

  const seekTo = useCallback((time: number) => {
    const clamped = Math.max(0, Math.min(time, duration || time));
    seekPlayer(frameRef.current, clamped);
    setCurrentTime(clamped);
  }, [duration]);

  const playFromGesture = useCallback(() => {
    if (nativeStartedRef.current) return;
    playPlayer(frameRef.current);
    unmutePlayer(frameRef.current);
  }, []);

  const queuedControlsRef = useRef({ play: playFromGesture });
  queuedControlsRef.current.play = playFromGesture;

  useEffect(() => {
    if (role !== 'queued' || !registerQueuedPlayback) return;
    const controls = queuedControlsRef.current;
    registerQueuedPlayback(controls);
    return () => unregisterQueuedPlayback?.(controls);
  }, [registerQueuedPlayback, role, unregisterQueuedPlayback]);

  const togglePlayback = useCallback(() => {
    if (role !== 'active' || gated || !loaded || unavailableRef.current) return;
    if (didJustEnableSound()) return;
    const next = !userPausedRef.current;
    userPausedRef.current = next;
    setUserPaused(next);
    setIntent({ playing: !next, muted: false });
  }, [gated, loaded, role, setIntent]);

  const activeControlsRef = useRef({ toggle: togglePlayback });
  activeControlsRef.current.toggle = togglePlayback;

  useEffect(() => {
    if (role !== 'active' || gated || !registerActivePlayback) return;
    const controls = activeControlsRef.current;
    registerActivePlayback(controls);
    return () => unregisterActivePlayback?.(controls);
  }, [gated, registerActivePlayback, role, unregisterActivePlayback]);

  const showChrome = role === 'active' && loaded && !gated;
  const showSpinner = role !== 'queued' && !gated && (!loaded || !ready);
  const iframeInteractive = (role === 'queued' && awaitGesture)
    || (role === 'active' && (gated || (loaded && !pauseArmed)));
  const showPauseHit = role === 'active' && loaded && !gated && pauseArmed;

  return (
    <>
      <div className="player-shell">
        <div className="player-frame relative rounded-2xl bg-black shadow-2xl shadow-black/50">
          {showSpinner && (
            <div className="player-placeholder absolute inset-0 z-30 flex items-center justify-center bg-black">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
            </div>
          )}

          <iframe
            ref={frameRef}
            key={`${videoId}:${loadNonce}`}
            src={embedSrc}
            title="TikTok video"
            scrolling="no"
            tabIndex={-1}
            onFocus={handleGestureStart}
            onPointerDown={handleGestureStart}
            onLoad={handleFrameLoad}
            className={`player-iframe player-iframe--native${loaded || role === 'queued' || gated ? ' is-visible' : ''}${iframeInteractive ? ' is-interactive' : ''}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />

          {showPauseHit && (
            <button
              type="button"
              data-playback-toggle
              aria-label={userPaused ? 'Play video' : 'Pause video'}
              className="player-pause-hit"
              onClick={togglePlayback}
            />
          )}

          {showChrome && (
            <a
              href={videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              className="absolute right-3 top-3 z-[45] rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium backdrop-blur-sm hover:bg-black/70"
            >
              TikTok
            </a>
          )}
          {createdDate && role !== 'queued' && !gated && <VideoDateOverlay date={createdDate} />}
        </div>
      </div>

      {showChrome && (
        <div className="video-controls rounded-lg border border-white/10 bg-black/80 px-2 py-1 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="min-w-[2.25rem] shrink-0 text-[10px] tabular-nums text-muted">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              disabled={!ready || duration <= 0}
              onChange={(event) => seekTo(Number(event.target.value))}
              className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/20 accent-accent disabled:opacity-40"
            />
            <span className="min-w-[2.25rem] shrink-0 text-right text-[10px] tabular-nums text-muted">
              {formatTime(duration)}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
