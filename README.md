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

`http://localhost:11434` from a hosted page targets the **viewer's** own machine, not the deploy host. Plain HTTP is not what blocks this call: per the Fetch and Secure Contexts specs, `http://localhost` and `http://127.0.0.1` are *potentially trustworthy* origins, so browsers do not treat them as mixed content even on an HTTPS page. What actually rejects the request is Ollama's own CORS allow-list — it answers only a fixed set of origins and sends no `Access-Control-Allow-Origin` for anything else.

So the failing call is a CORS failure, not a mixed-content failure. The settings panel has a "Can't connect?" disclosure that names the exact origin to allow and the command to run, which is generated from the page's real origin, so it stays correct for a Pages deploy, a local preview, or a fork.

Do not reach for `--disable-web-security` or `--allow-running-insecure-content`: neither is needed, and both weaken every site you visit while Chrome runs that way.

Press Space from the main view to toggle the microphone. Microphone access requires a secure browser context (HTTPS or localhost). The live preview must be able to reach Ollama from the machine running its Vite server; `localhost` always refers to that server, not the computer viewing a remote preview.

## Build and publish

```bash
npm run build
npm run preview
```

After changing the app, run `npm run build:pages` to refresh the root `index.html` and `assets/` bundle used by branch-based GitHub Pages. Commit those generated root files with the source changes. GitHub Pages is static hosting and cannot use the local Vite proxy, so the hosted UI renders but starts in the offline state until you set the Ollama endpoint described above.

In development, `npm run dev` serves the hot-reloading source entry at `/` and `/index.html`, so the stale root Pages bundle is never served from the dev server. `index.dev.html` remains the direct source entry and the build input; the root `index.html` is only ever the published artifact.

## Standalone single file (`aria.html`)

`aria.html` is one self-contained HTML file — CSS and JS inlined, no build step, no server, no `node_modules`. Open it from disk with `file://` and it runs. Settings expose it as **Download aria.html** so the hosted site can hand out a copy.

```bash
npm run build:standalone   # builds and verifies aria.html
```

`build:pages` runs this automatically, so the published site always ships a current copy.

The standalone build differs from the hosted page in two ways, both decided at build time by the `__ARIA_STANDALONE__` flag in `src/App.jsx`:

- The Ollama endpoint defaults to `http://localhost:11434` and the ElevenLabs endpoint to `https://api.elevenlabs.io`, instead of the same-origin proxy paths that cannot exist without a server.
- The CORS helper prints `OLLAMA_ORIGINS=* ollama serve`, because a file has no stable origin to name.

### What a `file://` copy does and does not solve

It sidesteps proxy setup and it avoids mixed-content concerns entirely, since a `file://` document is not an HTTPS document. It does **not** bypass CORS: the browser sends `Origin: null` for a local file, Ollama's default allow-list contains `file://*` rather than `null`, and a response carrying no `Access-Control-Allow-Origin` is refused. Ollama must be started with `OLLAMA_ORIGINS=*` (or the request must pass through something that adds the header) or the file will show the offline state just like the hosted page.

`file://` is also not a normal web origin, so a copy cannot be narrowed to a specific allowed origin and any embedded link would have to be absolute. If a copy is blocked anyway, run `npm run dev` and use the served page instead — `http://localhost:5173` is an allowed Ollama origin by default.

`scripts/verify-standalone.mjs` asserts the properties above on every build: no external references, one inline style and script block, the flag substituted, and — by extracting and executing the compiled defaults — that the file really does fall back to direct endpoints.
