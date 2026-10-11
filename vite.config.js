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

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
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
