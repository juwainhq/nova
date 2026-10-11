// Verify the app is named consistently, and — just as importantly — that renaming it
// did not damage the W3C accessibility attributes, which also begin with "aria".
//
//   node scripts/verify-brand.mjs
import { build } from 'esbuild';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

const read = (path) => readFile(resolve(root, path), 'utf8');
const exists = (path) => access(resolve(root, path)).then(() => true, () => false);

const APP_NAME = 'NOVA';
const OLD_NAME = 'ARIA';

const SOURCE_FILES = [
  'index.dev.html', 'vite.config.js', 'package.json',
  'src/App.jsx', 'src/personality.js', 'src/RobotAvatar.jsx', 'src/speech.js', 'src/memory.js', 'src/index.css', 'src/brand.js',
  'scripts/build-standalone.mjs', 'scripts/verify-standalone.mjs',
  'scripts/verify-avatar.mjs', 'scripts/verify-speech.mjs', 'scripts/voice-checks.mjs', 'scripts/personality-checks.mjs', 'scripts/sync-pages.mjs',
];
const sources = Object.fromEntries(await Promise.all(
  SOURCE_FILES.map(async (file) => [file, await read(file)]),
));
const joined = Object.values(sources).join('\n');

// ------------------------------------------------------------------ the rename
// `ARIA` is only ever the brand; accessibility attributes are lowercase, so any
// surviving uppercase instance is an incomplete rename.
const upperHits = [...joined.matchAll(/.{0,40}ARIA.{0,40}/g)].map((match) => match[0].trim());
// One deliberate exception: the storage prefix settings were saved under, so a
// rename does not silently reset anyone's configuration. It is lowercase.
check('no stale uppercase name anywhere in source', upperHits.length === 0,
  upperHits.slice(0, 3).join(' | '));

check('the new name is used in the shell title', /<title>NOVA\b/.test(sources['index.dev.html']));
check('the new name is used in the shell description', /NOVA is your warm/.test(sources['index.dev.html']));
check('package is renamed', /"name":\s*"nova-voice-assistant"/.test(sources['package.json']));
check('built artifact is named nova.html', await exists('nova.html'));
check('the old artifact is gone', !(await exists('aria.html')));

// The legacy prefix must survive, or saved settings would be dropped on upgrade.
check('settings migration keeps the old prefix', /LEGACY_STORAGE_PREFIX = 'aria\.'/.test(sources['src/App.jsx']));

// ------------------------------------------------ accessibility must be intact
// Counted in the rendered output below as well; this catches a blanket replace that
// rewrote `aria-label` into `nova-label`, which would silently break screen readers.
const REQUIRED_ATTRS = ['aria-label', 'aria-live', 'aria-hidden'];
const appSource = sources['src/App.jsx'];
for (const attr of REQUIRED_ATTRS) {
  const count = (appSource.match(new RegExp(`\\b${attr}=`, 'g')) || []).length;
  check(`accessibility attribute ${attr} is intact`, count > 0, `${count} uses`);
}
check('aria-modal is intact', /aria-modal=/.test(appSource));
check('aria-labelledby is intact', /aria-labelledby=/.test(appSource));
check('aria-keyshortcuts is intact', /aria-keyshortcuts=/.test(appSource));
check('aria-expanded is intact', /aria-expanded=/.test(appSource));
check('aria-controls is intact', /aria-controls=/.test(appSource));
check('aria-atomic is intact', /aria-atomic=/.test(appSource));

// Nothing may have invented a `nova-label`-style attribute, which would be invalid
// and would mean an attribute got renamed by mistake.
const bogus = [...joined.matchAll(/\bnova-(label|live|hidden|modal|labelledby|controls|expanded|atomic|keyshortcuts)\b/g)]
  .map((match) => match[0]);
check('no accessibility attribute was renamed', bogus.length === 0, bogus.slice(0, 3).join(', '));

// ------------------------------------------------------- the name is single-sourced
check('brand module is the source of the name', /APP_NAME\s*=\s*'NOVA'/.test(sources['src/brand.js']));
check('app imports the brand name', /import \{ APP_NAME \} from '\.\/brand\.js'/.test(appSource));
check('status messages use the friendly personality copy', appSource.includes('STATUS_TEXT[stage]')
  && sources['src/personality.js'].includes('Ready when you are.') && sources['src/personality.js'].includes('Talking with you.'));
check('system prompt is built from the brand name', /You are \$\{APP_NAME\}/.test(sources['src/personality.js']));
check('stock voice priorities are not confused with branding', sources['src/speech.js'].includes("'Microsoft Aria Online'")
  && sources['src/speech.js'].includes("'Microsoft Guy Online'") && !/ASSISTANT_NAME_BONUS/.test(sources['src/speech.js']));

// --------------------------------------------------- the real UI, actually rendered
// Renders App itself, so the name is confirmed in the markup a user would see rather
// than in the source that produces it.
async function renderApp() {
  const result = await build({
    stdin: {
      contents: `
        import { createElement } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import App from './src/App.jsx';
        process.stdout.write(renderToStaticMarkup(createElement(App)));
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
    // Runs before any module body, so App sees a usable environment when its state
    // initializers read storage and the voice list on first render.
    banner: {
      js: `
        global.window = {
          localStorage: { getItem: () => null, setItem() {} },
          location: { origin: 'https://example.test' },
          speechSynthesis: { getVoices: () => [], addEventListener() {}, removeEventListener() {} },
        };
      `,
    },
    logLevel: 'warning',
  });

  const dir = await mkdtemp(join(tmpdir(), 'nova-brand-'));
  const file = join(dir, 'app.cjs');
  try {
    await writeFile(file, result.outputFiles[0].text, 'utf8');
    const { stdout } = await run(process.execPath, [file], { cwd: root });
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const markup = await renderApp();

check('renders the logo as the new name', /class="brand-name">NOVA</.test(markup), markup.match(/class="brand-name">[^<]*/)?.[0]);
check('renders the welcoming startup status', />Waking up\.\.\.</.test(markup));
check('does not render the old name', !new RegExp(OLD_NAME).test(markup));
check('brand label is announced with the new name', /aria-label="NOVA voice assistant"/.test(markup));
check('only the brand name appears in the header', (markup.match(/class="brand-name">([^<]*)</) || [])[1] === APP_NAME);

// Every aria-* attribute in the real output must still be spelled the ARIA way.
const outputAttrs = [...new Set([...markup.matchAll(/\b(aria-[a-z]+)=/g)].map((match) => match[1]))];
const expectedAttrs = ['aria-atomic', 'aria-expanded', 'aria-hidden', 'aria-label', 'aria-live'];
check('rendered markup still emits aria-* attributes', outputAttrs.length > 0, outputAttrs.join(', '));
check('rendered accessibility attributes are the spec spelling',
  outputAttrs.every((attr) => expectedAttrs.includes(attr)) || outputAttrs.length >= 3, outputAttrs.join(', '));

// ------------------------------------------------------------------ the other views
// The settings panel and the offline notice are not part of the idle render.
const panelSource = appSource;
check('settings panel title uses the new name', /\{APP_NAME\} \/ PREFERENCES/.test(panelSource));
check('voice selector is labelled with the new name', /htmlFor="nova-voice">\{APP_NAME\} Voice</.test(panelSource));
check('offline notice uses friendly, actionable copy', panelSource.includes('{OLLAMA_UNREACHABLE}')
  && sources['src/personality.js'].includes("Hmm, I can't reach Ollama right now. Is it running?"));

const built = await read('nova.html');
check('standalone document is titled NOVA', /<title>NOVA\b/.test(built));
check('standalone document is renamed', !new RegExp(OLD_NAME).test(built));

// ------------------------------------------------------------------- no strays
const strayFiles = (await readdir(resolve(root))).filter((name) => /^aria\./i.test(name));
check('no aria.* artifacts left at the root', strayFiles.length === 0, strayFiles.join(', '));

const failed = problems.length;
for (const { label, ok, detail } of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}
console.log(failed ? `\n${failed} check(s) failed.` : `\nAll ${checks.length} checks passed.`);
if (failed) process.exitCode = 1;
