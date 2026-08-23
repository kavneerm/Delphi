import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    // No inlining: the stylesheet stays a separate, fingerprinted file. deploy.ts depends
    // on that — assets are cached `immutable` forever and only /index.html is invalidated,
    // which only works if a content change produces a new asset name.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        writing: resolve(import.meta.dirname, 'writing/index.html'),
        // Each further page is one line here plus the file itself, e.g.
        //   'writing/compliance-costs': resolve(import.meta.dirname, 'writing/compliance-costs/index.html'),
        //
        // CloudFront serves S3 over origin access control, and `default_root_object`
        // applies only to `/`. A request for `/writing/` would 403 without the
        // viewer-request function in infra/main.tf, which rewrites trailing-slash paths to
        // index.html. That function must be applied before any sub-page is reachable.
      },
    },
  },
});
