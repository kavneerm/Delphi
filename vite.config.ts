import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    // No inlining: the intro clip stays a separate, fingerprinted file. deploy.ts depends
    // on that — assets are cached `immutable` forever and only HTML is invalidated, which
    // only works if a content change produces a new asset name.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        // The site is two documents: the entrance, and the simulation it opens into.
        main: resolve(import.meta.dirname, 'index.html'),
        wargame: resolve(import.meta.dirname, 'wargame/index.html'),
      },
    },
  },
});
