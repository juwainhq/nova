// Kokoro TTS checks with worker/audio doubles. They verify loading, chunking,
// scheduling, pulse sync and fallbacks — not the real model's sound or speed.
import { runInNewContext } from 'node:vm';
import {
  DEFAULT_KOKORO_VOICE, KOKORO_CDN_URL, KOKORO_CHUNK_CHARS, KOKORO_CHUNK_TIMEOUT_MS, KOKORO_DEVICE, KOKORO_DTYPE,
  KOKORO_FIRST_CHUNK_CHARS, KOKORO_LOAD_IDLE_MS, KOKORO_MODEL_ID, KOKORO_UNLOCK_WAIT_MS, KOKORO_VOICES, KOKORO_VOICE_KEY,
  createKokoroAudio, createKokoroEngine, kokoroVoice, kokoroWorkerSource, speakWithKokoro, speechEnvelope, splitSpeechText,
} from '../src/kokoro.js';
import { TTS_TEST_TEXT } from '../src/speech.js';
import { createAppHarness, createAudioDouble, createClock, createStorageDouble, createWorkerDouble } from './speech-test-fixtures.mjs';

const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const words = (text) => text.split(/\s+/).filter(Boolean).join(' ');
const near = (a, b) => Math.abs(a - b) < 1e-9;
// Polling waits schedule their next timer only after a microtask, so step through.
const advance = async (clock, ms, step = 250) => { for (let t = 0; t < ms; t += step) { clock.tick(step); await flush(); } };
// One second at 24 kHz: loud first half, silent second half.
const second = () => Float32Array.from({ length: 24000 }, (_, i) => (i < 12000 ? (i % 2 ? 0.5 : -0.5) : 0));

function fakeEngine({ state = 'ready', ready = Promise.resolve(true) } = {}) {
  const jobs = [];
  const canceled = [];
  let groups = 0;
  return {
    state, ready, jobs, canceled,
    group: () => ++groups,
    generate(text, voice, group, speed) {
      return new Promise((resolve, reject) => jobs.push({ text, voice, group, speed, resolve, reject }));
    },
    cancel(group) { canceled.push(group); for (const job of jobs) job.reject(new Error('canceled')); },
  };
}

function session(options = {}) {
  const clock = createClock();
  const engine = options.engine || fakeEngine();
  const { AudioContext } = createAudioDouble(options.audio);
  const context = new AudioContext();
  const events = { start: 0, waiting: 0, blocked: 0, pulses: [], result: null };
  const text = options.text ?? `Hello there, friend. ${'This sentence keeps going so the reply needs several chunks. '.repeat(6)}`;
  const spoken = speakWithKokoro({
    engine, getContext: () => context, text, voice: 'af_bella', timers: clock,
    onStart: () => { events.start += 1; }, onWaiting: () => { events.waiting += 1; },
    onBlocked: () => { events.blocked += 1; }, onPulse: (level) => events.pulses.push(level),
  });
  spoken.done.then((result) => { events.result = result; });
  return { clock, engine, context, events, spoken, chunks: splitSpeechText(text) };
}

function runWorker(KokoroTTS) {
  const posted = [];
  const imports = [];
  const self = { postMessage: (message, transfer) => posted.push({ message, transfer }) };
  runInNewContext(kokoroWorkerSource().replace('import(data.url)', '__import(data.url)'), {
    self, Date, Float32Array, Promise, Set, Map, String, Number, Error,
    __import: async (url) => { imports.push(url); return { KokoroTTS }; },
  });
  return { posted, imports, send: (data) => self.onmessage({ data }), types: () => posted.map(({ message }) => message.type) };
}

export async function verifyKokoro(check) {
  // ------------------------------------------------------------ configuration
  check('kokoro: loads the official package’s self-contained browser build from jsDelivr',
    KOKORO_CDN_URL === 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js');
  check('kokoro: uses the published 82M ONNX model with the in-browser q8/WASM setup',
    KOKORO_MODEL_ID === 'onnx-community/Kokoro-82M-v1.0-ONNX' && KOKORO_DTYPE === 'q8' && KOKORO_DEVICE === 'wasm');
  check('kokoro: offers exactly the four requested voices with af_bella as default',
    KOKORO_VOICES.map((voice) => `${voice.id}:${voice.label}`).join(',')
      === 'af_bella:Warm American Female,af_sarah:Bright American Female,af_nicole:Soft American Female,bf_emma:British Female'
    && DEFAULT_KOKORO_VOICE === 'af_bella' && KOKORO_VOICE_KEY === 'nova.kokoro.voice');
  check('kokoro: unknown/old saved voices fall back to af_bella', kokoroVoice('am_adam').id === 'af_bella' && kokoroVoice('bf_emma').name === 'Emma');

  // ----------------------------------------------------------------- chunking
  const long = `Sure! ${'Here is a detailed sentence about planning a calm and happy morning routine. '.repeat(12)}Version 3.5 works. Visit https://example.com/${'a'.repeat(300)} today.`;
  const chunks = splitSpeechText(long);
  check('kokoro chunks: long replies are split instead of hitting Kokoro’s truncation', chunks.length > 4
    && chunks.every((chunk) => chunk.length <= KOKORO_CHUNK_CHARS));
  // An oversized URL is the only thing cut mid-token, so compare characters.
  check('kokoro chunks: every character is spoken, in order', chunks.join('').replace(/\s+/g, '') === long.replace(/\s+/g, ''));
  check('kokoro chunks: ordinary sentences keep whole words', words(splitSpeechText(long.split(' Visit ')[0]).join(' ')) === words(long.split(' Visit ')[0]));
  check('kokoro chunks: a short first chunk starts speaking sooner', chunks[0].length <= KOKORO_FIRST_CHUNK_CHARS);
  const shortReply = splitSpeechText('Hi there! How are you? I am well.');
  check('kokoro chunks: the first sentence is alone so speech starts sooner; the rest joins one chunk', shortReply.length === 2
    && shortReply[0] === 'Hi there!' && shortReply[1] === 'How are you? I am well.');
  check('kokoro chunks: decimals and domains do not create false sentence breaks', splitSpeechText('Version 3.5 of example.com is out.').length === 1);
  check('kokoro chunks: list lines are kept and marker-only/empty text is dropped', words(splitSpeechText('Ideas:\n- Tea\n- A walk\n-\n').join(' ')) === 'Ideas: - Tea - A walk'
    && splitSpeechText('  \n - ').length === 0);

  // ----------------------------------------------------------------- envelope
  const levels = speechEnvelope(second(), 24000);
  check('kokoro pulse: 50ms loudness frames span the whole buffer', levels.length === 20);
  check('kokoro pulse: speech is bright and silence stays dark', levels[0] === 1 && levels[9] === 1 && levels[10] === 0 && levels[19] === 0);
  check('kokoro pulse: an all-silent buffer never pulses', speechEnvelope(new Float32Array(2400), 24000).every((level) => level === 0));

  // ------------------------------------------------------------------- worker
  const generated = [];
  let releaseFirst;
  const progressTTS = {
    async from_pretrained(model, options) {
      generated.push({ model, options });
      options.progress_callback({ status: 'initiate', file: 'config.json' });
      options.progress_callback({ status: 'progress', file: 'model.onnx', loaded: 50, total: 100 });
      options.progress_callback({ status: 'progress', file: 'tokenizer.json', loaded: 0, total: 100 });
      options.progress_callback({ status: 'done', file: 'tokenizer.json' });
      return {
        async generate(text, generateOptions) {
          generated.push({ text, generateOptions });
          if (text === 'first') await new Promise((resolve) => { releaseFirst = resolve; });
          if (text === 'broken') throw new Error('phonemizer failed');
          return { audio: new Float32Array([0.1, 0.2, 0.3]), sampling_rate: 24000 };
        },
      };
    },
  };
  const worker = runWorker(progressTTS);
  worker.send({ type: 'load', url: KOKORO_CDN_URL, model: KOKORO_MODEL_ID, dtype: 'q8', device: 'wasm' });
  worker.send({ type: 'load', url: 'https://evil.test/x.js' });
  await flush();
  check('kokoro worker: imports the CDN module once and loads the model with dtype/device', worker.imports.join() === KOKORO_CDN_URL
    && generated[0].model === KOKORO_MODEL_ID && generated[0].options.dtype === 'q8' && generated[0].options.device === 'wasm');
  check('kokoro worker: download progress is aggregated across files, then ready',
    worker.posted.filter(({ message }) => message.type === 'progress').map(({ message }) => message.percent).join() === ',50,25,75'
    && worker.types().at(-1) === 'ready');
  worker.posted.length = 0;
  worker.send({ type: 'generate', id: 1, group: 1, text: 'first', voice: 'af_bella', speed: 1 });
  worker.send({ type: 'generate', id: 2, group: 2, text: 'second', voice: 'bf_emma', speed: 1 });
  await flush();
  check('kokoro worker: generation is serialized on one model session', generated.length === 2 && generated[1].text === 'first');
  releaseFirst();
  await flush();
  const audioMessages = worker.posted.filter(({ message }) => message.type === 'audio');
  check('kokoro worker: audio is posted per request with its voice, sample rate and a transferred buffer', audioMessages.length === 2
    && audioMessages[0].message.id === 1 && audioMessages[1].message.sampleRate === 24000 && generated[2].generateOptions.voice === 'bf_emma'
    && audioMessages[0].transfer?.[0] === audioMessages[0].message.samples.buffer);
  worker.posted.length = 0;
  worker.send({ type: 'generate', id: 3, group: 3, text: 'first', voice: 'af_bella' });
  worker.send({ type: 'generate', id: 4, group: 3, text: 'never', voice: 'af_bella' });
  worker.send({ type: 'cancel', group: 3 });
  releaseFirst();
  await flush();
  check('kokoro worker: a canceled reply posts nothing and skips its queued chunks', worker.posted.length === 0 && !generated.some((entry) => entry.text === 'never'));
  worker.send({ type: 'generate', id: 5, group: 4, text: 'broken', voice: 'af_bella' });
  await flush();
  check('kokoro worker: generation errors are reported for that request only', worker.posted[0]?.message.type === 'generate-error' && worker.posted[0].message.id === 5);
  const failedWorker = runWorker({ from_pretrained: async () => { throw new Error('offline'); } });
  failedWorker.send({ type: 'load', url: KOKORO_CDN_URL });
  failedWorker.send({ type: 'generate', id: 1, group: 1, text: 'hi' });
  await flush();
  check('kokoro worker: a failed load is reported and later requests fail cleanly', failedWorker.types().join() === 'load-error,generate-error');

  // ------------------------------------------------------------------- engine
  const clock = createClock();
  const { Worker, workers } = createWorkerDouble();
  const statuses = [];
  const engine = createKokoroEngine({ createWorker: () => new Worker('blob:test', { type: 'module' }), timers: clock, onStatus: (status) => statuses.push(status) });
  check('kokoro engine: worker creation is deferred (StrictMode-safe)', workers.length === 0 && engine.state === 'loading');
  clock.tick();
  const load = workers[0]?.messages[0];
  check('kokoro engine: spawns one module worker and asks it to load Kokoro', workers.length === 1 && load?.type === 'load' && load.url === KOKORO_CDN_URL
    && load.model === KOKORO_MODEL_ID && load.dtype === 'q8' && load.device === 'wasm');
  workers[0].reply({ type: 'progress', percent: 42 });
  workers[0].reply({ type: 'progress', percent: 42 });
  clock.tick(KOKORO_LOAD_IDLE_MS - 1);
  workers[0].reply({ type: 'alive' });
  clock.tick(KOKORO_LOAD_IDLE_MS - 1);
  check('kokoro engine: progress is published once per change and activity keeps a slow download alive',
    statuses.length === 1 && statuses[0].progress === 42 && engine.state === 'loading');
  let readyValue = null;
  engine.ready.then((value) => { readyValue = value; });
  workers[0].reply({ type: 'ready' });
  await flush();
  check('kokoro engine: ready resolves true and stops the stall timer', readyValue === true && engine.state === 'ready' && statuses.at(-1).state === 'ready' && clock.pending === 0);
  const group = engine.group();
  const first = engine.generate('Hello.', 'af_sarah', group);
  const request = workers[0].messages.at(-1);
  workers[0].reply({ type: 'audio', id: request.id, samples: new Float32Array([0.5]), sampleRate: 24000 });
  const firstAudio = await first;
  check('kokoro engine: generate sends text/voice and resolves the matching audio', request.type === 'generate' && request.voice === 'af_sarah'
    && request.text === 'Hello.' && firstAudio.sampleRate === 24000 && firstAudio.samples.length === 1);
  const canceledRequest = engine.generate('Later.', 'af_bella', group).catch((error) => error.name);
  engine.cancel(group);
  check('kokoro engine: cancel rejects pending chunks and tells the worker to skip them', await canceledRequest === 'AbortError'
    && workers[0].messages.at(-1).type === 'cancel' && workers[0].messages.at(-1).group === group);
  const errored = engine.generate('Bad.', 'af_bella', engine.group()).catch((error) => error.message);
  workers[0].reply({ type: 'generate-error', id: workers[0].messages.at(-1).id, message: 'bad input' });
  check('kokoro engine: per-request errors reject only that request', await errored === 'bad input' && engine.state === 'ready');
  const crashed = engine.generate('Crash.', 'af_bella', engine.group()).catch(() => 'rejected');
  workers[0].onerror({ preventDefault() {} });
  check('kokoro engine: a worker crash fails over (Web Speech) and rejects in-flight speech', await crashed === 'rejected' && engine.state === 'failed'
    && workers[0].terminated && statuses.at(-1).state === 'failed');
  check('kokoro engine: a failed engine refuses new work', await engine.generate('x', 'af_bella', 1).catch(() => 'refused') === 'refused');

  const stallClock = createClock();
  const stalled = createKokoroEngine({ createWorker: () => new Worker('blob:test'), timers: stallClock });
  let stalledReady = null;
  stalled.ready.then((value) => { stalledReady = value; });
  stallClock.tick();
  stallClock.tick(KOKORO_LOAD_IDLE_MS);
  await flush();
  check('kokoro engine: a download with no activity for 60s fails instead of hanging', stalled.state === 'failed' && stalledReady === false && stallClock.pending === 0);
  const loadErrorClock = createClock();
  const loadError = createKokoroEngine({ createWorker: () => new Worker('blob:test'), timers: loadErrorClock });
  loadErrorClock.tick();
  workers.at(-1).reply({ type: 'load-error', message: 'CDN blocked' });
  check('kokoro engine: a CDN/model load error fails over', loadError.state === 'failed' && workers.at(-1).terminated);
  const throwClock = createClock();
  const throwing = createKokoroEngine({ createWorker: () => { throw new Error('module workers unsupported'); }, timers: throwClock });
  throwClock.tick();
  check('kokoro engine: browsers that cannot create the worker fail over', throwing.state === 'failed');
  const disposeClock = createClock();
  const before = workers.length;
  const disposed = createKokoroEngine({ createWorker: () => new Worker('blob:test'), timers: disposeClock });
  disposed.dispose();
  disposeClock.tick();
  check('kokoro engine: disposing before startup never spawns a worker or leaves timers', workers.length === before && disposeClock.pending === 0);

  const audioDouble = createAudioDouble({ suspended: true });
  const kokoroAudio = createKokoroAudio(audioDouble.AudioContext);
  check('kokoro audio: no AudioContext is created until it is needed', audioDouble.instances.length === 0);
  kokoroAudio.unlock();
  kokoroAudio.unlock();
  await flush();
  check('kokoro audio: a gesture creates one context and resumes it', audioDouble.instances.length === 1 && audioDouble.instances[0].state === 'running');
  kokoroAudio.dispose();
  check('kokoro audio: dispose closes the context', audioDouble.instances[0].closes === 1);
  check('kokoro audio: a missing Web Audio API is reported as no context', createKokoroAudio(undefined).get() === null);

  // ------------------------------------------------------------------ session
  const play = session();
  await flush();
  check('kokoro session: every chunk is requested in order with the chosen voice', play.engine.jobs.length === play.chunks.length
    && play.engine.jobs.every((job, i) => job.text === play.chunks[i] && job.voice === 'af_bella' && job.group === 1));
  check('kokoro session: nothing plays or claims to speak before audio exists', play.context.sources.length === 0 && play.events.start === 0);
  play.engine.jobs[0].resolve({ samples: second(), sampleRate: 24000 });
  await flush();
  const [firstSource] = play.context.sources;
  check('kokoro session: the first buffer plays through Web Audio and starts speaking', play.context.sources.length === 1 && near(firstSource.startAt, 2.05)
    && firstSource.target === play.context.destination && firstSource.buffer.getChannelData(0)[1] === 0.5 && play.events.start === 1);
  play.engine.jobs[1].resolve({ samples: second(), sampleRate: 24000 });
  await flush();
  check('kokoro session: later chunks are scheduled gaplessly on the AudioContext clock', near(play.context.sources[1].startAt, 3.05));
  play.context.currentTime = 2.1;
  play.clock.tick(50);
  const loud = play.events.pulses.at(-1);
  play.context.currentTime = 2.7;
  play.clock.tick(50);
  const quiet = play.events.pulses.at(-1);
  play.context.currentTime = 3.1;
  play.clock.tick(50);
  check('kokoro session: eye pulse follows the playing audio’s loudness', loud === 1 && quiet === 0 && play.events.pulses.at(-1) === 1);
  play.context.currentTime = 9;
  play.clock.tick(50);
  check('kokoro session: eyes stop pulsing in a gap with no audio', play.events.pulses.at(-1) === 0);
  for (const job of play.engine.jobs.slice(2)) job.resolve({ samples: second(), sampleRate: 24000 });
  await flush();
  play.context.sources.slice(0, -1).forEach((source) => source.finish());
  await flush();
  check('kokoro session: earlier buffers ending do not end the reply', play.events.result === null);
  play.context.sources.at(-1).finish();
  await flush();
  check('kokoro session: the last buffer ending completes the reply and clears the pulse', play.events.result?.status === 'completed'
    && play.events.pulses.at(-1) === null && play.clock.pending === 0);

  const stopping = session();
  await flush();
  stopping.engine.jobs[0].resolve({ samples: second(), sampleRate: 24000 });
  await flush();
  stopping.spoken.stop();
  await flush();
  check('kokoro session: stop silences audio, cancels generation and leaves no timers', stopping.context.sources[0].stopped
    && stopping.engine.canceled.includes(1) && stopping.events.result?.status === 'stopped' && stopping.events.pulses.at(-1) === null && stopping.clock.pending === 0);

  const midFail = session();
  await flush();
  midFail.engine.jobs[0].resolve({ samples: second(), sampleRate: 24000 });
  await flush();
  midFail.context.currentTime = 2.5;
  midFail.engine.jobs[1].reject(new Error('boom'));
  await flush();
  check('kokoro session: a mid-reply failure hands over the still-audible chunk onward', midFail.events.result?.status === 'failed'
    && midFail.events.result.reason === 'generate' && midFail.events.result.remaining === midFail.chunks.join(' ') && midFail.context.sources[0].stopped);
  const lateFail = session();
  await flush();
  lateFail.engine.jobs[0].resolve({ samples: second(), sampleRate: 24000 });
  await flush();
  lateFail.context.currentTime = 3.5;
  lateFail.engine.jobs[1].reject(new Error('boom'));
  await flush();
  check('kokoro session: finished chunks are not repeated after a failure', lateFail.events.result?.remaining === lateFail.chunks.slice(1).join(' '));

  const slow = session();
  await flush();
  slow.clock.tick(KOKORO_CHUNK_TIMEOUT_MS - 1);
  await flush();
  const slowPending = slow.events.result === null;
  slow.clock.tick(1);
  await flush();
  check('kokoro session: a chunk that never generates times out to the fallback', slowPending && slow.events.result?.status === 'failed'
    && slow.events.result.remaining === slow.chunks.join(' '));

  let finishLoading;
  const loading = session({ engine: fakeEngine({ state: 'loading', ready: new Promise((resolve) => { finishLoading = resolve; }) }) });
  await flush();
  check('kokoro session: a reply during model loading says so and waits without a timeout', loading.events.waiting === 1 && loading.engine.jobs.length === 0);
  loading.clock.tick(KOKORO_CHUNK_TIMEOUT_MS * 3);
  finishLoading(false);
  await flush();
  // Nothing was taken from the stream, so the whole reply is still there for the fallback.
  check('kokoro session: if loading fails, nothing is taken and the reply stays for the fallback', loading.events.result?.status === 'failed' && loading.events.result.reason === 'load'
    && loading.events.result.remaining === '' && loading.engine.jobs.length === 0);

  const blocked = session({ audio: { suspended: true, rejectResume: true } });
  await flush();
  blocked.engine.jobs[0].resolve({ samples: second(), sampleRate: 24000 });
  await flush();
  await advance(blocked.clock, 500);
  check('kokoro session: autoplay-blocked audio asks for a tap', blocked.events.blocked === 1 && blocked.context.sources.length === 0);
  await advance(blocked.clock, KOKORO_UNLOCK_WAIT_MS);
  check('kokoro session: audio that never unlocks ends as blocked without playing', blocked.events.result?.status === 'blocked' && blocked.context.sources.length === 0);
  const unlocked = session({ audio: { suspended: true } });
  unlocked.context.resume = () => new Promise(() => {});
  await flush();
  unlocked.engine.jobs[0].resolve({ samples: second(), sampleRate: 24000 });
  await flush();
  await advance(unlocked.clock, 1000);
  unlocked.context.state = 'running';
  await advance(unlocked.clock, 250);
  check('kokoro session: a tap during the wait starts the reply', unlocked.context.sources.length === 1 && unlocked.events.start === 1);

  const short = session({ text: 'Hi!' });
  await flush();
  short.engine.jobs[0].resolve({ samples: second(), sampleRate: 24000 });
  await flush();
  short.clock.tick(1050 + 3000 - 1);
  await flush();
  const shortPending = short.events.result === null;
  short.clock.tick(1);
  await flush();
  check('kokoro session: a context that never reports ended still finishes after the audio', shortPending && short.events.result?.status === 'completed');
  const empty = session({ text: '  ' });
  await flush();
  check('kokoro session: empty text completes without generating', empty.events.result?.status === 'completed' && empty.engine.jobs.length === 0);

  // ---------------------------------------------------------------------- App
  const atStage = (ui, stage) => ui.find('status-word')?.props.className.split(' ').includes(`status-word-${stage}`);
  const label = (ui) => ui.find('active-voice-label')?.props.children;
  const notice = (ui) => ui.find('toast')?.props.children[1]?.props.children;
  const panelNode = (ui) => ui.nodes().find((node) => node.props.onTestVoice && node.props.onClose);
  const kokoroContext = (ui) => ui.audio.instances.find((context) => context.sources.length);
  const ANSWER = 'Here are two ideas:\n- Tea\n- A walk';
  async function kokoroUi(answer = ANSWER) {
    const ui = await createAppHarness({ kokoro: true, storage: createStorageDouble() });
    ui.chatAnswer = answer;
    return ui;
  }
  async function ask(ui) {
    ui.clock.tick();
    ui.flush();
    ui.recognition.instances[0].result('hey nova what do you suggest');
    ui.recognition.instances[0].end();
    await ui.settle();
  }
  const generateMessages = (ui) => ui.workers[0].messages.filter((message) => message.type === 'generate');
  const reply = async (ui, message) => {
    ui.workers[0].reply({ type: 'audio', id: message.id, samples: second(), sampleRate: 24000 });
    await ui.settle();
  };

  const app = await kokoroUi();
  check('kokoro App: loads on app load and shows Bella under the avatar while loading', label(app) === 'Bella · Kokoro AI' && app.workers.length === 0);
  check('kokoro App: a tiny "warming up..." indicator shows while Kokoro loads', app.find('kokoro-warmup')?.props.children === 'warming up...'
    && app.find('kokoro-warmup')?.props.role === 'status');
  app.clock.tick();
  await app.settle();
  check('kokoro App: a module worker starts loading Kokoro', app.workers.length === 1 && app.workers[0].options?.type === 'module'
    && app.workers[0].messages[0]?.url === KOKORO_CDN_URL);
  app.workers[0].reply({ type: 'ready' });
  app.flush();
  check('kokoro App: the label settles on the Kokoro voice once ready', label(app) === 'Bella · Kokoro AI');
  await ask(app);
  const [chunk, rest] = generateMessages(app);
  check('kokoro App: replies go through Kokoro with af_bella, not Web Speech', chunk?.voice === 'af_bella' && rest?.voice === 'af_bella'
    && words(generateMessages(app).map((message) => message.text).join(' ')) === words(ANSWER) && app.utterances.length === 0);
  check('kokoro App: generation shows as thinking, not speaking', atStage(app, 'thinking'));
  await reply(app, chunk);
  const context = kokoroContext(app);
  check('kokoro App: real audio starts the speaking state', atStage(app, 'speaking') && context?.sources.length === 1);
  context.currentTime = 2.1;
  app.clock.tick(50);
  check('kokoro App: eyes pulse from the audio while it plays', app.avatarElement.style.getPropertyValue('--audio-pulse') === '1.000'
    && app.avatarElement.classList.contains('speech-boundary-active'));
  await reply(app, rest);
  context.sources.forEach((source) => source.finish());
  await app.settle();
  check('kokoro App: playback end stops the pulse, finishes speaking and publishes cards', atStage(app, 'ready')
    && app.avatarElement.style.getPropertyValue('--audio-pulse') === '' && !app.avatarElement.classList.contains('speech-boundary-active')
    && Boolean(app.find('rich-content-slot')));
  app.clock.tick();
  app.flush();
  check('kokoro App: wake-word standby resumes after Kokoro playback ends', Boolean(app.find('wake-indicator')));

  app.find('settings-trigger').props.onClick();
  app.flush();
  if (app.recognition.instances[0]?.active) app.recognition.instances[0].end();
  const panel = await createAppHarness({ panelProps: panelNode(app).props });
  const select = panel.find('kokoro-voice-select');
  const fieldLabel = panel.nodes().find((node) => node.type === 'label' && node.props.htmlFor === 'nova-voice');
  check('kokoro settings: labelled “NOVA Voice (Kokoro AI)” with the four voices', [fieldLabel?.props.children].flat().join('') === 'NOVA Voice (Kokoro AI)'
    && select.props.value === 'af_bella' && select.props.children.length === 4);
  check('kokoro settings: the browser fallback list stays hidden while Kokoro works', !panel.find('browser-voice-select'));
  select.props.onChange({ target: { value: 'af_sarah' } });
  panel.flush();
  panel.find('test-voice-button').props.onClick();
  app.flush();
  await app.settle();
  const preview = generateMessages(app).slice(2);
  check('kokoro settings: Test Voice previews the unsaved voice with the sample phrase', preview.length > 0 && preview.every((message) => message.voice === 'af_sarah')
    && preview.map((message) => message.text).join(' ') === TTS_TEST_TEXT);
  panel.nodes().find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  app.flush();
  check('kokoro settings: saving persists the Kokoro voice and updates the label', app.storage.getItem(KOKORO_VOICE_KEY) === 'af_sarah'
    && label(app) === 'Sarah · Kokoro AI');
  panel.unmount();
  app.unmount();
  check('kokoro App: unmount terminates the worker and clears every timer', app.workers[0].terminated && app.clock.pending === 0);

  const saved = await createAppHarness({ kokoro: true, storage: createStorageDouble({ [KOKORO_VOICE_KEY]: 'bf_emma' }) });
  check('kokoro App: a saved Kokoro voice survives reload', label(saved) === 'Emma · Kokoro AI');
  saved.unmount();

  const failed = await kokoroUi();
  failed.clock.tick();
  await failed.settle();
  failed.workers[0].reply({ type: 'load-error', message: 'blocked' });
  failed.flush();
  check('kokoro fallback: a failed load says so and switches to the browser voice', notice(failed) === 'I couldn’t load my Kokoro voice, so I’ll use your browser’s voice for now.'
    && label(failed) === 'Samantha' && failed.workers[0].terminated);
  await ask(failed);
  check('kokoro fallback: replies then use Web Speech', failed.utterances.length === 1 && failed.utterances[0].text === ANSWER);
  failed.unmount();

  const snag = await kokoroUi();
  snag.clock.tick();
  await snag.settle();
  snag.workers[0].reply({ type: 'ready' });
  await ask(snag);
  snag.workers[0].reply({ type: 'generate-error', id: generateMessages(snag)[0].id, message: 'bad' });
  await snag.settle();
  check('kokoro fallback: a generation failure finishes that reply with Web Speech', words(snag.utterances[0]?.text || '') === words(ANSWER)
    && atStage(snag, 'speaking') && /hit a snag/.test(notice(snag) || ''));
  snag.utterances[0].onend();
  await snag.settle();
  check('kokoro fallback: the handed-off reply still completes and publishes cards', atStage(snag, 'ready') && Boolean(snag.find('rich-content-slot')));
  snag.unmount();

  const interrupted = await kokoroUi();
  interrupted.clock.tick();
  await interrupted.settle();
  interrupted.workers[0].reply({ type: 'ready' });
  await ask(interrupted);
  await reply(interrupted, generateMessages(interrupted)[0]);
  const playing = kokoroContext(interrupted).sources[0];
  interrupted.unmount();
  check('kokoro App: unmount mid-reply silences audio and cancels generation', playing.stopped && interrupted.workers[0].terminated && interrupted.clock.pending === 0);
}
