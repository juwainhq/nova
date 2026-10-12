// Interrupting NOVA while she speaks: listener and App behavior with recognition,
// speech and Web Audio doubles. Not a test of real echo, microphones or audio.
import { createVoiceListener, parseInterrupt } from '../src/speech.js';
import { createAppHarness, createClock, createRecognitionDouble, createStorageDouble, createWorkerDouble } from './speech-test-fixtures.mjs';

const second = () => Float32Array.from({ length: 24000 }, (_, i) => (i % 2 ? 0.5 : -0.5));

function listenerFor(options = {}) {
  const clock = createClock();
  const { Recognition, instances } = createRecognitionDouble(clock, options.recognition);
  const events = { interrupts: [], questions: [], ends: [], detected: 0, starts: [] };
  let spoken = options.spoken || '';
  const listener = createVoiceListener({
    Recognition, timers: clock, now: clock.now,
    onInterrupt: (command) => events.interrupts.push(command),
    onQuestion: (text) => events.questions.push(text),
    onInputEnd: (reason) => events.ends.push(reason),
    onInputStart: (mode) => events.starts.push(mode),
    onSpeechDetected: () => { events.detected += 1; },
    spokenText: () => spoken,
  });
  return { clock, listener, mic: instances[0], events, setSpoken(text) { spoken = text; } };
}

export async function verifyInterrupt(check) {
  // ------------------------------------------------------------- phrase rules
  const accepted = { stop: 'stop', 'Stop.': 'stop', wait: 'wait', 'Wait, please': 'wait', 'nova stop': 'stop', 'hey nova': 'hey nova' };
  for (const [heard, command] of Object.entries(accepted)) {
    check(`interrupt phrase: "${heard}" interrupts (${command})`, parseInterrupt(heard)?.command === command);
  }
  check('interrupt phrase: "hey nova" keeps the question said after it', parseInterrupt('Hey Nova, what time is it?')?.question === 'what time is it?');
  check('interrupt phrase: other words, partial words and silence never interrupt',
    ['stopping by', 'weight', 'tell me more', 'waiting room is full', ''].every((heard) => parseInterrupt(heard) === null));
  check('interrupt phrase: a command word NOVA is saying is ignored while still interim',
    parseInterrupt('stop', { spoken: 'Next stop is Dhaka.' }) === null && parseInterrupt('wait let me think', { spoken: 'Wait, let me think.' }) === null);
  check('interrupt phrase: …but counts once finalized as the whole utterance',
    parseInterrupt('stop', { spoken: 'Next stop is Dhaka.', final: true })?.command === 'stop'
    && parseInterrupt('the bus stop', { spoken: 'the bus stop', final: true }) === null);

  // ------------------------------------------------------------------ listener
  const a = listenerFor({ spoken: 'Here is a long answer about tea.' });
  a.listener.setMode('interrupt');
  a.clock.tick();
  check('interrupt listener: starts a continuous, interim session', a.mic.starts.length === 1 && a.mic.starts[0].continuous && a.mic.starts[0].interim);
  a.mic.speechStart();
  a.mic.results([{ text: 'here is a long answer', isFinal: false }]);
  a.mic.results([{ text: 'here is a long answer about tea', isFinal: true }]);
  check('interrupt listener: NOVA\'s own words are not sent or treated as the user speaking', a.events.questions.length === 0
    && a.events.interrupts.length === 0 && a.events.detected === 0);
  a.mic.results([{ text: 'old', isFinal: true }, { text: 'stop', isFinal: false }], 1);
  check('interrupt listener: an interim "stop" interrupts immediately', a.events.interrupts.length === 1 && a.events.interrupts[0] === 'stop');
  check('interrupt listener: the same session becomes the question (no restart, no abort)', a.mic.starts.length === 1 && a.mic.aborts === 0 && a.events.starts.at(-1) === 'question');
  a.mic.results([{ text: 'old', isFinal: true }, { text: 'stop', isFinal: true }], 1);
  check('interrupt listener: the command itself is never sent as a question', a.events.questions.length === 0);
  a.mic.results([{ text: 'old', isFinal: true }, { text: 'stop', isFinal: true }, { text: 'what time is it', isFinal: true }], 2);
  check('interrupt listener: what the user says next is the question', a.events.questions[0] === 'what time is it');

  const quiet = listenerFor();
  quiet.listener.setMode('interrupt');
  quiet.clock.tick();
  quiet.mic.result('wait', false);
  quiet.clock.tick(15000);
  check('interrupt listener: silence after an interrupt ends quietly, without a "didn\'t catch that"', same(quiet.events.ends, ['quiet']));
  const quietError = listenerFor();
  quietError.listener.setMode('interrupt');
  quietError.clock.tick();
  quietError.mic.result('stop', false);
  quietError.mic.error('no-speech');
  check('interrupt listener: a no-speech error after an interrupt is quiet too', same(quietError.events.ends, ['quiet']));
  const manual = listenerFor();
  manual.listener.setMode('question', { quiet: true });
  manual.clock.tick();
  manual.clock.tick(15000);
  const normal = listenerFor();
  normal.listener.setMode('question');
  normal.clock.tick();
  normal.clock.tick(15000);
  check('interrupt listener: a quiet question can be requested; normal questions still say no-speech', same(manual.events.ends, ['quiet']) && same(normal.events.ends, ['no-speech']));

  const wake = listenerFor();
  wake.listener.setMode('interrupt');
  wake.clock.tick();
  wake.mic.result('hey nova', false);
  wake.mic.result('hey nova what is the time', true);
  check('interrupt listener: "hey nova …" interrupts and keeps the rest as the question', same(wake.events.interrupts, ['hey nova']) && same(wake.events.questions, ['what is the time']));
  const finalWake = listenerFor();
  finalWake.listener.setMode('interrupt');
  finalWake.clock.tick();
  finalWake.mic.result('hey nova tell me a joke', true);
  check('interrupt listener: a final-only "hey nova …" interrupts and asks', same(finalWake.events.interrupts, ['hey nova']) && same(finalWake.events.questions, ['tell me a joke']));
  const finalStop = listenerFor();
  finalStop.listener.setMode('interrupt');
  finalStop.clock.tick();
  finalStop.mic.results([{ text: 'stop', isFinal: true }]);
  finalStop.mic.results([{ text: 'stop', isFinal: true }, { text: 'tell me about tea', isFinal: true }], 1);
  check('interrupt listener: after a final-only "stop", the next words are still the question', same(finalStop.events.interrupts, ['stop']) && same(finalStop.events.questions, ['tell me about tea']));

  const echo = listenerFor({ spoken: 'Wait for the next stop.' });
  echo.listener.setMode('interrupt');
  echo.clock.tick();
  echo.mic.result('stop', false);
  check('interrupt listener: an interim command word from NOVA\'s own reply is ignored', echo.events.interrupts.length === 0);
  echo.mic.result('stop', true);
  check('interrupt listener: the user saying just that word still interrupts once final', same(echo.events.interrupts, ['stop']));

  const back = listenerFor();
  back.listener.setMode('interrupt');
  back.clock.tick();
  back.listener.setMode('standby');
  check('interrupt listener: speech ending returns to standby in the same session (no listening gap)', back.mic.aborts === 0 && back.mic.starts.length === 1);
  back.mic.result('hey nova what is new', true);
  check('interrupt listener: the wake phrase works right after', same(back.events.questions, ['what is new']));

  const flaky = listenerFor();
  flaky.listener.setMode('interrupt');
  flaky.clock.tick();
  flaky.mic.error('network');
  flaky.mic.end();
  flaky.clock.tick(800);
  check('interrupt listener: a network error just retries, keeping wake-word standby available', flaky.mic.starts.length === 2);
  flaky.listener.setMode('standby');
  check('interrupt listener: …and standby still works afterwards', flaky.mic.aborts === 0);
  const single = listenerFor({ recognition: { continuous: false } });
  single.listener.setMode('interrupt');
  single.clock.tick(1000);
  check('interrupt listener: browsers without continuous recognition do not listen during speech', single.mic.starts.length === 0);

  // ----------------------------------------------------------------------- App
  const atStage = (ui, stage) => ui.find('status-word')?.props.className.split(' ').includes(`status-word-${stage}`);
  const mic = (ui) => ui.find('mic-button');
  // The button holds one icon; React hands a lone child over as an element, not an
  // array, so read the first icon either way.
  const iconName = (ui) => {
    const kids = mic(ui)?.props.children;
    return (Array.isArray(kids) ? kids[0] : kids)?.type?.name;
  };
  const panel = (ui) => ui.find('rich-content-slot');
  const toast = (ui) => ui.find('toast');
  async function speaking(options = {}, answer = 'First sentence here. Second sentence follows. And a third.') {
    const ui = await createAppHarness({ storage: createStorageDouble(), ...options });
    ui.chatAnswer = answer;
    ui.clock.tick();
    await ui.settle();
    ui.recognition.instances[0].result('hey nova tell me about tea');
    ui.recognition.instances[0].end();
    await ui.settle();
    ui.clock.tick();
    ui.flush();
    return ui;
  }

  const idle = await createAppHarness();
  idle.clock.tick();
  await idle.settle();
  check('interrupt App: the mic button is the normal mic when NOVA is not speaking', !mic(idle).props.className.includes('mic-button-stop')
    && iconName(idle) === 'MicIcon' && mic(idle).props['aria-label'] === 'Start listening');
  idle.unmount();

  const button = await speaking();
  const reply = button.utterances[0];
  check('interrupt App: while speaking the mic button turns into an enabled red stop button', atStage(button, 'speaking')
    && mic(button).props.className.includes('mic-button-stop') && !mic(button).props.disabled
    && iconName(button) === 'StopIcon' && mic(button).props['aria-label'] === 'Stop speaking');
  const voiceSession = button.recognition.instances[0];
  check('interrupt App: an interrupt-only listener runs during speech (no wake indicator)', voiceSession.active === true && voiceSession.starts.at(-1)?.continuous === true && !button.find('wake-indicator'));
  const cancelsBefore = button.cancellations;
  const utterancesBefore = button.utterances.length;
  mic(button).props.onClick();
  button.flush();
  check('interrupt App: pressing it cancels speechSynthesis immediately', button.cancellations > cancelsBefore);
  check('interrupt App: the avatar returns to listening at once', atStage(button, 'listening')
    && button.find('avatar-container').props.className.includes('is-listening') && !mic(button).props.className.includes('mic-button-stop'));
  reply.onend();
  await button.settle();
  button.clock.tick(5000);
  button.flush();
  check('interrupt App: NOVA says nothing more, celebrates nothing and shows no cards', button.utterances.length === utterancesBefore
    && atStage(button, 'listening') && !panel(button) && !button.find('avatar-container').props.className.includes('is-happy'));
  voiceSession.end();
  button.clock.tick(150);
  button.flush();
  voiceSession.result('what about coffee');
  await button.settle();
  check('interrupt App: the next thing said is a new question', button.requests.filter((r) => r.url.endsWith('/chat/completions')).length === 2
    && JSON.parse(button.requests.at(-1).options.body).messages.at(-1).content === 'what about coffee');
  button.unmount();

  const silent = await speaking();
  mic(silent).props.onClick();
  silent.flush();
  silent.recognition.instances[0].end();
  silent.clock.tick(150);
  silent.flush();
  silent.clock.tick(15000);
  await silent.settle();
  check('interrupt App: if nothing is said after, NOVA quietly returns to standby (no toast)', atStage(silent, 'ready') && !toast(silent) && silent.utterances.length === 1);
  silent.unmount();

  const voice = await speaking();
  const voiceCancels = voice.cancellations;
  voice.recognition.instances[0].result('stop', false);
  voice.flush();
  check('interrupt App: saying "stop" while NOVA speaks interrupts at once', voice.cancellations > voiceCancels && atStage(voice, 'listening')
    && voice.find('avatar-container').props.className.includes('is-listening'));
  voice.recognition.instances[0].result('stop', true);
  await voice.settle();
  check('interrupt App: the word "stop" is not sent to the model', voice.requests.filter((r) => r.url.endsWith('/chat/completions')).length === 1 && voice.utterances.length === 1);
  voice.unmount();

  for (const word of ['wait', 'hey nova']) {
    const ui = await speaking();
    ui.recognition.instances[0].result(word, false);
    ui.flush();
    check(`interrupt App: saying "${word}" while NOVA speaks interrupts`, atStage(ui, 'listening') && !ui.find('wake-indicator'));
    ui.unmount();
  }
  const ignored = await speaking();
  ignored.recognition.instances[0].result('first sentence here', false);
  ignored.recognition.instances[0].result('first sentence here second sentence', true);
  ignored.flush();
  check('interrupt App: NOVA hearing her own reply does not interrupt her', atStage(ignored, 'speaking') && ignored.utterances.length === 1);
  ignored.unmount();

  const space = await speaking();
  const spaceCancels = space.cancellations;
  space.window.dispatch('keydown', { code: 'Space', key: ' ', target: {}, preventDefault() {} });
  space.flush();
  check('interrupt App: the mic button\'s Space shortcut also interrupts', space.cancellations > spaceCancels && atStage(space, 'listening'));
  space.unmount();

  const streaming = await createAppHarness({ storage: createStorageDouble() });
  streaming.deferChat = true;
  streaming.clock.tick();
  await streaming.settle();
  streaming.recognition.instances[0].result('hey nova tell me about tea');
  streaming.recognition.instances[0].end();
  await streaming.settle();
  const pendingChat = streaming.pendingChats[0];
  pendingChat.resolve();
  await streaming.settle();
  mic(streaming).props.onClick();
  streaming.flush();
  check('interrupt App: interrupting also aborts the model request', pendingChat.options.signal.aborted === true);
  streaming.unmount();

  // Kokoro: Web Audio playback and queued chunks stop instantly.
  const kokoro = await createAppHarness({ kokoro: true, storage: createStorageDouble() });
  kokoro.chatAnswer = 'Here is the first part of my answer. Here is the second part, still queued.';
  kokoro.clock.tick();
  await kokoro.settle();
  kokoro.workers[0].reply({ type: 'ready' });
  kokoro.flush();
  kokoro.recognition.instances[0].result('hey nova what do you suggest');
  kokoro.recognition.instances[0].end();
  await kokoro.settle();
  const generate = kokoro.workers[0].messages.filter((message) => message.type === 'generate');
  kokoro.workers[0].reply({ type: 'audio', id: generate[0].id, samples: second(), sampleRate: 24000 });
  await kokoro.settle();
  const context = kokoro.audio.instances.find((item) => item.sources.length);
  check('interrupt App: Kokoro speech shows the red stop button too', atStage(kokoro, 'speaking') && mic(kokoro).props.className.includes('mic-button-stop'));
  const kokoroCancels = kokoro.cancellations;
  mic(kokoro).props.onClick();
  kokoro.flush();
  check('interrupt App: speechSynthesis is canceled on every interrupt, even with Kokoro speaking', kokoro.cancellations > kokoroCancels);
  check('interrupt App: Kokoro Web Audio playback is stopped and disconnected instantly', context.sources.every((source) => source.stopped && source.disconnected));
  check('interrupt App: queued Kokoro chunks are canceled in the worker', kokoro.workers[0].messages.some((message) => message.type === 'cancel'));
  if (generate[1]) kokoro.workers[0].reply({ type: 'audio', id: generate[1].id, samples: second(), sampleRate: 24000 });
  await kokoro.settle();
  check('interrupt App: late Kokoro audio never plays after an interrupt', context.sources.length === 1 && atStage(kokoro, 'listening'));
  kokoro.unmount();

  const preview = await createAppHarness();
  preview.clock.tick();
  await preview.settle();
  preview.find('settings-trigger').props.onClick();
  preview.flush();
  preview.nodes().find((node) => node.props.onTestVoice && node.props.onClose).props.onTestVoice('');
  preview.flush();
  check('interrupt App: a Settings voice test is not interruptible from the mic (button stays disabled)', atStage(preview, 'speaking')
    && mic(preview).props.disabled && !mic(preview).props.className.includes('mic-button-stop'));
  preview.unmount();
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
