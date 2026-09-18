import { defineConfig } from 'astro/config';

// BASE_PATH can be overridden by a preview or by a future repository rename.
// The default matches the planned public GitHub Pages project URL.
const base = process.env.BASE_PATH || '/cocktails';

export default defineConfig({
  site: process.env.SITE_URL || 'https://xiaoyu233kao.github.io',
  base,
  trailingSlash: 'always',
  devToolbar: {
    enabled: false,
  },
  build: {
    format: 'directory',
  },
  vite: {
    // Astro's accessibility helper packages are only needed by the dev
    // toolbar. Keeping them external avoids a Windows esbuild resolver edge
    // case while preserving normal production output.
    optimizeDeps: {
      exclude: ['aria-query', 'axobject-query'],
    },
  },
});
