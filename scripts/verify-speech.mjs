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

const run = promisify(execFile);
const root = process.cwd();

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

const { TTS, defaultVoice, describeVoice, groupVoices, resolveVoice, scoreVoice, sortVoices, voiceKey, voiceOptionLabel,
  WAKE_WORD, WAKE_UNSUPPORTED_MESSAGE, parseWakeWord, createVoiceListener, createWakeChime } = speech;

const voice = (name, lang, extra = {}) => ({ name, lang, voiceURI: `${name}-uri`, localService: true, default: false, ...extra });

// --------------------------------------------------------- speaking parameters
check('rate is 0.95', TTS.rate === 0.95, String(TTS.rate));
check('pitch is 0.9', TTS.pitch === 0.9, String(TTS.pitch));
check('volume is 1.0', TTS.volume === 1, String(TTS.volume));

// -------------------------------------------------- a representative machine
// Roughly what Chrome on Windows reports: a mix of local legacy, cloud, and the
// newer neural voices, plus non-English entries that must never win by accident.
const MACHINE = [
  voice('Microsoft David - English (United States)', 'en-US'),
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
check('picks a natural English voice', /natural/i.test(best.name) && /^en/i.test(best.lang), best.name);
check('picks the voice named after the app', /nova/i.test(best.name), best.name);
check('prefers it over an equally natural rival', /nova/i.test(best.name) && /aria/i.test(MACHINE.find(
  (entry) => /^Microsoft Aria Online/.test(entry.name)).name), best.name);
check('never picks a non-English voice', /^en/i.test(defaultVoice(MACHINE).lang), defaultVoice(MACHINE).lang);

// Without a voice matching the app name, plain quality still decides.
const noNova = MACHINE.filter((entry) => !/nova/i.test(entry.name));
check('still prefers natural without a NOVA voice', /natural/i.test(defaultVoice(noNova).name), defaultVoice(noNova).name);

// With no neural voices at all, the well-regarded local ones should surface.
const LOCAL_ONLY = [
  voice('Microsoft David - English (United States)', 'en-US'),
  voice('Samantha', 'en-US'),
  voice('Albert', 'en-US'),
  voice('Microsoft Zira - English (United States)', 'en-US'),
];
check('falls back to a preferred local voice', defaultVoice(LOCAL_ONLY).name === 'Samantha', defaultVoice(LOCAL_ONLY).name);

// Offline capability is rewarded, so a tie breaks toward the voice that keeps working.
const TIE = [
  voice('Generic Voice A', 'en-US', { localService: false }),
  voice('Generic Voice B', 'en-US', { localService: true }),
];
check('prefers an offline voice when quality is equal', defaultVoice(TIE).name === 'Generic Voice B', defaultVoice(TIE).name);

// Degenerate inputs must not throw.
check('handles an empty voice list', defaultVoice([]) === null);
check('handles a missing list', defaultVoice(undefined) === null);
check('handles voices with no English option', Boolean(defaultVoice([voice('Hedda', 'de-DE')])));
check('handles a voice with no name', Boolean(defaultVoice([{ lang: 'en-US', voiceURI: 'x', localService: true }])));

// ------------------------------------------------------------------ ordering
const { english, others } = groupVoices(MACHINE);
check('groups English separately', english.length === 9 && others.length === 3, `${english.length}/${others.length}`);
check('every English voice is in the English group', english.every((entry) => /^en/i.test(entry.lang)));
check('no English voice leaks into the other group', !others.some((entry) => /^en/i.test(entry.lang)));
check('English group is best first', scoreVoice(english[0]) >= scoreVoice(english[1]));
check('other languages are best first too', scoreVoice(others[0]) >= scoreVoice(others[1]),
  others.map((entry) => entry.name).join(' | '));
check('locale is a tiebreak, not the primary key', sortVoices([
  voice('Plain', 'en-US'),
  voice('Microsoft Aria Online (Natural) - English (United Kingdom)', 'en-GB', { localService: false }),
])[0].lang === 'en-GB', sortVoices([
  voice('Plain', 'en-US'),
  voice('Microsoft Aria Online (Natural) - English (United Kingdom)', 'en-GB', { localService: false }),
])[0].name);

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
check('describes a missing voice safely', describeVoice(null) === 'No voice available');

// ------------------------------------------------------------- no ElevenLabs
const app = await readFile(resolve(root, 'src/App.jsx'), 'utf8');
const viteConfig = await readFile(resolve(root, 'vite.config.js'), 'utf8');
check('app has no ElevenLabs code', !/elevenlabs/i.test(app));
check('app has no API key handling', !/xi-api-key|apiKey/.test(app));
check('dev proxy no longer forwards ElevenLabs', !/elevenlabs/i.test(viteConfig));
check('app speaks through the Web Speech API', /speechSynthesis\.speak/.test(app));
check('app takes its name from the brand module', /import \{ APP_NAME \} from '\.\/brand\.js'/.test(app));
check('system prompt carries the brand name', /You are \$\{APP_NAME\}/.test(app));
check('system prompt asks for a warm personality', /warm and witty/.test(app));
check('status messages carry the brand name', /ready: `\$\{APP_NAME\} READY`/.test(app));
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
const options = [...panel.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)]
  .map((match) => ({ value: match[1], label: match[2] }));

check('panel renders the NOVA Voice selector', /<label[^>]*for="nova-voice"[^>]*>NOVA Voice<\/label>|>NOVA Voice</.test(panel));
check('panel renders a select bound to nova-voice', /<select[^>]*id="nova-voice"/.test(panel));
check('selector lists every voice', options.length === MACHINE.length, `${options.length} of ${MACHINE.length}`);
check('selector groups English and other languages', /<optgroup label="English">/.test(panel) && /<optgroup label="Other languages">/.test(panel));
check('English voices appear before other languages', panel.indexOf('<optgroup label="English">') < panel.indexOf('<optgroup label="Other languages">'));
check('labels mark which voices work offline', options.some((option) => option.label.includes('· offline')) && options.some((option) => option.label.includes('· network')));

const bestKey = voiceKey(best);
const selectedOption = options.find((option) => option.value === bestKey);
check('the natural voice is offered as an option', Boolean(selectedOption), bestKey);
check('the app-named voice is pre-selected', panel.includes(`value="${bestKey}" selected`),
  `pre-selected: ${bestKey}`);
check('panel states the speaking parameters', panel.includes(`rate ${TTS.rate}`) && panel.includes(`pitch ${TTS.pitch}`) && panel.includes(`volume ${TTS.volume}`));

// A saved choice must win over the automatic one.
const savedPanel = await renderPanel(MACHINE, 'Samantha-uri');
check('a saved voice is selected', /<option value="Samantha-uri"[^>]*selected/.test(savedPanel)
  || savedPanel.includes('value="Samantha-uri" selected'), 'Samantha-uri');

// A voice that has since been uninstalled must be reported, not silently swapped.
const missingPanel = await renderPanel(MACHINE, 'Ghost-uri');
check('a missing saved voice is reported', /no longer installed/i.test(missingPanel));

// An empty list must degrade gracefully rather than render a broken control.
const emptyPanel = await renderPanel([], '');
check('panel survives an empty voice list', /<select[^>]*id="nova-voice"/.test(emptyPanel) && /No voices available/.test(emptyPanel));

// ----------------------------------------------------------- wake word / modes
check('wake phrase follows the brand', WAKE_WORD === 'hey nova');
check('wake phrase is case insensitive', parseWakeWord('HEY NOVA')?.question === '');
check('wake parser preserves a same-utterance question', parseWakeWord('Hey, Nova! What time is it?')?.question === 'What time is it?');
check('wake parser tolerates repeated whitespace', parseWakeWord('hey   nova, hello')?.question === 'hello');
check('wake parser rejects partial and lookalike names', ['hey novation', 'hey supernova', 'heynova', 'hey no va'].every((text) => parseWakeWord(text) === null));
check('wake parser ignores unrelated and empty text', parseWakeWord('good morning') === null && parseWakeWord(undefined) === null);
check('unsupported message is the specified wording', WAKE_UNSUPPORTED_MESSAGE === 'Wake word not supported — use the mic button');

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
check('standby starts continuous final-only recognition', wake.recognition.starts[0].continuous === true && wake.recognition.starts[0].interim === false);
check('standby indicator waits for actual onstart', wake.events.standby.length === 0);
wake.recognition.onstart();
check('standby indicator reflects a running microphone', wake.events.standby.at(-1) === true);
wake.recognition.result('hey nova', false);
wake.recognition.result('ordinary background speech');
check('standby discards unrelated and interim transcripts', wake.events.wakes === 0 && wake.events.questions.length === 0);
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

const split = listenerHarness();
split.clock.tick();
split.recognition.result('Hey,');
split.recognition.result('Nova, what is two plus two?');
check('wake phrase may span adjacent final results', split.events.wakes === 1 && split.events.questions[0] === 'what is two plus two?');
split.listener.dispose();

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
check('question timeout returns to final-only standby', silence.recognition.starts.at(-1).interim === false && silence.events.standby.at(-1) === true);
silence.listener.dispose();

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
check('wake changes status to LISTENING and enables listening eyes', ui.find('status-word')?.props.children === 'NOVA LISTENING' && ui.find('avatar-container')?.props.className.includes('is-listening'));
check('wake hides the standby icon and plays the chime', !ui.find('wake-indicator') && ui.audio.instances[0]?.oscillators.length === 2);
mic.end();
ui.clock.tick(150);
mic.result('How are you?');
ui.flush();
check('a question enters thinking and disables the mic button', ui.find('status-word')?.props.children === 'NOVA THINKING' && ui.find('mic-button')?.props.disabled);
mic.end();
await ui.settle();
const reply = ui.utterances[0];
check('App speaks the answer with the selected browser voice and parameters', reply?.voice?.name === 'Samantha' && reply.rate === .95 && reply.pitch === .9 && reply.volume === 1);
check('queued speech stays speaking, not happy or standby', ui.find('status-word')?.props.children === 'NOVA SPEAKING' && !ui.find('wake-indicator') && !ui.find('avatar-container')?.props.className.includes('is-happy'));
const beforeSpeechEnd = mic.starts.length;
ui.clock.tick(10000);
ui.flush();
check('standby cannot restart while speech is queued', mic.starts.length === beforeSpeechEnd);
reply?.onstart();
ui.flush();
reply?.onboundary({ name: 'word', charLength: 4 });
ui.clock.tick(125);
check('standby stays paused while speech is playing', mic.starts.length === beforeSpeechEnd && !ui.find('wake-indicator'));
reply?.onend();
await ui.settle();
ui.clock.tick();
ui.flush();
check('actual speech end automatically restores wake standby', mic.starts.length === beforeSpeechEnd + 1 && Boolean(ui.find('wake-indicator')));
check('celebration happens after speech, not before', ui.find('avatar-container')?.props.className.includes('is-happy'));
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
check('speech error releases the UI without claiming wake support', unsupportedUi.find('status-word')?.props.children === 'NOVA READY' && !unsupportedUi.find('wake-indicator'));
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
check('App explains denied microphone permission without repeated prompts', deniedUi.find('wake-message')?.props.children.includes('Microphone access is blocked') && deniedUi.recognition.instances[0].starts.length === 1 && !deniedUi.find('wake-indicator'));
deniedUi.unmount();

await verifyMemory(check, renderPanel);

const failed = problems.length;
for (const { label, ok, detail } of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}
console.log(failed ? `\n${failed} check(s) failed.` : `\nAll ${checks.length} checks passed.`);
if (failed) process.exitCode = 1;
