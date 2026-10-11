import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxy = {
  // Keep browser requests same-origin; Vite forwards them to the local Ollama API.
  '/api/ollama': {
    target: 'http://localhost:11434',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/ollama/, '/v1'),
  },
  // ElevenLabs requests also go through the local dev server to avoid browser CORS issues.
  '/api/elevenlabs': {
    target: 'https://api.elevenlabs.io',
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/api\/elevenlabs/, ''),
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

export default defineConfig({
  base: './',
  plugins: [react(), serveDevEntryAtRoot()],
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
