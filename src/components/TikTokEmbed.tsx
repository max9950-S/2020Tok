import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import {
  attemptUnmute,
  buildEmbedUrl,
  getVideoDateParts,
  parsePlayerMessage,
  pausePlayer,
  playPlayer,
  mutePlayer,
  sendPlayerCommand,
  silencePlayer,
} from '../lib/tiktok';
import { VideoDateOverlay } from './VideoDateOverlay';

interface TikTokEmbedProps {
  videoId: string;
  videoUrl: string;
  isActive: boolean;
  activationEpoch: number;
  registerActivePlayback?: (controls: { toggle: () => void } | null) => void;
}

const UNMUTE_RETRY_DELAYS_MS = [0, 40, 100, 200, 400, 700, 1100, 1600];
const PLAY_RETRY_DELAYS_MS = [0, 80, 200, 450, 900, 1500, 2500, 4000, 6000, 9000];
const READY_FALLBACK_MS = 3500;
const UNMUTE_POLL_MS = 350;
const UNMUTE_POLL_DURATION_MS = 12000;

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function TikTokEmbed({
  videoId,
  videoUrl,
  isActive,
  activationEpoch,
  registerActivePlayback,
}: TikTokEmbedProps) {
  const nativeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const isMutedRef = useRef(true);
  const isPlayingRef = useRef(false);
  const userPausedRef = useRef(false);
  const playerErrorRef = useRef(false);
  const pageHiddenRef = useRef(false);
  const wasPlayingBeforeBackgroundRef = useRef(false);
  const lastToggleAtRef = useRef(0);
  const unmuteTimersRef = useRef<number[]>([]);
  const playTimersRef = useRef<number[]>([]);
  const isActiveRef = useRef(isActive);
  const embedSrcRef = useRef(buildEmbedUrl(videoId, { autoplay: true, muted: true }));
  const createdDate = useMemo(() => getVideoDateParts(videoId), [videoId]);

  isActiveRef.current = isActive;

  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [playerError, setPlayerError] = useState(false);

  readyRef.current = ready;
  const playerVisible = iframeLoaded && !playerError;

  const markReady = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    setReady(true);
  }, []);

  const clearUnmuteTimers = useCallback(() => {
    unmuteTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    unmuteTimersRef.current = [];
  }, []);

  const clearPlayTimers = useCallback(() => {
    playTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    playTimersRef.current = [];
  }, []);

  const scheduleUnmuteRetries = useCallback((iframe: HTMLIFrameElement) => {
    clearUnmuteTimers();
    UNMUTE_RETRY_DELAYS_MS.forEach((delay) => {
      unmuteTimersRef.current.push(window.setTimeout(() => attemptUnmute(iframe), delay));
    });
  }, [clearUnmuteTimers]);

  const schedulePlayRetries = useCallback((iframe: HTMLIFrameElement) => {
    clearPlayTimers();
    PLAY_RETRY_DELAYS_MS.forEach((delay) => {
      playTimersRef.current.push(window.setTimeout(() => {
        if (
          !isActiveRef.current
          || pageHiddenRef.current
          || userPausedRef.current
          || isPlayingRef.current
          || playerErrorRef.current
        ) {
          return;
        }
        playPlayer(iframe);
      }, delay));
    });
  }, [clearPlayTimers]);

  const kickPlayback = useCallback((iframe: HTMLIFrameElement | null) => {
    if (!iframe || !isActiveRef.current || pageHiddenRef.current || userPausedRef.current || playerErrorRef.current) {
      return;
    }
    playPlayer(iframe);
    schedulePlayRetries(iframe);
  }, [schedulePlayRetries]);

  const pauseForPageBackground = useCallback(() => {
    if (pageHiddenRef.current) return;
    pageHiddenRef.current = true;
    wasPlayingBeforeBackgroundRef.current = Boolean(
      isActive && iframeLoaded && !playerErrorRef.current && !userPausedRef.current && isPlayingRef.current,
    );
    pausePlayer(nativeRef.current);
    isPlayingRef.current = false;
    setIsPlaying(false);
    clearPlayTimers();
    clearUnmuteTimers();
  }, [clearPlayTimers, clearUnmuteTimers, iframeLoaded, isActive]);

  const resumeFromPageBackground = useCallback(() => {
    if (!pageHiddenRef.current) return;
    pageHiddenRef.current = false;
    if (
      !isActive
      || !iframeLoaded
      || playerErrorRef.current
      || userPausedRef.current
      || !wasPlayingBeforeBackgroundRef.current
    ) {
      wasPlayingBeforeBackgroundRef.current = false;
      return;
    }
    wasPlayingBeforeBackgroundRef.current = false;
    const iframe = nativeRef.current;
    kickPlayback(iframe);
    if (iframe) {
      attemptUnmute(iframe);
      scheduleUnmuteRetries(iframe);
    }
  }, [iframeLoaded, isActive, kickPlayback, scheduleUnmuteRetries]);

  useEffect(() => {
    readyRef.current = false;
    isMutedRef.current = true;
    isPlayingRef.current = false;
    userPausedRef.current = false;
    playerErrorRef.current = false;
    clearUnmuteTimers();
    clearPlayTimers();
    setIframeLoaded(false);
    setReady(false);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setUserPaused(false);
    setPlayerError(false);
    return () => {
      silencePlayer(nativeRef.current);
      if (nativeRef.current) nativeRef.current.src = 'about:blank';
      clearUnmuteTimers();
      clearPlayTimers();
    };
  }, [clearPlayTimers, clearUnmuteTimers, videoId]);

  useEffect(() => {
    if (isActive) return;
    silencePlayer(nativeRef.current);
    isPlayingRef.current = false;
    setIsPlaying(false);
    clearPlayTimers();
    clearUnmuteTimers();
    nativeRef.current?.blur();
  }, [clearPlayTimers, clearUnmuteTimers, isActive]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') pauseForPageBackground();
      else resumeFromPageBackground();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', pauseForPageBackground);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', pauseForPageBackground);
    };
  }, [pauseForPageBackground, resumeFromPageBackground]);

  useEffect(() => {
    if (!isActive || playerErrorRef.current) return;
    userPausedRef.current = false;
    isPlayingRef.current = false;
    setUserPaused(false);
    setIsPlaying(false);
    const iframe = nativeRef.current;
    if (iframe && iframeLoaded) {
      kickPlayback(iframe);
      attemptUnmute(iframe);
      scheduleUnmuteRetries(iframe);
    }
  }, [activationEpoch, iframeLoaded, isActive, kickPlayback, scheduleUnmuteRetries]);

  useEffect(() => {
    if (!isActive || !iframeLoaded || playerErrorRef.current || userPausedRef.current) return;
    kickPlayback(nativeRef.current);
    attemptUnmute(nativeRef.current);
  }, [iframeLoaded, isActive, kickPlayback]);

  useEffect(() => {
    if (!iframeLoaded || ready || playerErrorRef.current) return;
    const timer = window.setTimeout(() => {
      if (!readyRef.current && !playerErrorRef.current && isActive) {
        markReady();
        kickPlayback(nativeRef.current);
      }
    }, READY_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [iframeLoaded, isActive, kickPlayback, markReady, ready, videoId]);

  useEffect(() => {
    const iframe = nativeRef.current;
    if (!iframe) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const message = parsePlayerMessage(event.data);
      if (!message) return;

      switch (message.type) {
        case 'onPlayerReady':
          markReady();
          setPlayerError(false);
          playerErrorRef.current = false;
          if (!userPausedRef.current && isActiveRef.current) {
            kickPlayback(iframe);
            scheduleUnmuteRetries(iframe);
          } else {
            silencePlayer(iframe);
          }
          break;
        case 'onPlayerError':
          playerErrorRef.current = true;
          setPlayerError(true);
          clearPlayTimers();
          clearUnmuteTimers();
          break;
        case 'onMute':
          isMutedRef.current = Boolean(message.value);
          if (isMutedRef.current && isPlayingRef.current && isActiveRef.current) attemptUnmute(iframe);
          else if (!isMutedRef.current && !isActiveRef.current) mutePlayer(iframe);
          else if (!isMutedRef.current) clearUnmuteTimers();
          break;
        case 'onStateChange': {
          const state = message.value as number;
          const playing = state === 1;

          if (!isActiveRef.current) {
            if (playing) silencePlayer(iframe);
            isPlayingRef.current = false;
            setIsPlaying(false);
            break;
          }

          isPlayingRef.current = playing;
          setIsPlaying(playing);
          if (playing) {
            markReady();
            clearPlayTimers();
            scheduleUnmuteRetries(iframe);
          } else if (
            !userPausedRef.current
            && !playerErrorRef.current
            && !pageHiddenRef.current
            && (state === 2 || state === 0 || state === 3)
          ) {
            kickPlayback(iframe);
          }
          break;
        }
        case 'onCurrentTime': {
          const timing = message.value as { currentTime?: number; duration?: number } | undefined;
          if (timing?.currentTime != null) setCurrentTime(timing.currentTime);
          if (timing?.duration != null) setDuration(timing.duration);
          if (timing?.currentTime != null && timing.currentTime > 0) {
            markReady();
            if (isMutedRef.current && isPlayingRef.current && isActiveRef.current) attemptUnmute(iframe);
          }
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [
    clearPlayTimers,
    clearUnmuteTimers,
    isActive,
    kickPlayback,
    markReady,
    scheduleUnmuteRetries,
    videoId,
  ]);

  useEffect(() => {
    if (!isActive || !iframeLoaded || userPaused || playerErrorRef.current) return;
    const interval = window.setInterval(() => {
      if (pageHiddenRef.current || userPausedRef.current || isPlayingRef.current || !isActiveRef.current) return;
      playPlayer(nativeRef.current);
    }, 300);
    const stopTimer = window.setTimeout(() => window.clearInterval(interval), 25000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(stopTimer);
    };
  }, [activationEpoch, iframeLoaded, isActive, userPaused, videoId]);

  useEffect(() => {
    if (!isActive || !iframeLoaded || playerErrorRef.current) return;
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      if (!isActiveRef.current) {
        window.clearInterval(interval);
        return;
      }
      if (!isMutedRef.current) {
        window.clearInterval(interval);
        return;
      }
      attemptUnmute(nativeRef.current);
      if (Date.now() - startedAt >= UNMUTE_POLL_DURATION_MS) window.clearInterval(interval);
    }, UNMUTE_POLL_MS);
    return () => window.clearInterval(interval);
  }, [activationEpoch, iframeLoaded, isActive, videoId]);

  const handleNativeLoad = useCallback(() => {
    const iframe = nativeRef.current;
    if (!iframe || playerErrorRef.current) return;
    setIframeLoaded(true);
    if (isActive && !userPausedRef.current) {
      kickPlayback(iframe);
      scheduleUnmuteRetries(iframe);
    } else {
      silencePlayer(iframe);
    }
  }, [isActive, kickPlayback, scheduleUnmuteRetries]);

  const seekTo = useCallback((time: number) => {
    const clamped = Math.max(0, Math.min(time, duration || time));
    sendPlayerCommand(nativeRef.current, 'seekTo', clamped);
    setCurrentTime(clamped);
  }, [duration]);

  const togglePlayback = useCallback(() => {
    if (!isActive || !iframeLoaded || playerErrorRef.current) return;
    const iframe = nativeRef.current;
    if (!iframe) return;

    if (!userPausedRef.current && isPlayingRef.current) {
      userPausedRef.current = true;
      setUserPaused(true);
      pausePlayer(iframe);
      isPlayingRef.current = false;
      setIsPlaying(false);
      clearPlayTimers();
      clearUnmuteTimers();
      return;
    }

    userPausedRef.current = false;
    isPlayingRef.current = false;
    setUserPaused(false);
    markReady();
    playPlayer(iframe);
    schedulePlayRetries(iframe);
    attemptUnmute(iframe);
    scheduleUnmuteRetries(iframe);
  }, [
    clearPlayTimers,
    clearUnmuteTimers,
    iframeLoaded,
    isActive,
    markReady,
    schedulePlayRetries,
    scheduleUnmuteRetries,
  ]);

  useEffect(() => {
    if (!isActive || !registerActivePlayback) return;
    registerActivePlayback({ toggle: togglePlayback });
    return () => registerActivePlayback(null);
  }, [isActive, registerActivePlayback, togglePlayback]);

  const handleToggle = useCallback((event: SyntheticEvent) => {
    event.stopPropagation();
    event.preventDefault();
    const now = Date.now();
    if (now - lastToggleAtRef.current < 280) return;
    lastToggleAtRef.current = now;
    togglePlayback();
  }, [togglePlayback]);

  return (
    <>
      <div className="player-shell">
        <div className="player-frame relative rounded-2xl bg-black shadow-2xl shadow-black/50">
          {!iframeLoaded && !playerError && (
            <div className="player-placeholder absolute inset-0 z-30 flex items-center justify-center bg-black">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
            </div>
          )}

          {playerError && (
            <div className="player-placeholder absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black px-6 text-center">
              <p className="text-sm text-muted">This TikTok is gone or blocked embeds.</p>
              <a
                href={videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-accent px-4 py-2 text-sm font-semibold"
              >
                Open on TikTok
              </a>
            </div>
          )}

          {!playerError && (
            <iframe
              ref={nativeRef}
              key={videoId}
              src={embedSrcRef.current}
              title="TikTok video"
              scrolling="no"
              tabIndex={-1}
              onLoad={handleNativeLoad}
              className={`player-iframe player-iframe--native${playerVisible ? ' is-visible' : ''}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          )}

          {isActive && iframeLoaded && !playerError && (
            <>
              <button
                type="button"
                data-playback-toggle
                onPointerDown={(event) => event.stopPropagation()}
                onClick={handleToggle}
                className="absolute inset-0 z-40 cursor-pointer touch-manipulation bg-transparent"
                aria-label={isPlaying ? 'Pause video' : 'Play video'}
              />
              {userPaused && (
                <div className="pointer-events-none absolute inset-0 z-[41] flex items-center justify-center bg-black/20">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-2xl">
                    ▶
                  </div>
                </div>
              )}
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
            </>
          )}
          {createdDate && <VideoDateOverlay date={createdDate} />}
        </div>
      </div>

      {iframeLoaded && !playerError && isActive && (
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
