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
        // A second page is one line here plus the file itself:
        //   writing: resolve(import.meta.dirname, 'writing/index.html'),
        // Note before adding one: CloudFront serves S3 over origin access control, and
        // `default_root_object` applies only to `/`. A request for `/writing/` returns 403
        // until a viewer-request function rewrites trailing-slash paths to index.html.
        // See docs/plans/deploy-aws.md.
      },
    },
  },
});
