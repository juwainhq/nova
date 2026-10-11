// Kokoro TTS: natural neural speech generated in this browser. The official
// kokoro-js package loads from jsDelivr inside a module Web Worker, so inference
// never blocks recognition, timers or the avatar. Model and voice files download
// from Hugging Face once and are cached by the browser. Reply text stays on-device.
//
// kokoro.web.js is the package's self-contained browser build (jsDelivr's default
// file for kokoro-js). dist/kokoro.js — and jsDelivr's generated kokoro.min.js —
// import bare Node packages ("@huggingface/transformers", "fs/promises") and cannot
// load in a page. The version is pinned so a new release can't silently break NOVA.
export const KOKORO_VERSION = '1.2.1';
export const KOKORO_CDN_URL = `https://cdn.jsdelivr.net/npm/kokoro-js@${KOKORO_VERSION}/dist/kokoro.web.js`;
export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// The package's recommended in-page setup: ~90 MB quantized model on WebAssembly.
export const KOKORO_DTYPE = 'q8';
export const KOKORO_DEVICE = 'wasm';
export const KOKORO_VOICE_KEY = 'nova.kokoro.voice';
export const DEFAULT_KOKORO_VOICE = 'af_bella';
export const KOKORO_VOICES = Object.freeze([
  { id: 'af_bella', name: 'Bella', label: 'Warm American Female' },
  { id: 'af_sarah', name: 'Sarah', label: 'Bright American Female' },
  { id: 'af_nicole', name: 'Nicole', label: 'Soft American Female' },
  { id: 'bf_emma', name: 'Emma', label: 'British Female' },
]);
export const KOKORO_LOAD_IDLE_MS = 60000; // No download/progress activity at all.
export const KOKORO_CHUNK_TIMEOUT_MS = 45000; // One chunk's generation.
export const KOKORO_UNLOCK_WAIT_MS = 20000; // Autoplay-blocked audio waiting for a tap.
export const KOKORO_CHUNK_CHARS = 240; // Well inside Kokoro's 510-token truncation limit.
export const KOKORO_FIRST_CHUNK_CHARS = 140; // A shorter first chunk starts speaking sooner.
export const PULSE_FRAME_MS = 50;
const POLL_MS = 250;

export function kokoroVoice(id) {
  return KOKORO_VOICES.find((voice) => voice.id === id) || KOKORO_VOICES[0];
}

export function kokoroVoiceLabel(voice) {
  return `${voice.id} — ${voice.label}${voice.id === DEFAULT_KOKORO_VOICE ? ' (default)' : ''}`;
}

// generate() truncates long input, so replies are split at sentence boundaries,
// then packed into chunks. Every word is kept; only whitespace is normalized.
export function splitSpeechText(text, max = KOKORO_CHUNK_CHARS, firstMax = KOKORO_FIRST_CHUNK_CHARS) {
  const source = String(text || '');
  const sentences = [];
  let start = 0;
  for (const match of source.matchAll(/[.!?…]+["'”’)\]]*(?=\s)|\n+/g)) {
    const end = match.index + match[0].length;
    sentences.push(source.slice(start, end));
    start = end;
  }
  sentences.push(source.slice(start));
  const fit = (piece) => {
    const parts = [];
    let rest = piece;
    while (rest.length > max) {
      const head = rest.slice(0, max + 1);
      let cut = -1;
      for (const match of head.matchAll(/[,;:]\s/g)) cut = match.index + 1;
      if (cut < max * 0.4) cut = head.lastIndexOf(' ');
      if (cut <= 0) cut = max; // One enormous token, such as a URL.
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  };
  const chunks = [];
  for (const piece of sentences.map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => /[\p{L}\p{N}]/u.test(sentence)).flatMap(fit)) {
    const last = chunks[chunks.length - 1];
    if (last && last.length + 1 + piece.length <= (chunks.length === 1 ? firstMax : max)) chunks[chunks.length - 1] = `${last} ${piece}`;
    else chunks.push(piece);
  }
  return chunks;
}

// A normalized loudness envelope (one value per 50ms) that drives the eye pulse.
export function speechEnvelope(samples, sampleRate, frameMs = PULSE_FRAME_MS) {
  const size = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const levels = new Float32Array(Math.ceil(samples.length / size));
  let peak = 0;
  for (let frame = 0; frame < levels.length; frame += 1) {
    const from = frame * size;
    const to = Math.min(samples.length, from + size);
    let sum = 0;
    for (let index = from; index < to; index += 1) sum += samples[index] * samples[index];
    levels[frame] = Math.sqrt(sum / Math.max(1, to - from));
    peak = Math.max(peak, levels[frame]);
  }
  for (let frame = 0; frame < levels.length; frame += 1) {
    const level = peak ? levels[frame] / peak : 0;
    levels[frame] = level < 0.1 ? 0 : level; // Silence and breaths stay dark.
  }
  return levels;
}

// Runs inside the worker. Generation is serialized (one ONNX session) and a
// canceled reply's queued chunks are skipped rather than generated.
export function kokoroWorkerSource() {
  return `
let tts = null;
let loading = null;
let queue = Promise.resolve();
let lastPercent = -1;
let lastAlive = 0;
const canceled = new Set();
const files = new Map();
const describe = (error) => String((error && error.message) || error || 'Unknown error').slice(0, 300);
const progress = (event) => {
  if (event && event.file) {
    if (event.status === 'done' && files.has(event.file)) files.get(event.file).loaded = files.get(event.file).total;
    else if (typeof event.total === 'number' && event.total > 0) files.set(event.file, { loaded: Number(event.loaded) || 0, total: event.total });
  }
  let loaded = 0;
  let total = 0;
  for (const file of files.values()) { loaded += Math.min(file.loaded, file.total); total += file.total; }
  const percent = total ? Math.floor((loaded / total) * 100) : null;
  if (percent !== lastPercent) {
    lastPercent = percent;
    self.postMessage({ type: 'progress', percent });
  } else if (Date.now() - lastAlive > 1000) {
    lastAlive = Date.now();
    self.postMessage({ type: 'alive' });
  }
};
self.onmessage = (event) => {
  const data = event.data || {};
  if (data.type === 'load' && !loading) {
    loading = import(data.url)
      .then(({ KokoroTTS }) => KokoroTTS.from_pretrained(data.model, { dtype: data.dtype, device: data.device, progress_callback: progress }))
      .then((model) => { tts = model; self.postMessage({ type: 'ready' }); },
        (error) => { self.postMessage({ type: 'load-error', message: describe(error) }); });
    queue = loading;
  } else if (data.type === 'cancel') {
    canceled.add(data.group);
  } else if (data.type === 'generate') {
    queue = queue.then(async () => {
      if (canceled.has(data.group)) return;
      if (!tts) throw new Error('Kokoro is not loaded.');
      const audio = await tts.generate(data.text, { voice: data.voice, speed: data.speed });
      if (canceled.has(data.group)) return;
      const samples = Float32Array.from(audio.audio);
      self.postMessage({ type: 'audio', id: data.id, samples, sampleRate: audio.sampling_rate }, [samples.buffer]);
    }).catch((error) => { self.postMessage({ type: 'generate-error', id: data.id, message: describe(error) }); });
  }
};
`;
}

// The URL entry is resolved during construction, so revoking it right away is safe.
export function browserKokoroWorker(scope = globalThis) {
  const url = scope.URL.createObjectURL(new scope.Blob([kokoroWorkerSource()], { type: 'text/javascript' }));
  try { return new scope.Worker(url, { type: 'module' }); }
  finally { scope.URL.revokeObjectURL(url); }
}

const abortError = () => Object.assign(new Error('Kokoro speech was canceled.'), { name: 'AbortError' });

// Worker client. `ready` resolves true/false and never rejects; any load failure,
// stall or worker crash moves to 'failed' so the app can use its Web Speech fallback.
export function createKokoroEngine({ createWorker, timers = globalThis, onStatus = () => {}, idleMs = KOKORO_LOAD_IDLE_MS }) {
  let worker = null;
  let state = 'loading';
  let progress = null;
  let sequence = 0;
  let idleTimer;
  let spawnTimer;
  let settle;
  const pending = new Map();
  const ready = new Promise((resolve) => { settle = resolve; });
  const publish = () => onStatus({ state, progress });

  const shutdown = (next) => {
    if (state === 'failed' || state === 'disposed') return false;
    state = next;
    timers.clearTimeout(idleTimer);
    timers.clearTimeout(spawnTimer);
    if (worker) worker.onmessage = worker.onerror = worker.onmessageerror = null;
    try { worker?.terminate(); } catch { /* Already gone. */ }
    worker = null;
    for (const job of pending.values()) job.reject(new Error('Kokoro is unavailable.'));
    pending.clear();
    settle(false);
    return true;
  };
  const fail = () => { if (shutdown('failed')) publish(); };
  const armIdle = () => {
    timers.clearTimeout(idleTimer);
    if (state === 'loading') idleTimer = timers.setTimeout(fail, idleMs);
  };
  const receive = (event) => {
    const data = event?.data || {};
    if (state === 'loading') armIdle();
    if (data.type === 'progress' && state === 'loading') {
      const percent = Number.isFinite(data.percent) ? Math.max(0, Math.min(100, Math.floor(data.percent))) : null;
      if (percent !== progress) { progress = percent; publish(); }
    } else if (data.type === 'ready' && state === 'loading') {
      state = 'ready';
      progress = 100;
      timers.clearTimeout(idleTimer);
      settle(true);
      publish();
    } else if (data.type === 'load-error') fail();
    else if (data.type === 'audio' || data.type === 'generate-error') {
      const job = pending.get(data.id);
      if (!job) return;
      pending.delete(data.id);
      if (data.type === 'audio' && ArrayBuffer.isView(data.samples) && data.samples.length && data.sampleRate > 0) {
        job.resolve({ samples: data.samples, sampleRate: data.sampleRate });
      } else job.reject(new Error(data.message || 'Kokoro returned no audio.'));
    }
  };
  const spawn = () => {
    spawnTimer = undefined;
    try {
      worker = createWorker();
      worker.onmessage = receive;
      worker.onerror = (event) => { event?.preventDefault?.(); fail(); };
      worker.onmessageerror = fail;
      worker.postMessage({ type: 'load', url: KOKORO_CDN_URL, model: KOKORO_MODEL_ID, dtype: KOKORO_DTYPE, device: KOKORO_DEVICE });
      armIdle();
    } catch { fail(); }
  };
  // Deferred so React StrictMode's mount/unmount probe never spawns a worker.
  spawnTimer = timers.setTimeout(spawn, 0);

  return {
    get state() { return state; },
    get progress() { return progress; },
    ready,
    group: () => ++sequence,
    generate(text, voice, group, speed = 1) {
      if (state !== 'ready' || !worker) return Promise.reject(new Error('Kokoro is not ready.'));
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, group });
        worker.postMessage({ type: 'generate', id, group, text, voice, speed });
      });
    },
    cancel(group) {
      try { worker?.postMessage({ type: 'cancel', group }); } catch { /* Worker gone. */ }
      for (const [id, job] of pending) {
        if (job.group === group) { pending.delete(id); job.reject(abortError()); }
      }
    },
    dispose() { shutdown('disposed'); },
  };
}

// One lazily created AudioContext for Kokoro playback. Browsers may keep it
// suspended until a tap or key press; unlock() is called from those gestures.
export function createKokoroAudio(AudioContext) {
  let context = null;
  const get = () => {
    if (!context && AudioContext) {
      try { context = new AudioContext(); } catch { return null; }
    }
    return context;
  };
  return {
    get,
    unlock() {
      const current = get();
      if (current?.state === 'suspended') {
        try { current.resume()?.catch?.(() => {}); } catch { /* Still blocked. */ }
      }
    },
    dispose() {
      try { context?.close()?.catch?.(() => {}); } catch { /* Audio is optional. */ }
      context = null;
    },
  };
}

// Speaks one reply: chunks are generated in order and scheduled back-to-back on
// the AudioContext clock while later chunks generate. `done` resolves with
//   completed — the last buffer actually finished playing
//   failed    — load/generation/audio failure; `remaining` is the unplayed text
//   blocked   — autoplay never allowed audio; nothing was heard
//   stopped   — canceled by the app
export function speakWithKokoro({
  engine, getContext, text, voice, timers = globalThis, speed = 1,
  onWaiting = () => {}, onBlocked = () => {}, onStart = () => {}, onPulse = () => {},
}) {
  const chunks = splitSpeechText(text);
  const group = engine.group();
  const sources = [];
  const segments = [];
  let settled = false;
  let allScheduled = false;
  let ended = 0;
  let nextAt = 0;
  let context = null;
  let pulseTimer;
  let ceilingTimer;
  let chunkTimer;
  let waitTimer;
  let wake = null;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  const settleWith = (result) => {
    if (settled) return;
    settled = true;
    for (const timer of [pulseTimer, ceilingTimer, chunkTimer, waitTimer]) timers.clearTimeout(timer);
    wake?.();
    for (const source of sources) {
      source.onended = null;
      try { source.stop(); } catch { /* Already finished. */ }
      try { source.disconnect(); } catch { /* Already detached. */ }
    }
    engine.cancel(group);
    onPulse(null);
    resolveDone(result);
  };
  // Unplayed text, starting with the chunk that is still audible (if any).
  const remainingFrom = (index) => {
    const audible = context ? segments.findIndex((segment) => segment.end > context.currentTime) : -1;
    return chunks.slice(audible === -1 ? index : audible).join(' ');
  };
  const sleep = (ms) => new Promise((resolve) => {
    wake = resolve;
    waitTimer = timers.setTimeout(resolve, ms);
  });
  const withTimeout = (promise) => new Promise((resolve, reject) => {
    const timer = timers.setTimeout(() => reject(new Error('Kokoro took too long.')), KOKORO_CHUNK_TIMEOUT_MS);
    chunkTimer = timer; // Each chunk clears its own timer, never a newer chunk's.
    promise.then(resolve, reject).finally(() => timers.clearTimeout(timer));
  });
  const pulse = () => {
    pulseTimer = timers.setTimeout(() => {
      if (settled) return;
      const now = context.currentTime;
      const segment = segments.find((item) => now >= item.start && now < item.end);
      const frame = segment ? Math.floor(((now - segment.start) * 1000) / PULSE_FRAME_MS) : 0;
      onPulse(segment ? segment.levels[Math.min(segment.levels.length - 1, frame)] || 0 : 0);
      pulse();
    }, PULSE_FRAME_MS);
  };
  const schedule = ({ samples, sampleRate }) => {
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const start = Math.max(context.currentTime + 0.05, nextAt);
    nextAt = start + samples.length / sampleRate;
    segments.push({ start, end: nextAt, levels: speechEnvelope(samples, sampleRate) });
    source.onended = () => {
      ended += 1;
      if (allScheduled && ended === sources.length) settleWith({ status: 'completed' });
    };
    sources.push(source);
    source.start(start);
  };
  const waitForAudio = async () => {
    try { context.resume()?.catch?.(() => {}); } catch { /* Gesture required. */ }
    for (let waited = 0; waited < KOKORO_UNLOCK_WAIT_MS && !settled; waited += POLL_MS) {
      if (context.state === 'running') return true;
      if (waited === POLL_MS * 2) onBlocked();
      await sleep(POLL_MS);
    }
    return context.state === 'running';
  };

  (async () => {
    if (!chunks.length) return settleWith({ status: 'completed' });
    if (engine.state === 'loading') onWaiting();
    if (!(await engine.ready)) return settleWith({ status: 'failed', reason: 'load', remaining: chunks.join(' ') });
    if (settled) return undefined;
    const requests = chunks.map((chunk) => engine.generate(chunk, voice, group, speed));
    requests.forEach((request) => request.catch(() => {}));
    for (let index = 0; index < chunks.length; index += 1) {
      let audio;
      try { audio = await withTimeout(requests[index]); } catch {
        return settleWith({ status: 'failed', reason: 'generate', remaining: remainingFrom(index) });
      }
      if (settled) return undefined;
      if (!context) {
        context = getContext();
        if (!context) return settleWith({ status: 'failed', reason: 'audio', remaining: chunks.join(' ') });
        if (context.state !== 'running' && !(await waitForAudio())) return settleWith({ status: 'blocked' });
        if (settled) return undefined;
      }
      try { schedule(audio); } catch {
        return settleWith({ status: 'failed', reason: 'audio', remaining: remainingFrom(index) });
      }
      if (index === 0) { onStart(); pulse(); }
    }
    allScheduled = true;
    if (ended === sources.length) return settleWith({ status: 'completed' });
    // Safety net: a context suspended mid-reply never fires onended.
    ceilingTimer = timers.setTimeout(() => settleWith({ status: 'completed' }),
      Math.max(0, (nextAt - context.currentTime) * 1000) + 3000);
    return undefined;
  })().catch(() => settleWith({ status: 'failed', reason: 'audio', remaining: remainingFrom(0) }));

  return { done, stop: () => settleWith({ status: 'stopped' }) };
}
