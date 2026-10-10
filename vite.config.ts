import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Dev serves the source page; the repo-root index.html is the GitHub Pages redirect. */
function devEntry(): Plugin {
  return {
    name: 'dev-entry',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const raw = req.url ?? '/';
        const path = raw.split('?')[0];
        if (path === '/' || path === '/index.html') {
          const q = raw.includes('?') ? '?' + raw.slice(raw.indexOf('?') + 1) : '';
          req.url = '/index.source.html' + q;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [devEntry()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
    cssMinify: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.source.html'),
      },
    },
  },
});
