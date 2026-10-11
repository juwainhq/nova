// Check the avatar still matches its specification after an edit.
//
// Verified two ways: the SVG is rendered to real markup through React (so the
// element structure is checked, not the source text), and index.css is checked for
// the eye and body behaviour each state is supposed to have.
//
//   node scripts/verify-avatar.mjs
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

async function renderAvatar() {
  const result = await build({
    stdin: {
      contents: `
        import { createElement } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import RobotAvatar from './src/RobotAvatar.jsx';
        process.stdout.write(renderToStaticMarkup(createElement(RobotAvatar)));
      `,
      resolveDir: root,
      loader: 'jsx',
    },
    bundle: true,
    write: false,
    platform: 'node',
    // CJS, not ESM: react-dom/server requires node builtins, which an ESM bundle
    // cannot express. Bundling everything keeps the probe runnable from /tmp,
    // where bare imports would not resolve against this project's node_modules.
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'warning',
  });

  const directory = await mkdtemp(join(tmpdir(), 'aria-avatar-'));
  const file = join(directory, 'probe.cjs');
  try {
    await writeFile(file, result.outputFiles[0].text, 'utf8');
    const { stdout } = await run(process.execPath, [file], { cwd: root });
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const markup = await renderAvatar();
const css = await readFile(resolve(root, 'src/index.css'), 'utf8');
// Comments explain the absence of a mouth, so strip them before searching.
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');

// ---------------------------------------------------------------- SVG structure
check('renders an svg', /^<svg class="robot-avatar"/.test(markup));
check('has no mouth element', !/mouth/i.test(markup), markup.match(/class="[^"]*mouth[^"]*"/g)?.join(', ') ?? '');
check('has no mouthBloom filter', !/mouthBloom/.test(markup));
check('keeps the orb body', markup.includes('class="blob-shape"'));
check('has exactly two eyes', (markup.match(/class="robot-eye robot-eye-/g) || []).length === 2);
check('has a left and a right eye', /robot-eye-left/.test(markup) && /robot-eye-right/.test(markup));
check('lays eyes out as gaze > size > blink', (markup.match(/class="eye-scale"/g) || []).length === 2
  && (markup.match(/class="eye-lid"/g) || []).length === 2);
check('includes a crescent shape per eye', (markup.match(/class="eye-crescent"/g) || []).length === 2);
check('keeps an iris and a spark per eye', (markup.match(/class="eye-iris"/g) || []).length === 2
  && (markup.match(/class="eye-spark"/g) || []).length === 2);

// ------------------------------------------------------------- motion plumbing
check('pose and rhythm use separate elements',
  /\.avatar-figure\s*\{[^}]*transform:/.test(cssCode) && /\.robot-avatar\s*\{[^}]*animation:/.test(cssCode));
check('eyes define all three motion layers',
  /\.eye-scale\s*\{[^}]*scale\(var\(--eye-sx/.test(cssCode) && /\.eye-lid\s*\{[^}]*animation: eye-blink/.test(cssCode));

const keyframes = (name) => new RegExp(`@keyframes\\s+${name}\\b`).test(cssCode);

function rulesFor(selector) {
  // Collect the bodies of every rule whose selector list contains `selector`.
  const bodies = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(cssCode)) !== null) {
    const selectors = match[1].split(',').map((part) => part.trim());
    if (selectors.some((part) => part === selector || part.split(/\s+/).includes(selector)
      || part.startsWith(`${selector} `) || part.includes(`${selector}:`))) {
      bodies.push(match[2]);
    }
  }
  return bodies.join('\n');
}

const idle = rulesFor('.robot-avatar');
const idleEyes = rulesFor('.eye-lid');
const listening = rulesFor('.is-listening');
const thinking = rulesFor('.is-thinking');
const speaking = rulesFor('.is-speaking');
const happy = rulesFor('.is-happy');
const offline = rulesFor('.is-offline');

// ------------------------------ IDLE: steady glow, occasional blink, gentle float
check('idle: body floats up and down', keyframes('orb-float') && /animation: orb-float/.test(idle));
check('idle: eyes glow softly', /drop-shadow/.test(idleEyes));
check('idle: slow occasional blink', keyframes('eye-blink') && /--eye-blink, 7\.6s/.test(idleEyes));

// --------------------- LISTENING: bigger, brighter, lean in, 5 degree tilt, ring
check('listening: eyes grow bigger', /--eye-sx: 1\.1[6-9]/.test(listening));
check('listening: eyes get brighter', /--eye-blink: 6\.4s/.test(listening) && /drop-shadow\(0 0 3\.6px/.test(listening));
check('listening: body tilts 5 degrees', /--figure-tilt: -5deg/.test(listening));
check('listening: leans in', /--figure-scale: 1\.0[0-9]/.test(listening));
check('listening: subtle pulse ring', /\.is-listening \.listen-ring\s*\{[^}]*animation: listen-pulse/.test(cssCode));

// ------------------ THINKING: gaze side to side, one squint, 3% smaller, wobble
check('thinking: gaze moves side to side', keyframes('eyes-thinking') && /animation: eyes-thinking/.test(thinking));
check('thinking: one eye squints', /\.is-thinking \.robot-eye-left \.eye-scale\s*\{[^}]*--eye-sy: \.7/.test(cssCode));
check('thinking: shrinks 3 percent', /--figure-scale: \.97/.test(thinking));
check('thinking: body wobbles', keyframes('orb-wobble') && /animation: orb-wobble/.test(thinking));

// ----------------- SPEAKING: wider, brighter, rapid blinks, 5% bigger, word beat
check('speaking: eyes wider', /--eye-sx: 1\.1/.test(speaking));
check('speaking: rapid blinking', keyframes('eye-blink-rapid') && /animation: eye-blink-rapid/.test(speaking));
check('speaking: grows 5 percent', /--figure-scale: calc\(1\.05/.test(speaking));
check('speaking: body bounces on each word', keyframes('orb-word-bounce')
  && /animation: orb-word-bounce/.test(speaking));
check('speaking: eyes brighten with the voice', /--audio-pulse/.test(speaking));

// ------------------------------ HAPPY: crescent eyes, quick jump, small bounces
check('happy: crescent eyes replace the iris', /\.is-happy \.eye-crescent\s*\{[^}]*opacity: 1/.test(cssCode)
  && /\.is-happy \.eye-lid\s*\{[^}]*opacity: 0/.test(cssCode));
check('happy: quick jump then small bounces', keyframes('orb-happy-hop') && /animation: orb-happy-hop/.test(happy));

// ------------------------------ OFFLINE: droop, half brightness, slow sad sway
check('offline: eyes droop', /--eye-sy: \.68/.test(offline));
check('offline: eyes dim to half brightness', /opacity: \.5;/.test(rulesFor('.is-offline .robot-eye')));
check('offline: slow sad sway', keyframes('orb-sad-sway') && /animation: orb-sad-sway/.test(offline));
check('offline rules come last', cssCode.indexOf('.is-offline .robot-eye') > cssCode.indexOf('.is-happy .robot-eye'));

// ------------------------------------------------------------------- hygiene
check('no mouth selectors remain in css', !/\.mouth-|\.orb-smile/.test(cssCode));
check('no mouth keyframes remain', !/mouth-glow-pulse|mouth-light-pulse/.test(cssCode));
check('reduced motion is still honoured', /@media \(prefers-reduced-motion: reduce\)/.test(cssCode));

// ------------------------------------------------------------- state sheet
// A sheet of every state, built from the real CSS and the real rendered markup, so
// the motion can be reviewed without a microphone, a model or a network.
const STATES = [
  ['idle', 'IDLE', 'float · slow blink'],
  ['is-listening', 'LISTENING', 'bigger + brighter · 5° tilt · ring'],
  ['is-thinking', 'THINKING', 'side to side · one squint · −3% · wobble'],
  ['is-speaking', 'SPEAKING', 'wider · rapid blinks · +5% · word beat'],
  ['is-happy', 'HAPPY', 'crescents · jump then bounces'],
  ['is-offline', 'OFFLINE', 'droop · half brightness · sad sway'],
];

const sheet = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ARIA — avatar states</title>
    <style>
${css}
      body { margin: 0; padding: 34px 26px 44px; background: #0d0805; }
      .sheet-head { max-width: 1080px; margin: 0 auto 26px; }
      .sheet-head h1 { margin: 0; color: #fff7ef; font-size: 20px; font-weight: 600; letter-spacing: -.02em; }
      .sheet-head p { margin: 7px 0 0; color: #a38a72; font-size: 11px; line-height: 1.6; }
      .sheet { display: grid; gap: 14px; max-width: 1080px; margin: 0 auto; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
      .cell { display: flex; flex-direction: column; align-items: center; padding: 18px 12px 16px; border: 1px solid rgba(245, 201, 154, .12); border-radius: 10px; background: rgba(255, 247, 239, .015); }
      .cell .avatar-container { animation: none; }
      .cell-label { margin-top: 12px; color: #f2d6b8; font: 10px var(--mono); letter-spacing: .16em; }
      .cell-note { margin-top: 6px; color: #8f775f; font-size: 10px; line-height: 1.5; text-align: center; }
    </style>
  </head>
  <body>
    <div class="sheet-head">
      <h1>ARIA — avatar states</h1>
      <p>Generated by <code>scripts/verify-avatar.mjs</code> from the real stylesheet and the
      rendered avatar markup, so this sheet cannot drift from the app. No mouth: every state is
      expressed through the eyes and the body. Values for the audio-driven states are frozen here,
      since nothing is actually speaking.</p>
    </div>
    <div class="sheet">
${STATES.map(([className, label, note]) => `      <div class="cell">
        <div class="avatar-container ${className}">
          <div class="avatar-backlight"></div>
          <div class="listen-ring"></div>
          <div class="avatar-figure">${markup}</div>
        </div>
        <div class="cell-label">${label}</div>
        <div class="cell-note">${note}</div>
      </div>`).join('\n')}
    </div>
  </body>
</html>
`;

await writeFile(resolve(root, 'avatar-states.html'), sheet, 'utf8');

const failed = problems.length;
for (const { label, ok, detail } of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}
console.log(failed ? `\n${failed} check(s) failed.` : `\nAll ${checks.length} checks passed.`);
console.log('Wrote avatar-states.html — open it to review every state side by side.');
if (failed) process.exitCode = 1;
