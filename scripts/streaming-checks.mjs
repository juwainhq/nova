// Low-latency speech checks: sentence streaming, Kokoro warm-up and per-reply
// fallback, and the Ollama length/sampling limits. Doubles only: these verify
// ordering and timing logic, not real model speed or how long the first word takes.
import { createSpeechStream, sentenceCut, textSpeechStream } from '../src/speech-stream.js';
import {
  KOKORO_FIRST_CHUNK_CHARS, KOKORO_VOICE_KEY, KOKORO_WARMUP_TEXT, kokoroWorkerSource, speakWithKokoro, splitSpeechText,
} from '../src/kokoro.js';
import { runInNewContext } from 'node:vm';
import { createAppHarness, createAudioDouble, createClock, createStorageDouble } from './speech-test-fixtures.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const flush = async () => { for (let i = 0; i < 20; i += 1) await tick(); };
const second = () => Float32Array.from({ length: 24000 }, (_, i) => (i < 12000 ? (i % 2 ? 0.5 : -0.5) : 0));

// An Ollama SSE response whose chunks arrive one network read at a time.
function sseReply() {
  let controller;
  const encoder = new TextEncoder();
  const body = new ReadableStream({ start(value) { controller = value; } });
  const event = (payload) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  return {
    response: new Response(body, { status: 200 }),
    send(content, finish = null) { event({ choices: [{ delta: content == null ? {} : { content }, finish_reason: finish }] }); },
    done() { controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); },
    fail() { controller.error(new Error('Test stream broke')); },
  };
}

function fakeEngine({ state = 'ready', ready = Promise.resolve(true) } = {}) {
  const jobs = [];
  let groups = 0;
  return {
    state, ready, jobs,
    group: () => ++groups,
    generate(text, voice, group) { return new Promise((resolve, reject) => jobs.push({ text, voice, group, resolve, reject })); },
    cancel() { for (const job of jobs) job.reject(new Error('canceled')); },
  };
}

export async function verifyStreaming(check) {
  // ------------------------------------------------------- sentence boundaries
  const cutAt = (text) => text.slice(0, sentenceCut(text));
  check('stream: a sentence is complete at ".", "?" or "!" followed by a space', cutAt('Sure! Here it') === 'Sure!'
    && cutAt('Is it? Yes. Mor') === 'Is it? Yes.' && cutAt('Hello there.') === '');
  check('stream: closing quotes stay with their sentence', cutAt('She said “hi.” Then') === 'She said “hi.”');
  check('stream: decimals, titles, initials and "e.g." are not sentence ends', cutAt('It costs 3.5 dollars') === ''
    && cutAt('Ask Dr. Lee about it') === '' && cutAt('The U.S. team') === '' && cutAt('Fruit, e.g. apples') === '');
  check('stream: "1." list markers are not sentence ends, but line breaks are', cutAt('1. Tea\n2. A walk') === '1. Tea\n'
    && cutAt('Ideas:\n1. Tea') === 'Ideas:\n' && cutAt('I am 30. Really') === 'I am 30.');

  // ------------------------------------------------------------- stream object
  const stream = createSpeechStream();
  let woke = 0;
  void stream.wait().then(() => { woke += 1; });
  stream.push('Sure! Here');
  check('stream: nothing is ready until the network chunk is flushed', stream.poll() === undefined && !stream.pending);
  stream.flush();
  await flush();
  check('stream: flush releases the complete sentence and wakes the speaker', woke === 1 && stream.poll() === 'Sure!' && stream.poll() === undefined);
  stream.push(' is the rest. And');
  stream.flush();
  stream.push(' more');
  stream.end();
  check('stream: the end releases the last sentence even without a full stop', stream.poll() === 'Here is the rest. And more'
    && stream.poll() === null && stream.text === 'Sure! Here is the rest. And more');
  const cut = createSpeechStream();
  cut.push('One idea is tea. Another idea is to take a');
  cut.flush();
  cut.end({ cutOff: true });
  check('stream: at the token limit the unfinished last sentence is dropped', cut.poll() === 'One idea is tea.' && cut.poll() === null
    && cut.text === 'One idea is tea.');
  const only = createSpeechStream();
  only.push('Tea is a good');
  only.end({ cutOff: true });
  check('stream: a cut-off reply with no complete sentence is still spoken', only.poll() === 'Tea is a good' && only.text === 'Tea is a good');
  const handoff = textSpeechStream('Later text.');
  handoff.unshift('Unplayed first.');
  check('stream: unshift puts unplayed text back in front for a fallback speaker', handoff.poll() === 'Unplayed first. Later text.');
  const canceled = createSpeechStream();
  let stops = 0;
  canceled.onCancel = () => { stops += 1; };
  canceled.push('Ready. Not yet');
  canceled.flush();
  canceled.cancel();
  canceled.cancel();
  check('stream: cancel stops the speaker once and drops unspoken text', stops === 1 && canceled.poll() === null && canceled.canceled);
  const detached = createSpeechStream();
  let late = 0;
  detached.onCancel = () => { late += 1; };
  detached.detach();
  detached.cancel();
  check('stream: a detached speaker is not stopped by a later cancel', late === 0);

  // ------------------------------------------------- Kokoro first-chunk size
  const longFirst = 'Here is a fairly long first sentence that keeps on going and going, with a comma before even more words follow along after it. Then a second one.';
  const firstChunks = splitSpeechText(longFirst);
  check('kokoro chunks: a long first sentence is cut at a comma to speak sooner', firstChunks[0].length <= KOKORO_FIRST_CHUNK_CHARS
    && firstChunks[0].endsWith(',') && firstChunks.join(' ').replace(/\s+/g, ' ') === longFirst);
  check('kokoro chunks: a short opener is spoken on its own', splitSpeechText('Sure! Here is the plan for today.')[0] === 'Sure!');

  // ------------------------------------------------- Kokoro streamed session
  const clock = createClock();
  const engine = fakeEngine();
  const { AudioContext } = createAudioDouble();
  const context = new AudioContext();
  const live = createSpeechStream();
  const events = { start: 0, result: null };
  const spoken = speakWithKokoro({
    engine, getContext: () => context, source: live, voice: 'af_bella', timers: clock, onStart: () => { events.start += 1; },
  });
  spoken.done.then((result) => { events.result = result; });
  live.push('Sure! Here');
  live.flush();
  await flush();
  check('kokoro stream: the first sentence is generated while the reply is still arriving', engine.jobs.length === 1 && engine.jobs[0].text === 'Sure!');
  engine.jobs[0].resolve({ samples: second(), sampleRate: 24000 });
  await flush();
  context.sources[0].finish();
  await flush();
  check('kokoro stream: audio plays at once and the reply waits for more text', events.start === 1 && context.sources.length === 1 && events.result === null);
  live.push(' it is. Last');
  live.flush();
  await flush();
  live.push(' bit.');
  live.end();
  await flush();
  check('kokoro stream: a sentence arriving during a silence is generated at once', engine.jobs.map((job) => job.text).join('|') === 'Sure!|Here it is.');
  engine.jobs[1].resolve({ samples: second(), sampleRate: 24000 });
  await flush();
  // Text that arrived while a chunk was generating goes next (the worker is serial anyway).
  check('kokoro stream: text that arrived during generation is generated next', engine.jobs[2]?.text === 'Last bit.');
  engine.jobs[2].resolve({ samples: second(), sampleRate: 24000 });
  await flush();
  context.sources[1].finish();
  context.sources[2].finish();
  await flush();
  check('kokoro stream: the reply completes after its last sentence plays', events.result?.status === 'completed' && clock.pending === 0);

  // --------------------------------------------------------- worker warm-up
  const posted = [];
  const generated = [];
  const self = { postMessage: (message) => posted.push(message) };
  runInNewContext(kokoroWorkerSource().replace('import(data.url)', '__import(data.url)'), {
    self, Date, Float32Array, Promise, Set, Map, String, Number, Error,
    __import: async () => ({
      KokoroTTS: { from_pretrained: async () => ({ generate: async (text, options) => { generated.push({ text, ...options }); return { audio: [0], sampling_rate: 24000 }; } }) },
    }),
  });
  self.onmessage({ data: { type: 'load', url: 'x', model: 'm', warmup: KOKORO_WARMUP_TEXT, voice: 'bf_emma' } });
  await flush();
  check('kokoro warm-up: the worker generates a short phrase with the saved voice before reporting ready', generated.length === 1
    && generated[0].text === KOKORO_WARMUP_TEXT && generated[0].voice === 'bf_emma' && posted.at(-1)?.type === 'ready'
    && !posted.some((message) => message.type === 'audio'));

  // -------------------------------------------------------------------- App
  const models = () => ({ ok: true, json: async () => ({ data: [{ id: 'mistral:7b-instruct-q4_K_M' }] }) });
  const settle = async (ui) => { for (let i = 0; i < 8; i += 1) { await tick(); await ui.settle(); } };
  const atStage = (ui, stage) => ui.find('status-word')?.props.className.split(' ').includes(`status-word-${stage}`);
  const chats = (ui) => ui.requests.filter((request) => request.url.endsWith('/chat/completions'));
  const ask = async (ui, question = 'what do you suggest') => {
    ui.clock.tick();
    ui.flush();
    ui.recognition.instances[0].result(`hey nova ${question}`);
    ui.recognition.instances[0].end();
    await settle(ui);
  };
  async function streamingUi(options = {}) {
    const ui = await createAppHarness({ storage: createStorageDouble(options.saved), kokoro: options.kokoro });
    let reply = null;
    ui.fetchOverride = (url) => (url.endsWith('/models') ? models() : reply.response);
    return { ui, next: () => { reply = sseReply(); return reply; } };
  }

  // Request limits.
  const web = await streamingUi();
  let sse = web.next();
  await ask(web.ui);
  const body = JSON.parse(chats(web.ui)[0]?.options.body || '{}');
  check('ollama: Fast replies ask for at most 80 tokens (num_predict via max_tokens), temperature 0.6, top_p 0.9',
    body.max_tokens === 80 && body.temperature === 0.6 && body.top_p === 0.9 && body.stream === true);
  check('ollama: no fields the OpenAI-compatible endpoint would silently ignore', !('num_predict' in body) && !('options' in body));

  // Web Speech fallback, streamed.
  sse.send('Sure! Here');
  await settle(web.ui);
  check('streaming: the first sentence is spoken before the reply finishes', web.ui.utterances.length === 1
    && web.ui.utterances[0].text === 'Sure!' && atStage(web.ui, 'speaking'));
  sse.send(' is the rest. And');
  await settle(web.ui);
  check('streaming: later text waits for the current utterance to end', web.ui.utterances.length === 1);
  web.ui.utterances[0]?.onend?.();
  await settle(web.ui);
  check('streaming: the next utterance speaks everything ready so far', web.ui.utterances[1]?.text === 'Here is the rest.' && atStage(web.ui, 'speaking'));
  web.ui.utterances[1]?.onend?.();
  await settle(web.ui);
  check('streaming: a pause while the model writes stays in the speaking state', web.ui.utterances.length === 2 && atStage(web.ui, 'speaking'));
  sse.send(' more.', 'stop');
  sse.done();
  await settle(web.ui);
  check('streaming: the final sentence follows when the reply ends', web.ui.utterances[2]?.text === 'And more.');
  web.ui.utterances[2]?.onend?.();
  await settle(web.ui);
  check('streaming: the reply finishes after its last sentence, with every word spoken in order', atStage(web.ui, 'ready')
    && web.ui.utterances.map((utterance) => utterance.text).join(' ') === 'Sure! Here is the rest. And more.');
  check('streaming: Web Speech keeps the fallback rate and pitch on every sentence', web.ui.utterances.every((utterance) => utterance.rate === 0.92 && utterance.pitch === 0.88));

  // Token limit: the unfinished last sentence is neither spoken nor kept.
  sse = web.next();
  await ask(web.ui, 'tell me two ideas');
  sse.send('One idea is tea. Another idea is to');
  await settle(web.ui);
  sse.send(' take a', 'length');
  sse.done();
  await settle(web.ui);
  web.ui.utterances.at(-1)?.onend?.();
  await settle(web.ui);
  check('streaming: a reply cut off at 80 tokens drops its unfinished sentence', web.ui.utterances.at(-1)?.text === 'One idea is tea.' && atStage(web.ui, 'ready'));
  sse = web.next();
  await ask(web.ui, 'and another');
  const history = JSON.parse(chats(web.ui).at(-1)?.options.body || '{}').messages || [];
  check('streaming: the conversation history keeps only the finished sentences', history.some((message) => message.role === 'assistant' && message.content === 'One idea is tea.'));
  sse.send('Okay.', 'stop');
  sse.done();
  await settle(web.ui);
  web.ui.utterances.at(-1)?.onend?.();
  await settle(web.ui);

  // A stream that breaks mid-reply stops speaking and reports the problem.
  sse = web.next();
  await ask(web.ui, 'keep going');
  sse.send('First part. Second');
  await settle(web.ui);
  const spokenBefore = web.ui.utterances.length;
  const cancelsBefore = web.ui.cancellations;
  sse.fail();
  await settle(web.ui);
  web.ui.utterances.at(-1).onend?.();
  await settle(web.ui);
  check('streaming: a broken stream stops speech at once and returns to ready', web.ui.cancellations > cancelsBefore
    && web.ui.utterances.length === spokenBefore && atStage(web.ui, 'ready') && Boolean(web.ui.find('toast')));
  web.ui.unmount();
  check('streaming: unmount leaves no timers', web.ui.clock.pending === 0);

  // Kokoro still warming up when the first sentence arrives: Web Speech for that reply only.
  const warm = await streamingUi({ kokoro: true });
  check('warm-up: the indicator shows on first load', warm.ui.find('kokoro-warmup')?.props.children === 'warming up...');
  sse = warm.next();
  await ask(warm.ui);
  check('warm-up: Kokoro starts loading on page load, warmed up with the saved voice', warm.ui.workers.length === 1
    && warm.ui.workers[0].messages[0]?.warmup === KOKORO_WARMUP_TEXT && warm.ui.workers[0].messages[0]?.voice === 'af_bella');
  sse.send('Hi there! More');
  await settle(warm.ui);
  const generates = () => warm.ui.workers[0].messages.filter((message) => message.type === 'generate');
  check('warm-up: a reply that starts while Kokoro is loading uses Web Speech at once', warm.ui.utterances.length === 1
    && warm.ui.utterances[0].text === 'Hi there!' && generates().length === 0 && atStage(warm.ui, 'speaking'));
  warm.ui.workers[0].reply({ type: 'ready' });
  await settle(warm.ui);
  check('warm-up: the indicator hides once Kokoro is ready', !warm.ui.find('kokoro-warmup'));
  sse.send(' to say.', 'stop');
  sse.done();
  await settle(warm.ui);
  warm.ui.utterances[0]?.onend?.();
  await settle(warm.ui);
  check('warm-up: that reply stays on Web Speech even if Kokoro becomes ready mid-reply', warm.ui.utterances[1]?.text === 'More to say.' && generates().length === 0);
  warm.ui.utterances[1]?.onend?.();
  await settle(warm.ui);

  sse = warm.next();
  await ask(warm.ui, 'what next');
  sse.send('Sure! Here');
  await settle(warm.ui);
  check('warm-up: the next reply switches back to Kokoro, generating its first sentence mid-stream', generates().length === 1
    && generates()[0].text === 'Sure!' && warm.ui.utterances.length === 2 && atStage(warm.ui, 'thinking'));
  warm.ui.workers[0].reply({ type: 'audio', id: generates()[0]?.id, samples: second(), sampleRate: 24000 });
  await settle(warm.ui);
  check('warm-up: Kokoro audio starts while the reply is still streaming', atStage(warm.ui, 'speaking'));
  sse.send(' it is.', 'stop');
  sse.done();
  await settle(warm.ui);
  check('warm-up: Kokoro generates the rest as it arrives', generates()[1]?.text === 'Here it is.');
  warm.ui.workers[0].reply({ type: 'audio', id: generates()[1]?.id, samples: second(), sampleRate: 24000 });
  await settle(warm.ui);
  const playback = warm.ui.audio.instances.find((item) => item.sources.length) || { sources: [] };
  playback.sources.forEach((source) => source.finish());
  await settle(warm.ui);
  check('warm-up: the Kokoro reply completes after its audio ends', atStage(warm.ui, 'ready') && playback.sources.length === 2);

  // A Kokoro stream that breaks mid-reply stops the audio and cancels generation.
  sse = warm.next();
  await ask(warm.ui, 'go on');
  sse.send('One thing. Two');
  await settle(warm.ui);
  const before = warm.ui.workers[0].messages.length;
  sse.fail();
  await settle(warm.ui);
  check('streaming: a broken stream cancels queued Kokoro generation', warm.ui.workers[0].messages.slice(before).some((message) => message.type === 'cancel')
    && atStage(warm.ui, 'ready'));
  warm.ui.unmount();
  check('warm-up: unmount leaves no timers', warm.ui.clock.pending === 0);

  const saved = await streamingUi({ kokoro: true, saved: { [KOKORO_VOICE_KEY]: 'bf_emma' } });
  saved.ui.clock.tick();
  await settle(saved.ui);
  check('warm-up: a saved voice is the one warmed up', saved.ui.workers[0]?.messages[0]?.voice === 'bf_emma');
  saved.ui.unmount();
}
