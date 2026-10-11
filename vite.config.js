import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Speech output runs on the browser's own Web Speech API, so Ollama is the only
// service that needs proxying.
const apiProxy = {
  // Keep browser requests same-origin; Vite forwards them to the local Ollama API.
  '/api/ollama': {
    target: 'http://localhost:11434',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/ollama/, '/v1'),
  },
};

// The repository root also holds the built, Pages-ready `index.html`. Without
// this, `npm run dev` would serve that stale bundle at `/` instead of the
// hot-reloading source entry. Production builds are untouched.
function serveDevEntryAtRoot() {
  return {
    name: 'aria-serve-dev-entry-at-root',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [pathname, search = ''] = (req.url || '').split('?');
        if (pathname === '/' || pathname === '/index.html') {
          req.url = `/index.dev.html${search ? `?${search}` : ''}`;
        }
        next();
      });
    },
  };
}

// Vite rewrites the HTML it serves — it injects the HMR client, including into
// plain root-level .html files. The standalone download must be byte-exact, so
// serve that one file from disk untouched. Dev only; production is unaffected.
function serveStandaloneRaw() {
  return {
    name: 'aria-serve-standalone-raw',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const [pathname] = (req.url || '').split('?');
        if (pathname !== '/aria.html') return next();
        try {
          const { readFile } = await import('node:fs/promises');
          const file = readFile('aria.html');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(await file);
        } catch {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), serveDevEntryAtRoot(), serveStandaloneRaw()],
  build: {
    rollupOptions: {
      input: { index: 'index.dev.html' },
    },
  },
  server: {
    open: '/',
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: apiProxy,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
    proxy: apiProxy,
  },
});
