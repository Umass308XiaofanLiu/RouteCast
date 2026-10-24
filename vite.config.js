import { defineConfig } from 'vite';

// Relative base: the same static build works at a domain root (Cloudflare Pages)
// and under a sub-path (GitHub Pages /glarepilot/).
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
});
