// Verify the Web Speech voice plumbing: the same voice must be chosen for the same
// machine, users must be able to override it, and the speaking parameters must be the
// values NOVA is specified to use.
//
//   node scripts/verify-speech.mjs
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createAppHarness, createAudioDouble, createClock, createRecognitionDouble } from './speech-test-fixtures.mjs';
import { verifyMemory } from './memory-checks.mjs';
import { verifyVoices } from './voice-checks.mjs';
import { verifyPersonality } from './personality-checks.mjs';
import { verifyRich } from './rich-checks.mjs';
import { verifyKokoro } from './kokoro-checks.mjs';
import { verifyStreaming } from './streaming-checks.mjs';
import { verifyWebBrowse } from './web-browse-checks.mjs';
import { verifyInterrupt } from './interrupt-checks.mjs';

const run = promisify(execFile);
const root = process.cwd();
const atStage = (ui, stage) => ui.find('status-word')?.props.className.split(' ').includes(`status-word-${stage}`);

const problems = [];
const checks = [];
function check(label, ok, detail = '') {
  checks.push({ label, ok, detail });
  if (!ok) problems.push(label);
}

// speech.js is plain ESM with no browser access at module scope, so it runs in Node.
const bundle = await build({
  entryPoints: [resolve(root, 'src/speech.js')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  logLevel: 'warning',
});

const directory = await mkdtemp(join(tmpdir(), 'nova-speech-'));
const probe = join(directory, 'speech.mjs');
let speech;
try {
  await writeFile(probe, bundle.outputFiles[0].text, 'utf8');
  speech = await import(`file://${probe}`);
} finally {
  await rm(directory, { recursive: true, force: true }).catch(() => {});
}

const { TTS, TTS_TEST_TEXT, defaultVoice, describeVoice, groupVoices, isNaturalVoice, resolveVoice, scoreVoice, sortVoices, voiceKey, voiceOptionLabel, voicePriority,
  WAKE_WORD, WAKE_UNSUPPORTED_MESSAGE, parseWakeWord, createVoiceListener, createWakeChime } = speech;

const voice = (name, lang, extra = {}) => ({ name, lang, voiceURI: `${name}-uri`, localService: true, default: false, ...extra });

// --------------------------------------------------------- speaking parameters
check('rate is 0.92', TTS.rate === 0.92, String(TTS.rate));
check('pitch is 0.88', TTS.pitch === 0.88, String(TTS.pitch));
check('volume stays 1.0', TTS.volume === 1, String(TTS.volume));
check('preview says the exact requested phrase', TTS_TEST_TEXT === "Hey, I'm Nova. Ready when you are.");

// -------------------------------------------------- a representative machine
const MACHINE = [
  voice('Microsoft David - English (United States)', 'en-US', { default: true }),
  voice('Microsoft Zira - English (United States)', 'en-US'),
  voice('Google US English', 'en-US', { localService: false }),
  voice('Google UK English Female', 'en-GB', { localService: false }),
  voice('Microsoft Aria Online (Natural) - English (United States)', 'en-US', { localService: false }),
  voice('Microsoft NOVA Online (Natural) - English (United States)', 'en-US', { localService: false }),
  voice('Microsoft Guy Online (Natural) - English (United States)', 'en-US', { localService: false }),
  voice('Samantha', 'en-US'),
  voice('Alex', 'en-US'),
  voice('Microsoft Hedda - German (Germany)', 'de-DE'),
  voice('Microsoft Aria Online (Natural) - German (Germany)', 'de-DE', { localService: false }),
  voice('Amelie', 'fr-CA'),
];
const best = defaultVoice(MACHINE);
check('first priority is Microsoft Aria Online, not an app-name bonus', best === MACHINE[4], best.name);
check('English wins among variants within the same named tier', best.lang === 'en-US');
check('selection is independent of voice enumeration order', defaultVoice([...MACHINE].reverse()) === best);

// Remove each tier in turn to verify every edge of the ordered fallback chain.
const PRIORITY_CHAIN = [MACHINE[4], MACHINE[6], MACHINE[3], MACHINE[2], MACHINE[5], MACHINE[0]];
for (let i = 0; i < PRIORITY_CHAIN.length; i += 1) {
  const candidates = [...PRIORITY_CHAIN.slice(i)].reverse();
  check(`priority ${i + 1}: ${PRIORITY_CHAIN[i].name}`, defaultVoice(candidates) === PRIORITY_CHAIN[i]);
}
check('generic Online-only names outrank the default', defaultVoice([MACHINE[0], voice('Jenny Online', 'en-US')])?.name === 'Jenny Online');
check('generic Natural-only names outrank the default', defaultVoice([MACHINE[0], voice('Ava Natural', 'en-US')])?.name === 'Ava Natural');
check('voice-name priorities are case/whitespace insensitive', voicePriority(voice('  microsoft   aRiA ONLINE (nAtUrAl)', 'en-US')) === 0);
check('lookalike names cannot impersonate a named priority', voicePriority(voice('Microsoft Aria Onlinely', 'en-US')) !== 0);
check('named priority beats a default/local/language bonus', defaultVoice([
  voice('Google US English', 'en-US', { default: true }), MACHINE[3],
]) === MACHINE[3]);
check('any Natural/Online voice is preferred before a basic fallback', defaultVoice([
  MACHINE[0], voice('French Natural', 'fr-FR'),
])?.name === 'French Natural');
const LOCAL_ONLY = [voice('Samantha', 'en-US'), voice('System Default', 'de-DE', { default: true })];
check('no preferred voice: use the marked browser default, not an old heuristic', defaultVoice(LOCAL_ONLY) === LOCAL_ONLY[1]);
check('no default flag: use the first exposed voice as the last resort', defaultVoice([MACHINE[7], voice('Basic', 'en-US')]) === MACHINE[7]);
check('handles an empty voice list', defaultVoice([]) === null);
check('handles a missing list', defaultVoice(undefined) === null);
check('handles voices with no English option', Boolean(defaultVoice([voice('Hedda', 'de-DE')])));
check('handles a voice with no name', Boolean(defaultVoice([{ lang: 'en-US', voiceURI: 'x', localService: true }])));

// ------------------------------------------------------------------ grouping
const { natural, basic } = groupVoices(MACHINE);
check('Natural/Online voices and basic voices are separate', natural.length === 4 && basic.length === 8, `${natural.length}/${basic.length}`);
check('only names containing Natural/Online enter the top group', natural.every(isNaturalVoice));
check('basic group has no Natural/Online names', basic.every((entry) => !isNaturalVoice(entry)));
check('grouping retains every voice without duplicates', new Set([...natural, ...basic]).size === MACHINE.length);
check('top group is priority-sorted', natural[0] === best && natural.every((entry, i) => !i || scoreVoice(natural[i - 1]) >= scoreVoice(entry)));
check('Google voices keep their named priority within the basic group', basic[0] === MACHINE[3] && basic[1] === MACHINE[2]);
check('locale cannot override a higher named tier', sortVoices([
  voice('Plain', 'en-US'), voice('Microsoft Aria Online (Natural) - English (United Kingdom)', 'en-GB'),
])[0].lang === 'en-GB');
check('voice sorting does not mutate the browser list', MACHINE[0].default && MACHINE[4] === best);

// ------------------------------------------------------------------ selection
const chosen = MACHINE[4];
check('resolves a saved voice by URI', resolveVoice(MACHINE, voiceKey(chosen))?.name === chosen.name);
check('resolves a saved voice by name', resolveVoice(MACHINE, 'Samantha')?.name === 'Samantha');
check('returns null for an unknown voice', resolveVoice(MACHINE, 'nope') === null);
check('returns null for an empty key', resolveVoice(MACHINE, '') === null);
check('a stored choice survives a rename by URI', resolveVoice(MACHINE, 'Samantha-uri')?.name === 'Samantha');

// Labels must be honest about whether a voice needs the network.
check('labels an offline voice as offline', voiceOptionLabel(voice('Samantha', 'en-US')).includes('offline'));
check('labels a network voice as network', voiceOptionLabel(voice('Google US English', 'en-US', { localService: false })).includes('network'));
check('describes the selection for the panel', describeVoice(chosen) === `${chosen.name} · en-US · needs network`, describeVoice(chosen));
check('describes a missing voice safely', describeVoice(null) === 'No voice here yet');

// ------------------------------------------------------------- no ElevenLabs
const app = await readFile(resolve(root, 'src/App.jsx'), 'utf8');
const personality = await readFile(resolve(root, 'src/personality.js'), 'utf8');
const viteConfig = await readFile(resolve(root, 'vite.config.js'), 'utf8');
check('app has no ElevenLabs code', !/elevenlabs/i.test(app));
check('app has no API key handling', !/xi-api-key|apiKey/.test(app));
check('dev proxy no longer forwards ElevenLabs', !/elevenlabs/i.test(viteConfig));
check('app speaks through the Web Speech API', /speechSynthesis\.speak|synth\.speak\(utterance\)/.test(app) && /const synth = window\.speechSynthesis/.test(app));
check('app takes its name from the brand module', /import \{ APP_NAME \} from '\.\/brand\.js'/.test(app));
check('system prompt carries the brand name', /You are \$\{APP_NAME\}/.test(personality));
check('system prompt asks for a warm personality', /a warm, friendly, and genuinely helpful/.test(personality));
check('status messages are conversational rather than machine codes', personality.includes('Ready when you are.') && personality.includes('Talking with you.'));
check('settings written under the old name are adopted', /LEGACY_STORAGE_PREFIX/.test(app));;
check('app sends the specified parameters', /utterance\.rate = TTS\.rate/.test(app)
  && /utterance\.pitch = TTS\.pitch/.test(app)
  && /utterance\.volume = TTS\.volume/.test(app));
check('voice list comes from getVoices', /getVoices/.test(await readFile(resolve(root, 'src/speech.js'), 'utf8')));
check('listens for late voice loading', /voiceschanged/.test(app));
check('the selector label is derived from the brand', /\{\s*APP_NAME\s*\}\s*Voice/.test(app));

// Regression: the voice list arrives after first render and does not change
// `settings`, so a memoized askAria would otherwise call a speaker that never saw it
// and would ignore the selected voice for the rest of the session.
check('speaker is reached through a ref, not a stale closure',
  /speakRef\.current = speakAnswer/.test(app) && /speakRef\.current\?\.\(answer\)/.test(app));

// ------------------------------------------------- the panel, actually rendered
// Renders the real component, so the selector is inspected as markup rather than as
// source text.
async function renderPanel(voices, savedKey, memories = [], memoryError = '') {
  const result = await build({
    stdin: {
      contents: `
        import { createElement } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { SettingsPanel } from './src/App.jsx';
        const voices = ${JSON.stringify(voices)};
        const settings = { model: 'mistral:7b-instruct-q4_K_M', ollamaUrl: '', voiceKey: ${JSON.stringify(savedKey)}, showTranscript: false };
        process.stdout.write(renderToStaticMarkup(createElement(SettingsPanel, {
          settings, voices, memories: ${JSON.stringify(memories)}, memoryError: ${JSON.stringify(memoryError)}, connection: 'connected', modelAvailable: true, standalone: false,
          onClose() {}, onSave() {}, onConnectionChange() {}, openerRef: { current: null },
          onTestVoice() {}, onStopVoiceTest() {}, speechAvailable: true, voiceTestDisabled: false,
        })));
      `,
      resolveDir: root,
      loader: 'jsx',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    define: { __NOVA_STANDALONE__: 'false' },
    logLevel: 'warning',
  });

  const dir = await mkdtemp(join(tmpdir(), 'nova-panel-'));
  const file = join(dir, 'panel.cjs');
  try {
    await writeFile(file, result.outputFiles[0].text, 'utf8');
    const { stdout } = await run(process.execPath, [file], { cwd: root });
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const panel = await renderPanel(MACHINE, '');
// The browser list is the Web Speech fallback, shown when Kokoro is unavailable.
const browserSelect = (markup) => markup.match(/<select[^>]*id="nova-browser-voice"[\s\S]*?<\/select>/)?.[0] ?? '';
const options = [...browserSelect(panel).matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)]
  .map((match) => ({ value: match[1], label: match[2] }));

check('panel renders the NOVA Voice (Kokoro AI) selector', /<label[^>]*for="nova-voice"[^>]*>NOVA Voice \(Kokoro AI\)<\/label>/.test(panel));
check('panel renders a select bound to nova-voice', /<select[^>]*id="nova-voice"/.test(panel));
const kokoroOptions = [...(panel.match(/<select[^>]*id="nova-voice"[\s\S]*?<\/select>/)?.[0] ?? '').matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)];
check('Kokoro selector offers exactly the four requested voices', kokoroOptions.map((match) => `${match[1]}|${match[3]}`).join('\n') === [
  'af_bella|af_bella — Warm American Female (default)', 'af_sarah|af_sarah — Bright American Female',
  'af_nicole|af_nicole — Soft American Female', 'bf_emma|bf_emma — British Female'].join('\n'));
check('Kokoro selector defaults to af_bella', /selected/.test(kokoroOptions[0]?.[2] ?? ''));
check('unavailable Kokoro shows the labelled browser fallback selector', /<label[^>]*for="nova-browser-voice"[^>]*>Browser voice \(fallback\)<\/label>/.test(panel)
  && /couldn’t load Kokoro here/.test(panel));
check('selector lists every voice plus Automatic', options.length === MACHINE.length + 1, `${options.length - 1} of ${MACHINE.length}`);
check('selector separates Natural/Online from basic system voices', /<optgroup label="Natural \/ Online">/.test(panel) && /<optgroup label="Basic system voices">/.test(panel));
check('Natural/Online voices appear above basic voices', panel.indexOf('<optgroup label="Natural / Online">') < panel.indexOf('<optgroup label="Basic system voices">'));
check('labels mark which voices work offline', options.some((option) => option.label.includes('· offline')) && options.some((option) => option.label.includes('· network')));

const bestKey = voiceKey(best);
const selectedOption = options.find((option) => option.value === bestKey);
check('the natural voice is offered as an option', Boolean(selectedOption), bestKey);
check('Automatic is selected and names the priority winner', /<option value="" selected/.test(panel) && panel.includes(`Automatic — ${best.name}`));
check('panel states the speaking parameters', panel.includes(`rate ${TTS.rate}`) && panel.includes(`pitch ${TTS.pitch}`) && panel.includes(`volume ${TTS.volume}`));

const naturalOptions = panel.match(/<optgroup label="Natural \/ Online">([\s\S]*?)<\/optgroup>/)?.[1] ?? '';
check('rendered top group contains only Natural/Online voices', [...naturalOptions.matchAll(/<option[^>]*>([^<]*)<\/option>/g)]
  .every((match) => /natural|online/i.test(match[1])));
check('Test Voice is a non-submit button', /<button[^>]*class="[^"]*test-voice-button[^>]*type="button"[^>]*>Test Voice<\/button>/.test(panel));
check('panel shows the exact sample phrase', panel.includes("Hey, I&#x27;m Nova. Ready when you are."));

// A saved choice must win over the automatic one.
const savedPanel = await renderPanel(MACHINE, 'Samantha-uri');
check('a saved voice is selected', /<option value="Samantha-uri"[^>]*selected/.test(savedPanel)
  || savedPanel.includes('value="Samantha-uri" selected'), 'Samantha-uri');
const legacyVoicePanel = await renderPanel(MACHINE, 'Samantha');
check('legacy name selections normalize to the dropdown URI', /<option value="Samantha-uri"[^>]*selected/.test(legacyVoicePanel));

// A voice that has since been uninstalled must be reported, not silently swapped.
const missingPanel = await renderPanel(MACHINE, 'Ghost-uri');
check('a missing saved voice is reported', /can’t find your saved voice/i.test(missingPanel));

// An empty list must degrade gracefully rather than render a broken control.
const emptyPanel = await renderPanel([], '');
check('panel survives an empty voice list', /<select[^>]*id="nova-browser-voice"/.test(emptyPanel) && /Voices are still loading/.test(emptyPanel));

// ----------------------------------------------------------- wake word / modes
check('wake phrase follows the brand', WAKE_WORD === 'hey nova');
check('wake phrase is case insensitive', parseWakeWord('HEY NOVA')?.question === '');
check('wake parser preserves a same-utterance question', parseWakeWord('Hey, Nova! What time is it?')?.question === 'What time is it?');
check('wake parser tolerates repeated whitespace', parseWakeWord('hey   nova, hello')?.question === 'hello');
check('wake parser rejects partial and lookalike names', ['hey novation', 'hey supernova', 'heynova', 'hey no va'].every((text) => parseWakeWord(text) === null));
check('wake parser ignores unrelated and empty text', parseWakeWord('good morning') === null && parseWakeWord(undefined) === null);
check('unsupported wake message is friendly and honest', WAKE_UNSUPPORTED_MESSAGE === 'I can’t listen for “hey nova” in this browser. Try the mic button instead.');

function listenerHarness(options = {}) {
  const clock = createClock();
  const { Recognition, instances } = createRecognitionDouble(clock, options);
  const events = { wakes: 0, questions: [], standby: [], errors: [], ended: [], unsupported: 0 };
  const listener = createVoiceListener({
    Recognition: options.missing ? undefined : Recognition,
    timers: clock,
    now: clock.now,
    onWake: () => { events.wakes += 1; },
    onQuestion: (text) => events.questions.push(text),
    onStandbyChange: (value) => events.standby.push(value),
    onError: (error, mode) => events.errors.push({ error, mode }),
    onInputEnd: (reason) => events.ended.push(reason),
    onUnsupported: () => { events.unsupported += 1; },
  });
  listener.setMode('standby');
  return { listener, clock, events, recognition: instances[0] };
}

const wake = listenerHarness({ autoStart: false });
check('startup is deferred so StrictMode cleanup can cancel it', wake.recognition.starts.length === 0 && wake.clock.pending === 1);
wake.clock.tick();
check('standby starts continuous recognition with interim results', wake.recognition.starts[0].continuous === true && wake.recognition.starts[0].interim === true);
check('standby indicator waits for actual onstart', wake.events.standby.length === 0);
wake.recognition.onstart();
check('standby indicator reflects a running microphone', wake.events.standby.at(-1) === true);
wake.recognition.result('ordinary interim chatter', false);
wake.recognition.result('ordinary background speech');
check('standby discards unrelated interim and final transcripts', wake.events.wakes === 0 && wake.events.questions.length === 0);
wake.recognition.result('Hey Nova!');
check('wake triggers once and does not send an empty question', wake.events.wakes === 1 && wake.events.questions.length === 0);
check('wake immediately hides standby and aborts the old session', wake.events.standby.at(-1) === false && wake.recognition.aborts === 1);
wake.recognition.result('late standby result');
wake.clock.tick(1000);
check('handoff never overlaps recognition sessions', wake.recognition.starts.length === 1 && wake.events.questions.length === 0);
wake.recognition.end();
wake.clock.tick(150);
wake.recognition.onstart();
check('full question mode enables interim recognition', wake.recognition.starts.length === 2 && wake.recognition.starts[1].interim === true);
wake.recognition.results([{ text: 'What', isFinal: true }, { text: 'time is it?', isFinal: true }]);
check('question mode combines final results with spaces', wake.events.questions[0] === 'What time is it?');
wake.recognition.result('duplicate final');
wake.recognition.end();
wake.clock.tick(20000);
check('recognition stays paused while the caller processes and speaks', wake.recognition.starts.length === 2 && wake.events.questions.length === 1);
wake.listener.setMode('standby');
wake.clock.tick();
wake.recognition.onstart();
check('caller can resume standby after speech ends', wake.recognition.starts.length === 3 && wake.events.standby.at(-1) === true);
wake.listener.dispose();

const inline = listenerHarness();
inline.clock.tick();
inline.recognition.result('Hey, Nova, tell me a joke.');
check('same-utterance question is not lost during wake handoff', inline.events.wakes === 1 && inline.events.questions[0] === 'tell me a joke.');
inline.listener.dispose();

const splitWake = listenerHarness();
splitWake.clock.tick();
splitWake.recognition.result('Hey,');
splitWake.recognition.result('Nova, what is two plus two?');
check('wake phrase may span adjacent final results', splitWake.events.wakes === 1 && splitWake.events.questions[0] === 'what is two plus two?');
splitWake.listener.dispose();

const indexed = listenerHarness();
indexed.clock.tick();
indexed.recognition.results([{ text: 'hey nova obsolete question' }, { text: 'new background speech' }], 1);
check('only changed results are processed', indexed.events.wakes === 0 && indexed.events.questions.length === 0);
indexed.listener.setMode('question');
indexed.recognition.end();
indexed.clock.tick(150);
indexed.recognition.result('Hey Nova, a manually started question');
check('mic button input requires no wake word and strips a repeated prefix', indexed.events.wakes === 0 && indexed.events.questions[0] === 'a manually started question');
indexed.listener.dispose();

const restart = listenerHarness();
restart.clock.tick();
restart.clock.tick(3000);
restart.recognition.result('hey');
restart.recognition.error('no-speech');
restart.recognition.end();
restart.clock.tick(799);
check('natural standby endings restart with a delay, not a hot loop', restart.recognition.starts.length === 1);
restart.clock.tick(1);
restart.recognition.result('nova, not a wake from a previous session');
check('silence is harmless and a new session clears the partial wake phrase', restart.events.errors.length === 0 && restart.events.wakes === 0 && restart.recognition.starts.length === 2);
restart.listener.dispose();

const silence = listenerHarness();
silence.clock.tick();
silence.recognition.result('hey nova');
silence.recognition.end();
silence.clock.tick(150);
silence.clock.tick(15000);
check('a wake without a question times out instead of staying awake', silence.events.ended[0] === 'no-speech');
silence.recognition.end();
silence.clock.tick(150);
check('question timeout returns to standby', silence.recognition.starts.at(-1).interim === true && silence.events.standby.at(-1) === true);
silence.listener.dispose();

// Interim wake: "hey nova" is caught while it is still being spoken.
const early = listenerHarness();
early.clock.tick();
early.recognition.results([{ text: 'hey nova', isFinal: false }]);
check('interim wake: "hey nova" in an interim result wakes before the final result', early.events.wakes === 1
  && early.events.questions.length === 0 && early.events.standby.at(-1) === false);
check('interim wake: the running session continues as the question (no abort, no restart gap)', early.recognition.aborts === 0
  && early.recognition.starts.length === 1 && early.recognition.active);
early.recognition.results([{ text: 'hey nova what time', isFinal: false }]);
check('interim wake: later interims neither wake again nor submit early', early.events.wakes === 1 && early.events.questions.length === 0);
early.recognition.results([{ text: 'hey nova what time is it', isFinal: true }]);
check('interim wake: a question in the same breath is kept, without the wake phrase', early.events.questions.join('|') === 'what time is it'
  && early.recognition.aborts === 1);
early.listener.dispose();
check('interim wake: dispose leaves no timers', early.clock.pending === 0);

const paused = listenerHarness();
paused.clock.tick();
paused.recognition.results([{ text: 'hey nova', isFinal: false }]);
paused.recognition.results([{ text: 'hey nova', isFinal: true }]);
check('interim wake: a final "hey nova" alone sends no empty question', paused.events.questions.length === 0 && paused.events.wakes === 1);
paused.recognition.results([{ text: 'hey nova', isFinal: true }, { text: 'tell me a joke', isFinal: true }], 1);
check('interim wake: a question after a pause is sent from the next final result', paused.events.questions.join('|') === 'tell me a joke');
paused.listener.dispose();

const chatter = listenerHarness();
chatter.clock.tick();
chatter.recognition.results([{ text: 'okay so hey nova', isFinal: false }]);
chatter.recognition.results([{ text: 'okay so hey nova what is up', isFinal: true }]);
check('interim wake: words before the wake phrase are never sent', chatter.events.wakes === 1 && chatter.events.questions.join('|') === 'what is up');
chatter.listener.dispose();

const separate = listenerHarness();
separate.clock.tick();
separate.recognition.results([{ text: 'okay so', isFinal: false }, { text: 'hey nova', isFinal: false }]);
separate.recognition.results([{ text: 'okay so', isFinal: true }, { text: 'hey nova how are you', isFinal: false }]);
check('interim wake: earlier chatter finalizing on its own is not a question', separate.events.wakes === 1 && separate.events.questions.length === 0);
separate.recognition.results([{ text: 'okay so', isFinal: true }, { text: 'hey nova how are you', isFinal: true }], 1);
check('interim wake: the wake result then delivers the question', separate.events.questions.join('|') === 'how are you');
separate.listener.dispose();

const split = listenerHarness();
split.clock.tick();
split.recognition.results([{ text: 'and hey', isFinal: true }]);
split.recognition.results([{ text: 'and hey', isFinal: true }, { text: 'nova what', isFinal: false }], 1);
check('interim wake: a "hey" in a final result plus "nova" in an interim still wakes', split.events.wakes === 1);
split.recognition.results([{ text: 'and hey', isFinal: true }, { text: 'nova what is new', isFinal: true }], 1);
check('interim wake: the split wake phrase is removed from the question', split.events.questions.join('|') === 'what is new');
split.listener.dispose();

const misheard = listenerHarness();
misheard.clock.tick();
misheard.recognition.results([{ text: 'hey nova', isFinal: false }]);
misheard.recognition.results([{ text: 'hey noah come here', isFinal: true }]);
check('interim wake: if the final drops the wake phrase, nothing is sent', misheard.events.wakes === 1 && misheard.events.questions.length === 0);
misheard.clock.tick(15000);
check('interim wake: a misheard wake times out like any wake without a question', misheard.events.ended.at(-1) === 'no-speech');
misheard.listener.dispose();

const interimUi = await createAppHarness();
interimUi.clock.tick();
interimUi.flush();
interimUi.recognition.instances[0].result('hey nova', false);
interimUi.flush();
check('interim wake: the App switches to listening while the wake word is still being spoken', interimUi.find('status-word')?.props.className.includes('status-word-listening')
  && interimUi.recognition.instances[0].aborts === 0);
interimUi.recognition.instances[0].result('hey nova what do you suggest', true);
await interimUi.settle();
const interimChat = interimUi.requests.find((request) => request.url.endsWith('/chat/completions'));
check('interim wake: the App sends the question without the wake phrase', JSON.parse(interimChat?.options.body || '{}').messages?.at(-1)?.content === 'what do you suggest');
interimUi.unmount();

const unsupported = listenerHarness({ continuous: false });
unsupported.clock.tick();
check('missing continuous mode reports unsupported without auto-starting', unsupported.events.unsupported === 1 && unsupported.recognition.starts.length === 0 && unsupported.listener.available);
unsupported.listener.setMode('question');
unsupported.clock.tick();
unsupported.recognition.result('manual fallback works');
check('unsupported continuous mode preserves manual voice input', unsupported.events.questions[0] === 'manual fallback works');
unsupported.listener.dispose();
const missing = listenerHarness({ missing: true });
missing.clock.tick();
check('a missing recognition API degrades safely', missing.events.unsupported === 1 && !missing.listener.available && missing.clock.pending === 0);
missing.listener.dispose();

const denied = listenerHarness();
denied.clock.tick();
denied.recognition.error('not-allowed');
denied.recognition.end();
denied.clock.tick(60000);
check('permission denial stops automatic retries', denied.recognition.starts.length === 1 && denied.events.errors[0]?.error === 'not-allowed');
denied.listener.setMode('question');
denied.clock.tick();
denied.recognition.result('permission is now granted');
denied.recognition.end();
denied.listener.setMode('standby');
denied.clock.tick();
check('a successful manual start recovers wake standby after permission denial', denied.recognition.starts.length === 3 && denied.events.standby.at(-1) === true);
denied.listener.dispose();

const network = listenerHarness();
network.clock.tick();
for (const delay of [1600, 3200, 6400]) {
  network.clock.tick(2000);
  network.recognition.error('network');
  network.recognition.end();
  network.clock.tick(delay);
}
check('network failure retries are bounded and back off', network.recognition.starts.length === 3 && network.events.errors.length === 1 && network.clock.pending === 0);
network.listener.dispose();

const ends = listenerHarness();
ends.clock.tick();
for (let i = 0; i < 3; i += 1) { ends.recognition.end(); ends.clock.tick(800); }
check('an engine that repeatedly ends immediately disables wake mode', ends.events.unsupported === 1 && ends.recognition.starts.length === 3 && ends.listener.available);
ends.listener.dispose();

const startFailure = listenerHarness();
startFailure.recognition.startError = Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
startFailure.clock.tick();
startFailure.clock.tick(60000);
check('synchronous start failure has no retry storm', startFailure.events.errors[0]?.error === 'not-allowed' && startFailure.clock.pending === 0);
startFailure.listener.dispose();

const cleanup = listenerHarness();
cleanup.listener.dispose();
cleanup.clock.tick(60000);
check('unmount before startup cancels the microphone attempt', cleanup.recognition.starts.length === 0 && cleanup.clock.pending === 0);
const activeCleanup = listenerHarness();
activeCleanup.clock.tick();
const lateResult = activeCleanup.recognition.onresult;
const lateEnd = activeCleanup.recognition.onend;
activeCleanup.listener.dispose();
lateResult({ resultIndex: 0, results: [Object.assign([{ transcript: 'hey nova' }], { isFinal: true })] });
lateEnd();
activeCleanup.clock.tick(60000);
check('unmount aborts recognition and ignores stale callbacks', activeCleanup.recognition.onresult === null && activeCleanup.events.wakes === 0 && activeCleanup.recognition.starts.length === 1 && activeCleanup.clock.pending === 0);

// ---------------------------------------------------------------- soft chime
const audio = createAudioDouble();
const chime = createWakeChime(audio.AudioContext);
check('chime allocates no audio context until it is needed', audio.instances.length === 0);
check('chime can play using only Web Audio', await chime.play());
const context = audio.instances[0];
check('chime uses two sine tones, quietly and briefly', context.oscillators.length === 2
  && context.oscillators.every((oscillator) => oscillator.type === 'sine')
  && context.gains.every((gain) => gain.ramps.some((ramp) => ramp.value === .035))
  && context.oscillators.at(-1).stopAt - context.currentTime < .35);
context.oscillators.forEach((oscillator) => oscillator.onended());
check('finished chime nodes disconnect', context.oscillators.every((oscillator) => oscillator.disconnected) && context.gains.every((gain) => gain.disconnected));
await chime.play();
check('chime reuses a single context', audio.instances.length === 1);
chime.dispose();
check('chime context closes on unmount and cannot play again', context.closes === 1 && !await chime.play());
const blockedAudio = createAudioDouble({ suspended: true });
const blockedChime = createWakeChime(blockedAudio.AudioContext);
check('blocked autoplay does not queue a late chime', !await blockedChime.play() && blockedAudio.instances[0].oscillators.length === 0);
await blockedChime.unlock();
check('a gesture can unlock audio without playing a stale wake sound', blockedAudio.instances[0].state === 'running' && blockedAudio.instances[0].oscillators.length === 0);
check('subsequent wake sounds play after audio unlock', await blockedChime.play());
blockedChime.dispose();
const rejectedAudio = createAudioDouble({ suspended: true, rejectResume: true });
const rejectedChime = createWakeChime(rejectedAudio.AudioContext);
check('autoplay rejection is handled without throwing', !await rejectedChime.unlock() && !await rejectedChime.play());
rejectedChime.dispose();
const noChime = createWakeChime(undefined);
check('a missing AudioContext leaves voice input usable', !await noChime.unlock() && !await noChime.play());
noChime.dispose();

// ----------------------------------------------- the real App's full lifecycle
const ui = await createAppHarness();
ui.clock.tick();
await ui.settle();
const mic = ui.recognition.instances[0];
check('App starts wake standby on load and renders a subtle mic indicator', mic.starts.length === 1 && Boolean(ui.find('wake-indicator')));
check('standby indicator has an accessible wake label', ui.find('wake-indicator')?.props['aria-label']?.includes('hey nova'));
mic.result('not a request');
check('App never sends background chatter to Ollama', !ui.requests.some((request) => request.url.endsWith('/chat/completions')));
ui.window.dispatch('pointerdown');
await ui.settle();
mic.result('Hey Nova');
ui.flush();
check('wake changes status to LISTENING and enables listening eyes', atStage(ui, 'listening') && ui.find('avatar-container')?.props.className.includes('is-listening'));
check('wake hides the standby icon and plays the chime', !ui.find('wake-indicator') && ui.audio.instances[0]?.oscillators.length === 2);
check('wake immediately starts the matching crescent/double-jump pose', ui.find('avatar-container')?.props.className.includes('is-waking'));
ui.clock.tick(799);
ui.flush();
check('wake flourish lasts through 799ms', ui.find('avatar-container')?.props.className.includes('is-waking'));
ui.clock.tick(1);
ui.flush();
check('wake flourish ends at 800ms without ending listening', !ui.find('avatar-container')?.props.className.includes('is-waking')
  && ui.find('avatar-container')?.props.className.includes('is-listening') && atStage(ui, 'listening'));
mic.end();
ui.clock.tick(150);
mic.result('How are you?');
ui.flush();
check('a question enters thinking and disables the mic button', atStage(ui, 'thinking') && ui.find('mic-button')?.props.disabled);
mic.end();
await ui.settle();
const reply = ui.utterances[0];
check('App speaks the answer with the selected browser voice and parameters', reply?.voice?.name === 'Samantha' && reply.rate === .92 && reply.pitch === .88 && reply.volume === 1);
check('queued speech stays speaking, not happy or standby', atStage(ui, 'speaking') && !ui.find('wake-indicator') && !ui.find('avatar-container')?.props.className.includes('is-happy'));
const beforeSpeechEnd = mic.starts.length;
ui.clock.tick(10000);
ui.flush();
check('standby cannot restart while speech is queued; only the interrupt listener starts', mic.starts.length === beforeSpeechEnd + 1 && !ui.find('wake-indicator'));
reply?.onstart();
ui.flush();
check('speaking: no fabricated pulse before a real word boundary', ui.avatarElement.style.getPropertyValue('--audio-pulse') === '');
reply?.onboundary({ name: 'sentence', charLength: 10 });
check('speaking: sentence boundaries do not fabricate word beats', ui.avatarElement.style.getPropertyValue('--audio-pulse') === '');
reply?.onboundary({ name: 'word', charLength: 4 });
check('speaking: a real word publishes one shared brightness/scale signal', ui.avatarElement.style.getPropertyValue('--audio-pulse') === '0.790'
  && ui.avatarElement.classList.contains('speech-boundary-active'));
ui.clock.tick(124);
check('speaking: word pulse persists until the 125ms decay', ui.avatarElement.style.getPropertyValue('--audio-pulse') === '0.790');
ui.clock.tick(1);
check('speaking: decay reaches zero, allowing a 100% body pose', ui.avatarElement.style.getPropertyValue('--audio-pulse') === '0');
reply?.onboundary({ name: 'word', charLength: 100 });
check('speaking: long words cap at one, giving a 104% maximum', ui.avatarElement.style.getPropertyValue('--audio-pulse') === '1.000');
ui.clock.tick(100);
reply?.onboundary({ name: 'word', charLength: 1 });
ui.clock.tick(25);
check('speaking: a new word cancels the previous decay timer', ui.avatarElement.style.getPropertyValue('--audio-pulse') === '0.685');
const requestsWhileSpeaking = ui.requests.length;
mic.result('and that is my answer for you');
await ui.settle();
check('standby stays paused while speech is playing; NOVA\'s own words are never sent', mic.starts.length === beforeSpeechEnd + 1 && !ui.find('wake-indicator')
  && ui.requests.length === requestsWhileSpeaking && atStage(ui, 'speaking'));
reply?.onend();
await ui.settle();
ui.clock.tick();
ui.flush();
check('actual speech end automatically restores wake standby', mic.starts.length === beforeSpeechEnd + 1 && Boolean(ui.find('wake-indicator')));
check('celebration happens after speech, not before', ui.find('avatar-container')?.props.className.includes('is-happy'));
check('speech end removes both pulse property and boundary marker', ui.avatarElement.style.getPropertyValue('--audio-pulse') === ''
  && !ui.avatarElement.classList.contains('speech-boundary-active'));
reply?.onboundary({ name: 'word', charLength: 10 });
ui.clock.tick(125);
check('late boundaries and cleared decay timers cannot revive a finished pulse', ui.avatarElement.style.getPropertyValue('--audio-pulse') === '');
reply?.onerror();
await ui.settle();
ui.clock.tick();
check('duplicate speech completion does not restart another recognizer', mic.starts.length === beforeSpeechEnd + 1);

ui.find('settings-trigger').props.onClick();
ui.flush();
mic.end();
ui.clock.tick(10000);
check('settings pause the background microphone', !ui.find('wake-indicator') && mic.starts.length === beforeSpeechEnd + 1);
// The fake JSX tree keeps SettingsPanel as a component with its real callbacks.
const openPanel = ui.tree.props.children.find((node) => node?.props?.onClose);
openPanel.props.onClose();
ui.flush();
ui.clock.tick();
ui.flush();
check('closing settings resumes wake standby', Boolean(ui.find('wake-indicator')));
ui.document.hidden = true;
ui.document.dispatch('visibilitychange');
ui.flush();
mic.end();
const beforeHidden = mic.starts.length;
ui.clock.tick(10000);
check('hidden tabs suspend background listening', mic.starts.length === beforeHidden && !ui.find('wake-indicator'));
ui.document.hidden = false;
ui.document.dispatch('visibilitychange');
ui.clock.tick();
ui.flush();
check('visible idle tabs resume wake listening', mic.starts.length === beforeHidden + 1 && Boolean(ui.find('wake-indicator')));
ui.unmount();
check('App unmount detaches recognition and closes audio', mic.onresult === null && ui.audio.instances[0]?.closes === 1);

// A same-utterance question must bypass the wake face as soon as work begins.
const inlineUi = await createAppHarness();
inlineUi.clock.tick();
await inlineUi.settle();
inlineUi.deferChat = true;
const inlineMic = inlineUi.recognition.instances[0];
inlineMic.result('hey nova tell me a joke');
inlineUi.flush();
check('inline wake: thinking overrides the still-active wake mood', inlineUi.find('avatar-container')?.props.className.includes('is-thinking')
  && !inlineUi.find('avatar-container')?.props.className.includes('is-waking'));
inlineMic.end();
await inlineUi.settle();
inlineUi.pendingChats[0]?.resolve();
await inlineUi.settle();
check('inline wake: speech overrides wake/happy before the 800ms timer', inlineUi.clock.now() < 800
  && inlineUi.find('avatar-container')?.props.className.includes('is-speaking')
  && !/is-waking|is-happy/.test(inlineUi.find('avatar-container')?.props.className ?? ''));
inlineUi.utterances[0]?.onend();
await inlineUi.settle();
inlineUi.clock.tick(800);
inlineUi.flush();
check('post-reply celebration cancels the earlier wake expiry timer', inlineUi.find('avatar-container')?.props.className.includes('is-happy'));
inlineUi.clock.tick(699);
inlineUi.flush();
check('post-reply crescent pose is held for 1.5 seconds', inlineUi.find('avatar-container')?.props.className.includes('is-happy'));
inlineUi.clock.tick(1);
inlineUi.flush();
check('post-reply pose releases to idle at 1500ms', !inlineUi.find('avatar-container')?.props.className.includes('is-happy'));
inlineUi.unmount();
check('wake and celebration timers are cleaned up on unmount', inlineUi.clock.pending === 0);

// Local memory commands still speak offline: the offline face must not mask them.
const offlineAvatarUi = await createAppHarness({ modelsOffline: true });
offlineAvatarUi.clock.tick();
await offlineAvatarUi.settle();
check('offline avatar appears only at rest', offlineAvatarUi.find('avatar-container')?.props.className.includes('is-offline'));
offlineAvatarUi.recognition.instances[0].result('hey nova');
offlineAvatarUi.flush();
check('offline wake uses the wake/listening face, not dim offline eyes', /is-waking/.test(offlineAvatarUi.find('avatar-container')?.props.className ?? '')
  && !/is-offline/.test(offlineAvatarUi.find('avatar-container')?.props.className ?? ''));
offlineAvatarUi.recognition.instances[0].end();
offlineAvatarUi.clock.tick(150);
offlineAvatarUi.recognition.instances[0].result('what do you remember');
offlineAvatarUi.recognition.instances[0].end();
await offlineAvatarUi.settle();
check('offline local speech is never masked by offline or wake poses', offlineAvatarUi.utterances.length === 1
  && offlineAvatarUi.find('avatar-container')?.props.className.includes('is-speaking')
  && !/is-offline|is-waking|is-happy/.test(offlineAvatarUi.find('avatar-container')?.props.className ?? ''));
offlineAvatarUi.utterances[0]?.onboundary({ name: 'word', charLength: 10 });
check('offline local speech receives the same live full-strength pulse', offlineAvatarUi.avatarElement.style.getPropertyValue('--audio-pulse') === '1.000');
offlineAvatarUi.unmount();
check('unmount clears live word pulse and its timer', offlineAvatarUi.avatarElement.style.getPropertyValue('--audio-pulse') === '' && offlineAvatarUi.clock.pending === 0);
offlineAvatarUi.utterances[0]?.onboundary({ name: 'word', charLength: 10 });
check('unmounted speech callbacks cannot restart eye brightness', offlineAvatarUi.avatarElement.style.getPropertyValue('--audio-pulse') === '');

const unsupportedUi = await createAppHarness({ continuous: false });
await unsupportedUi.settle();
check('App persistently shows the exact unsupported fallback message', unsupportedUi.find('wake-message')?.props.children === WAKE_UNSUPPORTED_MESSAGE && unsupportedUi.find('wake-message')?.props['aria-live'] === 'polite');
unsupportedUi.find('mic-button').props.onClick();
unsupportedUi.flush();
unsupportedUi.clock.tick();
const fallbackMic = unsupportedUi.recognition.instances[0];
fallbackMic.result('a question without a wake word');
fallbackMic.end();
await unsupportedUi.settle();
check('manual mic input still reaches Ollama on an unsupported browser', unsupportedUi.requests.some((request) => request.options?.method === 'POST') && unsupportedUi.utterances.length === 1);
unsupportedUi.utterances[0]?.onerror();
await unsupportedUi.settle();
unsupportedUi.clock.tick();
unsupportedUi.flush();
check('speech error releases the UI without claiming wake support', atStage(unsupportedUi, 'ready') && !unsupportedUi.find('wake-indicator'));
unsupportedUi.unmount();

const silentUi = await createAppHarness({ speech: false });
silentUi.clock.tick();
silentUi.recognition.instances[0].result('hey nova tell me something');
silentUi.recognition.instances[0].end();
await silentUi.settle();
silentUi.clock.tick();
silentUi.flush();
check('missing speech synthesis returns to standby without hanging', Boolean(silentUi.find('wake-indicator')) && silentUi.utterances.length === 0);
silentUi.unmount();

const failedUi = await createAppHarness();
failedUi.chatError = true;
failedUi.clock.tick();
failedUi.recognition.instances[0].result('hey nova this model request fails');
failedUi.recognition.instances[0].end();
await failedUi.settle();
failedUi.clock.tick();
failedUi.flush();
check('a failed model request returns to wake standby', Boolean(failedUi.find('wake-indicator')) && failedUi.utterances.length === 0);
failedUi.unmount();

const deniedUi = await createAppHarness();
deniedUi.clock.tick();
deniedUi.recognition.instances[0].error('not-allowed');
deniedUi.recognition.instances[0].end();
await deniedUi.settle();
deniedUi.clock.tick(60000);
check('App explains denied microphone permission without repeated prompts', deniedUi.find('wake-message')?.props.children.includes('I need microphone permission') && deniedUi.recognition.instances[0].starts.length === 1 && !deniedUi.find('wake-indicator'));
deniedUi.unmount();

// ------------------------------------------- standby cues, warm-up box, settings flash
const sheetCss = await readFile(resolve(root, 'src/index.css'), 'utf8');
check('warm-up: the line gets its own 24px box and clips, so nothing overlaps it', /\.kokoro-warmup \{[^}]*--warmup-height: 24px;[^}]*min-height: var\(--warmup-height\);[^}]*overflow: hidden/.test(sheetCss)
  && !/\.kokoro-warmup \{[^}]*height: 0[;}]/.test(sheetCss));
check('standby: the icon dims, lights for the wake phrase and names itself on hover', /\.wake-indicator \{[^}]*opacity: \.42;[^}]*transition: opacity 400ms ease-in-out/.test(sheetCss)
  && /\.wake-indicator:hover, \.wake-indicator\.is-alert \{ opacity: 1; color: #ff9a5a; \}/.test(sheetCss)
  && /\.wake-indicator:hover \.wake-hint \{ opacity: 1; \}/.test(sheetCss));

const alertUi = await createAppHarness();
alertUi.clock.tick();
await alertUi.settle();
const alertMic = alertUi.recognition.instances[0];
alertMic.result('hey');
alertUi.flush();
check('standby: a wake phrase starting lights the mic icon', alertUi.find('wake-indicator')?.props.className.includes('is-alert'));
alertUi.clock.tick(1599);
alertUi.flush();
check('standby: the light holds for 1.6s before dimming', alertUi.find('wake-indicator')?.props.className.includes('is-alert'));
alertUi.clock.tick(1);
alertUi.flush();
check('standby: the light fades on its own, without a wake', !alertUi.find('wake-indicator')?.props.className.includes('is-alert')
  && Boolean(alertUi.find('wake-indicator')));
check('standby: the hover hint spells the wake phrase', alertUi.find('wake-hint')?.props.children === 'Listening for \u201chey nova\u201d...');
alertMic.result('hey nova');
alertUi.flush();
check('wake: the icon hands over to listening instead of staying lit', !alertUi.find('wake-indicator'));
alertUi.unmount();
check('standby: an unmounted flash leaves no timer behind', alertUi.clock.pending === 0);

const attentionUi = await createAppHarness({ panelProps: { standalone: true } });
const attentionInput = () => attentionUi.nodes().find((node) => node.props.id === 'ollama-url');
check('settings: a saved copy highlights the blank endpoint it cannot do without', attentionInput()?.props.className.includes('needs-attention')
  && /\.settings-input\.needs-attention \{ animation: field-attention/.test(sheetCss));
attentionInput().props.onChange({ target: { value: 'http://localhost:11434' } });
attentionUi.flush();
check('settings: typing an address clears the highlight', !attentionInput().props.className.includes('needs-attention'));
attentionUi.unmount();
const proxyUi = await createAppHarness({ panelProps: { standalone: false } });
check('settings: a page with the local proxy never flashes its optional endpoint', !proxyUi.nodes().some((node) => node.props.className?.includes?.('needs-attention')));
proxyUi.unmount();

// Voice preview/selection and memory use the same compiled App fixture.
await verifyRich(check);
await verifyKokoro(check);
await verifyStreaming(check);
await verifyWebBrowse(check);
await verifyInterrupt(check);
await verifyPersonality(check);
await verifyVoices(check);
await verifyMemory(check, renderPanel);

const failed = problems.length;
for (const { label, ok, detail } of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}
console.log(failed ? `\n${failed} check(s) failed.` : `\nAll ${checks.length} checks passed.`);
if (failed) process.exitCode = 1;
