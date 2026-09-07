import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VideoFeed } from './components/VideoFeed';
import { BLOCKED_VIDEO_IDS } from './generated/embeddable';
import { enableSound, installSoundUnlockListener } from './lib/audio';
import { addToRuntimeBlocklist, readRuntimeBlocklist } from './lib/blocklist';
import { parseVideosTxt } from './lib/parseCatalog';

import videosTxt from '../data/videos.txt?raw';

export default function App() {
  const [blockTick, setBlockTick] = useState(0);
  const catalog = useMemo(() => {
    const blocked = new Set([...BLOCKED_VIDEO_IDS, ...readRuntimeBlocklist()]);
    return parseVideosTxt(videosTxt, blocked);
  }, [blockTick]);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => installSoundUnlockListener(), []);

  const handleActivated = useCallback(() => {
    enableSound();
  }, []);

  const onVideoUnavailable = useCallback((videoId: string) => {
    addToRuntimeBlocklist(videoId);
    setBlockTick((tick) => tick + 1);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      <header className="app-heading">
        <h1 className="text-[15px] font-semibold leading-none tracking-tight">
          <span className="text-cyan">2020</span>Tok
        </h1>
      </header>

      {catalog.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div className="max-w-sm space-y-2">
            <p className="text-lg font-semibold">No 2020 TikToks yet</p>
            <p className="text-sm text-muted">
              The feed is empty because <span className="text-cyan">data/videos.txt</span> has no playable 2020 video links.
            </p>
          </div>
        </div>
      ) : (
        <div className="feed-root">
          <VideoFeed
            catalog={catalog}
            onActivated={handleActivated}
            onVideoUnavailable={onVideoUnavailable}
            feedRef={feedRef}
          />
        </div>
      )}
    </div>
  );
}
