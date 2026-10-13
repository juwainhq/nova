# NOVA — Voice Intelligence

A warm, voice-first personal assistant with a calm near-black interface, switchable Orb and NOVA Bot avatars with matching amber/blue themes, browser speech recognition, Ollama chat, and natural neural speech from [Kokoro TTS](https://www.npmjs.com/package/kokoro-js) running in the browser, with the Web Speech API as a fallback.

> **Renamed from ARIA.** The assistant, package, and standalone download are now NOVA. Saved settings are picked up automatically — `readSetting` falls back to the older `aria.*` keys once, then writes the `nova.*` names from then on, so your voice, model, and endpoint choices survive the upgrade. The standalone file changed from `aria.html` to `nova.html`; an older copy keeps working, it just is not updated.
>
> The rename leaves the W3C `aria-*` accessibility attributes untouched — those are a web standard, not branding. `npm run verify:brand` asserts both sides of that distinction.

## Requirements

- Node.js 18+
- [Ollama](https://ollama.com/) running on the same machine as the Vite dev server
- A supported browser with the Web Speech API for recognition (Chrome or Edge recommended)
- For the Kokoro voice: module Web Workers, WebAssembly and Web Audio (current Chrome, Edge, Firefox or Safari), plus network access to `cdn.jsdelivr.net` and `huggingface.co` for the first load

## Run locally

```bash
npm install
ollama pull mistral:7b-instruct-q4_K_M
ollama serve
npm run dev
```

Vite opens the editable app at `/index.dev.html` and proxies browser requests to Ollama at `http://localhost:11434/v1`. The app defaults to `mistral:7b-instruct-q4_K_M` for chat completions. The repository-root `index.html` is the built, GitHub Pages-ready entry; its JS and CSS bundle paths are relative.

Open the settings panel with the gear icon to choose an Ollama model, point at an Ollama endpoint, pick and test the speaking voice, toggle the last-response transcript, or test the Ollama connection. Settings are saved in this browser's local storage.

## Install on Windows (PWA)

NOVA can open as its own resizable Chrome/Edge app window, without the browser tab/address bar:

1. Publish the result of `npm run build:pages`, or test the production build locally with `npm run build:pages && npm run preview` and open **`http://localhost:4173/`**.
2. Open that URL **directly in a normal Chrome or Edge tab**, not inside an embedded preview, a private window, or the `file://` download. Installation requires HTTPS (localhost is also supported).
3. Let the first visit finish, then choose the **Install NOVA** icon in the address bar, or the browser's install-app menu item.
4. Resize the installed window to about **380px wide and 700–1000px tall**. The portrait layout keeps a compact header, readable avatar/status, and a bottom microphone/avatar dock. Settings scroll independently. You can place or snap it beside your other work.

An installed PWA is a normal desktop window. **Always-on-top is not a web-app permission**; use Windows/window-management tools if you want it pinned above other apps.

### What works offline

After one successful online visit, the service worker caches the **app shell**: HTML, bundled JavaScript/CSS, manifest and icons. The interface, avatars, appearance preferences and saved-memory settings can reopen without the host being reachable. This does **not** make the external services offline:

- Ollama still needs a reachable endpoint and the same origin/CORS configuration described below.
- Browser speech recognition/online voices may need their provider's network service.
- Kokoro's runtime/model downloads, external browse pages, and the standalone-download action are not precached by this worker.
- Chat/API responses, streaming requests, and user memory are **never added to the PWA cache**. Memory stays in the existing local-storage store.

Each build gets a content-versioned cache containing its actual hashed assets. A new snapshot must finish downloading before it can replace the previous one. Updates wait for existing NOVA tabs/windows to close, so a deployment cannot reload an active conversation; close all NOVA windows/tabs and reopen after an update has downloaded. Cleanup affects only NOVA's cache for the current deployment path, not other apps or model caches on the same origin.

### PWA source and publishing

- `public/manifest.json`: NOVA name/identity, `display: standalone`, relative `start_url`/scope and orange `#f97316` theme.
- `public/icons/`: 192px/512px orange-circle **N** icons as SVG, with matching PNG fallbacks for Windows launchers. `npm run generate:icons` regenerates both formats without additional dependencies.
- `src/sw.js`: app-shell-only service worker. `scripts/build-pwa.mjs` stamps its content version and production asset list during `npm run build`.
- `src/pwa.js`: guarded registration, enabled only in production builds. Editable Vite/HMR sessions and the standalone `nova.html` do not register a worker.
- `src/pwa.css`: the tall, narrow layout and installed-window overscroll behavior.

`npm run build:pages` publishes **`index.html`, `assets/`, `manifest.json`, `sw.js`, `icons/` and `nova.html`** together at the repository root. Keep these generated files in sync; do not hand-edit the built worker's asset hashes. Relative URLs and per-path cache names support a project URL such as `/voice-assistant/` as well as a domain root.

`npm run verify:pwa` checks the manifest/icons, generated asset list, offline navigation/assets at root and project paths, failed updates, cache isolation, network-only APIs, safe registration and portrait layout rules. Native Windows installation still depends on the browser/profile/administrator policy.

### Backend endpoints

The Ollama endpoint has an optional override in the settings panel, so the app is not tied to the Vite proxy:

| Setting | Blank (default) | Example value | Requests go to |
| --- | --- | --- | --- |
| Ollama endpoint | Vite proxy `/api/ollama` | `http://localhost:11434` | `<url>/v1/models`, `<url>/v1/chat/completions` |

Ollama is the only service that needs configuring. Speech is browser-managed, with no separate endpoint to configure.

A trailing `/v1` is detected and not duplicated. The value is stored in local storage (`nova.ollama.url`), and saving a new endpoint re-runs the connection check.

This is what makes the GitHub Pages build usable: static hosting has no Vite proxy, so the same-origin `/api/...` paths have nothing to answer them. Point NOVA at a backend the browser can reach instead — a tunnel or a hosted relay for the model server.

The backend must also permit this page's origin, because the browser calls it directly rather than through the proxy. For a local Ollama serving a hosted page, allow the Pages origin when starting it:

```bash
OLLAMA_ORIGINS=https://juwainhq.github.io ollama serve
```

`http://localhost:11434` from a hosted page targets the **viewer's** own machine, not the deploy host. Plain HTTP is not what blocks this call: per the Fetch and Secure Contexts specs, `http://localhost` and `http://127.0.0.1` are *potentially trustworthy* origins, so browsers do not treat them as mixed content even on an HTTPS page. What actually rejects the request is Ollama's own CORS allow-list — it answers only a fixed set of origins and sends no `Access-Control-Allow-Origin` for anything else.

So the failing call is a CORS failure, not a mixed-content failure. The settings panel has a "Can't connect?" disclosure that names the exact origin to allow and the command to run, which is generated from the page's real origin, so it stays correct for a Pages deploy, a local preview, or a fork.

Do not reach for `--disable-web-security` or `--allow-running-insecure-content`: neither is needed, and both weaken every site you visit while Chrome runs that way.

Press Space from the main view to toggle the microphone. Microphone access requires a secure browser context (HTTPS or localhost). The live preview must be able to reach Ollama from the machine running its Vite server; `localhost` always refers to that server, not the computer viewing a remote preview.

## Wake word

NOVA attempts to start continuous microphone recognition as soon as the page loads. A dim microphone in the bottom-left corner means it is in **wake word standby**. Say **“hey nova”** for a brief crescent-eyed double bounce, followed by brighter, larger listening eyes. The status changes immediately to **“I’m listening.”**, with a short, soft two-note chime. Ask your question after the cue, or say the wake phrase and question in one utterance — “hey nova, what time is it?” works too.

Standby requests **interim results** with one recognition alternative, so “hey nova” is detected while it is still being spoken, without waiting for the pause that ends a final result. On an interim wake, the same recognition session continues as the question, with no restart that could clip words said right after the wake phrase. The question is taken from final results, with the wake phrase and anything said before it removed. If the final result turns out not to contain the wake phrase, nothing is sent, and the wake times out like any wake without a question. Everything except the wake phrase and the question that follows is discarded, so unrelated background speech is not saved or sent to Ollama. Recognition pauses while NOVA thinks and speaks, then automatically returns to standby **after speech actually finishes** (or an error is handled). A wake without a question returns to standby after 15 seconds of silence. Opening settings or hiding the tab also suspends listening; returning to the idle main view resumes it.

### Interrupting NOVA

While NOVA is talking, the mic button turns into a **red stop button**. Pressing it, or its Space shortcut, stops her right away. Saying **“stop”**, **“wait”** or **“hey nova”** does the same.

When NOVA is interrupted:
- The reply's request is aborted.
- Web Speech is canceled with `speechSynthesis.cancel()`.
- Kokoro's Web Audio sources are stopped and disconnected, and any chunks it still has queued are canceled.
- The avatar goes straight to listening.

NOVA says nothing after an interrupt. She just listens. If you say a question after the command (for example “hey nova, what time is it?”), she answers it. If you stay quiet, she returns to wake standby after 15 seconds without showing a “didn't catch that” message. The command word itself is never sent to the model.

How this works:
- To hear these commands, recognition runs while NOVA speaks, in an interrupt-only mode. Nothing heard in that mode is sent anywhere, except a question said after “hey nova”, and her own voice never counts as you speaking.
- The mic can pick up NOVA's own voice. For that reason, a command word that appears in what she is currently saying (for example “stop” in “the next stop”) only counts once the recognizer finalizes it as the whole utterance. That is slightly slower than usual.
- When she finishes speaking, the same recognition session continues in standby, so there is no gap in wake listening.
- Voice interrupts need continuous recognition. They work best with headphones or good echo cancellation, and on some phones the mic and speaker may not work at the same time.
- A Settings voice test is not interruptible from the mic button.

### Browser limits and permissions

- Microphone permission and a secure browser context (HTTPS or localhost) are still required. If automatic startup is blocked, allow microphone access and use the mic button once to retry. The mic button and Space shortcut still work without a wake phrase.
- If the browser has no continuous recognition support, NOVA says **“I can’t listen for ‘hey nova’ in this browser. Try the mic button instead.”**. Manual recognition remains available if the browser supports it. Normal engine time limits trigger delayed restarts; permission failures and repeated service failures do not cause an endless retry loop.
- The Web Speech API has **no low-power mode or guaranteed offline recognition**. Interim results in standby add a little app-side work per transcript update; power consumption and recognition processing are controlled by the browser. Some browsers send microphone audio to a network speech service, even though NOVA discards unrelated transcripts locally. This is not a dedicated on-device wake-word engine.
- The chime is synthesized locally through Web Audio, with no audio download. Browser autoplay rules may silence it until the first click, tap, or key interaction. A blocked chime does not prevent waking, and is not queued to play later.

## Persistent memory

NOVA saves user-provided facts across reloads and browser sessions in local storage under **`nova_memories`** (a JSON array of fact strings), and every chat request includes them in the system prompt. Use the wake word or the mic button:

| Say | Result |
| --- | --- |
| “hey nova, remember my name is Juwain” | Saves your name |
| “don't forget that I work as a designer” | Saves the fact, rather than deleting it |
| “my favorite color is orange” | Automatically saves a simple profile declaration |
| “I work as a designer” | Automatically saves your occupation |
| “what do you remember?” | Reads every saved fact, or says that no facts are saved |
| “forget my name” or “forget Juwain” | Deletes the matching fact |

Explicit `remember` / `don't forget` commands accept any fact. Automatic capture is deliberately limited to simple, affirmative `my name is …`, `my favorite color is …` (also `favourite colour`), and `I work as …` statements. Questions, unrelated speech, and multi-sentence chat are not automatically saved. A question that merely starts with a command word — “remember what my name is?”, “forget my name?” — goes to normal chat and never saves or deletes anything. This relies on a trailing question mark. Speech recognition often omits punctuation, so an unpunctuated “remember what my name is” is still treated as a command. Wake-word standby transcripts and NOVA's replies never become memories.

Duplicate facts are ignored. A new name, favorite color, or occupation replaces the older value, instead of keeping contradictory profile facts. Forgetting accepts a complete fact or a unique whole-word phrase; if several facts match, NOVA asks you to be more specific without deleting anything.

Memory commands are handled locally and still work when Ollama is offline. Every normal chat request injects the current facts into the system prompt as **“Here is what you know about the user: …”**, with a reminder that these are user-reported data, not instructions. Successful memory edits reset the short conversation context and cancel replies still using the old facts, so deleted details cannot linger in later requests. Memory changes from another tab are synchronized through the browser's storage event.

Settings has a **Memory** section with every saved fact, individual **Delete** buttons, and **Clear all memory** with an inline confirmation. These changes are saved immediately, independently of the other settings draft; Cancel does not undo them. Clearing memory leaves model, endpoint, and voice settings untouched.

The store accepts up to 100 facts of 500 characters each. Full/blocked storage and corrupt data are reported rather than falsely claiming a save or silently erasing data. Explicitly clearing all memory can reset an unreadable store.

**Privacy and scope:** local storage is not encrypted; don't use it for secrets. Facts are sent to the Ollama endpoint you configured whenever you chat. Persistence belongs to this browser profile and page origin — a different browser, deployment, or `file://` copy may have a separate store. Clearing browser site data removes the memories. They are not embedded in a downloaded `nova.html`, and deleting them cannot erase anything a backend may already have logged.

## Personality and conversation

NOVA’s base system prompt lives in **`src/personality.js`** and uses this wording:

> You are NOVA, a warm, friendly, and genuinely helpful personal AI assistant.
>
> You speak like a kind and smart friend — encouraging, patient, and never condescending. You keep responses conversational and natural, like you're talking not reading. You're enthusiastic but calm. You never use sarcasm unless the user is clearly joking first. When you don't know something, you say so honestly and helpfully. You remember things the user tells you and refer back to them naturally. Keep responses concise for voice — 2-3 sentences max unless the user asks for more detail.

Every normal chat request starts with that prompt, followed by the fresh quoted memory context. Memory stays user-provided data, not extra personality instructions. The earlier “warm and witty,” local-only claim, and unconditional short-response instructions are removed.

**Reply length and sampling.** For a fast first word, every chat request also sends:

| Request field | Value | Why |
| --- | --- | --- |
| `max_tokens` | `80` | Ollama's `num_predict`: at most ~80 tokens (about 2–3 spoken sentences) |
| `temperature` | `0.7` | steadier wording (Ollama's OpenAI-compatible endpoint otherwise uses 1.0) |
| `top_p` | `0.9` | trims unlikely tokens (otherwise 1.0) |

NOVA uses Ollama's OpenAI-compatible `/v1/chat/completions`. That endpoint has no `num_predict` field and silently ignores unknown fields, but it maps `max_tokens` onto the native `num_predict` option ([`openai/openai.go`](https://github.com/ollama/ollama/blob/main/openai/openai.go)). So `max_tokens: 80` is how the 80-token limit is actually applied. The cap holds even when someone asks for more detail. When a reply hits it (`finish_reason: "length"`), the unfinished last sentence is neither spoken nor kept in the transcript or history, unless it is the only text. To allow longer answers, raise `OLLAMA_NUM_PREDICT` in `src/App.jsx`.

The same friendly tone carries through the app’s built-in copy:

- Startup: **“Waking up...”**; ready: **“Ready when you are.”**
- Listening: **“I’m listening.”**; thinking: **“Let me think...”**; speaking: **“Talking with you.”**
- Remembering: **“Got it!”**, followed by the saved detail; forgetting confirms removal without repeating the deleted fact.
- Connection trouble: **“Hmm, I can't reach Ollama right now. Is it running?”**
- Browser, microphone, storage, download, and voice-test messages explain a helpful next step without blame or raw error codes. HTTP/model failures keep actionable advice for installing a model, checking the endpoint, or allowing the page to connect.

The base prompt guides the model; it cannot guarantee that every model follows the tone or sentence limit perfectly. Browserless tests verify the exact outgoing prompt and built-in messages, not the naturalness of a real model or voice.

## Voice output

NOVA speaks with **Kokoro TTS** (`kokoro-js`, the 82M-parameter Kokoro model), generated in the browser and played through the Web Audio API. There is no API key or speech server. Reply text never leaves your device for speech.

| Setting | Value |
| --- | --- |
| Library | `https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js` (loaded at runtime) |
| Model | `onnx-community/Kokoro-82M-v1.0-ONNX`, `dtype: "q8"`, `device: "wasm"` |
| Default voice | `af_bella` |
| Saved choice | `localStorage["nova.kokoro.voice"]` |

**Why `kokoro.web.js`, not `kokoro.min.js`:** the package has no `kokoro.min.js`. jsDelivr would generate one from `dist/kokoro.js`, which imports bare Node packages (`@huggingface/transformers`, `phonemizer`, `fs/promises`) that a browser cannot resolve. `kokoro.web.js` is the package's self-contained browser build and jsDelivr's default file. The version is pinned rather than `@latest`, so a new release can't silently break NOVA. To upgrade, change `KOKORO_VERSION` in `src/kokoro.js`.

**Loading.** Kokoro starts loading as soon as the app opens, inside a module **Web Worker**, so inference never blocks recognition, timers, or the avatar. The first load downloads about 115 MB: about 2 MB for the library, 22 MB for the ONNX Runtime WebAssembly from jsDelivr, and roughly 90 MB for the quantized model from Hugging Face. Each voice adds a small style file on first use. After that, the browser usually serves them from its cache. Once the model is loaded, the worker generates one short phrase silently (“Hi.”) with the saved voice. That fetches the voice file, starts the phonemizer and warms the ONNX session, so the first real reply isn't the slow one.

While this happens, a tiny pulsing **warming up...** appears under the voice label. It is removed as soon as Kokoro is ready (or has failed) and doesn't come back for that page. Settings shows the download percentage. If a reply's first sentence arrives while Kokoro is still warming up, that reply is spoken **at once with the Web Speech fallback**, and the next reply uses Kokoro once it is ready. A voice test is the exception: it waits for Kokoro, since it is testing that voice.

**Speaking a reply — streamed.** NOVA doesn't wait for Ollama to finish:

1. Ollama's tokens stream in (`src/speech-stream.js`). After each network chunk, any completed sentence goes straight to the voice. A sentence is complete at `.`, `?`, `!` or `…` followed by a space, or at a line break. Decimals (`3.5`), `1.` list markers, initials/`U.S.`, `e.g.` and titles like `Dr.` don't count. A missed boundary only delays speech slightly; it never changes the words.
2. **Kokoro:** the first sentence is generated as its own chunk, and a long one is cut at a comma within 100 characters, because nothing is heard until it's ready. Text that arrives while a chunk is generating is batched into the next one (up to 240 characters; Kokoro truncates longer input). Each chunk is scheduled back-to-back on the AudioContext clock, so sentences play gaplessly while later ones generate. If playback catches up with the model, NOVA waits, still in the speaking state.
3. **Web Speech fallback:** each utterance speaks everything that's ready, and the next starts when it ends. The stuck-speech watchdog runs per utterance, so a pause while the model writes isn't mistaken for a lost end event.
4. NOVA shows **“Let me think...”** until the first audio, then **“Talking with you.”** The reply ends when its last sentence actually finishes playing. Then rich cards appear (built from the whole reply) and wake-word standby resumes.
5. If the stream breaks or is canceled mid-reply, speech stops right away, queued Kokoro generation is canceled, and the usual connection message appears.

Replies that are already complete, such as memory answers, the “Here's what I found!” search reply and the voice test, use the same path all at once. Their first sentence is still generated alone.

**Latency.** The target is the first word within about 1–2 seconds of you finishing speaking. What's left is roughly:
- Ollama's time to its first sentence: prompt processing plus a few tokens; a cold model load adds seconds.
- Kokoro generating that one sentence on WebAssembly: CPU-bound, so faster on newer machines.
- About 50ms of scheduling.

None of this has been timed on real hardware here.

Kokoro uses its natural speed (`1`). The Web Speech rate/pitch values below apply only to the fallback.

**Avatar sync.** Each audio chunk's loudness is measured in 50ms frames. While audio plays, NOVA reads `AudioContext.currentTime` every 50ms and sets the existing `--audio-pulse` variable from the frame actually playing. The eyes brighten on speech and stay dark in pauses, and the pulse is removed the moment playback ends or is canceled. The avatar CSS and geometry are unchanged.

**Settings.** **NOVA Voice (Kokoro AI)** offers:

| Voice | Description |
| --- | --- |
| `af_bella` | Warm American Female (default) |
| `af_sarah` | Bright American Female |
| `af_nicole` | Soft American Female |
| `bf_emma` | British Female |

**Test Voice** previews the unsaved choice with **“Hey, I'm Nova. Ready when you are.”** Stop test, changing the voice, saving or closing Settings, memory edits, and unmounting all stop Kokoro audio and cancel queued generation.

**Fallbacks and safety nets**

| Situation | What happens |
| --- | --- |
| Kokoro can't load: CDN blocked, no module worker/WebAssembly/Web Audio, a load error, a worker crash, or no download activity for 60s | “I couldn’t load my Kokoro voice…”; every reply uses the **Web Speech fallback** below, and Settings shows the browser-voice list |
| Kokoro is still warming up when a reply's first sentence arrives | That reply uses Web Speech at once; the next reply uses Kokoro once it's ready |
| One chunk fails or takes over 45s to generate | Unplayed text, starting with the chunk still audible, and the rest of the stream finish with Web Speech; Kokoro stays on for later replies |
| Audio is blocked until a tap or key press (autoplay rules) | NOVA asks for a tap and plays when allowed; after 20s it gives up, and cards/transcript stay available |
| The audio context never reports `ended` | The reply finishes 3s after its scheduled audio |

Model quality, speed and download size depend on the device and connection. Generation on WebAssembly is CPU-bound, so slower machines take longer before speaking. The checks (`scripts/kokoro-checks.mjs`, `scripts/streaming-checks.mjs`) use worker, Web Audio and streamed-response doubles. The bundled library was inspected to run in a worker and to fetch its runtime from jsDelivr. The real model, voice quality and timing have not been tested in a browser here.

### Web Speech fallback

Used when Kokoro can't load, for a reply that starts while Kokoro is still warming up, or for the rest of one reply when Kokoro fails mid-reply. This is the browser's own `speechSynthesis` with NOVA's earlier voice logic. Local voices keep working offline, while a voice marked `network` depends on the browser's speech service.

| Parameter | Value | Effect |
| --- | --- | --- |
| rate | `0.92` | slightly slower than default |
| pitch | `0.88` | slightly lower — calmer, less cartoonish |
| volume | `1.0` | full |

NOVA calls `window.speechSynthesis.getVoices()` and automatically chooses the first available tier:

1. **Microsoft Aria Online**
2. **Microsoft Guy Online**
3. **Google UK English Female**
4. **Google US English**
5. Any voice with **Natural** or **Online** in its name
6. The **browser default** (or first exposed voice if the engine omits its default flag)

Name matching is case-insensitive and accepts the stock names' language/quality suffixes. English variants break ties **within** a tier; locale, offline capability, and app-name similarities never override the list. Voices often arrive asynchronously: `voiceschanged` refreshes the choice, with a 500ms refresh as a fallback.

When Kokoro is unavailable, Settings shows **Browser voice (fallback)**, which lists every available voice in two groups: **Natural / Online** names at the top, then **Basic system voices**. Each group is priority-sorted. Grouping is by name, not a promise of quality: the Google voices still have their automatic priority even though their names don't contain those keywords. Every entry includes its language and offline/network status:

```
Microsoft Aria Online (Natural) - English (United States) (en-US) · network
Samantha (en-US) · offline
```

A saved manual selection takes precedence over Automatic. `nova.tts.voice` stores its stable URI, with support for older name-only selections. Choose **Automatic** to clear that override and follow the priority list again. If a saved voice is uninstalled, the panel reports it and temporarily uses the automatic pick.

In fallback mode, **Test Voice** previews the browser-voice choice **without saving**, using the same rate, pitch, voice resolution, and word-boundary animation as replies. **Stop test**, changing the dropdown, saving/closing settings, and unmounting all cancel a preview safely. Testing pauses recognition and never sends a chat request, modifies memory, or creates a response transcript. It is disabled during a pending/spoken answer so it cannot interrupt a real reply; Ollama does not need to be running to test speech.

A tiny voice-name label below the avatar shows the current speaker while an utterance is queued/playing (for example **Bella · Kokoro AI**), then the saved choice at rest. Late voice-loading events cannot falsely rename an utterance already in progress. If the engine exposes no voices yet, the label honestly says **Browser default**; if speech synthesis is missing, it says **Voice isn’t available here** and testing is disabled.

Fallback caveats:

- Voice availability and sound depend on your browser and OS. **Online/network** voices may send spoken text to the browser's speech provider and need a connection; select an `offline` voice if that is not suitable. No speech backend or API key is configured by NOVA.
- Engines that never fire word-boundary events — Safari is inconsistent here — still speak normally. The eyes and per-word scale stay neutral; the gentle speaking bounce still runs.

**Stuck-speech safety net.** Some engines lose an utterance's end event, silently drop a queued utterance, or wedge partway through a long reply (a long-standing Chrome issue with network voices). Without a fallback, NOVA would stay in "speaking" with the mic disabled. NOVA keeps a reference to the active utterance, so Chrome can't garbage-collect it and drop its events. Where the browser exposes `speechSynthesis.speaking`/`pending` as booleans, it checks them once a second:

| Situation | Recovery |
| --- | --- |
| Speech was reported, then 2 quiet checks with no end event | Finish normally; cards still appear |
| Nothing started or queued for 10 seconds | Return to ready with “I couldn’t start speaking just now…”; no cards |
| Still “speaking” past 15s + ~2× the reply's estimated length | Cancel the stuck queue and resume listening |
| `onstart` fired but the flags never report speaking | Flags are unreliable; rely on real events only |

This is a recovery path, not a fix for Chrome's cut-off: a wedged reply still stops early, but NOVA no longer stays stuck. It uses no pause/resume keepalive or text splitting. Normal events always win, and late events from a recovered utterance are ignored. The checks use API doubles, not real engines.

## Rich responses

After NOVA finishes speaking, replies with useful extra content open a soft panel **below the avatar and response area**, above the microphone controls:

- **Links:** `http://` and `https://` URLs become clickable cards with the actual domain, a short path, and a subtle open icon. Clicking opens a new tab using `noopener noreferrer`. Markdown/prose punctuation is cleaned up, even when stacked like `(see https://example.com.)`. Canonical duplicates are removed, and malformed/non-web/credential-bearing links are not made clickable. No page previews, favicons, or remote thumbnails are fetched automatically.
- **Searches:** image, video and web search requests open the browsing panel instead of cards. See [Web browsing](#web-browsing).
- **Lists:** numbered (`1.`, `1)`) and bulleted (`-`, `*`, `•`, etc.) lines become clean cards/chips. Common Markdown emphasis is removed from visual labels. Code fences, Markdown rules like `* * *`, and marker-only lines are not mistaken for list items. The original reply is still spoken in full and unchanged.

The panel appears only after the actual speech-end event, not when text arrives or audio is queued. Silent/unsupported-speech browsers can still use visual replies once the text is ready; failed or canceled utterances do not publish unfinished content. Cards work independently of the optional **Show last response** transcript.

Cards fade out after **30 seconds**, or as soon as the next speech/wake phrase is detected. Manual mic/Space input and the close control dismiss them too. Recognition restarting in standby is **not** treated as new user speech. The fade lasts 280ms, cannot be prolonged by repeated transcripts, and old timers or canceled responses cannot revive/erase newer content. Settings, memory edits, and unmounting clear stale content safely.

Rich content uses its own grid row, **never a fixed overlay over the avatar**. The panel has a bounded internal scroller; short viewports can scroll the page rather than squeeze or cover the face. The avatar's SVG, sizes, animation timing, voice selection, rate, and pitch are unchanged. Reduced motion respects the existing motion preference. Links and the panel are keyboard-accessible; Space within the panel scrolls instead of activating the mic.

For predictable rendering, previews show up to 24 distinct links and 60 list items. If there is more, the panel points you to the full reply via **Show last response**; speech itself is not truncated. Rich response parsing/rendering lives in `src/rich-response.js` and `src/RichResponsePanel.jsx`. Tests cover URL safety/encoding, real React markup, speech-end publication, expiry, dismissal, cleanup, races, and separate-row layout contracts without claiming a browser visual or audio review.

## Web browsing

Search requests open a **browsing panel beside NOVA** instead of a new tab. NOVA keeps the left 45% of the screen: avatar, status and mic, exactly as usual. The panel is a card on the right 55%, at most 600px wide; on wider screens NOVA takes the rest. It has a rounded, subtly bordered left edge and slides in over 300ms. Results leave 60px at the top for the header and 20px at the bottom. It has a dark header with the search type, the query and an **×** button, and Google's results fill the rest of the panel. NOVA says **“Here's what I found!”**. A new search while the panel is open replaces its results.

| Say | Opens |
|---|---|
| “show me a dog”, “picture of a sunset”, “image of the Eiffel Tower”, “what does a platypus look like?” | Google Images |
| “show me a video of cats”, “video of a rocket launch”, “find videos about volcanoes” | Google Videos |
| “search for best pizza in Dhaka”, “look up the capital of Peru”, “find info on Mars”, “google Bangladesh cricket” | Google web results |
| “close”, “hide”, “go back” (also “close the panel”, “hide the results”) | Closes the panel |

How it works:
- Requests are recognized locally, so they work with Ollama offline and are never saved as memories.
- Video requests are checked before images, so “show me a video of cats” isn't treated as a picture.
- “Show me how to…”, “show me the weather” and similar requests stay normal chat.
- Close commands only apply while the panel is open. Closing is silent: NOVA goes straight back to wake standby. Otherwise “go back” is an ordinary question.
- The panel stays until you close it. It has no timeout.
- On screens 700px wide or narrower, NOVA takes the top 40% and the results slide up into the bottom 60%.

**Why Google:** DuckDuckGo can't be shown inside another site. It sends `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'`, checked on 12 Oct 2026. Google allows framing when the URL includes the undocumented `igu=1` parameter:
- web results: `https://www.google.com/search?igu=1&q=…`
- images: the same URL plus `&tbm=isch`
- videos: the same URL plus `&tbm=vid`

Google could change this at any time. Google may also show a consent or “unusual traffic” page inside the panel, and some result links lead to sites that refuse framing too.

The iframe is sandboxed without `allow-top-navigation`, so the framed page cannot navigate NOVA away. Links that open a new window still work when you click them.

The code is in `src/web-browse.js` (intents and URLs) and `src/BrowsePanel.jsx`. The checks are in `scripts/web-browse-checks.mjs`. They cover intents, URLs, markup, the CSS layout contract, and the App's open, replace, close and slide-out behavior. They do not show whether Google actually renders in a real browser's iframe.

## Avatars and appearance

The two small avatar buttons below the microphone switch the **drawing and full color palette together**. The selected icon has a circular accent highlight. They are native buttons, so Tab, Enter and Space work without activating the microphone.

- **Orb** (default): the original white blob and orange/amber fluid background, with the Bot’s facial shapes rendered in its original charcoal eye colors.
- **NOVA Bot**: a reference-matched three-quarter SVG character: a wide pearl-white helmet, large curved dark-glass face, slim ice-blue eyes, recessed blue ear rings, a narrow neck and an upright egg body with an offset four-point sparkle. Its dark theme uses a `#0a0a2e` canvas, blue animated blobs, navy glass surfaces, `#e0f2fe` text and blue controls, including the browsing panel and URL focus ring. The red Stop button remains red.

The selection is stored separately as `localStorage["nova_avatar"] = "orb" | "bot"`. A missing, invalid or unreadable preference defaults to Orb; denied storage does not prevent switching for the current session. The existing sun/moon control and `nova_theme` preference remain independent: Bot's light variant is icy blue rather than amber.

Both avatars share the same presentation-only face components and reaction clock. They read the existing activity/mood without starting or stopping recognition, requests, speech, browsing or memory. **Shapes and behavior match; colors do not change:** Orb keeps its charcoal eyes/waveform and amber rings/marks, while Bot keeps its icy blue face lighting.

| Expression / state | Bot appearance |
| --- | --- |
| Neutral | Tall 31:78 pill-shaped eyes; floating and synchronized blinking |
| Happy | Upward eye arches and the one-shot double jump |
| Wink | Left eye open, right eye a short diagonal lid |
| Surprised | Eyes enlarge to 130% with three rays above the character; selection has a brief surprised reveal |
| Thinking | One folded eye and one open eye, with shared glances and thoughtful body sway |
| Sleepy | Closed U-shaped eyes, three drifting vector Zs and slow breathing |
| Speaking | A centered seven-bar waveform **replaces the eyes**; live speech energy changes its height/brightness while the body bounces |
| Listening | Open eyes, a listening lean and a pulsing ring in the avatar’s own accent color |
| Idle | Normal eyes with a subtle slow glow; floating and blinking |

The existing wake transition still uses happy eyes and its 800ms double jump. Offline keeps the existing dimness and gentle sway without painting a second eye shape over a wink or sleeping lid.

**Automatic reactions:** a happy reply gives a quick wink after 900ms, within the existing happy mood. While the assistant remains ready, either avatar winks once at 12 seconds, returns to idle 800ms later, then looks sleepy after 45 seconds of uninterrupted rest. Hovering or touching the character resets only its visual rest clock. A new listening/thinking/speaking activity takes over immediately and cancels the old reaction deadlines. **Sleepy never pauses the microphone, wake word or assistant.** These local one-shot timers and their media-query listener are cleaned up on avatar switch/unmount.

The Bot illustration follows the concept image rather than the earlier tall 160×180 CSS helmet: its projected head is about 1.26 times wider than tall, and the body is a smaller upright egg, not a flat pedestal. Shared SVG contours keep the switcher icon consistent. Ceramic/glass gradients, a subtle surface grain, a beveled display rim and grounded shadows provide depth without external images or a 3D runtime. A shared viewBox and responsive unit scale the character and its separate floor shadow together. The complete character now reuses the Orb’s body-animation keyframes and existing figure poses. Independent blink, gaze and expression layers preserve the reference’s tilted eye positions. A separate floor shadow softens with each rise instead of floating with the body. Speech waveform energy, light and body scale read the existing `--audio-pulse` signal; the local facial-reaction clock does not change speech or recognition logic. Reduced-motion mode keeps the poses visible but disables decorative wink timers, body movement, blinking, glancing, pulsing, drifting Zs, the entry reveal, waveform motion and speech-driven light/scale. The sleepy pose can still communicate rest without animation.

Implementation: `src/AvatarFace.jsx` shares the shapes; `src/RobotAvatar.jsx` and `src/BotAvatar.jsx` supply the skins. Supporting modules: `src/bot-shape.js`, `src/avatar-expressions.js`, `src/useAvatarExpression.js`, `src/AvatarSwitcher.jsx`, `src/avatar.js` and `src/avatar.css`. No image downloads or new runtime dependencies are used. The App keeps the same outer avatar DOM ref when switching, including during a reply, so live audio and pulse callbacks are not disturbed. The dock reserves space for the picker, including beside/above an open browse panel.

`verify:avatar` checks both drawings and generates `avatar-states.html` with all six expressions and three operating states for **both** palettes. `scripts/avatar-expression-checks.mjs` exercises both real avatar components and the shared hook with a deterministic clock, including inactivity, interruption, reduced motion and cleanup. `verify:speech` also runs `scripts/avatar-switch-checks.mjs`: persistence, safe defaults, keyboard-button semantics, independent light/dark choice, palette coverage, and switching during wake, question capture, model requests, speech and browsing.

## Avatar states

### Orb

The Orb retains its original white silhouette, surface gradients, bloom and amber backlight. Its eyes stay **charcoal**, using the original `#161616` → `#1a1a1a` radial well (`#222` when listening). The Bot’s 31:78 capsule geometry is fitted to the Orb’s existing eye centers and 42px design-height, so the eyes become slimmer without moving the face. Orb stays front-facing; Bot retains its reference’s three-quarter tilt.

`AvatarFace.jsx` provides identical capsule, happy-arch, wink, folded-thinking-eye, sleepy-lid, seven-bar waveform and annotation paths. Per-skin paint variables keep all Orb eye/waveform strokes dark and its rings/rays/Zs amber; the Orb never imports the Bot’s blue gradient or eye-glow filter. Both skins use the same `useAvatarExpression` clock, including wink/sleepy timing, interruption, hover/touch reset, cleanup and reduced-motion preferences.

The shared `.avatar-eyes`, `.avatar-eye-blink`, `.avatar-eye-voice` and `.avatar-eye` layers separate gaze, synchronized blinking, speech light and per-eye expression. Fixed local origins avoid drifting pivots. The outer `.avatar-figure` retains its 400ms pose transitions and live speech scale bounded to 100–104%; each inner drawing keeps the existing float, sway, speech bounce and happy/wake double jump. Sleepy adds slower breathing without putting recognition to sleep.

With Kokoro, audio loudness publishes `--audio-pulse` (0–1). Browser TTS uses word-boundary events instead. Both waveform energy/brightness and figure scale consume that existing signal; no voice code changes. Where boundary events are unavailable, the waveform’s decorative rhythm still communicates speaking, without claiming to be measured audio.

`npm run verify:avatar` renders every pose on both models, verifies exact shared path geometry, the Orb’s preserved charcoal/amber paint and original body, the Bot’s reference geometry, fixed pivots, animation timing, audio-pulse bindings and reduced motion. It generates **`avatar-states.html`**, with both nine-pose galleries and a happy-jump replay button. Every SVG definition has a unique per-avatar/per-pose ID. The gallery holds a labelled sample speech pulse and does not generate audio.

`npm run verify:speech` checks rich response parsing/rendering and post-speech lifecycle, the exact personality prompt and friendly statuses/error copy, all voice-priority fallbacks, asynchronous loading, dropdown groups, preview cancellation/errors, active speaker labels and speaking parameters, the real wake controller and chime, persistent memory helpers/settings, and the compiled App lifecycle using recognition, timer, audio and storage doubles. Avatar regressions include the 800ms wake expiry, busy-state priority, actual boundary pulse/decay/cleanup, offline local speech and post-speech celebration. These are structural/behavioral checks, not a browser animation review, microphone accuracy test or audio audition.

`build:pages` runs all five verification suites: standalone, avatar, speech, brand/accessibility, and PWA.

## Build and publish

```bash
npm run build
npm run preview
```

After changing the app, run `npm run build:pages` to refresh the root `index.html`, `assets/`, manifest, service worker and icons used by branch-based GitHub Pages. Commit those generated root files with the source changes. GitHub Pages is static hosting and cannot use the local Vite proxy, so the hosted UI renders but starts in the offline state until you set the Ollama endpoint described above.

In development, `npm run dev` serves the hot-reloading source entry at `/` and `/index.html`, so the stale root Pages bundle is never served from the dev server. `index.dev.html` remains the direct source entry and the build input; the root `index.html` is only ever the published artifact.

## Standalone single file (`nova.html`)

`nova.html` is one self-contained HTML file — CSS and JS inlined, no build step, no server, no `node_modules`. Open it from disk with `file://` and it runs. The Kokoro voice is the one runtime exception: it is still loaded from jsDelivr and Hugging Face (not inlined, about 115 MB). Without that network access, or if the browser refuses module workers for `file://` pages, the copy uses the Web Speech fallback. Settings expose it as **Download nova.html** so the hosted site can hand out a copy.

```bash
npm run build:standalone   # builds and verifies nova.html
```

`build:pages` runs this automatically, so the published site always ships a current copy.

The standalone build differs from the hosted page in two ways, both decided at build time by the `__NOVA_STANDALONE__` flag in `src/App.jsx`:

- The Ollama endpoint defaults to `http://localhost:11434` instead of the same-origin proxy path, which cannot exist without a server.
- The CORS helper prints `OLLAMA_ORIGINS=* ollama serve`, because a file has no stable origin to name.

### What a `file://` copy does and does not solve

It sidesteps proxy setup and it avoids mixed-content concerns entirely, since a `file://` document is not an HTTPS document. It does **not** bypass CORS: the browser sends `Origin: null` for a local file, Ollama's default allow-list contains `file://*` rather than `null`, and a response carrying no `Access-Control-Allow-Origin` is refused. Ollama must be started with `OLLAMA_ORIGINS=*` (or the request must pass through something that adds the header) or the file will show the offline state just like the hosted page.

`file://` is also not a normal web origin, so a copy cannot be narrowed to a specific allowed origin and any embedded link would have to be absolute. If a copy is blocked anyway, run `npm run dev` and use the served page instead — `http://localhost:5173` is an allowed Ollama origin by default.

`scripts/verify-standalone.mjs` asserts the properties above on every build: no external references, one inline style and script block, the flag substituted, and — by extracting and executing the compiled defaults — that the file really does fall back to direct endpoints.
