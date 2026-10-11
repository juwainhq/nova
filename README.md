# NOVA — Voice Intelligence

A local, voice-first AI assistant with a calm warm near-black interface, a softly glowing orb avatar, browser speech recognition, Ollama chat, and speech output through the browser's built-in Web Speech API.

> **Renamed from ARIA.** The assistant, package, and standalone download are now NOVA. Saved settings are picked up automatically — `readSetting` falls back to the older `aria.*` keys once, then writes the `nova.*` names from then on, so your voice, model, and endpoint choices survive the upgrade. The standalone file changed from `aria.html` to `nova.html`; an older copy keeps working, it just is not updated.
>
> The rename leaves the W3C `aria-*` accessibility attributes untouched — those are a web standard, not branding. `npm run verify:brand` asserts both sides of that distinction.

## Requirements

- Node.js 18+
- [Ollama](https://ollama.com/) running on the same machine as the Vite dev server
- A supported browser with the Web Speech API (Chrome or Edge recommended)

## Run locally

```bash
npm install
ollama pull mistral:7b-instruct-q4_K_M
ollama serve
npm run dev
```

Vite opens the editable app at `/index.dev.html` and proxies browser requests to Ollama at `http://localhost:11434/v1`. The app defaults to `mistral:7b-instruct-q4_K_M` for chat completions. The repository-root `index.html` is the built, GitHub Pages-ready entry; its JS and CSS bundle paths are relative.

Open the settings panel with the gear icon to choose an Ollama model, point at an Ollama endpoint, pick the speaking voice, toggle the last-response transcript, or test the Ollama connection. Settings are saved in this browser's local storage.

### Backend endpoints

The Ollama endpoint has an optional override in the settings panel, so the app is not tied to the Vite proxy:

| Setting | Blank (default) | Example value | Requests go to |
| --- | --- | --- | --- |
| Ollama endpoint | Vite proxy `/api/ollama` | `http://localhost:11434` | `<url>/v1/models`, `<url>/v1/chat/completions` |

Ollama is the only service that needs configuring. Speech output is local, so there is nothing else to point anywhere.

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

NOVA attempts to start continuous microphone recognition as soon as the page loads. A dim microphone in the bottom-left corner means it is in **wake word standby**. Say **“hey nova”** to brighten and grow the avatar’s eyes, change the status to **LISTENING**, and hear a short, soft two-note chime. Ask your question after the cue, or say the wake phrase and question in one utterance — “hey nova, what time is it?” works too.

Standby requests final transcripts only, with one recognition alternative, and discards everything except the wake phrase. Unrelated background speech is not saved or sent to Ollama. Full question input uses interim results as well. Recognition pauses while NOVA thinks and speaks, then automatically returns to standby **after speech actually finishes** (or an error is handled). A wake without a question returns to standby after 15 seconds of silence. Opening settings or hiding the tab also suspends listening; returning to the idle main view resumes it.

### Browser limits and permissions

- Microphone permission and a secure browser context (HTTPS or localhost) are still required. If automatic startup is blocked, allow microphone access and use the mic button once to retry. The mic button and Space shortcut still work without a wake phrase.
- If the browser has no continuous recognition support, NOVA displays **“Wake word not supported — use the mic button”**. Manual recognition remains available if the browser supports it. Normal engine time limits trigger delayed restarts; permission failures and repeated service failures do not cause an endless retry loop.
- The Web Speech API has **no low-power mode or guaranteed offline recognition**. Final-only standby reduces app-side work, but power consumption and recognition processing are controlled by the browser. Some browsers send microphone audio to a network speech service, even though NOVA discards unrelated transcripts locally. This is not a dedicated on-device wake-word engine.
- The chime is synthesized locally through Web Audio, with no audio download. Browser autoplay rules may silence it until the first click, tap, or key interaction. A blocked chime does not prevent waking, and is not queued to play later.

## Persistent memory

NOVA saves user-provided facts across reloads and browser sessions in local storage under **`nova.memory`** (a JSON array of fact strings). Use the wake word or the mic button:

| Say | Result |
| --- | --- |
| “hey nova, remember my name is Juwain” | Saves your name |
| “don't forget that I work as a designer” | Saves the fact, rather than deleting it |
| “my favorite color is orange” | Automatically saves a simple profile declaration |
| “I work as a designer” | Automatically saves your occupation |
| “what do you remember?” | Reads every saved fact, or says that no facts are saved |
| “forget my name” or “forget Juwain” | Deletes the matching fact |

Explicit `remember` / `don't forget` commands accept any fact. Automatic capture is deliberately limited to simple, affirmative `my name is …`, `my favorite color is …` (also `favourite colour`), and `I work as …` statements. Questions, unrelated speech, and multi-sentence chat are not automatically saved. Wake-word standby transcripts and NOVA's replies never become memories.

Duplicate facts are ignored. A new name, favorite color, or occupation replaces the older value, instead of keeping contradictory profile facts. Forgetting accepts a complete fact or a unique whole-word phrase; if several facts match, NOVA asks you to be more specific without deleting anything.

Memory commands are handled locally and still work when Ollama is offline. Every normal chat request injects the current facts into the system prompt as **“Here is what you know about the user: …”**, with a reminder that these are user-reported data, not instructions. Successful memory edits reset the short conversation context and cancel replies still using the old facts, so deleted details cannot linger in later requests. Memory changes from another tab are synchronized through the browser's storage event.

Settings has a **Memory** section with every saved fact, individual **Delete** buttons, and **Clear all memory** with an inline confirmation. These changes are saved immediately, independently of the other settings draft; Cancel does not undo them. Clearing memory leaves model, endpoint, and voice settings untouched.

The store accepts up to 100 facts of 500 characters each. Full/blocked storage and corrupt data are reported rather than falsely claiming a save or silently erasing data. Explicitly clearing all memory can reset an unreadable store.

**Privacy and scope:** local storage is not encrypted; don't use it for secrets. Facts are sent to the Ollama endpoint you configured whenever you chat. Persistence belongs to this browser profile and page origin — a different browser, deployment, or `file://` copy may have a separate store. Clearing browser site data removes the memories. They are not embedded in a downloaded `nova.html`, and deleting them cannot erase anything a backend may already have logged.

## Voice output

Replies are spoken with the browser's own Web Speech API. There is no API key, account, or separate speech backend: a local voice keeps working with the machine offline, while a voice marked `network` depends on the browser's speech service. The speech path uses `speechSynthesis.speak()` with no fallback service behind it.

Speech is fixed at the values NOVA is specified to use, in `src/speech.js`:

| Parameter | Value | Effect |
| --- | --- | --- |
| rate | `0.95` | slightly slower than default |
| pitch | `0.9` | slightly lower — calmer, less cartoonish |
| volume | `1.0` | full |

**NOVA Voice** in the settings panel lists every voice `speechSynthesis.getVoices()` reports, English first, best first, then the rest by language. Each entry is labelled with its language and whether it works offline:

```
Samantha (en-US) · offline
Microsoft Aria Online (Natural) - English (United States) (en-US) · network
```

Until you choose one, NOVA picks the most natural English voice the machine offers: neural and "Natural"/"Enhanced" names first, then well-regarded local voices, with a bonus for Apple's and Microsoft's better defaults and for Microsoft's voice actually named *Aria* — a stock voice name that happens to match the app's former name, and unrelated to this rename. Offline voices are favoured when quality is otherwise equal.

Two caveats worth knowing:

- The most natural voices on a machine are often **cloud-backed** (Google's and Microsoft's "Online (Natural)" entries), so they stop working offline. The label says which is which; pick an `offline` voice if the machine is ever disconnected.
- Engines that never fire word-boundary events — Safari is inconsistent here — still speak normally, but the avatar's per-word pulse stays steady instead of reacting.

`nova.tts.voice` in local storage holds your choice. If that voice is later uninstalled, the panel says so and falls back to the automatic pick rather than switching silently.

## Avatar states

The avatar has no mouth. Every expression comes from two channels only — the eyes and the body — so the SVG in `src/RobotAvatar.jsx` stays purely presentational and `src/index.css` drives all of it from state classes on `.avatar-container`.

Eyes are layered three deep so the kinds of motion compose instead of overwriting each other, because nested transforms multiply while a shared element would let the animation win outright:

| Layer | Carries | Mechanism |
| --- | --- | --- |
| `.robot-eye` | gaze | animated `translateX` |
| `.eye-scale` | size: grow, squint, droop | transitioned `scale()` driven by `--eye-sx` / `--eye-sy` |
| `.eye-lid` | blinking, iris glow | animated `scaleY`, `drop-shadow` |

Body motion is split the same way: `.avatar-figure` holds the pose (`--figure-scale`, `--figure-tilt`) as a transitioned transform, and `.robot-avatar` carries the rhythm (`orb-float`, `orb-wobble`, …) as an animation, so pose and rhythm never share a `transform`.

| State | Eyes | Body |
| --- | --- | --- |
| Idle | soft steady glow, occasional slow blink | gentle float up and down |
| Listening | grow 16% and brighten | 5° tilt in, slow float, pulse ring |
| Thinking | gaze side to side, left eye squints | wobble, 3% smaller |
| Speaking | wider, brighten with the voice, rapid blinks | 5% bigger, swells on each word |
| Happy | crescents replace the iris | quick jump, then small bounces |
| Offline | droop, dim to half brightness | slow sad sway |

Speaking is driven by real data, not a guess: the speech engine's word-boundary events publish `--audio-pulse` on the container. Eye glow and the body's per-word swell both read that one value, so the movement tracks the voice. Engines that never fire boundary events simply hold the speaking animation steady.

"Happy" is inferred from a reply completing without error, held for 1.5 s and then released — the counterpart to Offline. It is one state change in `askAria`; swapping it for sentiment analysis of the answer text would be a small change.

The offline notice sits **below** the orb rather than over it, so the drooping eyes stay visible.

`npm run verify:avatar` checks all of the above — it renders the avatar through React and inspects the stylesheet, so a reworded selector or a dropped layer fails the build rather than silently flattening the animation. It also writes `avatar-states.html`, a sheet of every state built from the real stylesheet and the real markup, so the motion can be reviewed without a microphone, a model or a network.

`npm run verify:speech` does the same job for voice selection: it runs the real scorer against a synthetic machine and asserts what it picks, that the speaking parameters are the specified values, and that a non-English voice cannot displace an available English voice. It also exercises the real wake-word controller, chime scheduling, persistent memory helpers, settings controls, and compiled App lifecycle with recognition, timer, audio, and storage doubles — including waiting for speech completion, permission failures, restarts, manual fallback, cross-session memory, remembered-fact prompt context, forgetting, storage failures, and cleanup. These checks verify behaviour structurally, not microphone accuracy or how the chime sounds.

`build:pages` runs all four verification suites: standalone, avatar, speech, and brand/accessibility.

## Build and publish

```bash
npm run build
npm run preview
```

After changing the app, run `npm run build:pages` to refresh the root `index.html` and `assets/` bundle used by branch-based GitHub Pages. Commit those generated root files with the source changes. GitHub Pages is static hosting and cannot use the local Vite proxy, so the hosted UI renders but starts in the offline state until you set the Ollama endpoint described above.

In development, `npm run dev` serves the hot-reloading source entry at `/` and `/index.html`, so the stale root Pages bundle is never served from the dev server. `index.dev.html` remains the direct source entry and the build input; the root `index.html` is only ever the published artifact.

## Standalone single file (`nova.html`)

`nova.html` is one self-contained HTML file — CSS and JS inlined, no build step, no server, no `node_modules`. Open it from disk with `file://` and it runs. Settings expose it as **Download nova.html** so the hosted site can hand out a copy.

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
