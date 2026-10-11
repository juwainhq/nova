# NOVA — Voice Intelligence

A warm, voice-first personal assistant with a calm near-black interface, a softly glowing orb avatar, browser speech recognition, Ollama chat, and speech output through the browser's built-in Web Speech API.

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

Open the settings panel with the gear icon to choose an Ollama model, point at an Ollama endpoint, pick and test the speaking voice, toggle the last-response transcript, or test the Ollama connection. Settings are saved in this browser's local storage.

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

Standby requests final transcripts only, with one recognition alternative, and discards everything except the wake phrase. Unrelated background speech is not saved or sent to Ollama. Full question input uses interim results as well. Recognition pauses while NOVA thinks and speaks, then automatically returns to standby **after speech actually finishes** (or an error is handled). A wake without a question returns to standby after 15 seconds of silence. Opening settings or hiding the tab also suspends listening; returning to the idle main view resumes it.

### Browser limits and permissions

- Microphone permission and a secure browser context (HTTPS or localhost) are still required. If automatic startup is blocked, allow microphone access and use the mic button once to retry. The mic button and Space shortcut still work without a wake phrase.
- If the browser has no continuous recognition support, NOVA says **“I can’t listen for ‘hey nova’ in this browser. Try the mic button instead.”**. Manual recognition remains available if the browser supports it. Normal engine time limits trigger delayed restarts; permission failures and repeated service failures do not cause an endless retry loop.
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

Every normal chat request starts with that prompt, followed by the fresh quoted memory context. Memory stays user-provided data, not extra personality instructions. The earlier “warm and witty,” local-only claim, and unconditional short-response instructions are removed. There is no mechanical three-sentence cutoff: requested detail can still be spoken in full.

The same friendly tone carries through the app’s built-in copy:

- Startup: **“Waking up...”**; ready: **“Ready when you are.”**
- Listening: **“I’m listening.”**; thinking: **“Let me think...”**; speaking: **“Talking with you.”**
- Remembering: **“Got it!”**, followed by the saved detail; forgetting confirms removal without repeating the deleted fact.
- Connection trouble: **“Hmm, I can't reach Ollama right now. Is it running?”**
- Browser, microphone, storage, download, and voice-test messages explain a helpful next step without blame or raw error codes. HTTP/model failures keep actionable advice for installing a model, checking the endpoint, or allowing the page to connect.

The base prompt guides the model; it cannot guarantee that every model follows the tone or sentence limit perfectly. Browserless tests verify the exact outgoing prompt and built-in messages, not the naturalness of a real model or voice.

## Voice output

Replies are spoken with the browser's own Web Speech API. There is no API key, account, or separate speech backend: a local voice keeps working with the machine offline, while a voice marked `network` depends on the browser's speech service. The speech path uses `speechSynthesis.speak()` with no fallback service behind it.

Speech is fixed at the values NOVA is specified to use, in `src/speech.js`:

| Parameter | Value | Effect |
| --- | --- | --- |
| rate | `0.92` | slightly slower than default |
| pitch | `0.88` | slightly lower — calmer, less cartoonish |
| volume | `1.0` | full |

On load, NOVA calls `window.speechSynthesis.getVoices()` and automatically chooses the first available tier:

1. **Microsoft Aria Online**
2. **Microsoft Guy Online**
3. **Google UK English Female**
4. **Google US English**
5. Any voice with **Natural** or **Online** in its name
6. The **browser default** (or first exposed voice if the engine omits its default flag)

Name matching is case-insensitive and accepts the stock names' language/quality suffixes. English variants break ties **within** a tier; locale, offline capability, and app-name similarities never override the list. Voices often arrive asynchronously: `voiceschanged` refreshes the choice, with a 500ms refresh as a fallback.

**NOVA Voice** lists every available voice in two groups: **Natural / Online** names at the top, then **Basic system voices**. Each group is priority-sorted. Grouping is by name, not a promise of quality: the Google voices still have their automatic priority even though their names don't contain those keywords. Every entry includes its language and offline/network status:

```
Microsoft Aria Online (Natural) - English (United States) (en-US) · network
Samantha (en-US) · offline
```

A saved manual selection takes precedence over Automatic. `nova.tts.voice` stores its stable URI, with support for older name-only selections. Choose **Automatic** to clear that override and follow the priority list again. If a saved voice is uninstalled, the panel reports it and temporarily uses the automatic pick.

**Test Voice** previews the current dropdown choice **without saving**, saying exactly **“Hey, I'm Nova. Ready when you are.”** It uses the same rate, pitch, voice resolution, and word-boundary animation as replies. **Stop test**, changing the dropdown, saving/closing settings, and unmounting all cancel a preview safely. Testing pauses recognition and never sends a chat request, modifies memory, or creates a response transcript. It is disabled during a pending/spoken answer so it cannot interrupt a real reply; Ollama does not need to be running to test speech.

A tiny voice-name label below the avatar shows the current speaker while an utterance is queued/playing, then the saved/automatic choice at rest. Late voice-loading events cannot falsely rename an utterance already in progress. If the engine exposes no voices yet, the label honestly says **Browser default**; if speech synthesis is missing, it says **Voice isn’t available here** and testing is disabled.

Two caveats worth knowing:

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
- **Image requests:** say **“show me a picture of cats”**, **“find photos of the Eiffel Tower”**, or **“search Google Images for sunsets.”** NOVA handles these locally with a friendly spoken introduction and an encoded Google Images search link in a visual card. The thumbnail is clearly a **placeholder**, not a claimed photo; **View Images** opens the real search in a new tab. This does not require Ollama to be running and never saves the query as a memory.
- **Lists:** numbered (`1.`, `1)`) and bulleted (`-`, `*`, `•`, etc.) lines become clean cards/chips. Common Markdown emphasis is removed from visual labels. Code fences, Markdown rules like `* * *`, and marker-only lines are not mistaken for list items. The original reply is still spoken in full and unchanged.

The panel appears only after the actual speech-end event, not when text arrives or audio is queued. Silent/unsupported-speech browsers can still use visual replies once the text is ready; failed or canceled utterances do not publish unfinished content. Cards work independently of the optional **Show last response** transcript.

Cards fade out after **30 seconds**, or as soon as the next speech/wake phrase is detected. Manual mic/Space input and the close control dismiss them too. Recognition restarting in standby is **not** treated as new user speech. The fade lasts 280ms, cannot be prolonged by repeated transcripts, and old timers or canceled responses cannot revive/erase newer content. Settings, memory edits, and unmounting clear stale content safely.

Rich content uses its own grid row, **never a fixed overlay over the avatar**. The panel has a bounded internal scroller; short viewports can scroll the page rather than squeeze or cover the face. The avatar's SVG, sizes, animation timing, voice selection, rate, and pitch are unchanged. Reduced motion respects the existing motion preference. Links and the panel are keyboard-accessible; Space within the panel scrolls instead of activating the mic.

For predictable rendering, previews show up to 24 distinct links and 60 list items. If there is more, the panel points you to the full reply via **Show last response**; speech itself is not truncated. Rich response parsing/rendering lives in `src/rich-response.js` and `src/RichResponsePanel.jsx`. Tests cover URL safety/encoding, real React markup, speech-end publication, expiry, dismissal, cleanup, races, and separate-row layout contracts without claiming a browser visual or audio review.

## Avatar states

The mouthless orb now has **two identical SVG capsules**, restoring the previous rounded-end eye shape while retaining the current sizing: **28×42 CSS pixels** each at the default 160px avatar size, with an **18px gap** and a shared center line at **y=60px**, in the upper half. A neutral radial well runs subtly from `#161616` at the center to `#1a1a1a` at the edge. Both eyes remain upright and matching: no per-eye rotation, skew, squint, independent drift or staggered blinks.

The SVG keeps its 280-unit viewBox. A uniform 1.75 conversion makes the eye dimensions real on-screen pixels rather than accidentally smaller SVG units. Compact 108px / 92px avatars scale the whole face proportionally. The orange ring is sized against the **visible 222/280 orb**, plus movement clearance, and the backlight uses the same avatar-size variable.

Shared motion layers keep the pair synchronized:

| Layer | Carries |
| --- | --- |
| `.eyes-gaze` | the pair’s horizontal gaze |
| `.eyes-blink` | one blink clock and one fixed center for both eyes |
| `.eyes-voice` | shared word-boundary brightness |
| `.eye-scale` inside each eye | identical size/expression scaling about a fixed local origin |

Body pose is separate from rhythm: `.avatar-figure` holds transitioned scale and `rotateY`, while `.robot-avatar` carries translation-only keyframes. No body state rotates on Z. There is no perspective that could make one eye appear larger than the other. Pose, eye color and capsule/crescent crossfades use **400ms ease-in-out** transitions; timed blinks and rapid word-light beats keep their own timings.

| State | Eyes | Body |
| --- | --- | --- |
| Idle | shared blink every **4s**, **42→4→42px over 200ms** | **0↔−8px** float, **3s ease-in-out infinite** |
| Listening | both **115%**, brighter **#222** background | **rotateY(5deg)**; soft orange expanding/fading ring every **1.5s** |
| Thinking | shared **left/right 6px** gaze, **800ms holds** and 400ms moves | slow lateral sway, **97%** scale |
| Speaking | rapid shared brightness on actual speech word boundaries; no fake rapid blinks | gentle quick Y bounces, boundary-driven scale bounded to **100–104%** |
| Happy / wake | matching filled wide crescents, **scaleX(1.2), scaleY(.4)** | one **800ms double-bounce jump** |
| Offline | identical slight droop, half opacity | slow lateral sway; no eye tilt |

`speechSynthesis` word-boundary events publish a single `--audio-pulse`: capped at 1, decayed to 0 after 125ms, and removed on speech completion/cancellation. Both eye light and body scale read that value. Without boundary events the word light/scale stays neutral rather than being simulated.

The wake flourish lasts **800ms** and then settles into listening. A same-utterance question moves directly to thinking/speaking without the wake expression masking it. Happy follows response completion and holds its crescent pose for **1.5s**; the double jump itself happens only once. Offline styling applies only at rest, so local memory replies still get the full speaking animation even when Ollama is unavailable. The offline notice stays below the orb.

Reduced motion disables float, gaze, blinks, jumps, pulsing light and rings while preserving the current static expression.

`npm run verify:avatar` renders the real SVG through React and checks pixel geometry, symmetry, radial colors, fixed pivots, exact timing, scale bounds, reduced motion and orb/ring/backlight sizing at all three viewport sizes. It also generates **`avatar-states.html`**, a real-CSS state sheet with a happy/wake replay button. Each cell has unique SVG definition IDs so its gradient colors cannot accidentally resolve to another state. The sheet holds a clearly labelled sample speech pulse; it does not generate audio.

`npm run verify:speech` checks rich response parsing/rendering and post-speech lifecycle, the exact personality prompt and friendly statuses/error copy, all voice-priority fallbacks, asynchronous loading, dropdown groups, preview cancellation/errors, active speaker labels and speaking parameters, the real wake controller and chime, persistent memory helpers/settings, and the compiled App lifecycle using recognition, timer, audio and storage doubles. Avatar regressions include the 800ms wake expiry, busy-state priority, actual boundary pulse/decay/cleanup, offline local speech and post-speech celebration. These are structural/behavioral checks, not a browser animation review, microphone accuracy test or audio audition.

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
