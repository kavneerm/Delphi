import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    cssMinify: true,
    reportCompressedSize: true,
  },
  server: { port: 5173, strictPort: true },
});
