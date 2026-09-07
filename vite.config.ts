import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { dedupeVideosFile } from './scripts/dedupe-videos.mjs';
import { checkEmbeddable, ensureGeneratedModule } from './scripts/check-embeddable.mjs';

function videoCatalogPlugin() {
  const catalogPath = resolve('data/videos.txt');
  let busy = false;

  const run = async (budgetMs: number) => {
    if (busy) return;
    busy = true;
    try {
      await dedupeVideosFile(catalogPath);
      await checkEmbeddable({ budgetMs });
    } catch (error) {
      console.warn('Could not refresh the video catalog:', error);
    } finally {
      busy = false;
    }
  };

  return {
    name: 'video-catalog',
    async buildStart() {
      await ensureGeneratedModule();
      await run(45000);
    },
    async configureServer(server) {
      // The generated module has to exist before the first request resolves it;
      // the network probe then refreshes it in the background and triggers HMR.
      await ensureGeneratedModule();
      void run(240000);
      server.watcher.add(catalogPath);
      server.watcher.on('change', (changed) => {
        if (resolve(changed) === catalogPath) void run(240000);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), videoCatalogPlugin()],
  server: {
    port: 5173,
  },
});
