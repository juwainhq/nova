// Verify `nova.html` really is a single self-contained file that works from file://.
// Runs as part of `npm run build:standalone`, and standalone via `node scripts/verify-standalone.mjs`.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Script, runInNewContext } from 'node:vm';

const root = process.cwd();
const FILE = resolve(root, 'nova.html');

const problems = [];
const checks = [];

function check(label, ok, detail = '') {
  checks.push({ label, ok, detail });
  if (!ok) problems.push(label);
}

const html = await readFile(FILE, 'utf8');

// Strip embedded code so tag checks only see real markup, not strings inside JS.
const markupOnly = html
  .replace(/<script\b[\s\S]*?<\/script>/gi, '<script></script>')
  .replace(/<style\b[\s\S]*?<\/style>/gi, '<style></style>');

const externalScript = /<script[^>]*\ssrc\s*=/i.test(markupOnly);
const externalStyle = /<link[^>]*\srel\s*=\s*["']?stylesheet/i.test(markupOnly);
const externalRefs = [...markupOnly.matchAll(/\s(?:src|href)\s*=\s*["']([^"']*)["']/gi)]
  .map((match) => match[1]);
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/i);
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);

check('has a doctype', /^<!doctype html>/i.test(html.trimStart()));
check('loads no external script', !externalScript);
check('loads no external stylesheet', !externalStyle);
check('references no relative or remote assets', externalRefs.length === 0,
  externalRefs.length ? `found ${externalRefs.join(', ')}` : '');
check('inlines a non-empty stylesheet', Boolean(styleMatch) && styleMatch[1].trim().length > 1000,
  styleMatch ? `${styleMatch[1].trim().length} bytes` : 'missing');
check('inlines a non-empty script', Boolean(scriptMatch) && scriptMatch[1].trim().length > 10000,
  scriptMatch ? `${scriptMatch[1].trim().length} bytes` : 'missing');
// Counted on markup only: the bundle legitimately contains the text "<script".
check('ships exactly one style block', (markupOnly.match(/<style\b/gi) || []).length === 1);
check('ships exactly one script block', (markupOnly.match(/<script\b/gi) || []).length === 1);

check('explains how to open CORS', html.includes('OLLAMA_ORIGINS'));
check('keeps the file:// specific guidance', /file:\/\//.test(html) || /standalone/i.test(html));
check('mounts into the root element', html.includes('id="root"'));
check('is large enough to contain the app', html.length > 100000, `${(html.length / 1024).toFixed(1)} kB`);
check('guards inline script against early termination', !/<\/script>/i.test(scriptMatch?.[1] ?? ''));

// The build-time flag must be substituted and folded, so the file defaults to
// calling Ollama directly rather than a proxy path that cannot exist on file://.
check('substitutes the build-time flag', !html.includes('__NOVA_STANDALONE__'));

// Ollama is the only remaining service; speech output is the browser's own, so it
// needs no endpoint at all.
const EXPECTED_DEFAULTS = ['http://localhost:11434'];
const script = scriptMatch?.[1] ?? '';

// The default compiles to `function f(){return FLAG?"url":""}`; capture the flag
// name from the code itself rather than guessing at a minified identifier.
const guarded = [...script.matchAll(/function\s+([\w$]+)\s*\(\)\s*\{\s*return\s+([\w$]+)\s*\?\s*"([^"]*)"\s*:\s*""\s*\}/g)];
const flag = guarded[0]?.[2];

// Minifiers may choose `$a` or `a$`. A word boundary does not recognize a
// leading $, and an unescaped $ is a regex anchor, not an identifier character.
function compiledBoolean(source, name) {
  const identifier = name.replace(/\$/g, '\\$');
  const assignment = source.match(new RegExp(`(?:^|[^\\w$])${identifier}\\s*=\\s*(!0|!1|true|false)(?=[,;}\\s]|$)`));
  return assignment ? /^(?:!0|true)$/.test(assignment[1]) : null;
}
check('compiled-default checks accept dollar-containing minified names', compiledBoolean('var $a=!0,next=1;', '$a') === true
  && compiledBoolean('var a$=!1;', 'a$') === false && compiledBoolean('var other$a=true;', '$a') === null);

if (!guarded.length || !flag) {
  check('defaults to a direct local Ollama endpoint', false, 'could not locate the compiled endpoint default');
} else {
  const flagValue = compiledBoolean(script, flag);
  if (flagValue !== true) {
    check('defaults to a direct local Ollama endpoint', false,
      flagValue === null ? `could not resolve the value of ${flag}` : 'the standalone flag compiled to false');
  } else {
    const name = guarded[0][1];
    try {
      const url = runInNewContext(`${flag}=!0;${guarded[0][0]};${name}()`);
      check('defaults to a direct local Ollama endpoint', url === EXPECTED_DEFAULTS[0], `got ${JSON.stringify(url)}`);
    } catch (error) {
      check('defaults to a direct local Ollama endpoint', false, error.message);
    }
  }
}

// Speech is entirely local now, so nothing in the file may reach a speech service.
check('needs no speech API key', !/xi-api-key|elevenlabs/i.test(html));
check('speaks through the Web Speech API', /speechSynthesis/.test(html));

// The UI builds names from the brand constant, so the app name appears in the bundle
// as its own string rather than glued into every label. The rendered wording is
// asserted in verify-speech.mjs, which mounts the real panel.
check('shell is titled NOVA', /<title>NOVA\b/.test(html));
check('bundle carries the brand name', /"NOVA"/.test(html));
check('voice selector is bound to nova-voice', /nova-voice/.test(html));
check('includes the browser memory store', script.includes('nova_memories'));
check('includes remembered facts in the system prompt', script.includes('Things the user has told you to remember:'));
check('ships the memory settings controls', script.includes('Clear all memories') && script.includes('memory-list'));
check('ships the friendly personality and conditional voice brevity rules', script.includes('a warm, friendly, and genuinely helpful personal AI assistant.')
  && script.includes('You never use sarcasm unless the user is clearly joking first.')
  && script.includes('2-3 sentences max unless the user asks for more detail.'));
check('ships warm startup and connection messages', script.includes('Waking up...')
  && script.includes("Hmm, I can't reach Ollama right now. Is it running?"));
check('does not ship obsolete personality or robotic status copy', !/warm and witty|100% locally|NOVA READY|Query processed\.|Initializing\.\.\./.test(script));
check('ships response link cards with safe new-tab navigation', script.includes('rich-link-card') && script.includes('noopener noreferrer') && script.includes('_blank'));
check('ships Google Images searches with a local placeholder and View Images action', script.includes('https://www.google.com/search')
  && script.includes('rich-image-placeholder') && script.includes('View Images'));
check('loads Kokoro TTS at runtime from the pinned CDN browser build, not inlined', /kokoro-js@\$\{\w+\}\/dist\/kokoro\.web\.js/.test(script)
  && /=\s*"1\.2\.1"/.test(script) && script.includes('import(data.url)') && !script.includes('KokoroTTS.prototype') && script.includes('Kokoro AI'));
check('ships numbered/bulleted response item cards', script.includes('rich-items') && script.includes('rich-item-card'));
check('keeps rich content in its own sliding/fading row, not an avatar overlay', styleMatch[1].includes('.app-shell.has-rich-content')
  && styleMatch[1].includes('minmax(min-content,1fr)') && styleMatch[1].includes('rich-panel-in') && styleMatch[1].includes('rich-panel-out'));

check('ships both avatars and the persistent appearance picker', script.includes('nova_avatar') && script.includes('Avatar style')
  && script.includes('bot-head') && script.includes('avatar-waveform') && script.includes('orbSurface'));
check('inlines both avatar palettes and shared expression styles', /--canvas:\s*#0a0a2e/.test(styleMatch[1])
  && /--canvas:\s*#050300/.test(styleMatch[1]) && styleMatch[1].includes('.expression-thinking .avatar-eye')
  && styleMatch[1].includes('.expression-surprised .avatar-eye') && styleMatch[1].includes('.avatar-choice.is-selected'));

check('keeps the Orb face charcoal and its effects amber', /\.nova-orb\{[^}]*--avatar-eye-line:\s*var\(--eye-color,\s*#1a1a1a\)/.test(styleMatch[1])
  && /\.nova-orb\{[^}]*--avatar-face-accent:\s*#ff6a1a/.test(styleMatch[1]));

check('the single-file download does not register a worker or need a manifest', !script.includes('serviceWorker.register')
  && !script.includes('offline support could not be enabled') && !/rel=["']manifest["']/.test(html));

// Guards the `</script>` escaping: a mangled inline script would otherwise still
// satisfy every structural check above.
try {
  new Script(scriptMatch[1]);
  check('inline script is valid JavaScript', true);
} catch (error) {
  check('inline script is valid JavaScript', false, error.message);
}

const failed = problems.length;
for (const { label, ok, detail } of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}
console.log(failed ? `\n${failed} check(s) failed.` : `\nAll ${checks.length} checks passed.`);
if (failed) process.exitCode = 1;
