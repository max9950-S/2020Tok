import { useCallback, useMemo, useRef, useState } from 'react';
import { VideoFeed } from './components/VideoFeed';
import { parseVideosTxt } from './lib/parseCatalog';
import { shuffleArray, type CatalogVideo } from './lib/tiktok';
import videosTxt from '../data/videos.txt?raw';

const WINDOW = 12;
const BATCH = 8;

interface FeedState {
  deck: CatalogVideo[];
  cursor: number;
  visible: CatalogVideo[];
}

function startFeed(source: CatalogVideo[]): FeedState {
  const shuffled = shuffleArray(source);
  return {
    deck: shuffled,
    cursor: Math.min(WINDOW, shuffled.length),
    visible: shuffled.slice(0, WINDOW),
  };
}

export default function App() {
  const catalog = useMemo(() => parseVideosTxt(videosTxt), []);
  const [feed, setFeed] = useState<FeedState>(() => startFeed(catalog));
  const feedRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  const onNearEnd = useCallback(() => {
    if (loadingRef.current || feed.deck.length === 0) return;

    if (feed.cursor >= feed.deck.length) {
      const reshuffled = shuffleArray(feed.deck);
      setFeed((prev) => ({
        deck: reshuffled,
        cursor: BATCH,
        visible: [...prev.visible, ...reshuffled.slice(0, BATCH)],
      }));
      return;
    }

    loadingRef.current = true;
    const next = feed.deck.slice(feed.cursor, feed.cursor + BATCH);
    setFeed((prev) => ({
      ...prev,
      cursor: prev.cursor + BATCH,
      visible: [...prev.visible, ...next],
    }));
    window.setTimeout(() => {
      loadingRef.current = false;
    }, 200);
  }, [feed]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      <header className="app-heading">
        <h1 className="text-[15px] font-semibold leading-none tracking-tight">
          <span className="text-cyan">2020</span>Tok
        </h1>
      </header>

      {feed.visible.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div className="max-w-sm space-y-2">
            <p className="text-lg font-semibold">No 2020 TikToks yet</p>
            <p className="text-sm text-muted">
              The feed is empty because <span className="text-cyan">data/videos.txt</span> has no 2020 video links.
            </p>
          </div>
        </div>
      ) : (
        <VideoFeed videos={feed.visible} onNearEnd={onNearEnd} feedRef={feedRef} />
      )}
    </div>
  );
}
