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

if (!guarded.length || !flag) {
  check('defaults to a direct local Ollama endpoint', false, 'could not locate the compiled endpoint default');
} else {
  const assignment = script.match(new RegExp(`\\b${flag}\\s*=\\s*(!0|!1|true|false)`));
  const flagValue = assignment ? /!0|true/.test(assignment[1]) : null;
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
