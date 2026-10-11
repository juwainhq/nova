// Browserless doubles for verify-speech.mjs. They exercise the real controller
// and compiled App without claiming to emulate microphone hardware or audio quality.
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';

export function createClock() {
  let time = 0;
  let sequence = 0;
  const jobs = new Map();
  return {
    now: () => time,
    setTimeout(fn, delay = 0) {
      const id = ++sequence;
      jobs.set(id, { fn, at: time + delay });
      return id;
    },
    clearTimeout(id) { jobs.delete(id); },
    get pending() { return jobs.size; },
    tick(ms = 0) {
      const until = time + ms;
      for (let steps = 0; ; steps += 1) {
        const next = [...jobs].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > until) break;
        if (steps > 1000) throw new Error('Runaway speech restart loop');
        jobs.delete(next[0]);
        time = next[1].at;
        next[1].fn();
      }
      time = until;
    },
  };
}

export function createStorageDouble(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    readError: false,
    writeError: false,
    writes: [],
    getItem(key) {
      if (this.readError) throw new Error('Storage access denied');
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (this.writeError) throw new Error('Storage quota exceeded');
      values.set(key, String(value));
      this.writes.push({ key, value: String(value) });
    },
    removeItem(key) { values.delete(key); },
  };
}

export function createRecognitionDouble(clock, { continuous = true, autoStart = true } = {}) {
  const instances = [];
  class Recognition {
    constructor() {
      if (continuous) this.continuous = false;
      this.interimResults = false;
      this.starts = [];
      this.aborts = 0;
      this.active = false;
      this.startError = null;
      instances.push(this);
    }
    start() {
      if (this.active) throw new Error('Overlapping recognition.start()');
      if (this.startError) throw this.startError;
      this.active = true;
      this.starts.push({ at: clock.now(), continuous: this.continuous, interim: this.interimResults });
      if (autoStart) this.onstart?.();
    }
    abort() {
      this.aborts += 1;
      // Deliberately asynchronous: tests must deliver onend before another start.
    }
    end() { this.active = false; this.onend?.(); }
    error(error) { this.onerror?.({ error }); }
    result(text, isFinal = true) { this.results([{ text, isFinal }]); }
    results(entries, resultIndex = 0) {
      this.onresult?.({
        resultIndex,
        results: entries.map(({ text, isFinal = true }) => Object.assign([{ transcript: text }], { isFinal })),
      });
    }
  }
  return { Recognition, instances };
}

export function createAudioDouble({ suspended = false, rejectResume = false } = {}) {
  const instances = [];
  class AudioContext {
    constructor() {
      this.state = suspended ? 'suspended' : 'running';
      this.currentTime = 2;
      this.destination = {};
      this.oscillators = [];
      this.gains = [];
      this.resumes = 0;
      this.closes = 0;
      instances.push(this);
    }
    async resume() {
      this.resumes += 1;
      if (rejectResume) throw new Error('Autoplay denied');
      this.state = 'running';
    }
    async close() { this.closes += 1; this.state = 'closed'; }
    createOscillator() {
      const oscillator = {
        frequency: { setValueAtTime(value, at) { oscillator.frequencyValue = value; oscillator.frequencyAt = at; } },
        connect(target) { this.target = target; },
        disconnect() { this.disconnected = true; },
        start(at) { this.startAt = at; },
        stop(at) { this.stopAt = at; },
      };
      this.oscillators.push(oscillator);
      return oscillator;
    }
    createGain() {
      const gain = {
        ramps: [],
        connect(target) { this.target = target; },
        disconnect() { this.disconnected = true; },
        gain: {},
      };
      for (const method of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime']) {
        gain.gain[method] = (value, at) => gain.ramps.push({ method, value, at });
      }
      this.gains.push(gain);
      return gain;
    }
  }
  return { AudioContext, instances };
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn, options) {
      const list = listeners.get(type) || new Map();
      list.set(fn, options);
      listeners.set(type, list);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatch(type, event = {}) {
      for (const [fn, options] of [...(listeners.get(type) || [])]) {
        if (options?.once) listeners.get(type).delete(fn);
        fn(event);
      }
    },
  };
}

// Minimal hook scheduler: useState/useRef persist, effects clean up on dependency
// changes, and state updates batch into flush(). JSX is an inspectable tree, not DOM.
const appBuild = build({
  entryPoints: [resolve(process.cwd(), 'src/App.jsx')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  define: { __NOVA_STANDALONE__: 'false' },
  logLevel: 'warning',
  plugins: [{
    name: 'speech-test-hooks',
    setup(builder) {
      builder.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, ({ path }) => ({ path, namespace: 'test-hooks' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-hooks' }, ({ path }) => ({
        contents: path === 'react' ? `
          export const useState = (...args) => globalThis.hooks.state(...args);
          export const useRef = (...args) => globalThis.hooks.ref(...args);
          export const useCallback = (...args) => globalThis.hooks.callback(...args);
          export const useEffect = (...args) => globalThis.hooks.effect(...args);
        ` : `
          export const Fragment = 'fragment';
          export const jsx = (type, props) => ({ type, props });
          export const jsxs = jsx;
        `,
        loader: 'js',
      }));
    },
  }],
});

export async function createAppHarness({ continuous = true, missingRecognition = false, speech = true,
  storage = createStorageDouble(), panelProps = null, modelsOffline = false } = {}) {
  const clock = createClock();
  const recognition = createRecognitionDouble(clock, { continuous });
  const audio = createAudioDouble();
  const utterances = [];
  const requests = [];
  const pendingChats = [];
  let cancellations = 0;
  const window = Object.assign(eventTarget(), {
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    SpeechRecognition: missingRecognition ? undefined : recognition.Recognition,
    AudioContext: audio.AudioContext,
    localStorage: storage,
    location: { origin: 'https://nova.test' },
    speechSynthesis: Object.assign(eventTarget(), {
      getVoices: () => [{ name: 'Samantha', lang: 'en-US', voiceURI: 'samantha', localService: true }],
      cancel() { cancellations += 1; },
      speak(utterance) { utterances.push(utterance); },
    }),
  });
  const document = Object.assign(eventTarget(), { hidden: false });
  const slots = [];
  let cursor = 0;
  let dirty = true;
  let effects = [];
  let tree;
  let chatError = false;
  let chatAnswer = 'Hello! I am here to help.';
  let deferChat = false;
  let speechThrows = false;
  const same = (a, b) => a?.length === b?.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    state(initial) {
      const index = cursor++;
      slots[index] ||= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (value) => {
        const next = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    ref(initial) { const index = cursor++; return (slots[index] ||= { current: initial }); },
    callback(fn, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { value: fn, deps };
      return slots[index].value;
    },
    effect(fn, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) effects.push(() => {
        slots[index]?.cleanup?.();
        slots[index] = { deps, cleanup: fn() };
      });
    },
  };
  const sandbox = {
    module: { exports: {} }, hooks, window, document,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    Date: { now: clock.now }, AbortController, TextDecoder, Uint8Array,
    SpeechSynthesisUtterance: speech ? class { constructor(text) { this.text = text; } } : undefined,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/models')) {
        if (modelsOffline) throw new Error('Model server offline');
        return { ok: true, json: async () => ({ data: [{ id: 'mistral:7b-instruct-q4_K_M' }] }) };
      }
      if (chatError) throw new Error('Test model failure');
      const data = JSON.stringify({ choices: [{ delta: { content: chatAnswer } }] });
      const response = new Response(`data: ${data}\n\ndata: [DONE]\n\n`);
      if (deferChat) return new Promise((done) => pendingChats.push({ options, resolve: () => done(response) }));
      return response;
    },
  };
  const { outputFiles } = await appBuild;
  runInNewContext(outputFiles[0].text, sandbox);
  const Component = panelProps ? sandbox.module.exports.SettingsPanel : sandbox.module.exports.default;
  const props = panelProps ? {
    settings: { model: 'mistral:7b-instruct-q4_K_M', ollamaUrl: '', voiceKey: '', showTranscript: false },
    voices: [], connection: 'connected', modelAvailable: true, standalone: false,
    onClose() {}, onSave() {}, onConnectionChange() {}, openerRef: { current: null },
    ...panelProps,
  } : undefined;
  const flush = () => {
    for (let pass = 0; dirty; pass += 1) {
      if (pass > 50) throw new Error('Runaway App render loop');
      dirty = false;
      cursor = 0;
      effects = [];
      tree = Component(props);
      for (const effect of effects) effect();
    }
  };
  const nodes = () => {
    const found = [];
    const visit = (node) => {
      if (Array.isArray(node)) node.forEach(visit);
      else if (node?.props) { found.push(node); visit(node.props.children); }
    };
    visit(tree);
    return found;
  };
  const find = (className) => nodes().find((node) => node.props.className?.split(' ').includes(className));
  flush();
  // React would attach this ref during commit; supply only the pulse APIs it uses.
  const avatar = find('avatar-container');
  const avatarProperties = new Map();
  const avatarClasses = new Set();
  const avatarElement = {
    classList: {
      add(name) { avatarClasses.add(name); },
      remove(name) { avatarClasses.delete(name); },
      contains(name) { return avatarClasses.has(name); },
    },
    style: {
      setProperty(name, value) { avatarProperties.set(name, String(value)); },
      removeProperty(name) { avatarProperties.delete(name); },
      getPropertyValue(name) { return avatarProperties.get(name) ?? ''; },
    },
  };
  if (avatar) avatar.props.ref.current = avatarElement;
  window.speechSynthesis.speak = (utterance) => {
    if (speechThrows) throw new Error('Test synthesis failure');
    utterances.push(utterance);
  };
  return {
    clock, window, document, recognition, audio, utterances, requests, storage, pendingChats, avatarElement, flush, find, nodes,
    findButton: (text) => nodes().find((node) => node.type === 'button' && node.props.children === text),
    updatePanel(next) { Object.assign(props, next); dirty = true; flush(); },
    get tree() { return tree; },
    get cancellations() { return cancellations; },
    set chatError(value) { chatError = value; },
    set chatAnswer(value) { chatAnswer = value; },
    set deferChat(value) { deferChat = value; },
    set speechThrows(value) { speechThrows = value; },
    async settle() { for (let i = 0; i < 30; i += 1) { await Promise.resolve(); flush(); } },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
