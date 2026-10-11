# ARIA — Voice Intelligence

A local, voice-first AI assistant with a calm warm near-black interface, a softly glowing orb avatar, browser speech recognition, Ollama chat, and optional ElevenLabs speech output.

## Requirements

- Node.js 18+
- [Ollama](https://ollama.com/) running on the same machine as the Vite dev server
- A supported browser with the Web Speech API (Chrome or Edge recommended)
- Optional: an ElevenLabs API key for higher-quality speech output

## Run locally

```bash
npm install
ollama pull mistral:7b-instruct-q4_K_M
ollama serve
npm run dev
```

Vite opens the editable app at `/index.dev.html` and proxies browser requests to Ollama at `http://localhost:11434/v1`. The app defaults to `mistral:7b-instruct-q4_K_M` for chat completions. The repository-root `index.html` is the built, GitHub Pages-ready entry; its JS and CSS bundle paths are relative.

Open the settings panel with the gear icon to choose an Ollama model, add an ElevenLabs API key, load and select an ElevenLabs voice, toggle the last-response transcript, or test the Ollama connection. Settings are saved in this browser's local storage, including the API key; without a key, replies use the browser's built-in speech synthesis. ElevenLabs calls are proxied by Vite to avoid browser CORS issues.

### Backend endpoints

Both service endpoints have an optional override in the settings panel, so the app is not tied to the Vite proxy:

| Setting | Blank (default) | Example value | Requests go to |
| --- | --- | --- | --- |
| Ollama endpoint | Vite proxy `/api/ollama` | `http://localhost:11434` | `<url>/v1/models`, `<url>/v1/chat/completions` |
| ElevenLabs endpoint | Vite proxy `/api/elevenlabs` | `https://api.elevenlabs.io` | `<url>/v1/voices`, `<url>/v1/text-to-speech/<id>` |

A trailing `/v1` is detected and not duplicated. Values are stored in local storage (`aria.ollama.url`, `aria.elevenlabs.url`), and saving a new Ollama endpoint re-runs the connection check.

This is what makes the GitHub Pages build usable: static hosting has no Vite proxy, so the same-origin `/api/...` paths have nothing to answer them. Point ARIA at a backend the browser can reach instead — a tunnel or a hosted relay for the model server.

The backend must also permit this page's origin, because the browser calls it directly rather than through the proxy. For a local Ollama serving a hosted page, allow the Pages origin when starting it:

```bash
OLLAMA_ORIGINS=https://juwainhq.github.io ollama serve
```

`http://localhost:11434` from a hosted page targets the **viewer's** own machine, not the deploy host, and browsers treat `localhost` as a secure origin, so it is not blocked as mixed content. Requests still fail if the endpoint is unreachable or rejects the origin.

Press Space from the main view to toggle the microphone. Microphone access requires a secure browser context (HTTPS or localhost). The live preview must be able to reach Ollama from the machine running its Vite server; `localhost` always refers to that server, not the computer viewing a remote preview.

## Build and publish

```bash
npm run build
npm run preview
```

After changing the app, run `npm run build:pages` to refresh the root `index.html` and `assets/` bundle used by branch-based GitHub Pages. Commit those generated root files with the source changes. GitHub Pages is static hosting and cannot use the local Vite proxy, so the hosted UI renders but starts in the offline state until you set the Ollama endpoint described above.

In development, `npm run dev` serves the hot-reloading source entry at `/` and `/index.html`, so the stale root Pages bundle is never served from the dev server. `index.dev.html` remains the direct source entry and the build input; the root `index.html` is only ever the published artifact.
