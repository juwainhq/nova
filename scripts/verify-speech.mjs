// Verify the Web Speech voice plumbing: the same voice must be chosen for the same
// machine, users must be able to override it, and the speaking parameters must be the
// values ARIA is specified to use.
//
//   node scripts/verify-speech.mjs
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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

const directory = await mkdtemp(join(tmpdir(), 'aria-speech-'));
const probe = join(directory, 'speech.mjs');
let speech;
try {
  await writeFile(probe, bundle.outputFiles[0].text, 'utf8');
  speech = await import(`file://${probe}`);
} finally {
  await rm(directory, { recursive: true, force: true }).catch(() => {});
}

const { TTS, defaultVoice, describeVoice, groupVoices, resolveVoice, scoreVoice, sortVoices, voiceKey, voiceOptionLabel } = speech;

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
  voice('Microsoft Guy Online (Natural) - English (United States)', 'en-US', { localService: false }),
  voice('Samantha', 'en-US'),
  voice('Alex', 'en-US'),
  voice('Microsoft Hedda - German (Germany)', 'de-DE'),
  voice('Microsoft Aria Online (Natural) - German (Germany)', 'de-DE', { localService: false }),
  voice('Amelie', 'fr-CA'),
];

const best = defaultVoice(MACHINE);
check('picks a natural English voice', /natural/i.test(best.name) && /^en/i.test(best.lang), best.name);
check('picks the ARIA-named voice when present', /aria/i.test(best.name), best.name);
check('never picks a non-English voice', /^en/i.test(defaultVoice(MACHINE).lang), defaultVoice(MACHINE).lang);

// A natural voice still wins over a merely pleasant one.
const noAria = MACHINE.filter((entry) => !/aria/i.test(entry.name));
check('still prefers natural without an ARIA voice', /natural/i.test(defaultVoice(noAria).name), defaultVoice(noAria).name);

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
check('groups English separately', english.length === 8 && others.length === 3, `${english.length}/${others.length}`);
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
check('app sends the specified parameters', /utterance\.rate = TTS\.rate/.test(app)
  && /utterance\.pitch = TTS\.pitch/.test(app)
  && /utterance\.volume = TTS\.volume/.test(app));
check('voice list comes from getVoices', /getVoices/.test(await readFile(resolve(root, 'src/speech.js'), 'utf8')));
check('listens for late voice loading', /voiceschanged/.test(app));
check('the selector is labelled ARIA Voice', />ARIA Voice</.test(app));

// Regression: the voice list arrives after first render and does not change
// `settings`, so a memoized askAria would otherwise call a speaker that never saw it
// and would ignore the selected voice for the rest of the session.
check('speaker is reached through a ref, not a stale closure',
  /speakRef\.current = speakAnswer/.test(app) && /speakRef\.current\?\.\(answer\)/.test(app));

// ------------------------------------------------- the panel, actually rendered
// Renders the real component, so the selector is inspected as markup rather than as
// source text.
async function renderPanel(voices, savedKey) {
  const result = await build({
    stdin: {
      contents: `
        import { createElement } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { SettingsPanel } from './src/App.jsx';
        const voices = ${JSON.stringify(voices)};
        const settings = { model: 'mistral:7b-instruct-q4_K_M', ollamaUrl: '', voiceKey: ${JSON.stringify(savedKey)}, showTranscript: false };
        process.stdout.write(renderToStaticMarkup(createElement(SettingsPanel, {
          settings, voices, connection: 'connected', modelAvailable: true, standalone: false,
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
    define: { __ARIA_STANDALONE__: 'false' },
    logLevel: 'warning',
  });

  const dir = await mkdtemp(join(tmpdir(), 'aria-panel-'));
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

check('panel renders the ARIA Voice selector', /<label[^>]*for="aria-voice"[^>]*>ARIA Voice<\/label>|>ARIA Voice</.test(panel));
check('panel renders a select bound to aria-voice', /<select[^>]*id="aria-voice"/.test(panel));
check('selector lists every voice', options.length === MACHINE.length, `${options.length} of ${MACHINE.length}`);
check('selector groups English and other languages', /<optgroup label="English">/.test(panel) && /<optgroup label="Other languages">/.test(panel));
check('English voices appear before other languages', panel.indexOf('<optgroup label="English">') < panel.indexOf('<optgroup label="Other languages">'));
check('labels mark which voices work offline', options.some((option) => option.label.includes('· offline')) && options.some((option) => option.label.includes('· network')));

const bestKey = voiceKey(best);
const selectedOption = options.find((option) => option.value === bestKey);
check('the natural voice is offered as an option', Boolean(selectedOption), bestKey);
check('the natural voice is pre-selected', new RegExp(`<option value="${bestKey}"[^>]*selected`).test(panel)
  || /selected[^>]*value="[^"]*aria/i.test(panel) || panel.includes(`value="${bestKey}" selected`),
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
check('panel survives an empty voice list', /<select[^>]*id="aria-voice"/.test(emptyPanel) && /No voices available/.test(emptyPanel));

const failed = problems.length;
for (const { label, ok, detail } of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}
console.log(failed ? `\n${failed} check(s) failed.` : `\nAll ${checks.length} checks passed.`);
if (failed) process.exitCode = 1;
