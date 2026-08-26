import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { dedupeVideosFile } from './scripts/dedupe-videos.mjs';

function dedupeVideosPlugin() {
  const catalogPath = resolve('data/videos.txt');
  let busy = false;

  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await dedupeVideosFile(catalogPath);
    } catch (error) {
      console.warn('Could not dedupe data/videos.txt:', error);
    } finally {
      busy = false;
    }
  };

  return {
    name: 'dedupe-videos-txt',
    buildStart() {
      return run();
    },
    configureServer(server) {
      void run();
      server.watcher.add(catalogPath);
      server.watcher.on('change', (changed) => {
        if (resolve(changed) === catalogPath) void run();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), dedupeVideosPlugin()],
  server: {
    port: 5173,
  },
});
