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

Open the local address printed by Vite. The dev server proxies browser requests to Ollama at `http://localhost:11434/v1`, so browser requests remain same-origin. The app uses `mistral:7b-instruct-q4_K_M` for chat completions.

Open the settings panel with the gear icon to choose an Ollama model, add an ElevenLabs API key, load and select an ElevenLabs voice, toggle the last-response transcript, or test the Ollama connection. Settings are saved in this browser's local storage, including the API key; without a key, replies use the browser's built-in speech synthesis. ElevenLabs calls are proxied by Vite to avoid browser CORS issues.

Press Space from the main view to toggle the microphone. Microphone access requires a secure browser context (HTTPS or localhost). The live preview must be able to reach Ollama from the machine running its Vite server; `localhost` always refers to that server, not the computer viewing a remote preview.

## Build

```bash
npm run build
npm run preview
```
