// Verify the name the recognizer keeps mishearing, and the greeting that depends on it:
// transcript repair at the source, the saved name, the hello after a bare wake word, and
// the rule that NOVA never mistakes her own greeting for a question.
// Web Speech and Ollama are doubles here, so this is plumbing, not audio accuracy.
import { readFile } from 'node:fs/promises';
import { WAKE_GREET_MS, correctTranscript, createVoiceListener, isSameSpeech, parseWakeWord } from '../src/speech.js';
import { MEMORY_KEY, memoryName, readMemoryStore, writeMemoryStore } from '../src/memory.js';
import { createAppHarness, createClock, createRecognitionDouble, createStorageDouble } from './speech-test-fixtures.mjs';


const atStage = (ui, stage) => ui.find('status-word')?.props.className.split(' ').includes(`status-word-${stage}`);

const MISHEARD = [
  ['join hug', 'Juwain'],
  ['join hawk', 'Juwain'],
  ['join hock', 'Juwain'],
  ['joo wayne', 'Juwain'],
  ['ju wayne', 'Juwain'],
  ['do wayne', 'Juwain'],
];

// One listener, one wake phrase, and the reason the app is told about it.
function wakeCase(transcript, { final = true } = {}) {
  const clock = createClock();
  const { Recognition, instances } = createRecognitionDouble(clock, { autoStart: false });
  const reasons = [];
  const questions = [];
  const listener = createVoiceListener({
    Recognition, timers: clock, now: clock.now,
    onWake: (reason) => reasons.push(reason), onQuestion: (text) => questions.push(text),
  });
  listener.setMode('standby');
  clock.tick(); // Startup is deferred on purpose; the session begins on the next timer.
  instances[0].onstart();
  instances[0].results([{ text: transcript, isFinal: final }]);
  clock.tick(1000);
  listener.dispose();
  return { reasons, questions };
}

export async function verifyNames(check) {
  const speechSource = await readFile(new URL('../src/speech.js', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');

  // ------------------------------------------------------------------ the repair table
  for (const [heard, name] of MISHEARD) {
    check(`name repair: "${heard}" becomes ${name} in a fact and after the wake word`,
      correctTranscript(`my name is ${heard}`) === `my name is ${name}`
      && correctTranscript(`hey nova ${heard}`) === `hey nova ${name}`);
    check(`name repair: "${heard}" is repaired whatever case the engine used`,
      correctTranscript(`My NAME IS ${heard.toUpperCase()}.`) === 'My NAME IS Juwain.');
  }
  check('name repair: only the misheard name is replaced, ordinary words are untouched',
    ['join the hug', 'a hawk flew over', 'I like hocks and socks', 'the way of the saints', 'dowayne', 'wayne\'s world']
      .every((text) => correctTranscript(text) === text));
  check('name repair: a repaired introduction parses as a name, and the question survives',
    memoryName([correctTranscript('my name is join hug')]) === 'Juwain'
    && parseWakeWord(correctTranscript('hey nova what do I like'))?.question === 'what do I like');
  check('name repair: applying it twice changes nothing, and empty input stays empty',
    correctTranscript(correctTranscript('join hug then join hawk')) === 'Juwain then Juwain'
    && correctTranscript('') === '' && correctTranscript(null) === '' && correctTranscript(undefined) === '');
  check('name repair: one application point, ahead of wake detection, questions and interrupts',
    /const transcript = correctTranscript\(result\[0\]\?\.transcript \|\| ''\);/.test(speechSource)
    && !/const transcript = result\[0\]/.test(speechSource));
  check('name repair: isSameSpeech compares words, not case or punctuation',
    isSameSpeech('Hi Juwain!', 'hi  juwain') && !isSameSpeech('Hi Juwain', 'Hi Juwain, how are you?') && !isSameSpeech('', ''));

  // ------------------------------------------------------- the reason NOVA was woken
  const alone = wakeCase('hey nova');
  const asked = wakeCase('hey nova what is my name');
  const midword = wakeCase('hey nova', { final: false });
  check('wake reason: a bare wake word is reported as a wake, not a question', alone.reasons.join(',') === 'wake'
    && alone.questions.length === 0);
  check('wake reason: a request said with the wake phrase is reported as a question', asked.reasons.join(',') === 'question'
    && asked.questions.join(' ') === 'what is my name');
  check('wake reason: a wake phrase heard mid-word is reported as partial', midword.reasons.join(',') === 'partial');
  check('greeting timing: the beat before a hello is 700ms, and a spoken question cancels it',
    WAKE_GREET_MS === 700 && /window\.clearTimeout\(greetTimerRef\.current\)/.test(appSource)
    && /if \(mode === 'question'\) window\.clearTimeout\(greetTimerRef\.current\)/.test(appSource));

  // ------------------------------------------------------------------- the app's flow
  const ready = async (options) => {
    const ui = await createAppHarness({ storage: createStorageDouble(), ...options });
    ui.clock.tick();
    await ui.settle();
    return ui;
  };
  const mic = (ui) => ui.recognition.instances[0];
  const chats = (ui) => ui.requests.filter((request) => request.url.endsWith('/chat/completions')).length;
  const say = async (ui, text) => {
    ui.clock.tick();
    ui.flush();
    mic(ui).result(`hey nova ${text}`);
    mic(ui).end();
    await ui.settle();
  };
  const wakeUp = async (ui) => {
    mic(ui).result('hey nova');
    mic(ui).end();
    await ui.settle();
    ui.clock.tick(WAKE_GREET_MS);
    ui.flush();
  };
  const finish = async (ui) => { ui.utterances.at(-1)?.onend(); await ui.settle(); ui.clock.tick(); ui.flush(); };

  const saved = createStorageDouble();
  const first = await ready({ storage: saved, modelsOffline: true });
  await say(first, 'my name is join hug');
  check('name memory: a misheard introduction is saved as the real name',
    readMemoryStore(saved).facts.includes('my name is Juwain') && !readMemoryStore(saved).facts.join(' ').includes('join hug'));
  check('name memory: the profile is one JSON object under the memory key',
    JSON.parse(saved.getItem(MEMORY_KEY)).includes('my name is Juwain'));
  await finish(first);
  first.unmount();

  const second = await ready({ storage: saved, modelsOffline: true });
  await say(second, 'which city am I from?');
  const askedSystem = JSON.parse(second.requests.filter((request) => request.url.endsWith('/chat/completions'))[0].options.body).messages[0];
  check('name memory: a new session reads the store and puts it in the system prompt', chats(second) === 1
    && askedSystem.role === 'system' && askedSystem.content.includes('my name is Juwain'));
  await finish(second);
  const beforeGreeting = second.utterances.length;
  await wakeUp(second);
  check('greeting: a bare "hey nova" is answered with the name, in person',
    second.utterances.at(-1)?.text === 'Hi Juwain!' && second.utterances.length === beforeGreeting + 1);
  check('greeting: a hello is not a request, so Ollama is never asked', chats(second) === 1);
  check('greeting: while the hello is spoken NOVA shows she is speaking, not listening',
    !second.find('wake-indicator') && atStage(second, 'speaking'));
  second.utterances.at(-1)?.onend();
  await second.settle();
  mic(second).end(); // The recognizer answers the mode change's abort with onend, as a browser does.
  second.clock.tick(150);
  second.flush();
  check('greeting: the hello hands the microphone back to standby and leaves the stage ready',
    Boolean(second.find('wake-indicator')) && atStage(second, 'ready'));
  second.unmount();

  // A beat before the hello is the whole point: a user who says "hey nova" and then thinks
  // must not be interrupted by a greeting on their way into the question.
  const paused = await ready({ storage: saved, modelsOffline: true });
  mic(paused).result('hey nova');
  mic(paused).end();
  await paused.settle();
  paused.clock.tick(300); // A breath, shorter than the greeting beat.
  paused.flush();
  const listeningForIt = mic(paused).active;
  mic(paused).result('what time is it?');
  mic(paused).end();
  await paused.settle();
  check('greeting: the beat is the shared constant, so no reply can be cut by a hello',
    /\}, WAKE_GREET_MS\);/.test(appSource) && (appSource.match(/\}, 0\);/g) || []).length === 0);
  check('greeting: a question that follows a breath after the wake word is not greeted over',
    Boolean(listeningForIt) && paused.utterances.every((utterance) => utterance.text !== 'Hi Juwain!')
    && paused.utterances.length === 1 && chats(paused) === 1);
  paused.unmount();

  // NOVA's own hello must not come back as a question. Two layers protect it: the app drops
  // a transcript that matches what she is saying, and while she speaks the recognizer is in
  // interrupt mode, which hears nothing but "stop", "wait" and the wake phrase. The double
  // can only exercise the second layer, so the first one is pinned from the source.
  const echo = await ready({ storage: saved, modelsOffline: true });
  await wakeUp(echo);
  const askedBeforeEcho = chats(echo);
  mic(echo).result('Hi Juwain');
  await echo.settle();
  check('greeting: her own hello cannot be heard as a question while it is spoken',
    chats(echo) === askedBeforeEcho && echo.utterances.length === 1);
  check('greeting: the app also drops a transcript equal to the hello it just said',
    /if \(greetingRef\.current && isSameSpeech\(text, greetingRef\.current\)\)/.test(appSource)
    && /greetingRef\.current = greeting;/.test(appSource));

  const busy = await ready({ storage: saved, modelsOffline: true });
  mic(busy).result('hey nova what is my name');
  mic(busy).end();
  await busy.settle();
  busy.clock.tick(WAKE_GREET_MS * 2);
  busy.flush();
  check('greeting: a request said with the wake phrase is answered, never greeted over',
    busy.utterances.every((utterance) => utterance.text !== 'Hi Juwain!') && busy.utterances.length === 1);
  check('greeting: no hello is even armed while a request is being answered', busy.clock.pending === 0
    && /reason === 'question' \? '' : memoryName\(memoriesRef\.current\)/.test(appSource));
  busy.unmount();

  const anonymous = await ready({ modelsOffline: true });
  await wakeUp(anonymous);
  await say(anonymous, 'my favourite colour is orange');
  await finish(anonymous);
  await wakeUp(anonymous);
  check('greeting: nothing is said on wake until a name has been saved',
    anonymous.utterances.every((utterance) => !(utterance.text || '').startsWith('Hi ')));
  anonymous.unmount();

  const store = createStorageDouble();
  writeMemoryStore(['my name is Juwain', 'I like gaming'], store);
  const stored = JSON.parse(store.getItem(MEMORY_KEY));
  check('name memory: the stored shape is readable data, and the name comes back out of it',
    Array.isArray(stored) && stored.length === 2 && memoryName(stored) === 'Juwain');
}
